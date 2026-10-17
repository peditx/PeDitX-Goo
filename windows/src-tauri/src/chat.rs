// The island's transcript. Deliberately tiny: PeDitX-AI owns the persona, the
// system prompt, the memory and the model, so all Goo has to keep is the
// messages it has already exchanged, in the shape `/api/chat` expects.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history, including the tool blocks the agent loop wrote.
    messages: Mutex<Vec<Value>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
    }

    pub(crate) fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }

    pub(crate) fn replace(&self, messages: Vec<Value>) {
        *self.messages.lock().unwrap() = messages;
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
