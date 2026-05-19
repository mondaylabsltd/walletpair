use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::Value;
use thiserror::Error;

// --- Identifiers ---

/// Channel ID: 64 lowercase hex chars = 32 bytes.
pub type ChannelId = String;

/// Peer ID: base64url-no-pad encoded X25519 public key (32 bytes → 43 chars).
pub type PeerId = String;

// --- Role ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Role {
    DApp,
    Wallet,
}

impl Role {
    pub fn as_str(self) -> &'static str {
        match self {
            Role::DApp => "dapp",
            Role::Wallet => "wallet",
        }
    }
}

impl std::fmt::Display for Role {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// --- Close Reason ---

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum CloseReason {
    Normal,
    UserRejected,
    UnsupportedCapability,
    ChannelNotFound,
    ChannelExists,
    AlreadyConnected,
    InvalidState,
    InvalidRole,
    InvalidResume,
    Timeout,
    PayloadTooLarge,
    ProtocolError,
    UnsupportedVersion,
    DecryptionFailed,
    // Relay-specific (not in protocol spec, used internally)
    SlowConsumer,
    ServerShutdown,
}

impl CloseReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::UserRejected => "user_rejected",
            Self::UnsupportedCapability => "unsupported_capability",
            Self::ChannelNotFound => "channel_not_found",
            Self::ChannelExists => "channel_exists",
            Self::AlreadyConnected => "already_connected",
            Self::InvalidState => "invalid_state",
            Self::InvalidRole => "invalid_role",
            Self::InvalidResume => "invalid_resume",
            Self::Timeout => "timeout",
            Self::PayloadTooLarge => "payload_too_large",
            Self::ProtocolError => "protocol_error",
            Self::UnsupportedVersion => "unsupported_version",
            Self::DecryptionFailed => "decryption_failed",
            Self::SlowConsumer => "slow_consumer",
            Self::ServerShutdown => "server_shutdown",
        }
    }
}

impl std::fmt::Display for CloseReason {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

// --- Parsed Client Messages ---

/// Messages sent by peers to the relay.
#[derive(Debug, Clone)]
#[allow(dead_code)]
pub enum ClientMessage {
    Create {
        ch: ChannelId,
        from: PeerId,
        meta: Option<Value>,
        resume: Option<String>,
    },
    Join {
        ch: ChannelId,
        from: PeerId,
        capabilities: Value,
        meta: Option<Value>,
        resume: Option<String>,
    },
    Accept {
        ch: ChannelId,
        from: PeerId,
        target: PeerId,
    },
    Req {
        ch: ChannelId,
        id: String,
        from: PeerId,
    },
    Res {
        ch: ChannelId,
        id: String,
        from: PeerId,
    },
    Evt {
        ch: ChannelId,
        from: PeerId,
    },
    Ping {
        ch: ChannelId,
        from: PeerId,
    },
    Pong {
        ch: ChannelId,
        from: PeerId,
    },
    Close {
        ch: ChannelId,
        from: PeerId,
        target: Option<PeerId>,
        reason: String,
    },
}

impl ClientMessage {
    pub fn channel_id(&self) -> &str {
        match self {
            Self::Create { ch, .. }
            | Self::Join { ch, .. }
            | Self::Accept { ch, .. }
            | Self::Req { ch, .. }
            | Self::Res { ch, .. }
            | Self::Evt { ch, .. }
            | Self::Ping { ch, .. }
            | Self::Pong { ch, .. }
            | Self::Close { ch, .. } => ch,
        }
    }

    pub fn from_peer(&self) -> &str {
        match self {
            Self::Create { from, .. }
            | Self::Join { from, .. }
            | Self::Accept { from, .. }
            | Self::Req { from, .. }
            | Self::Res { from, .. }
            | Self::Evt { from, .. }
            | Self::Ping { from, .. }
            | Self::Pong { from, .. }
            | Self::Close { from, .. } => from,
        }
    }

    pub fn message_type(&self) -> &'static str {
        match self {
            Self::Create { .. } => "create",
            Self::Join { .. } => "join",
            Self::Accept { .. } => "accept",
            Self::Req { .. } => "req",
            Self::Res { .. } => "res",
            Self::Evt { .. } => "evt",
            Self::Ping { .. } => "ping",
            Self::Pong { .. } => "pong",
            Self::Close { .. } => "close",
        }
    }
}

// --- Parse errors ---

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("invalid JSON: {0}")]
    InvalidJson(#[from] serde_json::Error),

    #[error("message is not a JSON object")]
    NotAnObject,

    #[error("missing required field: {0}")]
    MissingField(&'static str),

    #[error("unsupported version: {0}")]
    UnsupportedVersion(u64),

    #[error("unknown message type: {0}")]
    UnknownType(String),

    #[error("invalid channel id: must be 64 lowercase hex characters")]
    InvalidChannelId,

    #[error("invalid peer id: must be base64url-no-pad encoding of 32 bytes")]
    InvalidPeerId,

    #[error("from and pubkey must be equal in create/join")]
    PubkeyMismatch,

    #[error("field type error: {0}")]
    #[allow(dead_code)]
    FieldType(&'static str),
}

impl ParseError {
    /// Map parse error to the close reason the relay should send.
    pub fn to_close_reason(&self) -> CloseReason {
        match self {
            Self::UnsupportedVersion(_) => CloseReason::UnsupportedVersion,
            _ => CloseReason::ProtocolError,
        }
    }
}

// --- Validation ---

pub fn validate_channel_id(ch: &str) -> Result<(), ParseError> {
    if ch.len() != 64
        || !ch
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(ParseError::InvalidChannelId);
    }
    Ok(())
}

pub fn validate_peer_id(peer_id: &str) -> Result<(), ParseError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(peer_id)
        .map_err(|_| ParseError::InvalidPeerId)?;
    if bytes.len() != 32 {
        return Err(ParseError::InvalidPeerId);
    }
    Ok(())
}

// --- Parsing ---

fn get_str<'a>(
    obj: &'a serde_json::Map<String, Value>,
    key: &'static str,
) -> Result<&'a str, ParseError> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .ok_or(ParseError::MissingField(key))
}

fn get_optional_str<'a>(obj: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    obj.get(key).and_then(|v| v.as_str())
}

pub fn parse_message(raw: &str) -> Result<ClientMessage, ParseError> {
    let value: Value = serde_json::from_str(raw)?;
    let obj = value.as_object().ok_or(ParseError::NotAnObject)?;

    // Validate version
    let v = obj
        .get("v")
        .and_then(|v| v.as_u64())
        .ok_or(ParseError::MissingField("v"))?;
    if v != 1 {
        return Err(ParseError::UnsupportedVersion(v));
    }

    // Validate common fields
    let t = get_str(obj, "t")?;
    let ch = get_str(obj, "ch")?;
    validate_channel_id(ch)?;
    let ch = ch.to_string();

    match t {
        "create" => {
            let from = get_str(obj, "from")?.to_string();
            let pubkey = get_str(obj, "pubkey")?.to_string();
            validate_peer_id(&from)?;
            validate_peer_id(&pubkey)?;
            if from != pubkey {
                return Err(ParseError::PubkeyMismatch);
            }
            let meta = obj.get("meta").cloned();
            let resume = get_optional_str(obj, "resume").map(String::from);
            Ok(ClientMessage::Create {
                ch,
                from,
                meta,
                resume,
            })
        }
        "join" => {
            let from = get_str(obj, "from")?.to_string();
            let pubkey = get_str(obj, "pubkey")?.to_string();
            validate_peer_id(&from)?;
            validate_peer_id(&pubkey)?;
            if from != pubkey {
                return Err(ParseError::PubkeyMismatch);
            }
            let capabilities = obj
                .get("capabilities")
                .ok_or(ParseError::MissingField("capabilities"))?
                .clone();
            let meta = obj.get("meta").cloned();
            let resume = get_optional_str(obj, "resume").map(String::from);
            Ok(ClientMessage::Join {
                ch,
                from,
                capabilities,
                meta,
                resume,
            })
        }
        "accept" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            let target = get_str(obj, "target")?.to_string();
            validate_peer_id(&target)?;
            Ok(ClientMessage::Accept { ch, from, target })
        }
        "req" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            let id = get_str(obj, "id")?.to_string();
            // method is required per protocol but relay just forwards raw
            if obj.get("method").and_then(|v| v.as_str()).is_none() {
                return Err(ParseError::MissingField("method"));
            }
            Ok(ClientMessage::Req { ch, id, from })
        }
        "res" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            let id = get_str(obj, "id")?.to_string();
            if obj.get("ok").is_none() {
                return Err(ParseError::MissingField("ok"));
            }
            Ok(ClientMessage::Res { ch, id, from })
        }
        "evt" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            if obj.get("event").and_then(|v| v.as_str()).is_none() {
                return Err(ParseError::MissingField("event"));
            }
            Ok(ClientMessage::Evt { ch, from })
        }
        "ping" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            Ok(ClientMessage::Ping { ch, from })
        }
        "pong" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            Ok(ClientMessage::Pong { ch, from })
        }
        "close" => {
            let from = get_str(obj, "from")?.to_string();
            validate_peer_id(&from)?;
            let target = get_optional_str(obj, "target").map(String::from);
            if let Some(ref t) = target {
                validate_peer_id(t)?;
            }
            let reason = get_str(obj, "reason")?.to_string();
            Ok(ClientMessage::Close {
                ch,
                from,
                target,
                reason,
            })
        }
        "ready" => Err(ParseError::UnknownType(
            "ready (peers must not send ready)".to_string(),
        )),
        other => Err(ParseError::UnknownType(other.to_string())),
    }
}

// --- Outgoing message builders (relay-generated) ---

pub fn build_ready_waiting(ch: &str, role: Role, peer_id: &str, resume: &str) -> String {
    serde_json::json!({
        "v": 1,
        "t": "ready",
        "ch": ch,
        "state": "waiting",
        "role": role.as_str(),
        "self": peer_id,
        "resume": resume,
    })
    .to_string()
}

pub fn build_ready_connected(
    ch: &str,
    role: Role,
    self_id: &str,
    remote_id: &str,
    resume: &str,
) -> String {
    serde_json::json!({
        "v": 1,
        "t": "ready",
        "ch": ch,
        "state": "connected",
        "role": role.as_str(),
        "self": self_id,
        "remote": remote_id,
        "resume": resume,
    })
    .to_string()
}

pub fn build_close(ch: &str, reason: CloseReason) -> String {
    serde_json::json!({
        "v": 1,
        "t": "close",
        "ch": ch,
        "reason": reason.as_str(),
    })
    .to_string()
}

pub fn build_close_with_target(ch: &str, reason: CloseReason, target: &str) -> String {
    serde_json::json!({
        "v": 1,
        "t": "close",
        "ch": ch,
        "reason": reason.as_str(),
        "target": target,
    })
    .to_string()
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_channel_id() {
        let id = "a".repeat(64);
        assert!(validate_channel_id(&id).is_ok());
    }

    #[test]
    fn channel_id_wrong_length() {
        assert!(validate_channel_id("abcd").is_err());
    }

    #[test]
    fn channel_id_uppercase_rejected() {
        let id = "A".repeat(64);
        assert!(validate_channel_id(&id).is_err());
    }

    #[test]
    fn channel_id_non_hex_rejected() {
        let mut id = "a".repeat(63);
        id.push('g');
        assert!(validate_channel_id(&id).is_err());
    }

    #[test]
    fn valid_peer_id() {
        // 32 bytes base64url no pad = 43 chars
        let bytes = [0u8; 32];
        let encoded = URL_SAFE_NO_PAD.encode(bytes);
        assert!(validate_peer_id(&encoded).is_ok());
    }

    #[test]
    fn peer_id_wrong_length() {
        let bytes = [0u8; 16];
        let encoded = URL_SAFE_NO_PAD.encode(bytes);
        assert!(validate_peer_id(&encoded).is_err());
    }

    #[test]
    fn peer_id_invalid_base64() {
        assert!(validate_peer_id("not-valid-!!!").is_err());
    }

    fn make_peer_id() -> String {
        URL_SAFE_NO_PAD.encode([1u8; 32])
    }

    fn make_channel_id() -> String {
        "ab".repeat(32)
    }

    #[test]
    fn parse_create_valid() {
        let pid = make_peer_id();
        let ch = make_channel_id();
        let json = serde_json::json!({
            "v": 1, "t": "create", "ch": ch, "from": pid, "pubkey": pid,
            "meta": {"name": "test"}
        });
        let msg = parse_message(&json.to_string()).unwrap();
        assert!(matches!(msg, ClientMessage::Create { .. }));
        assert_eq!(msg.message_type(), "create");
    }

    #[test]
    fn parse_create_pubkey_mismatch() {
        let pid1 = URL_SAFE_NO_PAD.encode([1u8; 32]);
        let pid2 = URL_SAFE_NO_PAD.encode([2u8; 32]);
        let ch = make_channel_id();
        let json = serde_json::json!({
            "v": 1, "t": "create", "ch": ch, "from": pid1, "pubkey": pid2
        });
        let err = parse_message(&json.to_string()).unwrap_err();
        assert!(matches!(err, ParseError::PubkeyMismatch));
    }

    #[test]
    fn parse_unsupported_version() {
        let pid = make_peer_id();
        let ch = make_channel_id();
        let json = serde_json::json!({
            "v": 2, "t": "create", "ch": ch, "from": pid, "pubkey": pid
        });
        let err = parse_message(&json.to_string()).unwrap_err();
        assert!(matches!(err, ParseError::UnsupportedVersion(2)));
        assert_eq!(err.to_close_reason(), CloseReason::UnsupportedVersion);
    }

    #[test]
    fn parse_unknown_type() {
        let ch = make_channel_id();
        let json = serde_json::json!({"v": 1, "t": "unknown", "ch": ch});
        let err = parse_message(&json.to_string()).unwrap_err();
        assert!(matches!(err, ParseError::UnknownType(_)));
    }

    #[test]
    fn parse_ready_rejected() {
        let ch = make_channel_id();
        let json = serde_json::json!({"v": 1, "t": "ready", "ch": ch});
        let err = parse_message(&json.to_string()).unwrap_err();
        assert!(matches!(err, ParseError::UnknownType(_)));
    }

    #[test]
    fn parse_invalid_json() {
        let err = parse_message("not json").unwrap_err();
        assert!(matches!(err, ParseError::InvalidJson(_)));
    }

    #[test]
    fn parse_not_object() {
        let err = parse_message("[1,2,3]").unwrap_err();
        assert!(matches!(err, ParseError::NotAnObject));
    }

    #[test]
    fn parse_join_valid() {
        let pid = make_peer_id();
        let ch = make_channel_id();
        let json = serde_json::json!({
            "v": 1, "t": "join", "ch": ch, "from": pid, "pubkey": pid,
            "capabilities": {"methods": [], "events": [], "chains": []}
        });
        let msg = parse_message(&json.to_string()).unwrap();
        assert!(matches!(msg, ClientMessage::Join { .. }));
    }

    #[test]
    fn parse_req_missing_method() {
        let pid = make_peer_id();
        let ch = make_channel_id();
        let json = serde_json::json!({
            "v": 1, "t": "req", "ch": ch, "from": pid, "id": "r1"
        });
        assert!(parse_message(&json.to_string()).is_err());
    }

    #[test]
    fn close_reason_mapping() {
        assert_eq!(CloseReason::Normal.as_str(), "normal");
        assert_eq!(CloseReason::ChannelNotFound.as_str(), "channel_not_found");
        assert_eq!(CloseReason::InvalidResume.as_str(), "invalid_resume");
        assert_eq!(CloseReason::PayloadTooLarge.as_str(), "payload_too_large");
        assert_eq!(
            CloseReason::UnsupportedVersion.as_str(),
            "unsupported_version"
        );
    }

    #[test]
    fn build_ready_waiting_valid_json() {
        let json = build_ready_waiting("ab".repeat(32).as_str(), Role::DApp, "peer", "tok");
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["t"], "ready");
        assert_eq!(v["state"], "waiting");
        assert_eq!(v["role"], "dapp");
    }

    #[test]
    fn build_ready_connected_valid_json() {
        let json = build_ready_connected(
            "ab".repeat(32).as_str(),
            Role::Wallet,
            "self",
            "remote",
            "tok",
        );
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["state"], "connected");
        assert_eq!(v["remote"], "remote");
    }

    #[test]
    fn build_close_no_from_field() {
        let json = build_close("ab".repeat(32).as_str(), CloseReason::Timeout);
        let v: Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["reason"], "timeout");
        assert!(v.get("from").is_none());
    }
}
