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
    let app = Router::new()
        .route("/v1", get(websocket_handler))
        .with_state(RelayState::default());
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("failed to bind relay listener");

    println!("WalletPair relay listening on ws://127.0.0.1:3000/v1?ch=<channel-id>");
    axum::serve(listener, app)
        .await
        .expect("relay server failed");
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
