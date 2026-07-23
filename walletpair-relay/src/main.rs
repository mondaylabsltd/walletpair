use axum::{
    Router,
    extract::{
        Query, State,
        ws::{Message, WebSocket, WebSocketUpgrade},
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::Deserialize;
use std::{
    collections::HashMap,
    env,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};
use url::Url;

const CHANNEL_CAPACITY: usize = 64;
const CHANNEL_ID_LENGTH: usize = 64;
const X25519_PUBLIC_KEY_LENGTH: usize = 32;
const MAX_NAME_BYTES: usize = 128;
const MAX_URL_BYTES: usize = 2048;
const DEFAULT_LISTEN_ADDR: &str = "0.0.0.0:3000";
const LISTEN_ADDR_ENV: &str = "WALLETPAIR_RELAY_LISTEN_ADDR";

#[derive(Clone, Default)]
struct RelayState {
    channels: Arc<Mutex<HashMap<String, broadcast::Sender<ChannelMessage>>>>,
    next_connection_id: Arc<AtomicU64>,
}

#[derive(Clone, Deserialize)]
struct ConnectionParams {
    ch: String,
    name: String,
    url: String,
    icon: String,
    pubkey: String,
}

#[derive(Clone)]
enum ChannelMessage {
    Joined(Message),
    Relay { sender_id: u64, message: Message },
}

#[tokio::main]
async fn main() {
    let app = app();
    let listen_addr = env::var(LISTEN_ADDR_ENV).unwrap_or_else(|_| DEFAULT_LISTEN_ADDR.to_owned());
    let listener = TcpListener::bind(&listen_addr)
        .await
        .expect("failed to bind relay listener");

    println!(
        "WalletPair relay listening on {listen_addr}; WebSocket endpoint: /v1?ch=<channel-id>&name=<name>&url=<url>&icon=<icon>&pubkey=<x25519-public-key>"
    );
    axum::serve(listener, app)
        .await
        .expect("relay server failed");
}

fn app() -> Router {
    Router::new()
        .route("/healthz", get(health_handler))
        .route("/v1", get(websocket_handler))
        .with_state(RelayState::default())
}

async fn health_handler() -> StatusCode {
    StatusCode::OK
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<RelayState>,
    Query(connection): Query<ConnectionParams>,
) -> Result<impl IntoResponse, StatusCode> {
    if !connection.is_valid() {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(ws.on_upgrade(move |socket| relay_socket(socket, state, connection)))
}

async fn relay_socket(mut socket: WebSocket, state: RelayState, connection: ConnectionParams) {
    let sender = state.channel_sender(&connection.ch).await;
    let mut receiver = sender.subscribe();
    let connection_id = state.next_connection_id.fetch_add(1, Ordering::Relaxed);
    let _ = sender.send(ChannelMessage::Joined(channel_joined_event(&connection)));

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(message))) => {
                        let _ = sender.send(ChannelMessage::Relay {
                            sender_id: connection_id,
                            message: Message::Text(message),
                        });
                    }
                    Some(Ok(Message::Binary(message))) => {
                        let _ = sender.send(ChannelMessage::Relay {
                            sender_id: connection_id,
                            message: Message::Binary(message),
                        });
                    }
                    Some(Ok(Message::Ping(payload))) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => break,
                    Some(Ok(Message::Pong(_))) => {}
                }
            }
            outgoing = receiver.recv() => {
                match outgoing {
                    Ok(ChannelMessage::Joined(message)) => {
                        if socket.send(message).await.is_err() {
                            break;
                        }
                    }
                    Ok(ChannelMessage::Relay { sender_id, message }) => {
                        if sender_id != connection_id && socket.send(message).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    drop(receiver);
    state.remove_channel_if_unused(&connection.ch).await;
}

impl RelayState {
    async fn channel_sender(&self, channel_id: &str) -> broadcast::Sender<ChannelMessage> {
        let mut channels = self.channels.lock().await;
        channels
            .entry(channel_id.to_owned())
            .or_insert_with(|| broadcast::channel(CHANNEL_CAPACITY).0)
            .clone()
    }

    async fn remove_channel_if_unused(&self, channel_id: &str) {
        let mut channels = self.channels.lock().await;
        if channels
            .get(channel_id)
            .is_some_and(|sender| sender.receiver_count() == 0)
        {
            channels.remove(channel_id);
        }
    }
}

impl ConnectionParams {
    fn is_valid(&self) -> bool {
        is_valid_channel_id(&self.ch)
            && is_valid_name(&self.name)
            && is_valid_url(&self.url, true)
            && is_valid_url(&self.icon, false)
            && is_valid_x25519_public_key(&self.pubkey)
    }
}

fn is_valid_channel_id(channel_id: &str) -> bool {
    channel_id.len() == CHANNEL_ID_LENGTH
        && channel_id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn is_valid_name(name: &str) -> bool {
    is_non_empty_within(name, MAX_NAME_BYTES) && !name.chars().any(char::is_control)
}

fn is_valid_url(value: &str, allow_http: bool) -> bool {
    if !is_non_empty_within(value, MAX_URL_BYTES) {
        return false;
    }

    let Ok(url) = Url::parse(value) else {
        return false;
    };
    let valid_scheme = url.scheme() == "https" || (allow_http && url.scheme() == "http");
    valid_scheme && url.host_str().is_some()
}

fn is_valid_x25519_public_key(pubkey: &str) -> bool {
    if pubkey.len() != 43 || pubkey.contains('=') {
        return false;
    }

    let Ok(bytes) = URL_SAFE_NO_PAD.decode(pubkey) else {
        return false;
    };
    bytes.len() == X25519_PUBLIC_KEY_LENGTH
        && bytes.iter().any(|byte| *byte != 0)
        && URL_SAFE_NO_PAD.encode(bytes) == pubkey
}

fn is_non_empty_within(value: &str, max_bytes: usize) -> bool {
    !value.is_empty() && value.len() <= max_bytes
}

fn channel_joined_event(connection: &ConnectionParams) -> Message {
    Message::Text(channel_joined_event_text(connection).into())
}

fn channel_joined_event_text(connection: &ConnectionParams) -> String {
    serde_json::json!({
        "type": "channel_joined",
        "ch": connection.ch,
        "name": connection.name,
        "url": connection.url,
        "icon": connection.icon,
        "pubkey": connection.pubkey,
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::{Duration, timeout};
    use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};

    const CHANNEL_A: &str = "0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c";
    const CHANNEL_B: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const PUBKEY: &str = "HJ_Yj0VgbZMqgMcYJK4VHRXXPnfeOOjgAIUuYU-ucBk";

    #[test]
    fn validates_all_required_connection_parameters() {
        let valid = connection(CHANNEL_A, "Test dApp");
        assert!(valid.is_valid());

        let mut invalid_channel = valid.clone();
        invalid_channel.ch = "A".repeat(CHANNEL_ID_LENGTH);
        assert!(!invalid_channel.is_valid());

        let mut missing_name = valid.clone();
        missing_name.name.clear();
        assert!(!missing_name.is_valid());

        let mut overlong_name = valid.clone();
        overlong_name.name = "n".repeat(MAX_NAME_BYTES + 1);
        assert!(!overlong_name.is_valid());

        let mut invalid_url = valid.clone();
        invalid_url.url = "not-a-url".to_owned();
        assert!(!invalid_url.is_valid());

        let mut invalid_icon = valid.clone();
        invalid_icon.icon = "http://example.test/icon.png".to_owned();
        assert!(!invalid_icon.is_valid());

        let mut invalid_pubkey = valid.clone();
        invalid_pubkey.pubkey = "A".repeat(43);
        assert!(!invalid_pubkey.is_valid());
    }

    #[tokio::test]
    async fn relays_messages_only_to_other_clients_in_the_same_channel() {
        let address = start_test_server().await;
        let sender_connection = connection(CHANNEL_A, "Sender dApp");
        let peer_connection = connection(CHANNEL_A, "Peer Wallet");
        let other_connection = connection(CHANNEL_B, "Other Wallet");

        let (mut sender, _) = connect_async(connection_url(address, &sender_connection))
            .await
            .unwrap();
        assert_eq!(
            next_text(&mut sender).await,
            channel_joined_event_text(&sender_connection)
        );

        let (mut same_channel_peer, _) = connect_async(connection_url(address, &peer_connection))
            .await
            .unwrap();
        let expected_channel_a_event = channel_joined_event_text(&peer_connection);
        assert_eq!(next_text(&mut sender).await, expected_channel_a_event);
        assert_eq!(
            next_text(&mut same_channel_peer).await,
            channel_joined_event_text(&peer_connection)
        );

        let (mut other_channel_peer, _) = connect_async(connection_url(address, &other_connection))
            .await
            .unwrap();
        assert_eq!(
            next_text(&mut other_channel_peer).await,
            channel_joined_event_text(&other_connection)
        );

        let payload = "channel broadcast";
        sender
            .send(ClientMessage::Text(payload.into()))
            .await
            .unwrap();

        assert_eq!(next_text(&mut same_channel_peer).await, payload);

        assert!(
            timeout(Duration::from_millis(100), sender.next())
                .await
                .is_err()
        );
        assert!(
            timeout(Duration::from_millis(100), other_channel_peer.next())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn rejects_connections_with_missing_or_invalid_parameters() {
        let address = start_test_server().await;
        let missing = format!("ws://{address}/v1?ch={CHANNEL_A}");
        assert!(connect_async(missing).await.is_err());

        let mut invalid = connection(CHANNEL_A, "Invalid dApp");
        invalid.pubkey = "invalid".to_owned();
        assert!(
            connect_async(connection_url(address, &invalid))
                .await
                .is_err()
        );
    }

    fn connection(ch: &str, name: &str) -> ConnectionParams {
        ConnectionParams {
            ch: ch.to_owned(),
            name: name.to_owned(),
            url: "https://example.test".to_owned(),
            icon: "https://example.test/icon.png".to_owned(),
            pubkey: PUBKEY.to_owned(),
        }
    }

    fn connection_url(address: std::net::SocketAddr, connection: &ConnectionParams) -> String {
        let mut url = Url::parse(&format!("ws://{address}/v1")).unwrap();
        url.query_pairs_mut()
            .append_pair("ch", &connection.ch)
            .append_pair("name", &connection.name)
            .append_pair("url", &connection.url)
            .append_pair("icon", &connection.icon)
            .append_pair("pubkey", &connection.pubkey);
        url.into()
    }

    async fn start_test_server() -> std::net::SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app()).await.unwrap();
        });
        address
    }

    async fn next_text<S>(socket: &mut S) -> String
    where
        S: futures_util::Stream<
                Item = Result<ClientMessage, tokio_tungstenite::tungstenite::Error>,
            > + Unpin,
    {
        timeout(Duration::from_secs(1), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap()
            .into_text()
            .unwrap()
            .to_string()
    }
}
