#![no_main]

use libfuzzer_sys::fuzz_target;
use walletpair_websocket_relay::protocol::{parse_message, validate_channel_id, validate_peer_id};

fuzz_target!(|data: &[u8]| {
    // Strategy 1: Feed raw bytes as a string to parse_message.
    // This tests that arbitrary input never causes a panic.
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = parse_message(s);
    }

    // Strategy 2: If the data is valid UTF-8, also test the validation
    // functions directly with various slices.
    if let Ok(s) = std::str::from_utf8(data) {
        let _ = validate_channel_id(s);
        let _ = validate_peer_id(s);

        // Strategy 3: Try to construct structured JSON from the fuzz input
        // to exercise deeper parsing paths.
        if data.len() >= 4 {
            let msg_types = ["create", "join", "accept", "req", "res", "evt",
                             "ping", "pong", "close", "ready", "terminate",
                             "unknown", ""];
            let type_idx = data[0] as usize % msg_types.len();
            let version = data[1] as u64;

            // Use the rest as channel/peer material
            let ch = format!("{:0>64}", hex::encode(&data[2..data.len().min(34)]));
            let from = base64::engine::general_purpose::URL_SAFE_NO_PAD
                .encode(&data[2..data.len().min(34)]);

            let json = serde_json::json!({
                "v": version,
                "t": msg_types[type_idx],
                "ch": &ch[..64],
                "ts": 1234,
                "from": from,
                "body": {
                    "meta": {},
                    "sealed_join": null,
                    "target": from,
                    "id": "fuzz_id",
                    "sealed": "fuzz_sealed",
                    "reason": "normal"
                }
            });
            let _ = parse_message(&json.to_string());
        }
    }
});

mod hex {
    pub fn encode(data: &[u8]) -> String {
        data.iter().map(|b| format!("{:02x}", b)).collect()
    }
}

use base64::Engine;
