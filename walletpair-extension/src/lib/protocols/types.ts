/**
 * Protocol handler abstraction — the interface all chain handlers implement.
 *
 * Each blockchain ecosystem (EVM, Solana, Sui, Cosmos, etc.) provides a
 * concrete implementation of ProtocolHandler so the extension core logic
 * (background.ts, confirmation popup, RPC proxy) stays chain-agnostic.
 */

/** State tracked per protocol in the provider */
export interface ProtocolState {
  isConnected: boolean;
  accounts: string[];
  chainId: string; // Protocol-native format (hex for EVM, string for Solana)
  chainRef: string; // Numeric/string reference (e.g., '1', 'mainnet-beta')
}

/**
 * Protocol handler — abstracts chain-specific logic.
 * Each blockchain ecosystem implements this interface.
 */
export interface ProtocolHandler {
  /** Protocol identifier: 'ethereum', 'solana', 'sui', 'cosmos' */
  readonly name: string;
  /** CAIP-2 namespace: 'eip155', 'solana', 'sui', 'cosmos' */
  readonly namespace: string;
  /** Window property name for injection: 'ethereum', 'solana', etc. */
  readonly windowPropertyName: string;

  /** Methods that require user confirmation popup before forwarding to wallet */
  readonly confirmationMethods: ReadonlySet<string>;
  /** Methods handled locally in the extension (no relay trip needed) */
  readonly localMethods: ReadonlySet<string>;
  /** Read-only methods proxied to public RPC node */
  readonly readOnlyMethods: ReadonlySet<string>;
  /** Methods that are explicitly unsupported */
  readonly unsupportedMethods: ReadonlySet<string>;

  /** Handle a local method synchronously. Returns the result. */
  handleLocalMethod(method: string, params: unknown, state: ProtocolState): unknown;

  /** Proxy a read-only RPC call to a public node. */
  proxyReadOnly(chainRef: string, method: string, params: unknown, customRpcUrls: Record<string, string>): Promise<unknown>;

  /** Format chain ID for provider state wire format */
  formatChainId(chainRef: string): string;
  /** Parse chain ID from wire format back to reference */
  parseChainId(wireChainId: string): string;

  /** Format a value for human display (e.g., wei -> ETH, lamports -> SOL) */
  formatDisplayValue(amount: string, chainRef: string): string;
  /** Get chain display name (e.g., 'Ethereum', 'Gnosis') */
  getChainName(chainRef: string): string;
  /** Format method name for confirmation popup display */
  formatMethodName(method: string): string;
}
