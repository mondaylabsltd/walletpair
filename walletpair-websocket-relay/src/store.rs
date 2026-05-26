use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, MutexGuard};

use tokio::time::Instant;

use crate::config::Config;
use crate::metrics::Metrics;
use crate::protocol::{ChannelId, CloseReason, Role};
use crate::state::{Channel, ChannelState};

// ---------------------------------------------------------------------------
// Single shard (the old ChannelStore, now per-shard)
// ---------------------------------------------------------------------------

pub struct ChannelStore {
    pub channels: HashMap<ChannelId, Channel>,
    pub max_channels: usize,
    pub pending_request_limit: usize,
    unpaired_ttl_secs: u64,
    connected_ttl_secs: u64,
}

impl ChannelStore {
    pub fn new(config: &Config) -> Self {
        Self {
            channels: HashMap::new(),
            max_channels: config.max_channels,
            pending_request_limit: config.pending_request_limit,
            unpaired_ttl_secs: config.unpaired_channel_ttl_secs,
            connected_ttl_secs: config.connected_channel_ttl_secs,
        }
    }

    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    pub fn get(&self, id: &str) -> Option<&Channel> {
        self.channels.get(id)
    }

    pub fn get_mut(&mut self, id: &str) -> Option<&mut Channel> {
        self.channels.get_mut(id)
    }

    pub fn contains(&self, id: &str) -> bool {
        self.channels.contains_key(id)
    }

    pub fn insert(&mut self, channel: Channel) {
        self.channels.insert(channel.id.clone(), channel);
    }

    /// Remove a channel.
    pub fn remove_channel(&mut self, channel_id: &str, metrics: &Metrics, reason: CloseReason) {
        if self.channels.remove(channel_id).is_some() {
            metrics.active_channels.dec();
            metrics
                .channels_closed_total
                .with_label_values(&[reason.as_str()])
                .inc();
        }
    }

    /// Remove expired channels. Returns the number removed.
    pub fn cleanup_expired(&mut self, metrics: &Metrics) -> usize {
        let now = Instant::now();
        let mut to_remove = Vec::new();

        for (id, ch) in &self.channels {
            if ch.state == ChannelState::Closed {
                to_remove.push(id.clone());
                continue;
            }
            let ttl_secs = if ch.state == ChannelState::Connected {
                self.connected_ttl_secs
            } else {
                self.unpaired_ttl_secs
            };
            let reference_time = ch.connected_at.unwrap_or(ch.created_at);
            if now.duration_since(reference_time).as_secs() > ttl_secs {
                // Send close to connected peers before removing
                let close_msg = crate::protocol::build_terminate(&ch.id, CloseReason::Timeout);
                if let Some(ref conn) = ch.dapp_conn {
                    let _ = conn.sender.try_send(close_msg.clone());
                }
                if let Some(ref conn) = ch.wallet_conn {
                    let _ = conn.sender.try_send(close_msg);
                }
                to_remove.push(id.clone());
            }
        }

        let count = to_remove.len();
        for id in to_remove {
            self.remove_channel(&id, metrics, CloseReason::Timeout);
        }
        count
    }

    /// Disconnect a peer from its channel by connection ID.
    pub fn disconnect_peer(&mut self, channel_id: &str, conn_id: u64) -> Option<(String, Role)> {
        if let Some(ch) = self.channels.get_mut(channel_id) {
            if let Some(role) = ch.disconnect_by_conn_id(conn_id) {
                tracing::info!(
                    ch = %channel_id,
                    role = %role,
                    "peer transport disconnected"
                );
                return Some((channel_id.to_string(), role));
            }
        }
        None
    }
}

// ---------------------------------------------------------------------------
// Sharded store — splits channels across N independent shards
// ---------------------------------------------------------------------------

/// Number of shards. Must be a power of two for fast modulo via bitmask.
const DEFAULT_SHARD_COUNT: usize = 64;

/// A sharded channel store that distributes channels across multiple
/// independent `Mutex<ChannelStore>` instances. This eliminates the global
/// lock bottleneck — operations on different channels never contend.
pub struct ShardedStore {
    shards: Vec<Mutex<ChannelStore>>,
    shard_mask: usize,
    /// Atomic total channel count (avoids locking all shards for readyz).
    total_channels: AtomicUsize,
    pub max_channels: usize,
}

impl ShardedStore {
    pub fn new(config: &Config) -> Self {
        let n = DEFAULT_SHARD_COUNT;
        let shards = (0..n).map(|_| Mutex::new(ChannelStore::new(config))).collect();
        Self {
            shards,
            shard_mask: n - 1,
            total_channels: AtomicUsize::new(0),
            max_channels: config.max_channels,
        }
    }

    /// Create from an existing single ChannelStore (used by persist::load).
    pub fn from_single(mut single: ChannelStore, config: &Config) -> Self {
        let store = Self::new(config);
        // Re-distribute channels across shards
        let channels: Vec<_> = single.channels.drain().collect();

        for (id, channel) in channels {
            let idx = shard_index(&id, store.shard_mask);
            let mut shard = store.shards[idx].lock().unwrap();
            shard.channels.insert(id, channel);
        }

        let total: usize = store.shards.iter()
            .map(|s| s.lock().unwrap().channel_count())
            .sum();
        store.total_channels.store(total, Ordering::Relaxed);
        store
    }

    /// Lock the shard responsible for a given channel ID.
    pub fn lock_shard(&self, ch: &str) -> MutexGuard<'_, ChannelStore> {
        let idx = shard_index(ch, self.shard_mask);
        self.shards[idx].lock().unwrap()
    }

    /// Total channel count (fast, no locking).
    pub fn total_channels(&self) -> usize {
        self.total_channels.load(Ordering::Relaxed)
    }

    /// Increment the total channel counter (called after inserting a channel).
    pub fn inc_total(&self) {
        self.total_channels.fetch_add(1, Ordering::Relaxed);
    }

    /// Decrement the total channel counter (called after removing a channel).
    pub fn dec_total(&self) {
        self.total_channels.fetch_sub(1, Ordering::Relaxed);
    }

    /// Check if the global channel limit is reached.
    pub fn at_capacity(&self) -> bool {
        self.total_channels() >= self.max_channels
    }

    /// Cleanup expired channels across all shards. Returns total removed.
    pub fn cleanup_all(&self, metrics: &Metrics) -> usize {
        let mut total = 0;
        for shard in &self.shards {
            let mut s = shard.lock().unwrap();
            let before = s.channel_count();
            let removed = s.cleanup_expired(metrics);
            total += removed;
            // Sync atomic counter with actual count
            let after = s.channel_count();
            if before != after + removed {
                // Shouldn't happen, but be defensive
                let _ = before;
            }
        }
        if total > 0 {
            self.total_channels.fetch_sub(total, Ordering::Relaxed);
        }
        total
    }

    /// Iterate all shards and apply a function. Used for shutdown.
    pub fn for_each_shard<F>(&self, mut f: F)
    where
        F: FnMut(&mut ChannelStore),
    {
        for shard in &self.shards {
            let mut s = shard.lock().unwrap();
            f(&mut s);
        }
    }

}

/// Fast shard index from channel ID. Channel IDs are hex strings, so the
/// first few bytes have good entropy.
fn shard_index(ch: &str, mask: usize) -> usize {
    // Use first 8 bytes of the hex channel ID as a hash
    let bytes = ch.as_bytes();
    let mut h: usize = 0;
    for &b in bytes.iter().take(8) {
        h = h.wrapping_mul(31).wrapping_add(b as usize);
    }
    h & mask
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::PeerConn;
    use tokio::sync::mpsc;

    fn test_config() -> Config {
        Config {
            max_channels: 100,
            pending_request_limit: 32,
            unpaired_channel_ttl_secs: 300,
            connected_channel_ttl_secs: 86400,
            ..Config::default()
        }
    }

    fn test_metrics() -> Metrics {
        Metrics::new()
    }

    #[test]
    fn remove_channel_cleans_up() {
        let config = test_config();
        let metrics = test_metrics();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);

        let ch_id = "ab".repeat(32);
        let ch = Channel::new(
            ch_id.clone(),
            "p".into(),
            PeerConn {
                sender: tx,
                conn_id: 1,
            },
        );
        store.insert(ch);
        metrics.active_channels.inc();

        store.remove_channel(&ch_id, &metrics, CloseReason::Normal);
        assert!(!store.contains(&ch_id));
    }

    #[test]
    fn sharded_store_routes_correctly() {
        let config = test_config();
        let store = ShardedStore::new(&config);

        let ch1 = "ab".repeat(32);
        let ch2 = "cd".repeat(32);

        // Insert into different shards
        {
            let mut shard = store.lock_shard(&ch1);
            let (tx, _rx) = mpsc::channel(1);
            shard.insert(Channel::new(
                ch1.clone(),
                "p1".into(),
                PeerConn { sender: tx, conn_id: 1 },
            ));
            store.inc_total();
        }
        {
            let mut shard = store.lock_shard(&ch2);
            let (tx, _rx) = mpsc::channel(1);
            shard.insert(Channel::new(
                ch2.clone(),
                "p2".into(),
                PeerConn { sender: tx, conn_id: 2 },
            ));
            store.inc_total();
        }

        assert_eq!(store.total_channels(), 2);

        // Lookup works
        assert!(store.lock_shard(&ch1).contains(&ch1));
        assert!(store.lock_shard(&ch2).contains(&ch2));

        // Wrong shard doesn't have it
        // (ch1 and ch2 may or may not be in same shard, so just verify lookup works)
        assert!(!store.lock_shard(&ch1).contains(&ch2) || shard_index(&ch1, 63) == shard_index(&ch2, 63));
    }

    // --- Additional coverage ---

    #[test]
    fn disconnect_peer_returns_role() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);

        let ch_id = "ab".repeat(32);
        let ch = Channel::new(
            ch_id.clone(),
            "p".into(),
            PeerConn { sender: tx, conn_id: 42 },
        );
        store.insert(ch);

        let result = store.disconnect_peer(&ch_id, 42);
        assert!(result.is_some());
        let (id, role) = result.unwrap();
        assert_eq!(id, ch_id);
        assert_eq!(role, Role::DApp);

        // Conn should be gone now
        assert!(store.get(&ch_id).unwrap().dapp_conn.is_none());
    }

    #[test]
    fn disconnect_peer_unknown_conn_id() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);

        let ch_id = "ab".repeat(32);
        let ch = Channel::new(
            ch_id.clone(),
            "p".into(),
            PeerConn { sender: tx, conn_id: 1 },
        );
        store.insert(ch);

        assert!(store.disconnect_peer(&ch_id, 999).is_none());
    }

    #[test]
    fn disconnect_peer_unknown_channel() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        assert!(store.disconnect_peer("nonexistent", 1).is_none());
    }

    #[test]
    fn channel_count_tracks_insertions() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        assert_eq!(store.channel_count(), 0);

        let (tx, _rx) = mpsc::channel(1);
        store.insert(Channel::new(
            "ab".repeat(32),
            "p".into(),
            PeerConn { sender: tx, conn_id: 1 },
        ));
        assert_eq!(store.channel_count(), 1);
    }

    #[test]
    fn get_and_contains() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);
        let ch_id = "ab".repeat(32);
        store.insert(Channel::new(
            ch_id.clone(),
            "p".into(),
            PeerConn { sender: tx, conn_id: 1 },
        ));

        assert!(store.contains(&ch_id));
        assert!(!store.contains("nonexistent"));
        assert!(store.get(&ch_id).is_some());
        assert!(store.get("nonexistent").is_none());
        assert!(store.get_mut(&ch_id).is_some());
    }

    #[test]
    fn shard_index_deterministic() {
        let ch = "ab".repeat(32);
        let idx1 = shard_index(&ch, 63);
        let idx2 = shard_index(&ch, 63);
        assert_eq!(idx1, idx2);
    }

    #[test]
    fn shard_index_within_bounds() {
        let mask = 63; // 64 shards
        for i in 0..=255u8 {
            let ch = format!("{:02x}", i).repeat(32);
            let idx = shard_index(&ch, mask);
            assert!(idx <= mask, "shard index {} exceeds mask {}", idx, mask);
        }
    }

    #[test]
    fn shard_index_distributes_across_shards() {
        let mask = 63;
        let mut seen = std::collections::HashSet::new();
        // Generate 256 different channel IDs and check distribution
        for i in 0..256u16 {
            let ch = format!("{:04x}{}", i, "a".repeat(60));
            seen.insert(shard_index(&ch, mask));
        }
        // With 256 inputs and 64 shards, we should hit many shards
        assert!(seen.len() > 10, "only {} shards used out of 64", seen.len());
    }

    #[test]
    fn sharded_store_at_capacity() {
        let config = Config {
            max_channels: 2,
            ..test_config()
        };
        let store = ShardedStore::new(&config);
        assert!(!store.at_capacity());

        store.inc_total();
        assert!(!store.at_capacity());

        store.inc_total();
        assert!(store.at_capacity());
    }

    #[test]
    fn sharded_store_inc_dec_total() {
        let config = test_config();
        let store = ShardedStore::new(&config);

        assert_eq!(store.total_channels(), 0);
        store.inc_total();
        store.inc_total();
        assert_eq!(store.total_channels(), 2);
        store.dec_total();
        assert_eq!(store.total_channels(), 1);
    }

    #[test]
    fn sharded_store_for_each_shard() {
        let config = test_config();
        let store = ShardedStore::new(&config);

        // Insert a channel
        let ch_id = "ab".repeat(32);
        {
            let mut shard = store.lock_shard(&ch_id);
            let (tx, _rx) = mpsc::channel(1);
            shard.insert(Channel::new(
                ch_id.clone(),
                "p".into(),
                PeerConn { sender: tx, conn_id: 1 },
            ));
        }

        let mut total = 0;
        store.for_each_shard(|s| {
            total += s.channel_count();
        });
        assert_eq!(total, 1);
    }

    #[test]
    fn cleanup_expired_removes_closed_channels() {
        let config = test_config();
        let metrics = test_metrics();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);

        let ch_id = "ab".repeat(32);
        let mut ch = Channel::new(
            ch_id.clone(),
            "p".into(),
            PeerConn { sender: tx, conn_id: 1 },
        );
        ch.state = ChannelState::Closed;
        store.insert(ch);
        metrics.active_channels.inc();

        let removed = store.cleanup_expired(&metrics);
        assert_eq!(removed, 1);
        assert!(!store.contains(&ch_id));
    }

}
