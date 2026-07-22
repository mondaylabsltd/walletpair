use axum::{
    Router,
    extract::ws::{Message, WebSocket, WebSocketUpgrade},
    response::IntoResponse,
    routing::get,
};
use tokio::net::TcpListener;

#[tokio::main]
async fn main() {
    let app = Router::new().route("/ws", get(websocket_handler));
    let listener = TcpListener::bind("0.0.0.0:3000")
        .await
        .expect("failed to bind relay listener");

    println!("WalletPair relay listening on ws://127.0.0.1:3000/ws");
    axum::serve(listener, app)
        .await
        .expect("relay server failed");
}

async fn websocket_handler(ws: WebSocketUpgrade) -> impl IntoResponse {
    ws.on_upgrade(echo_socket)
}

async fn echo_socket(mut socket: WebSocket) {
    while let Some(Ok(message)) = socket.recv().await {
        match message {
            Message::Text(_) | Message::Binary(_) => {
                if socket.send(message).await.is_err() {
                    break;
                }
            }
            Message::Close(_) => break,
            Message::Ping(_) | Message::Pong(_) => {}
        }
    }
}
