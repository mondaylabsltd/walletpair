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
use serde::Deserialize;
use std::{collections::HashMap, sync::Arc};
use tokio::net::TcpListener;
use tokio::sync::{Mutex, broadcast};

const CHANNEL_CAPACITY: usize = 64;

#[derive(Clone, Default)]
struct RelayState {
    channels: Arc<Mutex<HashMap<String, broadcast::Sender<Message>>>>,
}

#[derive(Deserialize)]
struct ChannelQuery {
    ch: String,
}

#[tokio::main]
async fn main() {
    let app = app();
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("failed to bind relay listener");

    println!("WalletPair relay listening on ws://127.0.0.1:3000/v1?ch=<channel-id>");
    axum::serve(listener, app)
        .await
        .expect("relay server failed");
}

fn app() -> Router {
    Router::new()
        .route("/v1", get(websocket_handler))
        .with_state(RelayState::default())
}

async fn websocket_handler(
    ws: WebSocketUpgrade,
    State(state): State<RelayState>,
    Query(query): Query<ChannelQuery>,
) -> Result<impl IntoResponse, StatusCode> {
    if !is_valid_channel_id(&query.ch) {
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(ws.on_upgrade(move |socket| relay_socket(socket, state, query.ch)))
}

async fn relay_socket(mut socket: WebSocket, state: RelayState, channel_id: String) {
    let sender = state.channel_sender(&channel_id).await;
    let mut receiver = sender.subscribe();
    let _ = sender.send(channel_joined_event(&channel_id));

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(message))) => {
                        let _ = sender.send(Message::Text(message));
                    }
                    Some(Ok(Message::Binary(message))) => {
                        let _ = sender.send(Message::Binary(message));
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
                    Ok(message) => {
                        if socket.send(message).await.is_err() {
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
    state.remove_channel_if_unused(&channel_id).await;
}

impl RelayState {
    async fn channel_sender(&self, channel_id: &str) -> broadcast::Sender<Message> {
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

fn is_valid_channel_id(channel_id: &str) -> bool {
    channel_id.len() == 64 && channel_id.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn channel_joined_event(channel_id: &str) -> Message {
    Message::Text(channel_joined_event_text(channel_id).into())
}

fn channel_joined_event_text(channel_id: &str) -> String {
    format!(r#"{{"type":"channel_joined","channel":"{channel_id}"}}"#)
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::{Duration, timeout};
    use tokio_tungstenite::{connect_async, tungstenite::Message as ClientMessage};

    const CHANNEL_A: &str = "0140446dc1742a90025fcd068df3a7338314e1da1649d520798c8581a0937d0c";
    const CHANNEL_B: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

    #[test]
    fn validates_64_character_hex_channel_ids() {
        assert!(is_valid_channel_id(CHANNEL_A));
        assert!(is_valid_channel_id(CHANNEL_B));
        assert!(!is_valid_channel_id("short"));
        assert!(!is_valid_channel_id(&"z".repeat(64)));
    }

    #[tokio::test]
    async fn relays_messages_only_to_clients_in_the_same_channel() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            axum::serve(listener, app()).await.unwrap();
        });

        let channel_a_url = format!("ws://{address}/v1?ch={CHANNEL_A}");
        let channel_b_url = format!("ws://{address}/v1?ch={CHANNEL_B}");
        let (mut sender, _) = connect_async(&channel_a_url).await.unwrap();
        assert_eq!(
            next_text(&mut sender).await,
            channel_joined_event_text(CHANNEL_A)
        );

        let (mut same_channel_peer, _) = connect_async(&channel_a_url).await.unwrap();
        let expected_channel_a_event = channel_joined_event_text(CHANNEL_A);
        assert_eq!(next_text(&mut sender).await, expected_channel_a_event);
        assert_eq!(
            next_text(&mut same_channel_peer).await,
            channel_joined_event_text(CHANNEL_A)
        );

        let (mut other_channel_peer, _) = connect_async(&channel_b_url).await.unwrap();
        assert_eq!(
            next_text(&mut other_channel_peer).await,
            channel_joined_event_text(CHANNEL_B)
        );

        let payload = "channel broadcast";
        sender
            .send(ClientMessage::Text(payload.into()))
            .await
            .unwrap();

        assert_eq!(next_text(&mut sender).await, payload);
        assert_eq!(next_text(&mut same_channel_peer).await, payload);

        assert!(
            timeout(Duration::from_millis(100), other_channel_peer.next())
                .await
                .is_err()
        );
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
