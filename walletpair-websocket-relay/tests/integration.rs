//! Integration tests for WalletPair Protocol v1 WebSocket Relay.
//!
//! Each test starts its own relay server on a random port, connects WebSocket
//! clients, and verifies protocol behavior end-to-end.

use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TIMEOUT: Duration = Duration::from_secs(5);

fn make_peer_id(byte: u8) -> String {
    URL_SAFE_NO_PAD.encode([byte; 32])
}

fn make_channel_id() -> String {
    "ab".repeat(32)
}

/// Start a relay server on a random port and return its base URL (e.g. "127.0.0.1:12345").
async fn start_server() -> (String, tokio::sync::broadcast::Sender<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();

    let config = walletpair_websocket_relay::config::Config {
        listen_addr: addr,
        metrics_enabled: true,
        max_message_bytes: 65_536,
        ..Default::default()
    };
    let config = Arc::new(config);

    let metrics = walletpair_websocket_relay::metrics::Metrics::new();
    let store = walletpair_websocket_relay::store::ChannelStore::new(&config);

    let (shutdown_tx, _) = tokio::sync::broadcast::channel(1);

    let app_state = walletpair_websocket_relay::http::AppState {
        store: Arc::new(Mutex::new(store)),
        config: config.clone(),
        metrics,
        shutdown_tx: shutdown_tx.clone(),
        conn_counter: Arc::new(AtomicU64::new(1)),
    };

    let router = walletpair_websocket_relay::http::router(app_state);

    tokio::spawn(async move {
        axum::serve(listener, router).await.unwrap();
    });

    (addr.to_string(), shutdown_tx)
}

type WsStream =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn ws_connect(addr: &str) -> WsStream {
    let url = format!("ws://{}/v1", addr);
    let (ws, _response) = tokio_tungstenite::connect_async(&url).await.unwrap();
    ws
}

async fn send_json(ws: &mut WsStream, val: &Value) {
    ws.send(Message::Text(val.to_string().into()))
        .await
        .unwrap();
}

async fn send_text(ws: &mut WsStream, text: &str) {
    ws.send(Message::Text(text.into())).await.unwrap();
}

async fn recv_json(ws: &mut WsStream) -> Value {
    let msg = timeout(TIMEOUT, ws.next())
        .await
        .expect("timed out waiting for message")
        .expect("stream ended")
        .expect("read error");
    match msg {
        Message::Text(t) => serde_json::from_str(&t).expect("not valid JSON"),
        other => panic!("expected text frame, got {:?}", other),
    }
}

fn create_msg(ch: &str, peer: &str) -> Value {
    json!({
        "v": 1,
        "t": "create",
        "ch": ch,
        "from": peer,
        "pubkey": peer
    })
}

fn join_msg(ch: &str, peer: &str) -> Value {
    json!({
        "v": 1,
        "t": "join",
        "ch": ch,
        "from": peer,
        "pubkey": peer,
        "capabilities": {"methods": [], "events": [], "chains": []}
    })
}

fn accept_msg(ch: &str, from: &str, target: &str) -> Value {
    json!({
        "v": 1,
        "t": "accept",
        "ch": ch,
        "from": from,
        "target": target
    })
}

fn req_msg(ch: &str, from: &str, id: &str) -> Value {
    json!({
        "v": 1,
        "t": "req",
        "ch": ch,
        "from": from,
        "id": id,
        "method": "eth_sendTransaction",
        "params": {}
    })
}

fn res_msg(ch: &str, from: &str, id: &str) -> Value {
    json!({
        "v": 1,
        "t": "res",
        "ch": ch,
        "from": from,
        "id": id,
        "ok": true,
        "result": "0x123"
    })
}

fn evt_msg(ch: &str, from: &str) -> Value {
    json!({
        "v": 1,
        "t": "evt",
        "ch": ch,
        "from": from,
        "event": "accountsChanged",
        "data": {}
    })
}

fn close_msg(ch: &str, from: &str, reason: &str) -> Value {
    json!({
        "v": 1,
        "t": "close",
        "ch": ch,
        "from": from,
        "reason": reason
    })
}

/// Helper: create channel, join wallet, accept -- return (dapp_ws, wallet_ws, dapp_resume, wallet_resume).
async fn setup_connected_pair(addr: &str) -> (WsStream, WsStream, String, String) {
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    // dApp creates
    let mut dapp = ws_connect(addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let ready = recv_json(&mut dapp).await;
    assert_eq!(ready["t"], "ready");
    assert_eq!(ready["state"], "waiting");
    let _dapp_resume_1 = ready["resume"].as_str().unwrap().to_string();

    // Wallet joins
    let mut wallet = ws_connect(addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;

    // Wallet gets ready.waiting
    let wallet_ready = recv_json(&mut wallet).await;
    assert_eq!(wallet_ready["t"], "ready");
    assert_eq!(wallet_ready["state"], "waiting");
    let _wallet_resume_1 = wallet_ready["resume"].as_str().unwrap().to_string();

    // dApp gets the raw join forwarded
    let join_fwd = recv_json(&mut dapp).await;
    assert_eq!(join_fwd["t"], "join");

    // dApp accepts
    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wallet_peer)).await;

    // Both get ready.connected
    let dapp_connected = recv_json(&mut dapp).await;
    assert_eq!(dapp_connected["t"], "ready");
    assert_eq!(dapp_connected["state"], "connected");
    let dapp_resume = dapp_connected["resume"].as_str().unwrap().to_string();

    let wallet_connected = recv_json(&mut wallet).await;
    assert_eq!(wallet_connected["t"], "ready");
    assert_eq!(wallet_connected["state"], "connected");
    let wallet_resume = wallet_connected["resume"].as_str().unwrap().to_string();

    (dapp, wallet, dapp_resume, wallet_resume)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn dapp_create_receives_ready_waiting() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;

    let ready = recv_json(&mut dapp).await;
    assert_eq!(ready["v"], 1);
    assert_eq!(ready["t"], "ready");
    assert_eq!(ready["ch"], ch);
    assert_eq!(ready["state"], "waiting");
    assert_eq!(ready["role"], "dapp");
    assert_eq!(ready["self"], dapp_peer);
    assert!(ready["resume"].as_str().is_some());
}

#[tokio::test]
async fn wallet_join_receives_ready_waiting_and_dapp_receives_join() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    // dApp creates
    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await; // ready.waiting

    // Wallet joins
    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;

    // Wallet gets ready.waiting
    let wallet_ready = recv_json(&mut wallet).await;
    assert_eq!(wallet_ready["t"], "ready");
    assert_eq!(wallet_ready["state"], "waiting");
    assert_eq!(wallet_ready["role"], "wallet");
    assert_eq!(wallet_ready["self"], wallet_peer);

    // dApp receives the raw join message forwarded
    let join_fwd = recv_json(&mut dapp).await;
    assert_eq!(join_fwd["t"], "join");
    assert_eq!(join_fwd["from"], wallet_peer);
    assert!(join_fwd.get("capabilities").is_some());
}

#[tokio::test]
async fn dapp_accept_both_receive_ready_connected() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await; // ready.waiting
    let _ = recv_json(&mut dapp).await; // join forwarded

    // dApp accepts
    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wallet_peer)).await;

    // dApp gets ready.connected
    let dapp_ready = recv_json(&mut dapp).await;
    assert_eq!(dapp_ready["t"], "ready");
    assert_eq!(dapp_ready["state"], "connected");
    assert_eq!(dapp_ready["role"], "dapp");
    assert_eq!(dapp_ready["remote"], wallet_peer);
    assert!(dapp_ready["resume"].as_str().is_some());

    // Wallet gets ready.connected
    let wallet_ready = recv_json(&mut wallet).await;
    assert_eq!(wallet_ready["t"], "ready");
    assert_eq!(wallet_ready["state"], "connected");
    assert_eq!(wallet_ready["role"], "wallet");
    assert_eq!(wallet_ready["remote"], dapp_peer);
    assert!(wallet_ready["resume"].as_str().is_some());
}

#[tokio::test]
async fn connected_req_forwarded_to_wallet() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp sends req
    let req = req_msg(&ch, &dapp_peer, "r1");
    send_json(&mut dapp, &req).await;

    // Wallet receives it
    let received = recv_json(&mut wallet).await;
    assert_eq!(received["t"], "req");
    assert_eq!(received["id"], "r1");
    assert_eq!(received["method"], "eth_sendTransaction");
}

#[tokio::test]
async fn connected_res_forwarded_to_dapp() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp sends req first (to have a pending request)
    send_json(&mut dapp, &req_msg(&ch, &dapp_peer, "r1")).await;
    let _ = recv_json(&mut wallet).await; // consume req

    // Wallet sends res
    let res = res_msg(&ch, &wallet_peer, "r1");
    send_json(&mut wallet, &res).await;

    // dApp receives it
    let received = recv_json(&mut dapp).await;
    assert_eq!(received["t"], "res");
    assert_eq!(received["id"], "r1");
    assert_eq!(received["ok"], true);
}

#[tokio::test]
async fn connected_evt_forwarded_to_dapp() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // Wallet sends evt
    let evt = evt_msg(&ch, &wallet_peer);
    send_json(&mut wallet, &evt).await;

    // dApp receives it
    let received = recv_json(&mut dapp).await;
    assert_eq!(received["t"], "evt");
    assert_eq!(received["event"], "accountsChanged");
}

#[tokio::test]
async fn dapp_cannot_send_evt() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut _wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp sends evt (not allowed)
    let evt = evt_msg(&ch, &dapp_peer);
    send_json(&mut dapp, &evt).await;

    // dApp gets close with invalid_role
    let close = recv_json(&mut dapp).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_role");
}

#[tokio::test]
async fn wallet_cannot_send_req() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let (mut _dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // Wallet sends req (not allowed)
    let req = req_msg(&ch, &wallet_peer, "r1");
    send_json(&mut wallet, &req).await;

    // Wallet gets close with invalid_role
    let close = recv_json(&mut wallet).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_role");
}

#[tokio::test]
async fn accept_wrong_target_rejected() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);
    let wrong_target = make_peer_id(3);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await;

    // dApp accepts with wrong target
    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wrong_target)).await;

    let close = recv_json(&mut dapp).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
    assert_eq!(close["target"], wrong_target);
}

#[tokio::test]
async fn join_missing_channel_returns_channel_not_found() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;

    let close = recv_json(&mut wallet).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "channel_not_found");
}

#[tokio::test]
async fn duplicate_create_returns_channel_exists() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let dapp_peer_2 = make_peer_id(3);

    // First create succeeds
    let mut dapp1 = ws_connect(&addr).await;
    send_json(&mut dapp1, &create_msg(&ch, &dapp_peer)).await;
    let ready = recv_json(&mut dapp1).await;
    assert_eq!(ready["t"], "ready");

    // Second create on same channel fails
    let mut dapp2 = ws_connect(&addr).await;
    send_json(&mut dapp2, &create_msg(&ch, &dapp_peer_2)).await;
    let close = recv_json(&mut dapp2).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "channel_exists");
}

#[tokio::test]
async fn third_peer_join_returns_already_connected() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);
    let third_peer = make_peer_id(3);

    // Setup: create + join (channel is now in PendingAccept)
    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await;

    // Third peer tries to join
    let mut third = ws_connect(&addr).await;
    send_json(&mut third, &join_msg(&ch, &third_peer)).await;

    let close = recv_json(&mut third).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "already_connected");
}

#[tokio::test]
async fn payload_too_large_returns_close() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await; // ready.waiting

    // Send a message exceeding 64KB
    let huge_payload = "x".repeat(65_537 + 100);
    let big_msg = json!({
        "v": 1,
        "t": "close",
        "ch": ch,
        "from": dapp_peer,
        "reason": "normal",
        "data": huge_payload
    });
    send_json(&mut dapp, &big_msg).await;

    let close = recv_json(&mut dapp).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "payload_too_large");
}

#[tokio::test]
async fn invalid_json_returns_protocol_error() {
    let (addr, _shutdown) = start_server().await;

    let mut ws = ws_connect(&addr).await;
    send_text(&mut ws, "this is not json {{{").await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn unsupported_version_returns_close() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let mut ws = ws_connect(&addr).await;
    let msg = json!({
        "v": 2,
        "t": "create",
        "ch": ch,
        "from": dapp_peer,
        "pubkey": dapp_peer
    });
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "unsupported_version");
}

#[tokio::test]
async fn close_from_dapp_forwarded_to_wallet() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp sends close
    send_json(&mut dapp, &close_msg(&ch, &dapp_peer, "normal")).await;

    // Wallet receives the close
    let received = recv_json(&mut wallet).await;
    assert_eq!(received["t"], "close");
    assert_eq!(received["reason"], "normal");
    assert_eq!(received["from"], dapp_peer);
}

#[tokio::test]
async fn dapp_reconnect_with_valid_resume() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut _wallet, dapp_resume, _wallet_resume) = setup_connected_pair(&addr).await;

    // dApp disconnects
    dapp.close(None).await.unwrap();

    // dApp reconnects with resume token
    let mut dapp2 = ws_connect(&addr).await;
    let reconnect_msg = json!({
        "v": 1,
        "t": "create",
        "ch": ch,
        "from": dapp_peer,
        "pubkey": dapp_peer,
        "resume": dapp_resume
    });
    send_json(&mut dapp2, &reconnect_msg).await;

    // Should get ready.connected (wallet is still connected)
    let ready = recv_json(&mut dapp2).await;
    assert_eq!(ready["t"], "ready");
    assert_eq!(ready["state"], "connected");
    assert_eq!(ready["role"], "dapp");
    assert!(ready["resume"].as_str().is_some());
    // New resume token should be different from old one
    assert_ne!(ready["resume"].as_str().unwrap(), dapp_resume);
}

#[tokio::test]
async fn wallet_reconnect_with_valid_resume() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let (mut _dapp, mut wallet, _dapp_resume, wallet_resume) = setup_connected_pair(&addr).await;

    // Wallet disconnects
    wallet.close(None).await.unwrap();

    // Wallet reconnects with resume token
    let mut wallet2 = ws_connect(&addr).await;
    let reconnect_msg = json!({
        "v": 1,
        "t": "join",
        "ch": ch,
        "from": wallet_peer,
        "pubkey": wallet_peer,
        "capabilities": {"methods": [], "events": [], "chains": []},
        "resume": wallet_resume
    });
    send_json(&mut wallet2, &reconnect_msg).await;

    // Should get ready.connected (dapp is still connected)
    let ready = recv_json(&mut wallet2).await;
    assert_eq!(ready["t"], "ready");
    assert_eq!(ready["state"], "connected");
    assert_eq!(ready["role"], "wallet");
    assert!(ready["resume"].as_str().is_some());
    assert_ne!(ready["resume"].as_str().unwrap(), wallet_resume);
}

#[tokio::test]
async fn invalid_resume_returns_close() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    // First create a channel so channel exists
    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    // Try to reconnect with bogus token on a new connection
    let mut dapp2 = ws_connect(&addr).await;
    let reconnect_msg = json!({
        "v": 1,
        "t": "create",
        "ch": ch,
        "from": dapp_peer,
        "pubkey": dapp_peer,
        "resume": "bogus-token-that-does-not-exist"
    });
    send_json(&mut dapp2, &reconnect_msg).await;

    let close = recv_json(&mut dapp2).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_resume");
}

#[tokio::test]
async fn metrics_endpoint_returns_prometheus_format() {
    let (addr, _shutdown) = start_server().await;

    // Create a channel to ensure some metrics exist
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    // Fetch /metrics via HTTP
    let resp = reqwest::get(&format!("http://{}/metrics", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body = resp.text().await.unwrap();
    // Check for expected Prometheus metric names
    assert!(body.contains("walletpair_active_connections"));
    assert!(body.contains("walletpair_active_channels"));
    assert!(body.contains("walletpair_channels_created_total"));
}

#[tokio::test]
async fn healthz_returns_ok() {
    let (addr, _shutdown) = start_server().await;

    let resp = reqwest::get(&format!("http://{}/healthz", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let body = resp.text().await.unwrap();
    assert_eq!(body, "ok");
}

#[tokio::test]
async fn binary_frame_rejected() {
    let (addr, _shutdown) = start_server().await;

    let mut ws = ws_connect(&addr).await;
    // Send a binary frame
    ws.send(Message::Binary(vec![0x00, 0x01, 0x02].into()))
        .await
        .unwrap();

    // Should get a close with protocol_error
    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

// ---------------------------------------------------------------------------
// Additional E2E tests — edge cases & full protocol coverage
// ---------------------------------------------------------------------------

#[tokio::test]
async fn ping_forwarded_to_other_peer_in_connected_state() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp sends ping
    let ping = json!({"v":1, "t":"ping", "ch":ch, "from":dapp_peer, "ts": 12345});
    send_json(&mut dapp, &ping).await;

    // wallet receives the ping (raw forwarded)
    let received = recv_json(&mut wallet).await;
    assert_eq!(received["t"], "ping");
    assert_eq!(received["from"], dapp_peer);
    assert_eq!(received["ts"], 12345);
}

#[tokio::test]
async fn pong_forwarded_to_other_peer_in_connected_state() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    // dApp pings, wallet receives
    let ping = json!({"v":1, "t":"ping", "ch":ch, "from":dapp_peer, "ts": 100});
    send_json(&mut dapp, &ping).await;
    let _ = recv_json(&mut wallet).await;

    // wallet pongs, dApp receives
    let pong = json!({"v":1, "t":"pong", "ch":ch, "from":wallet_peer, "ts": 200});
    send_json(&mut wallet, &pong).await;

    let received = recv_json(&mut dapp).await;
    assert_eq!(received["t"], "pong");
    assert_eq!(received["ts"], 200);
}

#[tokio::test]
async fn close_from_wallet_forwarded_to_dapp() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    send_json(&mut wallet, &close_msg(&ch, &wallet_peer, "normal")).await;

    let received = recv_json(&mut dapp).await;
    assert_eq!(received["t"], "close");
    assert_eq!(received["reason"], "normal");
    assert_eq!(received["from"], wallet_peer);
}

#[tokio::test]
async fn dapp_accept_before_wallet_joins_returns_invalid_state() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await; // ready.waiting

    // dApp tries to accept before any wallet joined
    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wallet_peer)).await;

    let close = recv_json(&mut dapp).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_state");
}

#[tokio::test]
async fn wallet_sends_res_before_connected_returns_invalid_state() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    // Create + join but don't accept
    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await; // ready.waiting
    let _ = recv_json(&mut dapp).await; // join forwarded

    // Wallet tries to send res before accept
    send_json(&mut wallet, &res_msg(&ch, &wallet_peer, "r1")).await;

    let close = recv_json(&mut wallet).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_state");
}

#[tokio::test]
async fn first_message_must_be_create_or_join() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let peer = make_peer_id(1);

    let mut ws = ws_connect(&addr).await;
    // Send req as first message (no channel binding)
    send_json(&mut ws, &req_msg(&ch, &peer, "r1")).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_state");
}

#[tokio::test]
async fn multiple_req_res_in_sequence() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    for i in 0..5 {
        let id = format!("req-{i}");
        send_json(&mut dapp, &req_msg(&ch, &dapp_peer, &id)).await;
        let received = recv_json(&mut wallet).await;
        assert_eq!(received["id"], id);

        send_json(&mut wallet, &res_msg(&ch, &wallet_peer, &id)).await;
        let received = recv_json(&mut dapp).await;
        assert_eq!(received["id"], id);
        assert_eq!(received["ok"], true);
    }
}

#[tokio::test]
async fn sealed_field_passes_through_untouched() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    let req = json!({
        "v":1, "t":"req", "ch":ch, "from":dapp_peer, "id":"s1",
        "method": "wallet_sign",
        "sealed": "dGhpcyBpcyBlbmNyeXB0ZWQgZGF0YQ"
    });
    send_json(&mut dapp, &req).await;

    let received = recv_json(&mut wallet).await;
    assert_eq!(received["sealed"], "dGhpcyBpcyBlbmNyeXB0ZWQgZGF0YQ");
}

#[tokio::test]
async fn resume_token_rejected_when_wrong_peer_id() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let impersonator = make_peer_id(99);

    let (mut dapp, _wallet, dapp_resume, _) = setup_connected_pair(&addr).await;
    dapp.close(None).await.unwrap();

    // Impersonator tries to use dApp's resume token
    let mut fake = ws_connect(&addr).await;
    let msg = json!({
        "v":1, "t":"create", "ch":ch,
        "from":impersonator, "pubkey":impersonator,
        "resume": dapp_resume
    });
    send_json(&mut fake, &msg).await;

    let close = recv_json(&mut fake).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_resume");
}

#[tokio::test]
async fn resume_token_rejected_when_wrong_role() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let (mut dapp, _wallet, dapp_resume, _) = setup_connected_pair(&addr).await;
    dapp.close(None).await.unwrap();

    // DApp tries to use its resume token as a wallet (join instead of create)
    let mut ws = ws_connect(&addr).await;
    let msg = json!({
        "v":1, "t":"join", "ch":ch,
        "from":dapp_peer, "pubkey":dapp_peer,
        "capabilities": {"methods":[], "events":[], "chains":[]},
        "resume": dapp_resume
    });
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_resume");
}

#[tokio::test]
async fn reconnect_both_peers_disconnect_then_reconnect() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, dapp_resume, wallet_resume) = setup_connected_pair(&addr).await;

    // Both disconnect
    dapp.close(None).await.unwrap();
    wallet.close(None).await.unwrap();
    // Small yield to let cleanup run
    tokio::task::yield_now().await;

    // dApp reconnects first — should get ready.waiting (wallet not yet connected)
    let mut dapp2 = ws_connect(&addr).await;
    send_json(
        &mut dapp2,
        &json!({
            "v":1, "t":"create", "ch":ch,
            "from":dapp_peer, "pubkey":dapp_peer,
            "resume": dapp_resume
        }),
    )
    .await;
    let ready = recv_json(&mut dapp2).await;
    assert_eq!(ready["state"], "waiting");

    // wallet reconnects — should get ready.connected (dApp just reconnected)
    let mut wallet2 = ws_connect(&addr).await;
    send_json(
        &mut wallet2,
        &json!({
            "v":1, "t":"join", "ch":ch,
            "from":wallet_peer, "pubkey":wallet_peer,
            "capabilities":{"methods":[],"events":[],"chains":[]},
            "resume": wallet_resume
        }),
    )
    .await;
    let ready = recv_json(&mut wallet2).await;
    assert_eq!(ready["state"], "connected");
}

#[tokio::test]
async fn data_flows_after_reconnect() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, dapp_resume, _) = setup_connected_pair(&addr).await;

    // dApp disconnects
    dapp.close(None).await.unwrap();
    tokio::task::yield_now().await;

    // dApp reconnects
    let mut dapp2 = ws_connect(&addr).await;
    send_json(
        &mut dapp2,
        &json!({
            "v":1, "t":"create", "ch":ch,
            "from":dapp_peer, "pubkey":dapp_peer,
            "resume": dapp_resume
        }),
    )
    .await;
    let ready = recv_json(&mut dapp2).await;
    assert_eq!(ready["state"], "connected");

    // Data should flow again
    send_json(&mut dapp2, &req_msg(&ch, &dapp_peer, "after-reconnect")).await;
    let received = recv_json(&mut wallet).await;
    assert_eq!(received["id"], "after-reconnect");

    send_json(&mut wallet, &res_msg(&ch, &wallet_peer, "after-reconnect")).await;
    let received = recv_json(&mut dapp2).await;
    assert_eq!(received["id"], "after-reconnect");
}

#[tokio::test]
async fn wallet_cannot_send_accept() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await;

    // Wallet tries to accept (not allowed — only dApp can accept)
    send_json(&mut wallet, &accept_msg(&ch, &wallet_peer, &dapp_peer)).await;

    let close = recv_json(&mut wallet).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_role");
}

#[tokio::test]
async fn message_on_wrong_channel_rejected() {
    let (addr, _shutdown) = start_server().await;
    let ch1 = make_channel_id();
    let ch2 = "cd".repeat(32);
    let dapp_peer = make_peer_id(1);

    let mut dapp = ws_connect(&addr).await;
    // Bind to ch1
    send_json(&mut dapp, &create_msg(&ch1, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    // Send message for ch2 on same connection
    let msg = json!({"v":1, "t":"close", "ch":ch2, "from":dapp_peer, "reason":"normal"});
    send_json(&mut dapp, &msg).await;

    let close = recv_json(&mut dapp).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn missing_required_field_from_returns_protocol_error() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();

    let mut ws = ws_connect(&addr).await;
    // create without "from" field
    let msg = json!({"v":1, "t":"create", "ch":ch, "pubkey":"abc"});
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn invalid_channel_id_format_returns_protocol_error() {
    let (addr, _shutdown) = start_server().await;
    let peer = make_peer_id(1);

    let mut ws = ws_connect(&addr).await;
    // Channel ID too short
    let msg = json!({"v":1, "t":"create", "ch":"abcd", "from":peer, "pubkey":peer});
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn invalid_peer_id_format_returns_protocol_error() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();

    let mut ws = ws_connect(&addr).await;
    let msg = json!({"v":1, "t":"create", "ch":ch, "from":"not-valid-base64!!!", "pubkey":"not-valid-base64!!!"});
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn from_pubkey_mismatch_returns_protocol_error() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let peer1 = make_peer_id(1);
    let peer2 = make_peer_id(2);

    let mut ws = ws_connect(&addr).await;
    let msg = json!({"v":1, "t":"create", "ch":ch, "from":peer1, "pubkey":peer2});
    send_json(&mut ws, &msg).await;

    let close = recv_json(&mut ws).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "protocol_error");
}

#[tokio::test]
async fn readyz_returns_ok() {
    let (addr, _shutdown) = start_server().await;

    let resp = reqwest::get(&format!("http://{}/readyz", addr))
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn graceful_shutdown_sends_close_to_peers() {
    let (addr, shutdown_tx) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await; // ready.waiting

    // Trigger shutdown
    let _ = shutdown_tx.send(());

    // dApp should eventually get disconnected (stream ends or close frame)
    // We just check the stream terminates without hanging
    let result = timeout(Duration::from_secs(3), async {
        loop {
            match dapp.next().await {
                None => return true,         // stream ended — graceful
                Some(Err(_)) => return true, // error — connection closed
                Some(Ok(Message::Close(_))) => return true,
                Some(Ok(Message::Text(t))) => {
                    // Might get a server_shutdown close
                    let v: Value = serde_json::from_str(&t).unwrap_or_default();
                    if v["t"] == "close" {
                        return true;
                    }
                }
                _ => continue,
            }
        }
    })
    .await;
    assert!(
        result.is_ok(),
        "dApp connection should close during shutdown"
    );
}

#[tokio::test]
async fn join_with_meta_and_capabilities_forwarded_to_dapp() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    let join = json!({
        "v":1, "t":"join", "ch":ch,
        "from":wallet_peer, "pubkey":wallet_peer,
        "capabilities": {
            "methods": ["wallet_signTransaction", "wallet_signMessage"],
            "events": ["accountsChanged"],
            "chains": ["eip155:1", "eip155:137"]
        },
        "meta": {"name": "TestWallet", "icon": "https://example.com/icon.png"}
    });
    send_json(&mut wallet, &join).await;
    let _ = recv_json(&mut wallet).await; // ready.waiting

    // dApp receives the full join with all fields
    let fwd = recv_json(&mut dapp).await;
    assert_eq!(fwd["t"], "join");
    assert_eq!(fwd["capabilities"]["methods"][0], "wallet_signTransaction");
    assert_eq!(fwd["capabilities"]["chains"][1], "eip155:137");
    assert_eq!(fwd["meta"]["name"], "TestWallet");
}

#[tokio::test]
async fn create_with_meta_sends_ready_waiting() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);

    let mut dapp = ws_connect(&addr).await;
    let create = json!({
        "v":1, "t":"create", "ch":ch,
        "from":dapp_peer, "pubkey":dapp_peer,
        "meta": {"name": "MyDApp"}
    });
    send_json(&mut dapp, &create).await;

    let ready = recv_json(&mut dapp).await;
    assert_eq!(ready["t"], "ready");
    assert_eq!(ready["state"], "waiting");
    // meta is not echoed in ready — just verify it didn't break anything
}

#[tokio::test]
async fn resume_token_changes_on_each_ready() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let ready1 = recv_json(&mut dapp).await;
    let resume_waiting = ready1["resume"].as_str().unwrap().to_string();

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await; // join

    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wallet_peer)).await;
    let ready2 = recv_json(&mut dapp).await;
    let resume_connected = ready2["resume"].as_str().unwrap().to_string();

    // Resume tokens should be different between waiting and connected
    assert_ne!(resume_waiting, resume_connected);
}

#[tokio::test]
async fn old_resume_token_invalidated_after_accept() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let ready1 = recv_json(&mut dapp).await;
    let old_resume = ready1["resume"].as_str().unwrap().to_string();

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await;

    send_json(&mut dapp, &accept_msg(&ch, &dapp_peer, &wallet_peer)).await;
    let _ = recv_json(&mut dapp).await; // ready.connected
    let _ = recv_json(&mut wallet).await;

    // Disconnect dApp
    dapp.close(None).await.unwrap();
    tokio::task::yield_now().await;

    // Try reconnect with OLD (pre-accept) resume token
    let mut dapp2 = ws_connect(&addr).await;
    send_json(
        &mut dapp2,
        &json!({
            "v":1, "t":"create", "ch":ch,
            "from":dapp_peer, "pubkey":dapp_peer,
            "resume": old_resume
        }),
    )
    .await;

    let close = recv_json(&mut dapp2).await;
    assert_eq!(close["t"], "close");
    assert_eq!(close["reason"], "invalid_resume");
}

#[tokio::test]
async fn wallet_sends_evt_with_id_and_sealed() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let wallet_peer = make_peer_id(2);

    let (mut dapp, mut wallet, _, _) = setup_connected_pair(&addr).await;

    let evt = json!({
        "v":1, "t":"evt", "ch":ch, "from":wallet_peer,
        "id": "evt-001", "event": "chainChanged",
        "sealed": "ZW5jcnlwdGVkLWRhdGE"
    });
    send_json(&mut wallet, &evt).await;

    let received = recv_json(&mut dapp).await;
    assert_eq!(received["t"], "evt");
    assert_eq!(received["id"], "evt-001");
    assert_eq!(received["event"], "chainChanged");
    assert_eq!(received["sealed"], "ZW5jcnlwdGVkLWRhdGE");
}

#[tokio::test]
async fn close_with_user_rejected_reason() {
    let (addr, _shutdown) = start_server().await;
    let ch = make_channel_id();
    let dapp_peer = make_peer_id(1);
    let wallet_peer = make_peer_id(2);

    let mut dapp = ws_connect(&addr).await;
    send_json(&mut dapp, &create_msg(&ch, &dapp_peer)).await;
    let _ = recv_json(&mut dapp).await;

    let mut wallet = ws_connect(&addr).await;
    send_json(&mut wallet, &join_msg(&ch, &wallet_peer)).await;
    let _ = recv_json(&mut wallet).await;
    let _ = recv_json(&mut dapp).await;

    // dApp rejects wallet with close + user_rejected
    let close = json!({
        "v":1, "t":"close", "ch":ch, "from":dapp_peer,
        "target":wallet_peer, "reason":"user_rejected"
    });
    send_json(&mut dapp, &close).await;

    let received = recv_json(&mut wallet).await;
    assert_eq!(received["t"], "close");
    assert_eq!(received["reason"], "user_rejected");
    assert_eq!(received["target"], wallet_peer);
}
