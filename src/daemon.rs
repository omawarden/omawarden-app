//! The daemon: one request, the poll that drives the UI's tick, and the SSH
//! prompt a pending signing request turns into.
//!
//! [`DaemonEngine`] is the seam. [`InProcess`] talks to the daemon socket over
//! `touch: false` probes and never starts a daemon of its own; [`Mock`] answers
//! the tick from the seeded state. Starting the daemon stays in the crate root
//! next to the boot path, because that is where the nsh host decides to spawn
//! it in-process.

use serde_json::{Value, json};

use crate::inspector::totp_view;
use crate::vault;
use crate::{AppPhase, DaemonTickView, MockState, SshPromptView, TotpLiveView, with_mock};

/// The daemon capabilities the bridge exposes.
pub(crate) trait DaemonEngine {
    /// Reports daemon status, pending SSH prompts, and the active TOTP code.
    fn tick(&self, active_cipher_id: Option<String>) -> DaemonTickView;

    /// Approves or denies a pending SSH signing request, then ticks.
    fn resolve_prompt(&self, prompt_id: u64, approve: bool) -> DaemonTickView;
}

/// The real adapter: the daemon socket.
pub(crate) struct InProcess;

impl DaemonEngine for InProcess {
    fn tick(&self, active_cipher_id: Option<String>) -> DaemonTickView {
        real_tick(active_cipher_id)
    }

    fn resolve_prompt(&self, prompt_id: u64, approve: bool) -> DaemonTickView {
        real_resolve_prompt(prompt_id, approve)
    }
}

/// The mock adapter: the seeded mock state.
pub(crate) struct Mock;

impl DaemonEngine for Mock {
    fn tick(&self, active_cipher_id: Option<String>) -> DaemonTickView {
        with_mock(|state| mock_tick(state, active_cipher_id))
    }

    fn resolve_prompt(&self, prompt_id: u64, approve: bool) -> DaemonTickView {
        with_mock(|state| mock_resolve_prompt(state, prompt_id, approve));
        self.tick(None)
    }
}

/// Sends one daemon request, returning `None` when no daemon answers.
pub(crate) fn daemon(action: Value) -> Option<Value> {
    omawarden::daemon::send_daemon_request(&action)
}

/// Parses the first pending SSH prompt.
pub(crate) fn parse_prompt(value: &Value, offset: usize) -> Option<SshPromptView> {
    let prompts = value.get("prompts")?.as_array()?;
    let prompt = prompts.get(offset)?;
    Some(SshPromptView {
        id: prompt.get("id").and_then(|v| v.as_u64()).unwrap_or(0) as u32,
        title: prompt
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("SSH request")
            .to_string(),
        action: prompt
            .get("action")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        key_name: prompt
            .get("key_name")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        fingerprint: prompt
            .get("fingerprint")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        client: prompt
            .get("client")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        command: prompt
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        forwarded: prompt
            .get("forwarded")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        remembered: prompt
            .get("remembered")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
        remaining: prompts.len().saturating_sub(offset + 1) as u32,
    })
}

/// Polls the daemon for status, pending SSH prompts, and the active TOTP code.
fn real_tick(active_cipher_id: Option<String>) -> DaemonTickView {
    let ping = daemon(json!({ "action": "ping", "touch": false }));
    let Some(ping) = ping else {
        return DaemonTickView {
            online: false,
            unlocked: false,
            quick_unlock_ready: false,
            ssh_prompt: None,
            ssh_pending_count: 0,
            totp: None,
            error: Some("The Omawarden daemon is not running.".to_string()),
        };
    };
    let pending =
        daemon(json!({ "action": "ssh_agent_pending", "touch": false })).unwrap_or(Value::Null);
    let ssh_prompt = parse_prompt(&pending, 0);
    let ssh_pending_count = pending
        .get("prompts")
        .and_then(|value| value.as_array())
        .map(|prompts| prompts.len() as u32)
        .unwrap_or(0);
    let totp = active_cipher_id.and_then(|cipher_id| {
        let response = daemon(json!({ "action": "totp", "query": cipher_id, "touch": false }))?;
        if response.get("ok").and_then(|value| value.as_bool()) != Some(true) {
            return None;
        }
        let code = response
            .get("code")
            .and_then(|value| value.as_str())?
            .to_string();
        Some(TotpLiveView {
            valid: true,
            formatted: format!(
                "{} {}",
                &code[..3.min(code.len())],
                &code[3.min(code.len())..]
            ),
            code,
            remaining: response
                .get("ttl")
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as u32,
            period: response
                .get("period")
                .and_then(|value| value.as_u64())
                .unwrap_or(30) as u32,
            error: None,
        })
    });
    let unlocked = ping
        .get("unlocked")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !unlocked {
        vault::clear_cached_vault();
    }
    DaemonTickView {
        online: true,
        unlocked,
        quick_unlock_ready: ping
            .get("quick_unlock")
            .and_then(|value| value.as_bool())
            .unwrap_or(false),
        ssh_prompt,
        ssh_pending_count,
        totp,
        error: None,
    }
}

/// Answers the tick from the seeded state.
fn mock_tick(state: &mut MockState, active_cipher_id: Option<String>) -> DaemonTickView {
    let totp = active_cipher_id.as_ref().and_then(|id| {
        state
            .items
            .iter()
            .find(|item| &item.id == id)
            .and_then(|item| totp_view(item.totp.as_deref()))
    });
    DaemonTickView {
        online: true,
        unlocked: state.phase == AppPhase::Unlocked,
        quick_unlock_ready: state.quick_unlock_ready,
        ssh_prompt: state.ssh_prompt.clone(),
        ssh_pending_count: state
            .ssh_prompt
            .as_ref()
            .map(|prompt| prompt.remaining + 1)
            .unwrap_or(0),
        totp,
        error: None,
    }
}

/// Sends the SSH agent's reply and re-ticks.
fn real_resolve_prompt(prompt_id: u64, approve: bool) -> DaemonTickView {
    let _ = daemon(
        json!({ "action": "ssh_agent_reply", "id": prompt_id, "approve": approve, "touch": true }),
    );
    real_tick(None)
}

/// Clears the seeded prompt and re-ticks.
fn mock_resolve_prompt(state: &mut MockState, prompt_id: u64, _approve: bool) {
    if state
        .ssh_prompt
        .as_ref()
        .is_some_and(|prompt| prompt.id as u64 == prompt_id)
    {
        state.ssh_prompt = None;
    }
    state.error = None;
}
