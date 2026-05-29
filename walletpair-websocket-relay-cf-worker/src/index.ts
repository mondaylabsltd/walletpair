import type { Env } from "./types";
import { validateChannelId } from "./protocol";

export { ChannelDO } from "./channel";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Upgrade, Sec-WebSocket-Protocol, Sec-WebSocket-Key, Sec-WebSocket-Version",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (url.pathname === "/healthz") {
      return new Response("ok", { status: 200 });
    }

    // WebSocket endpoint
    if (url.pathname === "/v1") {
      return handleWebSocket(request, url, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function handleWebSocket(
  request: Request,
  url: URL,
  env: Env,
): Promise<Response> {
  // Must be a WebSocket upgrade
  const upgradeHeader = request.headers.get("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return new Response("Expected WebSocket upgrade", { status: 426 });
  }

  // Extract channel ID from query parameter
  const ch = url.searchParams.get("ch");
  if (!ch) {
    return new Response(
      "Missing required query parameter: ch",
      { status: 400, headers: CORS_HEADERS },
    );
  }

  if (!validateChannelId(ch)) {
    return new Response(
      "Invalid channel ID: must be 64 lowercase hex characters",
      { status: 400, headers: CORS_HEADERS },
    );
  }

  // Route to the ChannelDO for this channel ID
  const doId = env.CHANNEL.idFromName(ch);
  const stub = env.CHANNEL.get(doId);

  // Forward the request to the DO (it will handle the WebSocket upgrade)
  return stub.fetch(request);
}
