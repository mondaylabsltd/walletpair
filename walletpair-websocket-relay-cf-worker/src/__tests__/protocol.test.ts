/**
 * Unit tests for protocol.ts — message parsing, validation, building, state machine.
 * Pure logic tests, no Workers runtime needed.
 */
import { describe, it, expect } from "vitest";
import {
  parseMessage,
  parseErrorToCloseReason,
  validateChannelId,
  validatePeerId,
  buildReadyWaiting,
  buildReadyConnected,
  buildTerminate,
  buildTerminateWithTarget,
  stateAllowsMessage,
} from "../protocol";

// Valid test values
const CH = "a".repeat(64);
const PEER = "HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk"; // 43 chars, 32 bytes
const PEER2 = "_2P-V7-_Q_o_VjYosUmvcE09tiU2nEmYNlA0empx4A4";

function envelope(t: string, body: Record<string, unknown> = {}): string {
  return JSON.stringify({ v: 1, t, ch: CH, ts: Date.now(), from: PEER, body });
}

// ─────────────────────────────────────────────
// Channel ID validation
// ─────────────────────────────────────────────
describe("validateChannelId", () => {
  it("accepts 64 lowercase hex", () => {
    expect(validateChannelId("a".repeat(64))).toBe(true);
    expect(validateChannelId("0123456789abcdef".repeat(4))).toBe(true);
  });
  it("rejects uppercase", () => {
    expect(validateChannelId("A".repeat(64))).toBe(false);
  });
  it("rejects wrong length", () => {
    expect(validateChannelId("a".repeat(63))).toBe(false);
    expect(validateChannelId("a".repeat(65))).toBe(false);
  });
  it("rejects non-hex", () => {
    expect(validateChannelId("g" + "a".repeat(63))).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Peer ID validation
// ─────────────────────────────────────────────
describe("validatePeerId", () => {
  it("accepts valid base64url 32-byte key", () => {
    expect(validatePeerId(PEER)).toBe(true);
    expect(validatePeerId(PEER2)).toBe(true);
  });
  it("rejects non-base64url chars", () => {
    expect(validatePeerId("abc=def")).toBe(false);
    expect(validatePeerId("abc def")).toBe(false);
  });
  it("rejects wrong decoded length", () => {
    // 16 bytes → 22 chars base64url
    expect(validatePeerId("AAAAAAAAAAAAAAAAAAAAAA")).toBe(false);
  });
  it("rejects empty", () => {
    expect(validatePeerId("")).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Message parsing — envelope validation
// ─────────────────────────────────────────────
describe("parseMessage — envelope", () => {
  it("rejects non-JSON", () => {
    const r = parseMessage("not json");
    expect("kind" in r && r.kind).toBe("invalid_json");
  });

  it("rejects array", () => {
    const r = parseMessage("[]");
    expect("kind" in r && r.kind).toBe("not_an_object");
  });

  it("rejects missing v", () => {
    const r = parseMessage(JSON.stringify({ t: "ping", ch: CH, ts: 1, from: PEER, body: {} }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });

  it("rejects v != 1", () => {
    const r = parseMessage(JSON.stringify({ v: 2, t: "ping", ch: CH, ts: 1, from: PEER, body: {} }));
    expect("kind" in r && r.kind).toBe("unsupported_version");
  });

  it("rejects missing ch", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ts: 1, from: PEER, body: {} }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });

  it("rejects invalid channel ID", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ch: "bad", ts: 1, from: PEER, body: {} }));
    expect("kind" in r && r.kind).toBe("invalid_channel_id");
  });

  it("rejects missing ts", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ch: CH, from: PEER, body: {} }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });

  it("rejects missing from", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ch: CH, ts: 1, body: {} }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });

  it("rejects missing body", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ch: CH, ts: 1, from: PEER }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });

  it("rejects body as array", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "ping", ch: CH, ts: 1, from: PEER, body: [] }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });
});

// ─────────────────────────────────────────────
// Message parsing — per-type body validation
// ─────────────────────────────────────────────
describe("parseMessage — create", () => {
  it("parses valid create", () => {
    const r = parseMessage(envelope("create", { meta: { name: "test" } }));
    expect("t" in r && r.t).toBe("create");
  });
  it("rejects create without meta object", () => {
    const r = parseMessage(envelope("create", { meta: "string" }));
    expect("kind" in r && r.kind).toBe("missing_field");
  });
  it("rejects create with invalid from", () => {
    const r = parseMessage(JSON.stringify({ v: 1, t: "create", ch: CH, ts: 1, from: "bad", body: { meta: {} } }));
    expect("kind" in r && r.kind).toBe("invalid_peer_id");
  });
});

describe("parseMessage — join", () => {
  it("parses join with sealed_join string", () => {
    const r = parseMessage(envelope("join", { sealed_join: "abc" }));
    expect("t" in r && r.t).toBe("join");
    expect("sealedJoinNull" in r && r.sealedJoinNull).toBe(false);
  });
  it("parses join with sealed_join null (reconnect)", () => {
    const r = parseMessage(envelope("join", { sealed_join: null }));
    expect("t" in r && r.t).toBe("join");
    expect("sealedJoinNull" in r && r.sealedJoinNull).toBe(true);
  });
  it("rejects join without sealed_join key", () => {
    const r = parseMessage(envelope("join", {}));
    expect("kind" in r && r.kind).toBe("missing_field");
  });
});

describe("parseMessage — accept", () => {
  it("parses valid accept", () => {
    const r = parseMessage(envelope("accept", { target: PEER2 }));
    expect("t" in r && r.t).toBe("accept");
    expect("target" in r && r.target).toBe(PEER2);
  });
  it("rejects accept without target", () => {
    const r = parseMessage(envelope("accept", {}));
    expect("kind" in r && r.kind).toBe("missing_field");
  });
  it("rejects accept with invalid target peer ID", () => {
    const r = parseMessage(envelope("accept", { target: "bad" }));
    expect("kind" in r && r.kind).toBe("invalid_peer_id");
  });
});

describe("parseMessage — req/res/evt", () => {
  for (const t of ["req", "res", "evt"]) {
    it(`parses valid ${t}`, () => {
      const r = parseMessage(envelope(t, { id: "r-1", sealed: "abc" }));
      expect("t" in r && r.t).toBe(t);
      expect("id" in r && r.id).toBe("r-1");
    });
    it(`rejects ${t} without id`, () => {
      const r = parseMessage(envelope(t, { sealed: "abc" }));
      expect("kind" in r && r.kind).toBe("missing_field");
    });
    it(`rejects ${t} without sealed`, () => {
      const r = parseMessage(envelope(t, { id: "r-1" }));
      expect("kind" in r && r.kind).toBe("missing_field");
    });
  }
});

describe("parseMessage — ping/pong", () => {
  it("parses ping", () => {
    const r = parseMessage(envelope("ping"));
    expect("t" in r && r.t).toBe("ping");
  });
  it("parses pong", () => {
    const r = parseMessage(envelope("pong"));
    expect("t" in r && r.t).toBe("pong");
  });
});

describe("parseMessage — close", () => {
  it("parses close with reason", () => {
    const r = parseMessage(envelope("close", { reason: "normal" }));
    expect("t" in r && r.t).toBe("close");
    expect("reason" in r && r.reason).toBe("normal");
  });
  it("rejects close without reason", () => {
    const r = parseMessage(envelope("close", {}));
    expect("kind" in r && r.kind).toBe("missing_field");
  });
});

describe("parseMessage — rejected types", () => {
  it("rejects ready from client", () => {
    const r = parseMessage(envelope("ready", { state: "waiting" }));
    expect("kind" in r && r.kind).toBe("unknown_type");
  });
  it("rejects terminate from client", () => {
    const r = parseMessage(envelope("terminate", { reason: "timeout" }));
    expect("kind" in r && r.kind).toBe("unknown_type");
  });
  it("rejects unknown type", () => {
    const r = parseMessage(envelope("foobar"));
    expect("kind" in r && r.kind).toBe("unknown_type");
  });
});

// ─────────────────────────────────────────────
// parseErrorToCloseReason
// ─────────────────────────────────────────────
describe("parseErrorToCloseReason", () => {
  it("maps unsupported_version", () => {
    expect(parseErrorToCloseReason({ kind: "unsupported_version", version: 2 })).toBe("unsupported_version");
  });
  it("maps everything else to protocol_error", () => {
    expect(parseErrorToCloseReason({ kind: "invalid_json" })).toBe("protocol_error");
    expect(parseErrorToCloseReason({ kind: "missing_field", field: "v" })).toBe("protocol_error");
    expect(parseErrorToCloseReason({ kind: "invalid_peer_id" })).toBe("protocol_error");
  });
});

// ─────────────────────────────────────────────
// State machine — stateAllowsMessage
// ─────────────────────────────────────────────
describe("stateAllowsMessage", () => {
  // closed rejects everything
  it("closed rejects all", () => {
    for (const t of ["create", "join", "accept", "req", "res", "evt", "ping", "pong", "close"]) {
      expect(stateAllowsMessage("closed", t, "dapp")).toBe(false);
      expect(stateAllowsMessage("closed", t, "wallet")).toBe(false);
    }
  });

  // none rejects everything
  it("none rejects all", () => {
    for (const t of ["req", "res", "evt", "accept", "ping", "pong", "close"]) {
      expect(stateAllowsMessage("none", t, "dapp")).toBe(false);
    }
  });

  // close allowed in all non-closed states
  it("close allowed in waiting/pending_accept/connected", () => {
    for (const s of ["waiting", "pending_accept", "connected"]) {
      expect(stateAllowsMessage(s, "close", "dapp")).toBe(true);
      expect(stateAllowsMessage(s, "close", "wallet")).toBe(true);
    }
  });

  // ping/pong allowed in all non-closed states
  it("ping/pong allowed in waiting/pending_accept/connected", () => {
    for (const s of ["waiting", "pending_accept", "connected"]) {
      expect(stateAllowsMessage(s, "ping", "dapp")).toBe(true);
      expect(stateAllowsMessage(s, "pong", "wallet")).toBe(true);
    }
  });

  // pending_accept: only accept from dapp
  it("pending_accept allows accept from dapp only", () => {
    expect(stateAllowsMessage("pending_accept", "accept", "dapp")).toBe(true);
    expect(stateAllowsMessage("pending_accept", "accept", "wallet")).toBe(false);
    expect(stateAllowsMessage("pending_accept", "req", "dapp")).toBe(false);
  });

  // connected: req from dapp, res/evt from wallet
  it("connected: req from dapp only", () => {
    expect(stateAllowsMessage("connected", "req", "dapp")).toBe(true);
    expect(stateAllowsMessage("connected", "req", "wallet")).toBe(false);
  });
  it("connected: res from wallet only", () => {
    expect(stateAllowsMessage("connected", "res", "wallet")).toBe(true);
    expect(stateAllowsMessage("connected", "res", "dapp")).toBe(false);
  });
  it("connected: evt from wallet only", () => {
    expect(stateAllowsMessage("connected", "evt", "wallet")).toBe(true);
    expect(stateAllowsMessage("connected", "evt", "dapp")).toBe(false);
  });

  // waiting: only ping/pong/close
  it("waiting rejects req/res/evt/accept", () => {
    expect(stateAllowsMessage("waiting", "req", "dapp")).toBe(false);
    expect(stateAllowsMessage("waiting", "res", "wallet")).toBe(false);
    expect(stateAllowsMessage("waiting", "evt", "wallet")).toBe(false);
    expect(stateAllowsMessage("waiting", "accept", "dapp")).toBe(false);
  });
});

// ─────────────────────────────────────────────
// Message builders
// ─────────────────────────────────────────────
describe("buildReadyWaiting", () => {
  it("produces correct format", () => {
    const msg = JSON.parse(buildReadyWaiting(CH, "dapp", PEER, false));
    expect(msg.v).toBe(1);
    expect(msg.t).toBe("ready");
    expect(msg.ch).toBe(CH);
    expect(msg.from).toBe("_adapter");
    expect(msg.body.state).toBe("waiting");
    expect(msg.body.role).toBe("dapp");
    expect(msg.body.self).toBe(PEER);
    expect(msg.body.remote).toBeNull();
    expect(msg.body.reconnect).toBe(false);
    expect(typeof msg.ts).toBe("number");
  });

  it("sets reconnect=true", () => {
    const msg = JSON.parse(buildReadyWaiting(CH, "wallet", PEER2, true));
    expect(msg.body.reconnect).toBe(true);
    expect(msg.body.role).toBe("wallet");
  });
});

describe("buildReadyConnected", () => {
  it("produces correct format", () => {
    const msg = JSON.parse(buildReadyConnected(CH, "dapp", PEER, PEER2, true));
    expect(msg.body.state).toBe("connected");
    expect(msg.body.self).toBe(PEER);
    expect(msg.body.remote).toBe(PEER2);
    expect(msg.body.reconnect).toBe(true);
  });
});

describe("buildTerminate", () => {
  it("produces correct format", () => {
    const msg = JSON.parse(buildTerminate(CH, "timeout"));
    expect(msg.v).toBe(1);
    expect(msg.t).toBe("terminate");
    expect(msg.from).toBe("_adapter");
    expect(msg.body.reason).toBe("timeout");
  });
});

describe("buildTerminateWithTarget", () => {
  it("includes target field", () => {
    const msg = JSON.parse(buildTerminateWithTarget(CH, "protocol_error", PEER2));
    expect(msg.body.reason).toBe("protocol_error");
    expect(msg.body.target).toBe(PEER2);
  });
});
