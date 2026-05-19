use std::collections::HashMap;

use tokio::time::Instant;

use crate::config::Config;
use crate::metrics::Metrics;
use crate::protocol::{ChannelId, CloseReason, PeerId, Role};
use crate::state::{Channel, ChannelState};

/// Token → (channel_id, role, peer_id)
pub struct ResumeInfo {
    pub channel_id: ChannelId,
    pub role: Role,
    pub peer_id: PeerId,
}

pub struct ChannelStore {
    pub channels: HashMap<ChannelId, Channel>,
    pub resume_tokens: HashMap<String, ResumeInfo>,
    pub max_channels: usize,
    pub pending_request_limit: usize,
    unpaired_ttl_secs: u64,
    connected_ttl_secs: u64,
}

impl ChannelStore {
    pub fn new(config: &Config) -> Self {
        Self {
            channels: HashMap::new(),
            resume_tokens: HashMap::new(),
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

    /// Generate and store a resume token for a peer.
    pub fn generate_resume_token(&mut self, channel_id: &str, role: Role, peer_id: &str) -> String {
        let token = uuid::Uuid::new_v4().to_string();
        self.resume_tokens.insert(
            token.clone(),
            ResumeInfo {
                channel_id: channel_id.to_string(),
                role,
                peer_id: peer_id.to_string(),
            },
        );
        // Store on the channel too
        if let Some(ch) = self.channels.get_mut(channel_id) {
            match role {
                Role::DApp => ch.dapp_resume = Some(token.clone()),
                Role::Wallet => ch.wallet_resume = Some(token.clone()),
            }
        }
        token
    }

    /// Validate a resume token. Returns (channel_id, role, peer_id) if valid.
    pub fn validate_resume_token(&self, token: &str) -> Option<&ResumeInfo> {
        self.resume_tokens.get(token)
    }

    /// Revoke old resume tokens for a given channel+role.
    pub fn revoke_resume_tokens(&mut self, channel_id: &str, role: Role) {
        self.resume_tokens
            .retain(|_, info| !(info.channel_id == channel_id && info.role == role));
    }

    /// Remove a channel and its associated resume tokens.
    pub fn remove_channel(&mut self, channel_id: &str, metrics: &Metrics, reason: CloseReason) {
        if self.channels.remove(channel_id).is_some() {
            self.resume_tokens
                .retain(|_, info| info.channel_id != channel_id);
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
                let close_msg = crate::protocol::build_close(&ch.id, CloseReason::Timeout);
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
    /// Returns (channel_id, role) if the peer was found.
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
    fn resume_token_binds_channel_role_peer() {
        let config = test_config();
        let mut store = ChannelStore::new(&config);
        let (tx, _rx) = mpsc::channel(1);

        let ch = Channel::new(
            "ab".repeat(32),
            "peer1".to_string(),
            PeerConn {
                sender: tx,
                conn_id: 1,
            },
        );
        store.insert(ch);

        let token = store.generate_resume_token(&"ab".repeat(32), Role::DApp, "peer1");

        // Valid lookup
        let info = store.validate_resume_token(&token).unwrap();
        assert_eq!(info.channel_id, "ab".repeat(32));
        assert_eq!(info.role, Role::DApp);
        assert_eq!(info.peer_id, "peer1");

        // Invalid token
        assert!(store.validate_resume_token("bogus").is_none());
    }

    #[test]
    fn remove_channel_cleans_resume_tokens() {
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

        let token = store.generate_resume_token(&ch_id, Role::DApp, "p");
        assert!(store.validate_resume_token(&token).is_some());

        store.remove_channel(&ch_id, &metrics, CloseReason::Normal);
        assert!(store.validate_resume_token(&token).is_none());
        assert!(!store.contains(&ch_id));
    }
}
