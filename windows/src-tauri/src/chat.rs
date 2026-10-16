// Shared chat plumbing for the island: the transcript, the prompt, and the
// file blocks. Engine-agnostic on purpose — backend.rs is the only thing that
// knows which wire format the bytes take.
//
// Everything happens here rather than in the island: the API key never leaves
// the Secret Service, and file bytes never cross the IPC boundary.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Text and code files are inlined; anything larger is skipped, as on macOS.
const MAX_INLINE_TEXT: u64 = 200_000;

/// Empty means "the endpoint gets to decide" — Settings fills this from
/// `GET /models`, because a gateway's model list is not something to guess.
pub const DEFAULT_MODEL: &str = "";

pub(crate) const SYSTEM_PROMPT: &str = "You are PeDitX-Goo, a personal AI assistant living at the top of the user's screen. \
You can help with absolutely anything — research, coding, finding places, recommendations, tasks, questions. \
Respond in the user's language. Be thorough and complete — use as much detail as the task requires. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history, including any tool blocks the backend wrote.
    messages: Mutex<Vec<Value>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.messages.lock().unwrap().is_empty()
    }

    pub(crate) fn push(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    pub(crate) fn pop(&self) {
        self.messages.lock().unwrap().pop();
    }

    pub(crate) fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

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

/// The dropped file / focused window, as the history stores it. Rides the
/// first message of a turn only.
pub(crate) fn context_blocks(chat: &Chat, context: Option<&ChatContext>) -> Vec<Value> {
    let mut content = Vec::new();
    if chat.is_empty() {
        match context {
            Some(ChatContext::File { name, path }) => {
                if let Some(block) = file_block(path) {
                    content.push(block);
                }
                content.push(json!({ "type": "text", "text": format!("File: {name}") }));
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                let mut text = format!("Context — App: {app_name}, Window: {title}");
                if let Some(url) = url {
                    text.push_str(&format!(", URL: {url}"));
                }
                content.push(json!({ "type": "text", "text": text }));
            }
            None => {}
        }
    }
    content
}

/// PDF → document block, image → image block, text/code → inline text.
pub(crate) fn file_block(path: &str) -> Option<Value> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "pdf" => Some(("document", "application/pdf")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "png" => Some(("image", "image/png")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        _ => None,
    };

    if let Some((block_type, media)) = media_type {
        let bytes = std::fs::read(path).ok()?;
        return Some(json!({
            "type": block_type,
            "source": { "type": "base64", "media_type": media, "data": base64(&bytes) },
        }));
    }

    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_INLINE_TEXT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(json!({ "type": "text", "text": format!("File contents:\n{text}") }))
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::base64;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
