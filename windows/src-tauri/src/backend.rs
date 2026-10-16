// PeDitX-Goo's backend — any OpenAI-compatible Chat Completions endpoint.
// 9Router, PeDitX-AI, or a service on the LAN reached by plain `http://`
// (e.g. `http://192.168.1.1:8765/v1`).
//
// Everything happens here: the bearer token is read out of the Secret Service
// and never crosses the IPC boundary, so the chat window only ever learns
// "configured" or "not configured". The address is passed in from Settings —
// it is not a secret — and there is deliberately no TLS special-casing:
// reqwest is built with `default-features = false`, so `http://` goes out as
// plain HTTP exactly as written and nothing ever upgrades it.

use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::chat::{self, Chat, ChatContext, ChatReply, SYSTEM_PROMPT};
use crate::secrets;

/// No overall request timeout on the streaming path: a turn can run long.
/// Only the connection is bounded — and the stream itself is bounded below.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// The endpoint has stopped sending. Bursts happen, so be generous.
const IDLE_TIMEOUT: Duration = Duration::from_secs(120);
/// Absolute ceiling for one turn, so a wedged stream cannot pin the window.
const MAX_TURN: Duration = Duration::from_secs(600);
/// `GET /models` is a probe as much as a lookup — keep it snappy.
const PROBE_TIMEOUT: Duration = Duration::from_secs(5);

const API_KEY: &str = "goo-api-key";

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum GooEvent {
    Delta { text: String },
    Done,
}

/// The settings row and the first-run hint both read this. The key is
/// optional — a LAN service often has none — so only the address counts.
pub fn configured(url: &str) -> bool {
    !url.trim().is_empty()
}

/// Base URL → the API root, i.e. everything before `/chat/completions`.
/// Accepts the path already being pasted in. Pure, so the tests never have to
/// touch the settings or the Secret Service.
fn api_root(raw: Option<&str>) -> Result<String, String> {
    let raw = raw.ok_or_else(|| "Backend URL missing. Open settings.".to_string())?;
    let base = raw.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("Backend URL missing. Open settings.".into());
    }
    // Set by the user, but still untrusted input: no file://, no garbage.
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("Backend URL must start with http:// or https://.".into());
    }
    // A pasted path wins over the default, so `…/v1` does not become `…/v1/v1`.
    for suffix in ["/v1/chat/completions", "/chat/completions", "/v1"] {
        if let Some(head) = base.strip_suffix(suffix) {
            return Ok(head.trim_end_matches('/').to_string());
        }
    }
    Ok(format!("{base}/v1"))
}

fn chat_url(raw: Option<&str>) -> Result<String, String> {
    Ok(format!("{}/chat/completions", api_root(raw)?))
}

fn models_url(raw: Option<&str>) -> Result<String, String> {
    Ok(format!("{}/models", api_root(raw)?))
}

fn endpoint(url: &str) -> Result<String, String> {
    chat_url(Some(url))
}

/// No key configured is not an error — plenty of gateways on a LAN have none.
fn token() -> Option<String> {
    secrets::get(API_KEY)
}

// ── Discovery ────────────────────────────────────────────────────────────────

/// `GET /models`. Doubles as the Settings "test connection" button: if it
/// answers, the address and the key are right. An empty list means connected
/// but unhelpful, which is not the same as failing.
pub async fn models(url: &str) -> Result<Vec<String>, String> {
    fetch_models(url, PROBE_TIMEOUT).await
}

async fn fetch_models(url: &str, timeout: Duration) -> Result<Vec<String>, String> {
    let url = models_url(Some(url))?;

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client.get(&url);
    if let Some(token) = token() {
        request = request.bearer_auth(token);
    }
    let response = request
        .send()
        .await
        .map_err(|e| format!("Goo unreachable: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(surface(response, status).await);
    }

    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("Bad API response: {e}"))?;
    let mut ids: Vec<String> = value
        .pointer("/data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|m| m.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    Ok(ids)
}

// ── Full-screen chat window ──────────────────────────────────────────────────
//
// The caller owns the transcript and hands it back in full each time, so
// nothing has to live in Rust between messages.

/// One streaming turn. `model` comes from Settings; an unset model is refused
/// loudly rather than sent as an empty string.
pub async fn send(
    url: &str,
    history: Vec<Value>,
    model: String,
    prompt: String,
    channel: Channel<GooEvent>,
) -> Result<(), String> {
    let url = endpoint(url)?;
    let model = require_model(model)?;

    let mut messages = history;
    messages.push(json!({ "role": "user", "content": prompt }));

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .post(&url)
        .header("content-type", "application/json")
        .json(&json!({ "model": model, "stream": true, "messages": messages }));
    if let Some(token) = token() {
        request = request.bearer_auth(token);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Goo unreachable: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(surface(response, status).await);
    }

    let mut response = response;
    let mut pending = String::new();
    let started = Instant::now();
    loop {
        if started.elapsed() > MAX_TURN {
            return Err("Goo stopped responding (10 minute limit).".into());
        }
        let chunk = tokio::time::timeout(IDLE_TIMEOUT, response.chunk())
            .await
            .map_err(|_| "Goo went quiet for two minutes.".to_string())?
            .map_err(|e| format!("Connection lost: {e}"))?;

        // Clean end of stream — not every server sends [DONE].
        let Some(chunk) = chunk else { break };
        pending.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(idx) = pending.find('\n') {
            let line: String = pending.drain(..=idx).collect();
            match handle(line.trim_end(), &channel)? {
                Stream::Continue => {}
                Stream::Finished => {
                    let _ = channel.send(GooEvent::Done);
                    return Ok(());
                }
            }
        }
    }

    let _ = channel.send(GooEvent::Done);
    Ok(())
}

enum Stream {
    Continue,
    Finished,
}

/// One SSE line. Anything that is not a `data:` line (comments, `event:`) is
/// silently skipped, as the spec allows.
fn handle(line: &str, channel: &Channel<GooEvent>) -> Result<Stream, String> {
    let Some(data) = line.strip_prefix("data:").map(str::trim_start) else {
        return Ok(Stream::Continue);
    };
    if data == "[DONE]" {
        return Ok(Stream::Finished);
    }
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Ok(Stream::Continue);
    };

    // An error object arrives mid-stream instead of as a status code.
    if let Some(message) = value.pointer("/error/message").and_then(Value::as_str) {
        return Err(message.to_string());
    }
    if let Some(text) = value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
    {
        if !text.is_empty() {
            channel
                .send(GooEvent::Delta {
                    text: text.to_string(),
                })
                .map_err(|_| "window closed".to_string())?;
        }
    }
    Ok(Stream::Continue)
}

/// Surface the server's own message, which is what makes a bad key or a
/// mis-typed address obvious.
async fn surface(response: reqwest::Response, status: reqwest::StatusCode) -> String {
    let text = response.text().await.unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|v| {
            v.pointer("/error/message")
                .or_else(|| v.pointer("/message"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
        .unwrap_or_else(|| text.chars().take(200).collect());
    if detail.is_empty() {
        return format!("Goo API {status}");
    }
    format!("Goo API {status}: {detail}")
}

fn require_model(model: String) -> Result<String, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("No model selected. Open settings and fetch the model list.".into());
    }
    Ok(model.to_string())
}

// ── Island chat ──────────────────────────────────────────────────────────────
//
// The island asks one question and waits for the whole reply: no stream, no
// channel, no transcript of its own.

/// One island turn against the backend.
pub async fn chat(
    url: &str,
    history: &Chat,
    model: String,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let url = endpoint(url)?;
    let model = require_model(model)?;

    let mut content = chat::context_blocks(history, context.as_ref());
    content.push(json!({ "type": "text", "text": query }));

    history.push(json!({ "role": "user", "content": content }));

    let request = json!({ "model": model, "messages": turn(&history.snapshot()) });

    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(MAX_TURN)
        .build()
        .map_err(|e| e.to_string())?;

    let mut http = client.post(&url).json(&request);
    if let Some(token) = token() {
        http = http.bearer_auth(token);
    }

    let response = http
        .send()
        .await
        .map_err(|e| format!("Goo unreachable: {e}"))?;

    let status = response.status();
    if !status.is_success() {
        let why = surface(response, status).await;
        history.pop();
        return Err(why);
    }

    let value: Value = response
        .json()
        .await
        .map_err(|e| format!("Bad API response: {e}"))?;
    if let Some(why) = value.pointer("/error/message").and_then(Value::as_str) {
        history.pop();
        return Err(why.to_string());
    }

    let text = value
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_string();
    if text.is_empty() {
        history.pop();
        return Err("No response text.".into());
    }

    // Store it in the same shape the next turn expects, so history reads back
    // the way it went in.
    history.push(json!({ "role": "assistant", "content": [{ "type": "text", "text": text }] }));
    Ok(ChatReply { text })
}

/// Stored history → OpenAI messages. The system prompt rides every request.
fn turn(history: &[Value]) -> Vec<Value> {
    let mut out = Vec::with_capacity(history.len() + 1);
    out.push(json!({ "role": "system", "content": SYSTEM_PROMPT }));
    for message in history {
        out.push(json!({
            "role": message.get("role").and_then(Value::as_str).unwrap_or("user"),
            "content": parts(message.get("content")),
        }));
    }
    out
}

fn parts(content: Option<&Value>) -> Value {
    match content {
        Some(Value::Array(blocks)) => Value::Array(blocks.iter().map(part).collect()),
        Some(Value::String(text)) => json!(text),
        _ => json!(""),
    }
}

/// One stored block → one OpenAI part. Text goes across as text; images and
/// PDFs are inlined, because the backend cannot open a path on this machine.
fn part(block: &Value) -> Value {
    let kind = block.get("type").and_then(Value::as_str).unwrap_or("");
    match kind {
        "image" | "document" => {
            let source = &block["source"];
            let media = source["media_type"]
                .as_str()
                .unwrap_or("application/octet-stream");
            let url = format!(
                "data:{media};base64,{}",
                source["data"].as_str().unwrap_or("")
            );
            if kind == "image" {
                json!({ "type": "image_url", "image_url": { "url": url } })
            } else {
                // OpenAI's file part. If the endpoint rejects it the turn fails
                // loudly instead of silently dropping the attachment.
                json!({ "type": "file", "file": { "filename": "attachment", "file_data": url } })
            }
        }
        "tool_use" => json!({
            "type": "text",
            "text": format!("Tool call {}: {}", block["name"].as_str().unwrap_or("?"), block["input"])
        }),
        "tool_result" => json!({ "type": "text", "text": tool_text(block) }),
        _ => json!({ "type": "text", "text": block["text"].as_str().unwrap_or("") }),
    }
}

/// tool_result content is a string, or a list of blocks.
fn tool_text(block: &Value) -> String {
    match block.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| item["text"].as_str().unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::{chat_url, models_url, part, turn};
    use serde_json::json;

    /// The URL field is user input; only http(s) survives it, and whatever
    /// path they pasted keeps working.
    #[test]
    fn chat_url_requires_http_and_accepts_a_pasted_path() {
        assert!(chat_url(None).is_err(), "no URL configured");
        assert!(chat_url(Some("   ")).is_err(), "blank URL refused");
        assert!(
            chat_url(Some("file:///etc")).is_err(),
            "non-http scheme refused"
        );

        assert_eq!(
            chat_url(Some("https://agent.example:8642/")).unwrap(),
            "https://agent.example:8642/v1/chat/completions"
        );
        assert_eq!(
            chat_url(Some("http://192.168.1.1:8765")).unwrap(),
            "http://192.168.1.1:8765/v1/chat/completions"
        );
        assert_eq!(
            chat_url(Some("https://agent.example:8642/v1/chat/completions")).unwrap(),
            "https://agent.example:8642/v1/chat/completions"
        );
        // A pasted `/v1` (9Router's shape) must not become `/v1/v1/…`.
        assert_eq!(
            chat_url(Some("http://127.0.0.1:20128/v1")).unwrap(),
            "http://127.0.0.1:20128/v1/chat/completions"
        );
        assert_eq!(
            chat_url(Some("http://192.168.1.1:8765/v1/")).unwrap(),
            "http://192.168.1.1:8765/v1/chat/completions"
        );
    }

    /// `/models` mirrors `chat_url`'s suffix handling, or the probe hits a
    /// path that never existed.
    #[test]
    fn models_url_follows_the_same_rules() {
        assert_eq!(
            models_url(Some("http://192.168.1.1:8765")).unwrap(),
            "http://192.168.1.1:8765/v1/models"
        );
        assert_eq!(
            models_url(Some("http://127.0.0.1:20128/v1")).unwrap(),
            "http://127.0.0.1:20128/v1/models"
        );
        assert_eq!(
            models_url(Some("https://api.example.com/v1/chat/completions")).unwrap(),
            "https://api.example.com/v1/models"
        );
        assert!(models_url(None).is_err());
    }

    /// The island stores block-shaped history; the wire wants OpenAI parts.
    /// Every block a turn can write has to come out the other side.
    #[test]
    fn history_translates_from_blocks_to_openai_parts() {
        assert_eq!(
            part(&json!({"type": "text", "text": "hi"})),
            json!({"type": "text", "text": "hi"})
        );
        assert_eq!(
            part(
                &json!({"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "AAA"}})
            ),
            json!({"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}})
        );
        assert_eq!(
            part(
                &json!({"type": "document", "source": {"type": "base64", "media_type": "application/pdf", "data": "BBB"}})
            ),
            json!({"type": "file", "file": {"filename": "attachment", "file_data": "data:application/pdf;base64,BBB"}})
        );

        let messages =
            turn(&[json!({"role": "user", "content": [{"type": "text", "text": "hello"}]})]);
        assert_eq!(messages[0]["role"], "system");
        assert_eq!(messages[1]["role"], "user");
        assert_eq!(messages[1]["content"][0]["text"], "hello");
    }
}
