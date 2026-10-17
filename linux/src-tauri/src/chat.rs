// The transcript, in the shape `/api/chat` expects. Deliberately tiny:
// PeDitX-AI owns the persona, the system prompt, the memory and the model, so
// all Goo keeps is the messages already exchanged.
//
// It is a list of sessions, not one conversation: the active session is what
// the island, the overview and the full-screen window all show, and the rest
// are the history the overview lists. One store, one truth — a New chat anywhere
// starts a session everywhere, and nothing is mirrored.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

struct Session {
    id: u64,
    messages: Vec<Value>,
}

#[derive(Default)]
struct Transcript {
    sessions: Vec<Session>,
    next_id: u64,
    active: u64,
}

impl Transcript {
    /// Every read and write goes through here, so there is always one session
    /// to be the active one — the UI never has to handle "no sessions".
    fn ensure(&mut self) {
        if self.sessions.is_empty() {
            self.next_id = self.next_id.max(1);
            self.sessions.push(Session {
                id: self.next_id,
                messages: Vec::new(),
            });
            self.active = self.next_id;
            self.next_id += 1;
        }
    }

    fn active_session(&self) -> Option<&Session> {
        self.sessions.iter().find(|s| s.id == self.active)
    }

    /// What every window reads: the sessions and which one is live.
    fn json(&self) -> Value {
        json!({
            "active": self.active,
            "sessions": self
                .sessions
                .iter()
                .map(|s| json!({ "id": s.id, "messages": s.messages }))
                .collect::<Vec<_>>(),
        })
    }
}

#[derive(Default)]
pub struct Chat {
    state: Mutex<Transcript>,
}

impl Chat {
    /// The whole state, as the UI consumes it.
    pub fn list(&self) -> Value {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        t.json()
    }

    /// The active session's messages — what a turn appends to.
    pub(crate) fn snapshot(&self) -> Vec<Value> {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        t.active_session()
            .map(|s| s.messages.clone())
            .unwrap_or_default()
    }

    pub(crate) fn replace(&self, messages: Vec<Value>) {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        // The guard derefs as a whole, so the id goes local before the mutation.
        let active = t.active;
        if let Some(s) = t.sessions.iter_mut().find(|s| s.id == active) {
            s.messages = messages;
        }
    }

    /// A new conversation. `force` makes one even when the active session is
    /// still empty — that is the full-screen window's "+" wanting a tab the
    /// user can see; the island's New chat passes false so a fresh transcript
    /// does not pile up blanks.
    pub fn new_session(&self, force: bool) -> Value {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        let empty = t
            .active_session()
            .map(|s| s.messages.is_empty())
            .unwrap_or(true);
        if !force && empty {
            return t.json();
        }
        let id = t.next_id;
        t.sessions.push(Session {
            id,
            messages: Vec::new(),
        });
        t.active = id;
        t.next_id += 1;
        t.json()
    }

    pub fn select_session(&self, id: u64) -> Value {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        if t.sessions.iter().any(|s| s.id == id) {
            t.active = id;
        }
        t.json()
    }

    /// Dropping a tab. The last one never goes — an empty window would be a
    /// bug, so closing it is refused rather than leaving nothing behind.
    pub fn close_session(&self, id: u64) -> Value {
        let mut t = self.state.lock().unwrap();
        t.ensure();
        if t.sessions.len() > 1 {
            if let Some(i) = t.sessions.iter().position(|s| s.id == id) {
                let was_active = t.sessions[i].id == t.active;
                t.sessions.remove(i);
                if was_active {
                    t.active = t.sessions[i.saturating_sub(1)].id;
                }
            }
        }
        t.json()
    }
}

/// The dropped file / focused window. Both are handed to PeDitX-AI by path and
/// title: reading a file is the agent's job, and it does it under its own
/// access mode.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    Window { app_name: String, title: String, url: Option<String> },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}
