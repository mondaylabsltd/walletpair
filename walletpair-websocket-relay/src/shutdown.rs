use tokio::sync::broadcast;

/// Returns a (sender, receiver) pair. Drop the sender or call send() to signal shutdown.
pub fn signal_channel() -> (broadcast::Sender<()>, broadcast::Receiver<()>) {
    broadcast::channel(1)
}

/// Waits for SIGINT or SIGTERM, then signals shutdown.
pub async fn wait_for_signal(shutdown_tx: broadcast::Sender<()>) {
    let ctrl_c = tokio::signal::ctrl_c();

    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = signal(SignalKind::terminate()).expect("failed to register SIGTERM");
        tokio::select! {
            _ = ctrl_c => tracing::info!("received SIGINT"),
            _ = sigterm.recv() => tracing::info!("received SIGTERM"),
        }
    }

    #[cfg(not(unix))]
    {
        ctrl_c.await.expect("failed to listen for ctrl-c");
        tracing::info!("received SIGINT");
    }

    let _ = shutdown_tx.send(());
}
