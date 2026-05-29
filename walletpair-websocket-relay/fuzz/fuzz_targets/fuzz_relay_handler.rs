#![no_main]

use arbitrary::Arbitrary;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use libfuzzer_sys::fuzz_target;
use tokio::sync::mpsc;

use walletpair_websocket_relay::config::Config;
use walletpair_websocket_relay::metrics::Metrics;
use walletpair_websocket_relay::protocol;
use walletpair_websocket_relay::relay::process_message;
use walletpair_websocket_relay::store::ChannelStore;

/// Deterministic peer ID from a seed byte.
fn make_peer_id(seed: u8) -> String {
    URL_SAFE_NO_PAD.encode([seed; 32])
}

/// Deterministic channel ID from a seed byte.
fn make_channel_id(seed: u8) -> String {
    format!("{:02x}", seed).repeat(32)
}

/// A fuzzed action to perform on the relay.
#[derive(Debug, Arbitrary)]
enum FuzzAction {
    Create {
        ch_seed: u8,
        peer_seed: u8,
    },
    Join {
        ch_seed: u8,
        peer_seed: u8,
    },
    Accept {
        ch_seed: u8,
        from_seed: u8,
        target_seed: u8,
    },
    Req {
        ch_seed: u8,
        peer_seed: u8,
        id_byte: u8,
    },
    Res {
        ch_seed: u8,
        peer_seed: u8,
        id_byte: u8,
    },
    Evt {
        ch_seed: u8,
        peer_seed: u8,
    },
    Ping {
        ch_seed: u8,
        peer_seed: u8,
    },
    Pong {
        ch_seed: u8,
        peer_seed: u8,
    },
    Close {
        ch_seed: u8,
        peer_seed: u8,
        reason_idx: u8,
    },
    /// Send raw bytes as a message (tests parse_message integration)
    RawBytes {
        data: Vec<u8>,
    },
}

/// A sequence of actions to fuzz.
#[derive(Debug, Arbitrary)]
struct FuzzInput {
    actions: Vec<FuzzAction>,
    at_capacity: bool,
}

fn build_and_process(
    store: &mut ChannelStore,
    metrics: &Metrics,
    raw: &str,
    conn_id: u64,
    sender: &mpsc::Sender<String>,
    at_capacity: bool,
) {
    // Parse the message first; if parsing fails, that is fine
    if let Ok(msg) = protocol::parse_message(raw) {
        let _ = process_message(store, conn_id, sender, raw, msg, metrics, at_capacity);
    }
}

fuzz_target!(|input: FuzzInput| {
    let config = Config {
        max_channels: 100,
        pending_request_limit: 8,
        unpaired_channel_ttl_secs: 300,
        connected_channel_ttl_secs: 86400,
        ..Config::default()
    };
    let metrics = Metrics::new();
    let mut store = ChannelStore::new(&config);

    let (tx, _rx) = mpsc::channel(64);
    let mut conn_counter: u64 = 1;

    let reasons = ["normal", "user_rejected", "timeout", "protocol_error",
                    "decryption_failed", "unsupported_capability", "unknown_reason"];

    for action in &input.actions {
        conn_counter = conn_counter.wrapping_add(1);
        let at_cap = input.at_capacity;

        match action {
            FuzzAction::Create { ch_seed, peer_seed } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "create", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"meta": {}}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Join { ch_seed, peer_seed } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "join", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"sealed_join": null}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Accept { ch_seed, from_seed, target_seed } => {
                let ch = make_channel_id(*ch_seed);
                let from = make_peer_id(*from_seed);
                let target = make_peer_id(*target_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "accept", "ch": ch, "ts": 1234, "from": from,
                    "body": {"target": target}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Req { ch_seed, peer_seed, id_byte } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "req", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"id": format!("r{}", id_byte), "sealed": "data"}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Res { ch_seed, peer_seed, id_byte } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "res", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"id": format!("r{}", id_byte), "sealed": "data"}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Evt { ch_seed, peer_seed } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "evt", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"id": "e1", "sealed": "data"}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Ping { ch_seed, peer_seed } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "ping", "ch": ch, "ts": 1234, "from": peer,
                    "body": {}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Pong { ch_seed, peer_seed } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let raw = serde_json::json!({
                    "v": 1, "t": "pong", "ch": ch, "ts": 1234, "from": peer,
                    "body": {}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::Close { ch_seed, peer_seed, reason_idx } => {
                let ch = make_channel_id(*ch_seed);
                let peer = make_peer_id(*peer_seed);
                let reason = reasons[*reason_idx as usize % reasons.len()];
                let raw = serde_json::json!({
                    "v": 1, "t": "close", "ch": ch, "ts": 1234, "from": peer,
                    "body": {"reason": reason}
                }).to_string();
                build_and_process(&mut store, &metrics, &raw, conn_counter, &tx, at_cap);
            }
            FuzzAction::RawBytes { data } => {
                if let Ok(s) = std::str::from_utf8(data) {
                    if let Ok(msg) = protocol::parse_message(s) {
                        let _ = process_message(
                            &mut store, conn_counter, &tx, s, msg, &metrics, at_cap,
                        );
                    }
                }
            }
        }
    }

    // After all actions, verify the store is in a consistent state:
    // channel_count should not be negative (it's usize, so this is just a sanity check)
    let _ = store.channel_count();
});
