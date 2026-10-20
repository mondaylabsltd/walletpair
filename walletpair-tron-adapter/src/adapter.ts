// WalletPair for @tronweb3/tronwallet-adapter: the WalletPair browser extension
// as a TRON wallet, under its own name. It talks to the extension's TIP-1193
// provider (spec/networks/tron.md §3), found through TIP-6963.

import {
  AdapterState,
  AddonAdapter,
  NetworkType,
  TIP6963AnnounceProviderEventName,
  TIP6963RequestProviderEventName,
  WalletConnectionError,
  WalletDisconnectedError,
  WalletError,
  WalletGetNetworkError,
  WalletReadyState,
  WalletSignMessageError,
  WalletSignTransactionError,
  WalletSwitchChainError,
  isInBrowser,
} from '@tronweb3/tronwallet-abstract-adapter';
import type {
  AdapterName,
  BaseAdapterConfig,
  Network,
  SignedTransaction,
  TIP6963AnnounceProviderEvent,
  Transaction,
} from '@tronweb3/tronwallet-abstract-adapter';

export const WalletPairAdapterName = 'WalletPair' as AdapterName<'WalletPair'>;

/** The reverse-DNS name the WalletPair extension announces with TIP-6963. */
export const WALLETPAIR_RDNS = 'org.walletpair.extension';

export type WalletPairAdapterConfig = BaseAdapterConfig;

type Listener = (...args: any[]) => void;

/** The extension's TIP-1193 provider and the signing object it exposes once the site is approved. */
interface WalletPairTron {
  request(args: { method: string; params?: unknown }): Promise<any>;
  on(event: string, listener: Listener): unknown;
  removeListener(event: string, listener: Listener): unknown;
  tronWeb:
    | false
    | {
        defaultAddress: { base58: string | false };
        fullNode: { host: string };
        solidityNode: { host: string };
        eventServer: { host: string };
        trx: {
          sign(transaction: Transaction): Promise<SignedTransaction>;
          multiSign(transaction: Transaction, privateKey?: string, permissionId?: number): Promise<SignedTransaction>;
          signMessageV2(message: string): Promise<string>;
        };
      };
}

declare global {
  interface Window {
    walletpair?: { tron?: WalletPairTron };
  }
}

const NETWORKS: Record<string, NetworkType> = {
  '0x2b6653dc': NetworkType.Mainnet,
  '0x94a9059e': NetworkType.Shasta,
  '0xcd8690dc': NetworkType.Nile,
};

const ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMjggMTI4Ij48cmVjdCB3aWR0aD0iMTI4IiBoZWlnaHQ9IjEyOCIgcng9IjI0IiBmaWxsPSIjMTExODI3Ii8+PHBhdGggZD0iTTIyIDQyIFEyMiAzMCAzNCAzMCBMNTQgMzAgTDU0IDU0IEwzOCA2NCBMNTQgNzQgTDU0IDk4IEwzNCA5OCBRMjIgOTggMjIgODYgWiIgZmlsbD0id2hpdGUiLz48cGF0aCBkPSJNMTA2IDQyIFExMDYgMzAgOTQgMzAgTDc0IDMwIEw3NCA1NCBMOTAgNjQgTDc0IDc0IEw3NCA5OCBMOTQgOTggUTEwNiA5OCAxMDYgODYgWiIgZmlsbD0id2hpdGUiLz48cmVjdCB4PSI1MiIgeT0iNTIiIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgcng9IjIiIHRyYW5zZm9ybT0icm90YXRlKDQ1IDY0IDY0KSIgZmlsbD0iIzNiODJmNiIvPjwvc3ZnPg==';

/** Turns what the extension rejects with (an error, or the string TRON pages expect) into an adapter error. */
function wrap<E extends WalletError>(error: unknown, Kind: new (message?: string, error?: unknown) => E): E {
  if (error instanceof WalletError) return error as E;
  if (typeof error === 'string') return new Kind(error, new Error(error));
  const message = (error as { message?: string } | null)?.message ?? 'Unknown error';
  return new Kind(message, error);
}

export class WalletPairAdapter extends AddonAdapter {
  name = WalletPairAdapterName;
  url = 'https://walletpair.org';
  icon = ICON;

  config: Required<WalletPairAdapterConfig>;
  private _readyState: WalletReadyState = isInBrowser() ? WalletReadyState.Loading : WalletReadyState.NotFound;
  private _state: AdapterState = AdapterState.Loading;
  private _connecting = false;
  private _address: string | null = null;
  private _provider: WalletPairTron | null = null;
  private _checkPromise: Promise<boolean> | null = null;

  constructor(config: WalletPairAdapterConfig = {}) {
    super(config);
    this.config = { ...this.commonConfig };
    if (!isInBrowser()) {
      this._state = AdapterState.NotFound;
      return;
    }
    void this._checkWallet().then(() => {
      if (this.connected) this.emit('connect', this.address || '');
    });
  }

  get address(): string | null {
    return this._address;
  }

  get state(): AdapterState {
    return this._state;
  }

  get readyState(): WalletReadyState {
    return this._readyState;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  protected async _connect(): Promise<void> {
    try {
      if (!(await this._beforeConnect())) return;
      this._connecting = true;
      const accounts: string[] = await this._provider!.request({ method: 'eth_requestAccounts' });
      if (!accounts?.[0]) throw new WalletConnectionError('The wallet returned no account.');
      this._setAddress(accounts[0]);
      this._setState(AdapterState.Connected);
      this.emit('connect', accounts[0]);
    } catch (error) {
      const err = wrap(error, WalletConnectionError);
      this.emit('error', err);
      throw err;
    } finally {
      this._connecting = false;
    }
  }

  /** The site stops seeing the account (the WalletPair session itself stays). */
  async disconnect(): Promise<void> {
    if (this.state !== AdapterState.Connected) return;
    try {
      await this._provider?.request({ method: 'wallet_revokePermissions' });
    } catch {
      // The adapter is disconnected either way.
    }
    this._setAddress(null);
    this._setState(AdapterState.Disconnect);
    this.emit('disconnect');
  }

  async signMessage(message: string): Promise<string> {
    try {
      const tronWeb = await this._signer();
      try {
        return await tronWeb.trx.signMessageV2(message);
      } catch (error) {
        throw wrap(error, WalletSignMessageError);
      }
    } catch (error) {
      this.emit('error', error as WalletError);
      throw error;
    }
  }

  async signTransaction(transaction: Transaction): Promise<SignedTransaction> {
    try {
      const tronWeb = await this._signer();
      try {
        return await tronWeb.trx.sign(transaction);
      } catch (error) {
        throw wrap(error, WalletSignTransactionError);
      }
    } catch (error) {
      this.emit('error', error as WalletError);
      throw error;
    }
  }

  /** The transaction must already carry its Permission_id (WalletPair signs; it does not query nodes). */
  async multiSign(transaction: Transaction, options: { permissionId?: number } = {}): Promise<SignedTransaction> {
    try {
      const tronWeb = await this._signer();
      try {
        return await tronWeb.trx.multiSign(transaction, undefined, options.permissionId);
      } catch (error) {
        throw wrap(error, WalletSignTransactionError);
      }
    } catch (error) {
      this.emit('error', error as WalletError);
      throw error;
    }
  }

  async switchChain(chainId: string): Promise<void> {
    try {
      await this._checkWallet();
      if (!this._provider) throw new WalletDisconnectedError();
      try {
        await this._provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId }] });
      } catch (error) {
        throw wrap(error, WalletSwitchChainError);
      }
    } catch (error) {
      this.emit('error', error as WalletError);
      throw error;
    }
  }

  /** The active network, from the wallet's chain ID: no node is queried. */
  async network(): Promise<Network> {
    try {
      const tronWeb = await this._signer();
      try {
        const chainId: string = await this._provider!.request({ method: 'eth_chainId' });
        return {
          networkType: NETWORKS[chainId] ?? NetworkType.Unknown,
          chainId,
          fullNode: tronWeb.fullNode.host,
          solidityNode: tronWeb.solidityNode.host,
          eventServer: tronWeb.eventServer.host,
        };
      } catch (error) {
        throw wrap(error, WalletGetNetworkError);
      }
    } catch (error) {
      this.emit('error', error as WalletError);
      throw error;
    }
  }

  protected _openAppByDeepLinkIfNeed(): boolean {
    // WalletPair is a browser extension paired with the phone; there is no app to open here.
    return false;
  }

  /**
   * Finds the extension: its TIP-6963 announcement, or `window.walletpair.tron`.
   * A failed detection is not cached, since the extension may be enabled later.
   */
  protected _checkWallet(): Promise<boolean> {
    if (this._readyState === WalletReadyState.Found && this._provider) return Promise.resolve(true);
    if (this._checkPromise) return this._checkPromise;
    if (!isInBrowser()) return Promise.resolve(false);

    const detection = new Promise<boolean>((resolve) => {
      const found = (provider: WalletPairTron) => {
        window.removeEventListener(TIP6963AnnounceProviderEventName, onAnnounce);
        clearTimeout(timer);
        this._useProvider(provider);
        resolve(true);
      };
      const onAnnounce = (event: TIP6963AnnounceProviderEvent) => {
        if (event.detail?.info?.rdns === WALLETPAIR_RDNS) found(event.detail.provider as unknown as WalletPairTron);
      };
      const timer = setTimeout(() => {
        window.removeEventListener(TIP6963AnnounceProviderEventName, onAnnounce);
        const fallback = window.walletpair?.tron;
        if (fallback) return found(fallback);
        this._readyState = WalletReadyState.NotFound;
        this._setState(AdapterState.NotFound);
        this.emit('readyStateChanged', this._readyState);
        resolve(false);
      }, this.config.checkTimeout);
      window.addEventListener(TIP6963AnnounceProviderEventName, onAnnounce);
      window.dispatchEvent(new Event(TIP6963RequestProviderEventName));
    });
    this._checkPromise = detection;
    void detection.then((ok) => {
      if (!ok && this._checkPromise === detection) this._checkPromise = null;
    });
    return detection;
  }

  private _useProvider(provider: WalletPairTron): void {
    this._provider?.removeListener('accountsChanged', this._onAccountsChanged);
    this._provider?.removeListener('chainChanged', this._onChainChanged);
    this._provider?.removeListener('disconnect', this._onDisconnect);
    this._provider = provider;
    provider.on('accountsChanged', this._onAccountsChanged);
    provider.on('chainChanged', this._onChainChanged);
    provider.on('disconnect', this._onDisconnect);
    this._readyState = WalletReadyState.Found;
    // A site the user already approved is connected from the start.
    const address = provider.tronWeb ? provider.tronWeb.defaultAddress.base58 || null : null;
    this._setAddress(address);
    this._setState(address ? AdapterState.Connected : AdapterState.Disconnect);
    this.emit('readyStateChanged', this._readyState);
  }

  private async _signer() {
    await this._checkWallet();
    const tronWeb = this._provider?.tronWeb;
    if (!this.connected || !tronWeb) throw new WalletDisconnectedError();
    return tronWeb;
  }

  private _onAccountsChanged = (accounts: string[]) => {
    const previous = this.address || '';
    const address = accounts?.[0] || null;
    this._setAddress(address);
    this._setState(address ? AdapterState.Connected : AdapterState.Disconnect);
    this.emit('accountsChanged', address || '', previous);
    if (!previous && address) this.emit('connect', address);
    else if (previous && !address) this.emit('disconnect');
  };

  private _onChainChanged = (data: { chainId: string }) => {
    this.emit('chainChanged', data);
  };

  private _onDisconnect = () => {
    if (!this.connected) return;
    this._setAddress(null);
    this._setState(AdapterState.Disconnect);
    this.emit('disconnect');
  };

  private _setAddress(address: string | null): void {
    this._address = address;
  }

  private _setState(state: AdapterState): void {
    if (state === this._state) return;
    this._state = state;
    this.emit('stateChanged', state);
  }
}
