/**
 * End-to-end tests — simulate real dApp/wallet interaction patterns
 * through the full Worker + ChannelDO stack.
 */
import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const DAPP_KEY = "HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk";
const WALLET_KEY = "_2P-V7-_Q_o_VjYosUmvcE09tiU2nEmYNlA0empx4A4";

// Use unique channel IDs per test to isolate DO instances
let testCounter = 0;
function freshCh(): string {
  testCounter++;
  return testCounter.toString(16).padStart(64, "0");
}

function m(ch: string, t: string, from: string, body: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, t, ch, ts: Date.now(), from, body });
}

async function openWs(ch: string): Promise<{ ws: WebSocket; msgs: string[] }> {
  const resp = await SELF.fetch(`http://localhost/v1?ch=${ch}`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": "walletpair.v1" },
  });
  expect(resp.status).toBe(101);
  const ws = resp.webSocket!;
  ws.accept();
  const msgs: string[] = [];
  ws.addEventListener("message", (e) => msgs.push(e.data as string));
  return { ws, msgs };
}

function p(raw: string): any { return JSON.parse(raw); }

async function pair(ch: string) {
  const dapp = await openWs(ch);
  dapp.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "E2E" } }));
  await tick();

  const wallet = await openWs(ch);
  wallet.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: "enc" }));
  await tick();

  dapp.ws.send(m(ch, "accept", DAPP_KEY, { target: WALLET_KEY }));
  await tick();

  return { dapp, wallet };
}

const tick = () => new Promise((r) => setTimeout(r, 50));

// ─────────────────────────────────────────────
// E2E: Full session lifecycle
// ─────────────────────────────────────────────
describe("E2E — full session lifecycle", () => {
  it("pairing → multiple req/res → evt → close", async () => {
    const ch = freshCh();
    const { dapp, wallet } = await pair(ch);

    // Multiple request-response cycles
    for (let i = 0; i < 5; i++) {
      dapp.ws.send(m(ch, "req", DAPP_KEY, { id: `r-${i}`, sealed: `req-${i}` }));
      await tick();

      const walletReq = p(wallet.msgs[wallet.msgs.length - 1]);
      expect(walletReq.t).toBe("req");
      expect(walletReq.body.id).toBe(`r-${i}`);

      wallet.ws.send(m(ch, "res", WALLET_KEY, { id: `r-${i}`, sealed: `res-${i}` }));
      await tick();

      const dappRes = p(dapp.msgs[dapp.msgs.length - 1]);
      expect(dappRes.t).toBe("res");
      expect(dappRes.body.id).toBe(`r-${i}`);
    }

    // Wallet pushes events
    wallet.ws.send(m(ch, "evt", WALLET_KEY, { id: "e-1", sealed: "accts" }));
    await tick();
    expect(p(dapp.msgs[dapp.msgs.length - 1]).t).toBe("evt");

    // Close
    wallet.ws.send(m(ch, "close", WALLET_KEY, { reason: "normal" }));
    await tick();
    expect(p(dapp.msgs[dapp.msgs.length - 1]).t).toBe("close");
  });
});

// ─────────────────────────────────────────────
// E2E: Reconnect after disconnect
// ─────────────────────────────────────────────
describe("E2E — reconnect", () => {
  it("both peers disconnect then dApp re-creates", async () => {
    const ch = freshCh();

    // Initial pairing
    const dapp1 = await openWs(ch);
    dapp1.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "E2E" } }));
    await tick();

    const wallet1 = await openWs(ch);
    wallet1.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: "enc" }));
    await tick();

    dapp1.ws.send(m(ch, "accept", DAPP_KEY, { target: WALLET_KEY }));
    await tick();

    // Both peers disconnect (simulates transport failure)
    wallet1.ws.close(1001, "going_away");
    dapp1.ws.close(1001, "going_away");
    await tick();
    await tick(); // extra tick for close handlers

    // dApp re-creates on new connection (old dApp WS is now closed)
    const dapp2 = await openWs(ch);
    const dapp2Msgs = dapp2.msgs;
    dapp2.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "E2E" } }));
    await tick();

    // Should get ready.waiting (stale detection: old dApp WS is closed)
    expect(dapp2Msgs.length).toBeGreaterThanOrEqual(1);
    const ready = p(dapp2Msgs[0]);
    expect(ready.t).toBe("ready");
    expect(ready.body.state).toBe("waiting");

    // Wallet reconnects with sealed_join=null
    const wallet2 = await openWs(ch);
    wallet2.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: null }));
    await tick();

    const walletReady = p(wallet2.msgs[0]);
    expect(walletReady.body.reconnect).toBe(true);

    // dApp accepts
    dapp2.ws.send(m(ch, "accept", DAPP_KEY, { target: WALLET_KEY }));
    await tick();

    const connected = p(dapp2Msgs[dapp2Msgs.length - 1]);
    expect(connected.body.state).toBe("connected");
    expect(connected.body.reconnect).toBe(true);
  });
});

// ─────────────────────────────────────────────
// E2E: Concurrent requests
// ─────────────────────────────────────────────
describe("E2E — concurrent requests", () => {
  it("handles 32 concurrent pending requests", async () => {
    const ch = freshCh();
    const { dapp, wallet } = await pair(ch);

    // Send 32 requests without waiting for responses
    for (let i = 0; i < 32; i++) {
      dapp.ws.send(m(ch, "req", DAPP_KEY, { id: `r-${i}`, sealed: "data" }));
    }
    await tick();
    await tick(); // extra tick for all to process

    // Wallet should have received all 32
    const reqs = wallet.msgs.filter((raw) => p(raw).t === "req");
    expect(reqs.length).toBe(32);

    // Respond to all
    for (let i = 0; i < 32; i++) {
      wallet.ws.send(m(ch, "res", WALLET_KEY, { id: `r-${i}`, sealed: "res" }));
    }
    await tick();
    await tick();

    const ress = dapp.msgs.filter((raw) => p(raw).t === "res");
    expect(ress.length).toBe(32);
  });
});

// ─────────────────────────────────────────────
// E2E: Interleaved events and responses
// ─────────────────────────────────────────────
describe("E2E — interleaved events and responses", () => {
  it("events can arrive between req and res", async () => {
    const ch = freshCh();
    const { dapp, wallet } = await pair(ch);

    // dApp sends req
    dapp.ws.send(m(ch, "req", DAPP_KEY, { id: "r-1", sealed: "req" }));
    await tick();

    // Wallet sends event BEFORE responding
    wallet.ws.send(m(ch, "evt", WALLET_KEY, { id: "e-1", sealed: "chainChanged" }));
    await tick();

    // dApp should receive evt
    const dappEvt = dapp.msgs.filter((raw) => p(raw).t === "evt");
    expect(dappEvt.length).toBe(1);

    // Wallet sends response
    wallet.ws.send(m(ch, "res", WALLET_KEY, { id: "r-1", sealed: "res" }));
    await tick();

    const dappRes = dapp.msgs.filter((raw) => p(raw).t === "res");
    expect(dappRes.length).toBe(1);
  });
});

// ─────────────────────────────────────────────
// E2E: Wallet close during pending request
// ─────────────────────────────────────────────
describe("E2E — close during pending request", () => {
  it("close is forwarded even with pending requests", async () => {
    const ch = freshCh();
    const { dapp, wallet } = await pair(ch);

    // dApp sends req
    dapp.ws.send(m(ch, "req", DAPP_KEY, { id: "r-1", sealed: "req" }));
    await tick();

    // Wallet closes without responding
    wallet.ws.send(m(ch, "close", WALLET_KEY, { reason: "user_rejected" }));
    await tick();

    const closeMsg = dapp.msgs.find((raw) => p(raw).t === "close");
    expect(closeMsg).toBeDefined();
    expect(p(closeMsg!).body.reason).toBe("user_rejected");
  });
});

// ─────────────────────────────────────────────
// E2E: Heartbeat during pairing
// ─────────────────────────────────────────────
describe("E2E — heartbeat during pairing", () => {
  it("ping/pong works during waiting state", async () => {
    const ch = freshCh();
    const dapp = await openWs(ch);
    dapp.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "T" } }));
    await tick();

    // Send ping in waiting state (before wallet joins)
    dapp.ws.send(m(ch, "ping", DAPP_KEY));
    await tick();

    // No crash, no terminate — ping was allowed
    const terminates = dapp.msgs.filter((raw) => p(raw).t === "terminate");
    expect(terminates.length).toBe(0);
  });
});

// ─────────────────────────────────────────────
// E2E: Worker entry point
// ─────────────────────────────────────────────
describe("E2E — Worker entry point", () => {
  it("returns 400 for missing ch param", async () => {
    const resp = await SELF.fetch("http://localhost/v1", {
      headers: { Upgrade: "websocket" },
    });
    expect(resp.status).toBe(400);
  });

  it("returns 400 for invalid ch param", async () => {
    const resp = await SELF.fetch("http://localhost/v1?ch=bad", {
      headers: { Upgrade: "websocket" },
    });
    expect(resp.status).toBe(400);
  });

  it("returns 404 for non /v1 path", async () => {
    const resp = await SELF.fetch("http://localhost/v2");
    expect(resp.status).toBe(404);
  });

  it("healthz returns 200", async () => {
    const resp = await SELF.fetch("http://localhost/healthz");
    expect(resp.status).toBe(200);
  });

  it("negotiates walletpair.v1 subprotocol", async () => {
    const ch = freshCh();
    const resp = await SELF.fetch(`http://localhost/v1?ch=${ch}`, {
      headers: {
        Upgrade: "websocket",
        "Sec-WebSocket-Protocol": "walletpair.v1",
      },
    });
    expect(resp.status).toBe(101);
    expect(resp.headers.get("Sec-WebSocket-Protocol")).toBe("walletpair.v1");
  });
});

// ─────────────────────────────────────────────
// E2E: Disconnect cleanup
// ─────────────────────────────────────────────
describe("E2E — disconnect cleanup", () => {
  it("dApp disconnect during waiting closes channel", async () => {
    const ch = freshCh();
    const dapp = await openWs(ch);
    dapp.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "T" } }));
    await tick();

    // Simulate dApp disconnect
    dapp.ws.close(1001, "going_away");
    await tick();

    // New wallet tries to join — should get channel_not_found (channel was closed)
    const wallet = await openWs(ch);
    wallet.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: "data" }));
    await tick();

    const lastMsg = p(wallet.msgs[wallet.msgs.length - 1]);
    expect(lastMsg.t).toBe("terminate");
    expect(lastMsg.body.reason).toBe("channel_not_found");
  });

  it("wallet disconnect during pending_accept reverts to waiting", async () => {
    const ch = freshCh();
    const dapp = await openWs(ch);
    const dappMsgs = dapp.msgs;
    dapp.ws.send(m(ch, "create", DAPP_KEY, { meta: { name: "T" } }));
    await tick();

    const wallet1 = await openWs(ch);
    wallet1.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: "data" }));
    await tick();

    // Wallet disconnects before accept
    wallet1.ws.close(1001, "going_away");
    await tick();

    // New wallet should be able to join (state reverted to waiting)
    const wallet2 = await openWs(ch);
    const wallet2Msgs = wallet2.msgs;
    wallet2.ws.send(m(ch, "join", WALLET_KEY, { sealed_join: "data2" }));
    await tick();

    // Should get ready.waiting (not already_connected)
    const ready = p(wallet2Msgs[0]);
    expect(ready.t).toBe("ready");
    expect(ready.body.state).toBe("waiting");
  });
});

// ─────────────────────────────────────────────
// E2E: Channel ID mismatch
// ─────────────────────────────────────────────
describe("E2E — channel ID mismatch", () => {
  it("rejects message with different ch than URL", async () => {
    const ch = freshCh();
    const otherCh = freshCh();
    const dapp = await openWs(ch);
    dapp.ws.send(m(otherCh, "create", DAPP_KEY, { meta: { name: "T" } }));
    await tick();

    const term = p(dapp.msgs[0]);
    expect(term.t).toBe("terminate");
    expect(term.body.reason).toBe("protocol_error");
  });
});
