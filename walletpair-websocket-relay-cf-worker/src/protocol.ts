import type { CloseReasonString, Role } from "./types";

// --- Validation ---

const CHANNEL_ID_RE = /^[0-9a-f]{64}$/;

export function validateChannelId(ch: string): boolean {
  return CHANNEL_ID_RE.test(ch);
}

/**
 * Validate peer ID: base64url-no-pad encoding of exactly 32 bytes.
 * 32 bytes -> ceil(32*4/3) = 43 base64url chars, no padding.
 */
export function validatePeerId(peerId: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(peerId)) return false;
  try {
    // Convert base64url to base64 standard
    let b64 = peerId.replace(/-/g, "+").replace(/_/g, "/");
    // Add padding if needed
    while (b64.length % 4 !== 0) b64 += "=";
    const binary = atob(b64);
    return binary.length === 32;
  } catch {
    return false;
  }
}

// --- Parsed Client Messages ---

export type ClientMessage =
  | { t: "create"; ch: string; from: string }
  | { t: "join"; ch: string; from: string; sealedJoinNull: boolean }
  | { t: "accept"; ch: string; from: string; target: string }
  | { t: "req"; ch: string; from: string; id: string }
  | { t: "res"; ch: string; from: string; id: string }
  | { t: "evt"; ch: string; from: string; id: string }
  | { t: "ping"; ch: string; from: string }
  | { t: "pong"; ch: string; from: string }
  | { t: "close"; ch: string; from: string; reason: string };

export type ParseError =
  | { kind: "invalid_json" }
  | { kind: "not_an_object" }
  | { kind: "missing_field"; field: string }
  | { kind: "unsupported_version"; version: number }
  | { kind: "unknown_type"; type: string }
  | { kind: "invalid_channel_id" }
  | { kind: "invalid_peer_id" };

export function parseErrorToCloseReason(err: ParseError): CloseReasonString {
  return err.kind === "unsupported_version" ? "unsupported_version" : "protocol_error";
}

function getStr(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

export function parseMessage(raw: string): ClientMessage | ParseError {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid_json" };
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "not_an_object" };
  }

  const obj = value as Record<string, unknown>;

  // Validate version
  const v = obj["v"];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { kind: "missing_field", field: "v" };
  }
  if (v !== 1) {
    return { kind: "unsupported_version", version: v };
  }

  // Validate common envelope
  const t = getStr(obj, "t");
  if (t === null) return { kind: "missing_field", field: "t" };

  const ch = getStr(obj, "ch");
  if (ch === null) return { kind: "missing_field", field: "ch" };
  if (!validateChannelId(ch)) return { kind: "invalid_channel_id" };

  // ts must be present and a number
  if (typeof obj["ts"] !== "number") {
    return { kind: "missing_field", field: "ts" };
  }

  // from must be present and a string
  const from = getStr(obj, "from");
  if (from === null) return { kind: "missing_field", field: "from" };

  // body must be present and an object
  const body = obj["body"];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "missing_field", field: "body" };
  }
  const bodyObj = body as Record<string, unknown>;

  switch (t) {
    case "create": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const meta = bodyObj["meta"];
      if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
        return { kind: "missing_field", field: "body.meta" };
      }
      return { t: "create", ch, from };
    }

    case "join": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      if (!("sealed_join" in bodyObj)) {
        return { kind: "missing_field", field: "body.sealed_join" };
      }
      const sealedJoinNull = bodyObj["sealed_join"] === null;
      return { t: "join", ch, from, sealedJoinNull };
    }

    case "accept": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const target = getStr(bodyObj, "target");
      if (target === null) return { kind: "missing_field", field: "body.target" };
      if (!validatePeerId(target)) return { kind: "invalid_peer_id" };
      return { t: "accept", ch, from, target };
    }

    case "req": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const id = getStr(bodyObj, "id");
      if (id === null) return { kind: "missing_field", field: "body.id" };
      if (!("sealed" in bodyObj)) return { kind: "missing_field", field: "body.sealed" };
      return { t: "req", ch, from, id };
    }

    case "res": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const id = getStr(bodyObj, "id");
      if (id === null) return { kind: "missing_field", field: "body.id" };
      if (!("sealed" in bodyObj)) return { kind: "missing_field", field: "body.sealed" };
      return { t: "res", ch, from, id };
    }

    case "evt": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const id = getStr(bodyObj, "id");
      if (id === null) return { kind: "missing_field", field: "body.id" };
      if (!("sealed" in bodyObj)) return { kind: "missing_field", field: "body.sealed" };
      return { t: "evt", ch, from, id };
    }

    case "ping": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      return { t: "ping", ch, from };
    }

    case "pong": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      return { t: "pong", ch, from };
    }

    case "close": {
      if (!validatePeerId(from)) return { kind: "invalid_peer_id" };
      const reason = getStr(bodyObj, "reason");
      if (reason === null) return { kind: "missing_field", field: "body.reason" };
      return { t: "close", ch, from, reason };
    }

    case "ready":
    case "terminate":
      return { kind: "unknown_type", type: `${t} (peers must not send ${t})` };

    default:
      return { kind: "unknown_type", type: t };
  }
}

// --- Outgoing message builders ---

function nowMs(): number {
  return Date.now();
}

export function buildReadyWaiting(
  ch: string,
  role: Role,
  peerId: string,
  reconnect: boolean,
): string {
  return JSON.stringify({
    v: 1,
    t: "ready",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: {
      state: "waiting",
      role,
      self: peerId,
      remote: null,
      reconnect,
    },
  });
}

export function buildReadyConnected(
  ch: string,
  role: Role,
  selfId: string,
  remoteId: string,
  reconnect: boolean,
): string {
  return JSON.stringify({
    v: 1,
    t: "ready",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: {
      state: "connected",
      role,
      self: selfId,
      remote: remoteId,
      reconnect,
    },
  });
}

export function buildTerminate(ch: string, reason: CloseReasonString): string {
  return JSON.stringify({
    v: 1,
    t: "terminate",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: { reason },
  });
}

export function buildTerminateWithTarget(
  ch: string,
  reason: CloseReasonString,
  target: string,
): string {
  return JSON.stringify({
    v: 1,
    t: "terminate",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: { reason, target },
  });
}

// --- State machine ---

/**
 * Returns whether a message type is valid in the given state for the given role.
 * Exact parity with the Rust relay's ChannelState::allows_message.
 */
export function stateAllowsMessage(
  state: string,
  msgType: string,
  role: Role,
): boolean {
  // Closed and none reject everything
  if (state === "closed" || state === "none") return false;

  // Close is always allowed (except closed, handled above)
  if (msgType === "close") return true;

  // Ping/pong allowed in all non-closed states
  if (msgType === "ping" || msgType === "pong") return true;

  switch (state) {
    case "pending_accept":
      return msgType === "accept" && role === "dapp";

    case "connected":
      if (msgType === "req") return role === "dapp";
      if (msgType === "res") return role === "wallet";
      if (msgType === "evt") return role === "wallet";
      return false;

    default:
      return false;
  }
}
