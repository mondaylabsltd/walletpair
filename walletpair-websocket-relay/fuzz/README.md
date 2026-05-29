# Fuzz Testing for walletpair-websocket-relay

Fuzz tests for the WalletPair WebSocket relay, using [cargo-fuzz](https://github.com/rust-fuzz/cargo-fuzz) (libFuzzer).

## Prerequisites

Install cargo-fuzz (requires nightly Rust):

```bash
cargo install cargo-fuzz
rustup install nightly
```

## Fuzz Targets

### fuzz_parse_message

Fuzzes `protocol::parse_message()`, `validate_channel_id()`, and `validate_peer_id()`.

- Feeds arbitrary bytes as UTF-8 strings to the JSON parser
- Constructs structured JSON with fuzzed version numbers, message types, channel IDs, and peer IDs
- Exercises all message type parsing branches (create, join, accept, req, res, evt, ping, pong, close)
- Verifies that server-only types (ready, terminate) are rejected
- Tests boundary values for field validation

```bash
cargo +nightly fuzz run fuzz_parse_message -- -max_len=4096
```

### fuzz_state_machine

Fuzzes `ChannelState::allows_message()` with arbitrary state/message-type/role combinations.

- Generates random (state, message_type, role) triples using `arbitrary`
- Verifies invariants hold across all combinations:
  - Closed state always rejects
  - close is always allowed in non-Closed states
  - req is DApp-only in Connected state
  - res/evt are Wallet-only in Connected state
  - accept is DApp-only in PendingAccept state

```bash
cargo +nightly fuzz run fuzz_state_machine -- -max_len=1024
```

### fuzz_relay_handler

Fuzzes `relay::process_message()` with random sequences of relay operations.

- Uses `arbitrary` to generate sequences of Create, Join, Accept, Req, Res, Evt, Ping, Pong, Close actions
- Creates a real `ChannelStore` and `Metrics` instance
- Sends parsed messages through the full relay handler pipeline
- Tests rapid create/join/accept/close sequences on varying channels
- Includes a `RawBytes` action that sends arbitrary bytes through the parser+handler
- Tests both normal and at-capacity conditions
- Verifies no panics and consistent store state after any sequence

```bash
cargo +nightly fuzz run fuzz_relay_handler -- -max_len=8192
```

## Running All Targets

```bash
# Run each target for 5 minutes
for target in fuzz_parse_message fuzz_state_machine fuzz_relay_handler; do
    cargo +nightly fuzz run "$target" -- -max_total_time=300
done
```

## Seed Corpus

Seed corpus files are in `corpus/fuzz_parse_message/` and contain valid examples of every message type, plus known-invalid inputs (wrong version, arrays, empty objects, non-JSON). These give the fuzzer a head start by covering all parsing branches from the beginning.

## Viewing Coverage

```bash
cargo +nightly fuzz coverage fuzz_parse_message
```

## Reproducing Crashes

If a crash is found, cargo-fuzz saves the input in `artifacts/`. Reproduce with:

```bash
cargo +nightly fuzz run fuzz_parse_message artifacts/fuzz_parse_message/<crash-file>
```
