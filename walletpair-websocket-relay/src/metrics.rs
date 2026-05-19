use prometheus::{IntCounter, IntCounterVec, IntGauge, Opts, Registry};

#[derive(Clone)]
pub struct Metrics {
    pub active_connections: IntGauge,
    pub active_channels: IntGauge,
    pub channels_created_total: IntCounter,
    pub channels_joined_total: IntCounter,
    pub channels_connected_total: IntCounter,
    pub channels_closed_total: IntCounterVec,
    pub messages_rejected_total: IntCounterVec,
    pub messages_forwarded_total: IntCounterVec,
    pub reconnect_attempts_total: IntCounterVec,
    pub outbound_queue_drops_total: IntCounter,
    pub slow_consumer_closes_total: IntCounter,
    pub registry: Registry,
}

impl Metrics {
    pub fn new() -> Self {
        let registry = Registry::new();

        let active_connections = IntGauge::new(
            "walletpair_active_connections",
            "Current WebSocket connections",
        )
        .unwrap();
        let active_channels =
            IntGauge::new("walletpair_active_channels", "Current active channels").unwrap();
        let channels_created_total =
            IntCounter::new("walletpair_channels_created_total", "Channels created").unwrap();
        let channels_joined_total = IntCounter::new(
            "walletpair_channels_joined_total",
            "Channels joined by wallet",
        )
        .unwrap();
        let channels_connected_total = IntCounter::new(
            "walletpair_channels_connected_total",
            "Channels that reached connected state",
        )
        .unwrap();
        let channels_closed_total = IntCounterVec::new(
            Opts::new(
                "walletpair_channels_closed_total",
                "Channels closed by reason",
            ),
            &["reason"],
        )
        .unwrap();
        let messages_rejected_total = IntCounterVec::new(
            Opts::new(
                "walletpair_messages_rejected_total",
                "Messages rejected by reason",
            ),
            &["reason"],
        )
        .unwrap();
        let messages_forwarded_total = IntCounterVec::new(
            Opts::new(
                "walletpair_messages_forwarded_total",
                "Messages forwarded by type",
            ),
            &["type"],
        )
        .unwrap();
        let reconnect_attempts_total = IntCounterVec::new(
            Opts::new(
                "walletpair_reconnect_attempts_total",
                "Reconnect attempts by result",
            ),
            &["result"],
        )
        .unwrap();
        let outbound_queue_drops_total = IntCounter::new(
            "walletpair_outbound_queue_drops_total",
            "Messages dropped due to full outbound queue",
        )
        .unwrap();
        let slow_consumer_closes_total = IntCounter::new(
            "walletpair_slow_consumer_closes_total",
            "Connections closed due to slow consumption",
        )
        .unwrap();

        // Register all metrics
        registry
            .register(Box::new(active_connections.clone()))
            .unwrap();
        registry
            .register(Box::new(active_channels.clone()))
            .unwrap();
        registry
            .register(Box::new(channels_created_total.clone()))
            .unwrap();
        registry
            .register(Box::new(channels_joined_total.clone()))
            .unwrap();
        registry
            .register(Box::new(channels_connected_total.clone()))
            .unwrap();
        registry
            .register(Box::new(channels_closed_total.clone()))
            .unwrap();
        registry
            .register(Box::new(messages_rejected_total.clone()))
            .unwrap();
        registry
            .register(Box::new(messages_forwarded_total.clone()))
            .unwrap();
        registry
            .register(Box::new(reconnect_attempts_total.clone()))
            .unwrap();
        registry
            .register(Box::new(outbound_queue_drops_total.clone()))
            .unwrap();
        registry
            .register(Box::new(slow_consumer_closes_total.clone()))
            .unwrap();

        Self {
            active_connections,
            active_channels,
            channels_created_total,
            channels_joined_total,
            channels_connected_total,
            channels_closed_total,
            messages_rejected_total,
            messages_forwarded_total,
            reconnect_attempts_total,
            outbound_queue_drops_total,
            slow_consumer_closes_total,
            registry,
        }
    }
}

impl Default for Metrics {
    fn default() -> Self {
        Self::new()
    }
}
