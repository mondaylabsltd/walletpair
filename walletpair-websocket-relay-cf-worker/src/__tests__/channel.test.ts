/**
 * Integration tests for ChannelDO — full protocol flows.
 * Runs in Cloudflare Workers vitest pool.
 */
import { env, createExecutionContext, SELF } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

const CH = "a".repeat(64);
const DAPP_KEY = "HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk";
const WALLET_KEY = "_2P-V7-_Q_o_VjYosUmvcE09tiU2nEmYNlA0empx4A4";

function msg(t: string, from: string, body: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, t, ch: CH, ts: Date.now(), from, body });
}

// Helper to open a WebSocket to the DO
async function connectWs(): Promise<WebSocket> {
  const resp = await SELF.fetch(`http://localhost/v1?ch=${CH}`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": "walletpair.v1",
    },
  });
  expect(resp.status).toBe(101);
  expect(resp.webSocket).not.toBeNull();
  const ws = resp.webSocket!;
  ws.accept();
  return ws;
}

// Collect messages from a WebSocket
function collectMessages(ws: WebSocket): string[] {
  const messages: string[] = [];
  ws.addEventListener("message", (e) => {
    messages.push(typeof e.data === "string" ? e.data : "");
  });
  return messages;
}

// Parse a collected message
function parse(raw: string): Record<string, unknown> {
  return JSON.parse(raw);
}

// ─────────────────────────────────────────────
// Happy path: full pairing flow
// ─────────────────────────────────────────────
describe("ChannelDO — pairing flow", () => {
  it("complete create → join → accept → req/res → close", async () => {
    // dApp connects and creates
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "Test" } }));
    await new Promise((r) => setTimeout(r, 50));

    // Should receive ready.waiting
    expect(dappMsgs.length).toBe(1);
    const readyWaiting = parse(dappMsgs[0]);
    expect(readyWaiting.t).toBe("ready");
    expect(readyWaiting.body).toMatchObject({
      state: "waiting",
      role: "dapp",
      self: DAPP_KEY,
      remote: null,
      reconnect: false,
    });

    // Wallet connects and joins
    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "encrypted_data" }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet gets ready.waiting
    expect(walletMsgs.length).toBe(1);
    const walletReady = parse(walletMsgs[0]);
    expect(walletReady.body).toMatchObject({
      state: "waiting",
      role: "wallet",
      reconnect: false,
    });

    // dApp receives forwarded join
    expect(dappMsgs.length).toBe(2);
    const joinForwarded = parse(dappMsgs[1]);
    expect(joinForwarded.t).toBe("join");
    expect(joinForwarded.from).toBe(WALLET_KEY);

    // dApp accepts
    dappWs.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // Both receive ready.connected
    const dappConnected = parse(dappMsgs[2]);
    expect(dappConnected.body).toMatchObject({
      state: "connected",
      role: "dapp",
      self: DAPP_KEY,
      remote: WALLET_KEY,
      reconnect: false,
    });

    const walletConnected = parse(walletMsgs[1]);
    expect(walletConnected.body).toMatchObject({
      state: "connected",
      role: "wallet",
      self: WALLET_KEY,
      remote: DAPP_KEY,
      reconnect: false,
    });

    // dApp sends req
    const reqMsg = msg("req", DAPP_KEY, { id: "r-1", sealed: "enc_req" });
    dappWs.send(reqMsg);
    await new Promise((r) => setTimeout(r, 50));

    // Wallet receives req
    const walletReq = parse(walletMsgs[2]);
    expect(walletReq.t).toBe("req");
    expect(walletReq.body).toMatchObject({ id: "r-1" });

    // Wallet sends res
    const resMsg = msg("res", WALLET_KEY, { id: "r-1", sealed: "enc_res" });
    walletWs.send(resMsg);
    await new Promise((r) => setTimeout(r, 50));

    // dApp receives res
    const dappRes = parse(dappMsgs[3]);
    expect(dappRes.t).toBe("res");
    expect(dappRes.body).toMatchObject({ id: "r-1" });

    // Wallet sends evt
    const evtMsg = msg("evt", WALLET_KEY, { id: "e-1", sealed: "enc_evt" });
    walletWs.send(evtMsg);
    await new Promise((r) => setTimeout(r, 50));

    const dappEvt = parse(dappMsgs[4]);
    expect(dappEvt.t).toBe("evt");

    // Close
    dappWs.send(msg("close", DAPP_KEY, { reason: "normal" }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet receives close
    const walletClose = parse(walletMsgs[3]);
    expect(walletClose.t).toBe("close");
    expect(walletClose.body).toMatchObject({ reason: "normal" });
  });
});

// ─────────────────────────────────────────────
// Validation and rejection
// ─────────────────────────────────────────────
describe("ChannelDO — validation", () => {
  it("rejects first message that is not create or join", async () => {
    const ws = await connectWs();
    const msgs = collectMessages(ws);
    ws.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    expect(msgs.length).toBe(1);
    const term = parse(msgs[0]);
    expect(term.t).toBe("terminate");
    expect(term.body).toMatchObject({ reason: "invalid_state" });
  });

  it("rejects binary frames", async () => {
    const ws = await connectWs();
    const msgs = collectMessages(ws);
    ws.send(new ArrayBuffer(10));
    await new Promise((r) => setTimeout(r, 50));

    expect(msgs.length).toBe(1);
    const term = parse(msgs[0]);
    expect(term.t).toBe("terminate");
    expect(term.body).toMatchObject({ reason: "protocol_error" });
  });

  it("rejects oversized messages", async () => {
    const ws = await connectWs();
    const msgs = collectMessages(ws);
    ws.send("x".repeat(65_537));
    await new Promise((r) => setTimeout(r, 50));

    expect(msgs.length).toBe(1);
    const term = parse(msgs[0]);
    expect(term.body).toMatchObject({ reason: "payload_too_large" });
  });

  it("rejects wrong protocol version", async () => {
    const ws = await connectWs();
    const msgs = collectMessages(ws);
    ws.send(JSON.stringify({ v: 2, t: "create", ch: CH, ts: 1, from: DAPP_KEY, body: { meta: {} } }));
    await new Promise((r) => setTimeout(r, 50));

    const term = parse(msgs[0]);
    expect(term.body).toMatchObject({ reason: "unsupported_version" });
  });

  it("rejects ready from client", async () => {
    const ws = await connectWs();
    const msgs = collectMessages(ws);
    ws.send(msg("ready", DAPP_KEY, { state: "waiting" }));
    await new Promise((r) => setTimeout(r, 50));

    const term = parse(msgs[0]);
    expect(term.body).toMatchObject({ reason: "protocol_error" });
  });
});

// ─────────────────────────────────────────────
// State machine enforcement
// ─────────────────────────────────────────────
describe("ChannelDO — state enforcement", () => {
  it("rejects join on non-waiting channel", async () => {
    // Create first
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet joins
    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    // Second wallet tries to join — should get already_connected
    const wallet2Ws = await connectWs();
    const wallet2Msgs = collectMessages(wallet2Ws);
    wallet2Ws.send(msg("join", WALLET_KEY, { sealed_join: "data2" }));
    await new Promise((r) => setTimeout(r, 50));

    const term = parse(wallet2Msgs[0]);
    expect(term.t).toBe("terminate");
    expect(term.body).toMatchObject({ reason: "already_connected" });
  });

  it("rejects accept from wallet", async () => {
    const dappWs = await connectWs();
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet tries to accept — invalid_role
    walletWs.send(msg("accept", WALLET_KEY, { target: DAPP_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // ready.waiting (index 0) + terminate (index 1)
    expect(walletMsgs.length).toBeGreaterThanOrEqual(2);
    const term = parse(walletMsgs[walletMsgs.length - 1]);
    expect(term.t).toBe("terminate");
    expect(term.body).toMatchObject({ reason: "invalid_role" });
  });

  it("rejects accept with wrong target", async () => {
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    // Accept with wrong target
    dappWs.send(msg("accept", DAPP_KEY, { target: DAPP_KEY })); // wrong: should be WALLET_KEY
    await new Promise((r) => setTimeout(r, 50));

    // Should get terminate with protocol_error and target field
    const lastMsg = parse(dappMsgs[dappMsgs.length - 1]);
    expect(lastMsg.t).toBe("terminate");
    expect(lastMsg.body).toMatchObject({ reason: "protocol_error", target: DAPP_KEY });
  });

  it("rejects req before connected", async () => {
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    // Send req in waiting state
    dappWs.send(msg("req", DAPP_KEY, { id: "r-1", sealed: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    const lastMsg = parse(dappMsgs[dappMsgs.length - 1]);
    expect(lastMsg.t).toBe("terminate");
  });

  it("rejects req from wallet", async () => {
    // Full pairing
    const dappWs = await connectWs();
    collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    dappWs.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet sends req — invalid_role
    walletWs.send(msg("req", WALLET_KEY, { id: "r-1", sealed: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    const lastMsg = parse(walletMsgs[walletMsgs.length - 1]);
    expect(lastMsg.t).toBe("terminate");
    expect(lastMsg.body).toMatchObject({ reason: "invalid_role" });
  });
});

// ─────────────────────────────────────────────
// Pending request limit
// ─────────────────────────────────────────────
describe("ChannelDO — pending request limit", () => {
  it("rejects 33rd pending request", async () => {
    // Full pairing
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    dappWs.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // Send 32 requests (all should succeed)
    for (let i = 0; i < 32; i++) {
      dappWs.send(msg("req", DAPP_KEY, { id: `r-${i}`, sealed: "data" }));
    }
    await new Promise((r) => setTimeout(r, 100));

    // 33rd should be rejected
    dappWs.send(msg("req", DAPP_KEY, { id: "r-32", sealed: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    const lastMsg = parse(dappMsgs[dappMsgs.length - 1]);
    expect(lastMsg.t).toBe("terminate");
    expect(lastMsg.body).toMatchObject({ reason: "rate_limited" });
  });
});

// ─────────────────────────────────────────────
// Reconnect flow
// ─────────────────────────────────────────────
describe("ChannelDO — reconnect", () => {
  it("join with sealed_join=null sets reconnect flag", async () => {
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: null }));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet ready.waiting should have reconnect=true
    const walletReady = parse(walletMsgs[0]);
    expect(walletReady.body.reconnect).toBe(true);

    // Accept
    dappWs.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // ready.connected should have reconnect=true
    const dappConnected = parse(dappMsgs[2]);
    expect(dappConnected.body.reconnect).toBe(true);
  });
});

// ─────────────────────────────────────────────
// Ping/pong forwarding
// ─────────────────────────────────────────────
describe("ChannelDO — ping/pong", () => {
  it("forwards ping/pong between peers", async () => {
    // Full pairing
    const dappWs = await connectWs();
    const dappMsgs = collectMessages(dappWs);
    dappWs.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    const walletWs = await connectWs();
    const walletMsgs = collectMessages(walletWs);
    walletWs.send(msg("join", WALLET_KEY, { sealed_join: "data" }));
    await new Promise((r) => setTimeout(r, 50));

    dappWs.send(msg("accept", DAPP_KEY, { target: WALLET_KEY }));
    await new Promise((r) => setTimeout(r, 50));

    // dApp sends ping
    dappWs.send(msg("ping", DAPP_KEY));
    await new Promise((r) => setTimeout(r, 50));

    // Wallet should receive it
    const walletPing = parse(walletMsgs[walletMsgs.length - 1]);
    expect(walletPing.t).toBe("ping");

    // Wallet sends pong
    walletWs.send(msg("pong", WALLET_KEY));
    await new Promise((r) => setTimeout(r, 50));

    const dappPong = parse(dappMsgs[dappMsgs.length - 1]);
    expect(dappPong.t).toBe("pong");
  });
});

// ─────────────────────────────────────────────
// Channel replacement (reconnect race)
// ─────────────────────────────────────────────
describe("ChannelDO — channel replacement", () => {
  it("replaces waiting channel on re-create", async () => {
    // First create
    const dappWs1 = await connectWs();
    const dappMsgs1 = collectMessages(dappWs1);
    dappWs1.send(msg("create", DAPP_KEY, { meta: { name: "T" } }));
    await new Promise((r) => setTimeout(r, 50));

    expect(dappMsgs1.length).toBe(1);
    expect(parse(dappMsgs1[0]).body).toMatchObject({ state: "waiting" });

    // Second create — replaces
    const dappWs2 = await connectWs();
    const dappMsgs2 = collectMessages(dappWs2);
    dappWs2.send(msg("create", DAPP_KEY, { meta: { name: "T2" } }));
    await new Promise((r) => setTimeout(r, 50));

    // New dApp gets ready.waiting
    expect(dappMsgs2.length).toBe(1);
    expect(parse(dappMsgs2[0]).body).toMatchObject({ state: "waiting" });

    // Old dApp should have received terminate(normal)
    const oldTerm = dappMsgs1.find((m) => {
      const p = parse(m);
      return p.t === "terminate";
    });
    expect(oldTerm).toBeDefined();
  });
});

// ─────────────────────────────────────────────
// Join on nonexistent channel
// ─────────────────────────────────────────────
describe("ChannelDO — join without create", () => {
  it("rejects join on channel with no prior create", async () => {
    // Use a different channel ID to get a fresh DO
    const otherCh = "b".repeat(64);
    const resp = await SELF.fetch(`http://localhost/v1?ch=${otherCh}`, {
      headers: { Upgrade: "websocket" },
    });
    const ws = resp.webSocket!;
    ws.accept();
    const msgs = collectMessages(ws);

    ws.send(JSON.stringify({ v: 1, t: "join", ch: otherCh, ts: Date.now(), from: WALLET_KEY, body: { sealed_join: "data" } }));
    await new Promise((r) => setTimeout(r, 50));

    const term = parse(msgs[0]);
    expect(term.t).toBe("terminate");
    expect(term.body).toMatchObject({ reason: "channel_not_found" });
  });
});
