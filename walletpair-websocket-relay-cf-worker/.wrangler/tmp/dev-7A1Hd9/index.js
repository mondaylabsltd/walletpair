var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/protocol.ts
var CHANNEL_ID_RE = /^[0-9a-f]{64}$/;
function validateChannelId(ch) {
  return CHANNEL_ID_RE.test(ch);
}
__name(validateChannelId, "validateChannelId");
function validatePeerId(peerId) {
  if (!/^[A-Za-z0-9_-]+$/.test(peerId)) return false;
  try {
    let b64 = peerId.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4 !== 0) b64 += "=";
    const binary = atob(b64);
    return binary.length === 32;
  } catch {
    return false;
  }
}
__name(validatePeerId, "validatePeerId");
function parseErrorToCloseReason(err) {
  return err.kind === "unsupported_version" ? "unsupported_version" : "protocol_error";
}
__name(parseErrorToCloseReason, "parseErrorToCloseReason");
function getStr(obj, key) {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}
__name(getStr, "getStr");
function parseMessage(raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return { kind: "invalid_json" };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { kind: "not_an_object" };
  }
  const obj = value;
  const v = obj["v"];
  if (typeof v !== "number" || !Number.isInteger(v)) {
    return { kind: "missing_field", field: "v" };
  }
  if (v !== 1) {
    return { kind: "unsupported_version", version: v };
  }
  const t = getStr(obj, "t");
  if (t === null) return { kind: "missing_field", field: "t" };
  const ch = getStr(obj, "ch");
  if (ch === null) return { kind: "missing_field", field: "ch" };
  if (!validateChannelId(ch)) return { kind: "invalid_channel_id" };
  if (typeof obj["ts"] !== "number") {
    return { kind: "missing_field", field: "ts" };
  }
  const from = getStr(obj, "from");
  if (from === null) return { kind: "missing_field", field: "from" };
  const body = obj["body"];
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { kind: "missing_field", field: "body" };
  }
  const bodyObj = body;
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
__name(parseMessage, "parseMessage");
function nowMs() {
  return Date.now();
}
__name(nowMs, "nowMs");
function buildReadyWaiting(ch, role, peerId, reconnect) {
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
      reconnect
    }
  });
}
__name(buildReadyWaiting, "buildReadyWaiting");
function buildReadyConnected(ch, role, selfId, remoteId, reconnect) {
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
      reconnect
    }
  });
}
__name(buildReadyConnected, "buildReadyConnected");
function buildTerminate(ch, reason) {
  return JSON.stringify({
    v: 1,
    t: "terminate",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: { reason }
  });
}
__name(buildTerminate, "buildTerminate");
function buildTerminateWithTarget(ch, reason, target) {
  return JSON.stringify({
    v: 1,
    t: "terminate",
    ch,
    ts: nowMs(),
    from: "_adapter",
    body: { reason, target }
  });
}
__name(buildTerminateWithTarget, "buildTerminateWithTarget");
function stateAllowsMessage(state, msgType, role) {
  if (state === "closed" || state === "none") return false;
  if (msgType === "close") return true;
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
__name(stateAllowsMessage, "stateAllowsMessage");

// src/channel.ts
import { DurableObject } from "cloudflare:workers";
var MAX_MESSAGE_BYTES = 65536;
var PENDING_REQUEST_LIMIT = 32;
var UNPAIRED_TTL_MS = 5 * 60 * 1e3;
var CONNECTED_TTL_MS = 24 * 60 * 60 * 1e3;
var ChannelDO = class extends DurableObject {
  static {
    __name(this, "ChannelDO");
  }
  // --- In-memory state (reconstructed from storage on hibernation wake) ---
  channelState = "none";
  channelId = null;
  dappPeerId = null;
  walletPeerId = null;
  isReconnect = false;
  pendingRequests = /* @__PURE__ */ new Set();
  initialized = false;
  // --- WebSocket Upgrade Handler ---
  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }
    const url = new URL(request.url);
    const ch = url.searchParams.get("ch");
    if (!ch || !validateChannelId(ch)) {
      return new Response("Invalid channel ID", { status: 400 });
    }
    const protocols = request.headers.get("Sec-WebSocket-Protocol");
    const hasWalletPairProtocol = protocols?.split(",").some((p) => p.trim() === "walletpair.v1") ?? false;
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    await this.ensureInitialized();
    if (this.channelId === null) {
      this.channelId = ch;
    }
    const responseHeaders = {};
    if (hasWalletPairProtocol) {
      responseHeaders["Sec-WebSocket-Protocol"] = "walletpair.v1";
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: responseHeaders
    });
  }
  // --- Hibernation Callbacks ---
  async webSocketMessage(ws, message) {
    await this.ensureInitialized();
    if (typeof message !== "string") {
      const ch = this.channelId ?? "unknown";
      this.sendAndClose(ws, buildTerminate(ch, "protocol_error"));
      return;
    }
    if (message.length > MAX_MESSAGE_BYTES) {
      const ch = this.channelId ?? "unknown";
      this.sendAndClose(ws, buildTerminate(ch, "payload_too_large"));
      return;
    }
    const result = parseMessage(message);
    if ("kind" in result) {
      const ch = this.channelId ?? "unknown";
      const reason = parseErrorToCloseReason(result);
      this.sendAndClose(ws, buildTerminate(ch, reason));
      return;
    }
    const msg = result;
    if (msg.ch !== this.channelId) {
      this.sendAndClose(ws, buildTerminate(msg.ch, "protocol_error"));
      return;
    }
    const attachment = this.getAttachment(ws);
    if (attachment === null) {
      await this.handleFirstMessage(ws, msg, message);
    } else {
      await this.handleMessage(ws, attachment, msg, message);
    }
  }
  async webSocketClose(ws, code, _reason, _wasClean) {
    await this.ensureInitialized();
    await this.handleDisconnect(ws);
  }
  async webSocketError(ws, _error) {
    await this.ensureInitialized();
    await this.handleDisconnect(ws);
  }
  async alarm() {
    await this.ensureInitialized();
    const ch = this.channelId;
    if (!ch) return;
    const terminateMsg = buildTerminate(ch, "timeout");
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(terminateMsg);
        ws.close(1e3, "timeout");
      } catch {
      }
    }
    this.channelState = "closed";
    await this.persistState();
  }
  // --- First message handling ---
  async handleFirstMessage(ws, msg, rawText) {
    const ch = msg.ch;
    switch (msg.t) {
      case "create":
        await this.handleCreate(ws, ch, msg.from);
        break;
      case "join":
        await this.handleJoin(ws, ch, msg.from, msg.sealedJoinNull, rawText);
        break;
      default:
        this.sendAndClose(ws, buildTerminate(ch, "invalid_state"));
        break;
    }
  }
  // --- Create ---
  async handleCreate(ws, ch, from) {
    switch (this.channelState) {
      case "waiting": {
        const oldDapp = this.findPeerWs("dapp");
        if (oldDapp) {
          try {
            oldDapp.send(buildTerminate(ch, "normal"));
            oldDapp.close(1e3, "replaced");
          } catch {
          }
        }
        break;
      }
      case "connected": {
        const dappWs = this.findPeerWs("dapp");
        if (dappWs) {
          this.sendAndClose(ws, buildTerminate(ch, "channel_exists"));
          return;
        }
        const walletWs = this.findPeerWs("wallet");
        if (walletWs) {
          try {
            walletWs.send(buildTerminate(ch, "normal"));
            walletWs.close(1e3, "replaced");
          } catch {
          }
        }
        break;
      }
      case "pending_accept": {
        this.sendAndClose(ws, buildTerminate(ch, "channel_exists"));
        return;
      }
      case "closed":
      case "none": {
        break;
      }
    }
    this.channelState = "waiting";
    this.dappPeerId = from;
    this.walletPeerId = null;
    this.isReconnect = false;
    this.pendingRequests.clear();
    this.setAttachment(ws, { role: "dapp", peerId: from, channelId: ch });
    ws.send(buildReadyWaiting(ch, "dapp", from, false));
    await this.ctx.storage.setAlarm(Date.now() + UNPAIRED_TTL_MS);
    await this.persistState();
  }
  // --- Join ---
  async handleJoin(ws, ch, from, sealedJoinNull, rawText) {
    if (this.channelState !== "waiting") {
      const reason = this.channelState === "closed" || this.channelState === "none" ? "channel_not_found" : "already_connected";
      this.sendAndClose(ws, buildTerminate(ch, reason));
      return;
    }
    this.walletPeerId = from;
    this.isReconnect = sealedJoinNull;
    this.channelState = "pending_accept";
    this.setAttachment(ws, { role: "wallet", peerId: from, channelId: ch });
    const dappWs = this.findPeerWs("dapp");
    if (dappWs) {
      try {
        dappWs.send(rawText);
      } catch {
      }
    }
    ws.send(buildReadyWaiting(ch, "wallet", from, sealedJoinNull));
    await this.persistState();
  }
  // --- Subsequent message handling ---
  async handleMessage(ws, attachment, msg, rawText) {
    const ch = msg.ch;
    const { role } = attachment;
    switch (msg.t) {
      case "create": {
        await this.handleCreate(ws, ch, msg.from);
        return;
      }
      case "join": {
        this.sendAndClose(ws, buildTerminate(ch, "invalid_state"));
        return;
      }
      case "accept":
        await this.handleAccept(ws, ch, msg.from, msg.target, role);
        return;
      case "req":
        await this.handleData(ws, rawText, ch, msg.from, "req", msg.id, role);
        return;
      case "res":
        await this.handleData(ws, rawText, ch, msg.from, "res", msg.id, role);
        return;
      case "evt":
        await this.handleData(ws, rawText, ch, msg.from, "evt", msg.id, role);
        return;
      case "ping":
        await this.handleData(ws, rawText, ch, msg.from, "ping", void 0, role);
        return;
      case "pong":
        await this.handleData(ws, rawText, ch, msg.from, "pong", void 0, role);
        return;
      case "close":
        await this.handleClose(ws, rawText, ch, msg.from, role);
        return;
    }
  }
  // --- Accept ---
  async handleAccept(_ws, ch, from, target, senderRole) {
    if (senderRole !== "dapp" || from !== this.dappPeerId) {
      this.sendAndClose(_ws, buildTerminate(ch, "invalid_role"));
      return;
    }
    if (this.channelState !== "pending_accept") {
      this.sendAndClose(_ws, buildTerminate(ch, "invalid_state"));
      return;
    }
    if (target !== this.walletPeerId) {
      this.sendAndClose(_ws, buildTerminateWithTarget(ch, "protocol_error", target));
      return;
    }
    this.channelState = "connected";
    const walletId = this.walletPeerId;
    const reconnect = this.isReconnect;
    const dappWs = this.findPeerWs("dapp");
    if (dappWs) {
      try {
        dappWs.send(buildReadyConnected(ch, "dapp", from, walletId, reconnect));
      } catch {
      }
    }
    const walletWs = this.findPeerWs("wallet");
    if (walletWs) {
      try {
        walletWs.send(buildReadyConnected(ch, "wallet", walletId, from, reconnect));
      } catch {
      }
    }
    await this.ctx.storage.setAlarm(Date.now() + CONNECTED_TTL_MS);
    await this.persistState();
  }
  // --- Data messages (req, res, evt, ping, pong) ---
  async handleData(ws, rawText, ch, from, msgType, reqId, senderRole) {
    const expectedPeerId = senderRole === "dapp" ? this.dappPeerId : this.walletPeerId;
    if (from !== expectedPeerId) {
      this.sendAndClose(ws, buildTerminate(ch, "invalid_role"));
      return;
    }
    if (!stateAllowsMessage(this.channelState, msgType, senderRole)) {
      const reason = (msgType === "req" || msgType === "res" || msgType === "evt") && this.channelState !== "connected" ? "invalid_state" : "invalid_role";
      this.sendAndClose(ws, buildTerminate(ch, reason));
      return;
    }
    if (msgType === "req" && reqId !== void 0) {
      if (this.pendingRequests.size >= PENDING_REQUEST_LIMIT) {
        this.sendAndClose(ws, buildTerminate(ch, "rate_limited"));
        return;
      }
      this.pendingRequests.add(reqId);
    }
    if (msgType === "res" && reqId !== void 0) {
      this.pendingRequests.delete(reqId);
    }
    const otherRole = senderRole === "dapp" ? "wallet" : "dapp";
    const otherWs = this.findPeerWs(otherRole);
    if (otherWs) {
      try {
        otherWs.send(rawText);
      } catch {
      }
    }
    if (msgType === "req" || msgType === "res") {
      await this.persistState();
    }
  }
  // --- Close ---
  async handleClose(_ws, rawText, ch, from, senderRole) {
    const expectedPeerId = senderRole === "dapp" ? this.dappPeerId : this.walletPeerId;
    if (from !== expectedPeerId) {
      this.sendAndClose(_ws, buildTerminate(ch, "invalid_role"));
      return;
    }
    const otherRole = senderRole === "dapp" ? "wallet" : "dapp";
    const otherWs = this.findPeerWs(otherRole);
    if (otherWs) {
      try {
        otherWs.send(rawText);
        otherWs.close(1e3, "peer_closed");
      } catch {
      }
    }
    try {
      _ws.close(1e3, "closed");
    } catch {
    }
    this.channelState = "closed";
    await this.persistState();
    await this.ctx.storage.deleteAlarm();
  }
  // --- Disconnect handling ---
  async handleDisconnect(ws) {
    const attachment = this.getAttachment(ws);
    if (!attachment) return;
    const { role } = attachment;
    const ch = this.channelId;
    if (!ch) return;
    if (this.channelState === "waiting" || this.channelState === "pending_accept") {
      if (role === "dapp") {
        const walletWs = this.findPeerWs("wallet");
        if (walletWs) {
          try {
            walletWs.send(buildTerminate(ch, "channel_not_found"));
            walletWs.close(1e3, "dapp_disconnected");
          } catch {
          }
        }
        this.channelState = "closed";
        await this.persistState();
        await this.ctx.storage.deleteAlarm();
      }
      if (role === "wallet" && this.channelState === "pending_accept") {
        this.walletPeerId = null;
        this.isReconnect = false;
        this.channelState = "waiting";
        await this.persistState();
      }
      return;
    }
    if (this.channelState === "connected") {
      return;
    }
  }
  // --- Helpers ---
  findPeerWs(role) {
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.role === role) {
        if (ws.readyState <= 1) return ws;
      }
    }
    return null;
  }
  getAttachment(ws) {
    try {
      const att = ws.deserializeAttachment();
      return att;
    } catch {
      return null;
    }
  }
  setAttachment(ws, attachment) {
    ws.serializeAttachment(attachment);
  }
  sendAndClose(ws, message) {
    try {
      ws.send(message);
      ws.close(1e3, "rejected");
    } catch {
    }
  }
  async persistState() {
    if (!this.channelId) return;
    const state = {
      state: this.channelState,
      dappPeerId: this.dappPeerId ?? "",
      walletPeerId: this.walletPeerId,
      isReconnect: this.isReconnect,
      pendingRequests: Array.from(this.pendingRequests)
    };
    await this.ctx.storage.put("channelState", state);
  }
  async ensureInitialized() {
    if (this.initialized) return;
    this.initialized = true;
    const stored = await this.ctx.storage.get("channelState");
    if (stored) {
      this.channelState = stored.state;
      this.dappPeerId = stored.dappPeerId || null;
      this.walletPeerId = stored.walletPeerId;
      this.isReconnect = stored.isReconnect;
      this.pendingRequests = new Set(stored.pendingRequests);
    }
    if (!this.channelId) {
      for (const ws of this.ctx.getWebSockets()) {
        const att = this.getAttachment(ws);
        if (att?.channelId) {
          this.channelId = att.channelId;
          break;
        }
      }
    }
  }
};

// src/index.ts
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Upgrade, Sec-WebSocket-Protocol, Sec-WebSocket-Key, Sec-WebSocket-Version",
  "Access-Control-Max-Age": "86400"
};
var src_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }
    if (url.pathname === "/v1") {
      return handleWebSocket(request, url, env);
    }
    return new Response("Not found", { status: 404 });
  }
};
async function handleWebSocket(request, url, env) {
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }
  const ch = url.searchParams.get("ch");
  if (!ch) {
    return new Response(
      "Missing required query parameter: ch",
      { status: 400, headers: CORS_HEADERS }
    );
  }
  if (!validateChannelId(ch)) {
    return new Response(
      "Invalid channel ID: must be 64 lowercase hex characters",
      { status: 400, headers: CORS_HEADERS }
    );
  }
  const doId = env.CHANNEL.idFromName(ch);
  const stub = env.CHANNEL.get(doId);
  return stub.fetch(request);
}
__name(handleWebSocket, "handleWebSocket");

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-f77yAj/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-f77yAj/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  ChannelDO,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
