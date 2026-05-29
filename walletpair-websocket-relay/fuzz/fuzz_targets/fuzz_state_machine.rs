#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use walletpair_websocket_relay::protocol::Role;
use walletpair_websocket_relay::state::ChannelState;

/// Represents a fuzzed message type for the state machine.
#[derive(Debug, Arbitrary)]
enum FuzzMsgType {
    Create,
    Join,
    Accept,
    Req,
    Res,
    Evt,
    Ping,
    Pong,
    Close,
    Unknown,
}

impl FuzzMsgType {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Create => "create",
            Self::Join => "join",
            Self::Accept => "accept",
            Self::Req => "req",
            Self::Res => "res",
            Self::Evt => "evt",
            Self::Ping => "ping",
            Self::Pong => "pong",
            Self::Close => "close",
            Self::Unknown => "garbage_type",
        }
    }
}

/// Represents a fuzzed role.
#[derive(Debug, Arbitrary)]
enum FuzzRole {
    DApp,
    Wallet,
}

impl FuzzRole {
    fn to_role(&self) -> Role {
        match self {
            Self::DApp => Role::DApp,
            Self::Wallet => Role::Wallet,
        }
    }
}

/// Represents a fuzzed state.
#[derive(Debug, Arbitrary)]
enum FuzzState {
    WaitingForWallet,
    PendingAccept,
    Connected,
    Closed,
}

impl FuzzState {
    fn to_state(&self) -> ChannelState {
        match self {
            Self::WaitingForWallet => ChannelState::WaitingForWallet,
            Self::PendingAccept => ChannelState::PendingAccept,
            Self::Connected => ChannelState::Connected,
            Self::Closed => ChannelState::Closed,
        }
    }
}

/// A sequence of state machine queries to test.
#[derive(Debug, Arbitrary)]
struct FuzzInput {
    /// The state to test.
    state: FuzzState,
    /// A sequence of (message_type, role) queries.
    queries: Vec<(FuzzMsgType, FuzzRole)>,
}

fuzz_target!(|input: FuzzInput| {
    let state = input.state.to_state();

    // Exercise allows_message for every (msg_type, role) pair in the sequence.
    // The key invariant: allows_message must never panic, regardless of input.
    for (msg_type, role) in &input.queries {
        let result = state.allows_message(msg_type.as_str(), role.to_role());

        // Verify consistency invariants:
        // 1. Closed state must reject everything
        if matches!(state, ChannelState::Closed) {
            assert!(!result, "Closed state must reject all messages");
        }

        // 2. close is allowed in every non-Closed state
        if msg_type.as_str() == "close" && !matches!(state, ChannelState::Closed) {
            assert!(result, "close must be allowed in non-Closed states");
        }

        // 3. req is only allowed for DApp in Connected state
        if msg_type.as_str() == "req" && result {
            assert!(
                matches!(state, ChannelState::Connected),
                "req must only be allowed in Connected state"
            );
            assert!(
                matches!(role.to_role(), Role::DApp),
                "req must only be allowed for DApp role"
            );
        }

        // 4. res and evt are only allowed for Wallet in Connected state
        if (msg_type.as_str() == "res" || msg_type.as_str() == "evt") && result {
            assert!(
                matches!(state, ChannelState::Connected),
                "res/evt must only be allowed in Connected state"
            );
            assert!(
                matches!(role.to_role(), Role::Wallet),
                "res/evt must only be allowed for Wallet role"
            );
        }

        // 5. accept is only allowed for DApp in PendingAccept state
        if msg_type.as_str() == "accept" && result {
            assert!(
                matches!(state, ChannelState::PendingAccept),
                "accept must only be allowed in PendingAccept state"
            );
            assert!(
                matches!(role.to_role(), Role::DApp),
                "accept must only be allowed for DApp role"
            );
        }
    }

    // Also test as_str() and Display do not panic
    let _ = state.as_str();
    let _ = format!("{}", state);
});
