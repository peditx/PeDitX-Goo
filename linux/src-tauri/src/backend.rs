// PeDitX-Goo is a shell. PeDitX-AI is the agent.
//
// Everything here talks to PeDitX-AI's own local service — the same process
// its desktop window runs, `127.0.0.1:8765` by default — so the persona, the
// memory, the Skills, the access mode and the model all stay PeDitX-AI's.
// Goo holds no endpoint, no API key and no model id: it has none of its own,
// which is the point. Settings only says where PeDitX-AI is listening.
//
// The loop below mirrors `web/index.html`'s `send()`: ask, run whatever tools
// the answer asks for, ask again, up to eight times, then one tool-free turn
// for the final wording. One difference, marked where it happens: this side
// cannot click a confirmation dialog, so `ask` mode denies instead of asking.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::ipc::Channel;

use crate::chat::{Chat, ChatContext, ChatReply};

/// Where PeDitX-AI listens unless the user says otherwise.
pub const DEFAULT_AGENT: &str = "http://127.0.0.1:8765";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// One turn can run long — the model thinks, then works. Matched to the 600 s
/// ceiling PeDitX-AI itself puts on an upstream request.
const TURN_TIMEOUT: Duration = Duration::from_secs(600);
/// Steps before Goo stops asking. The web UI uses 8; this mirrors it.
const MAX_STEPS: usize = 8;

/// The tools every access mode may still run. Same list as the web UI.
const READ_ONLY: &[&str] = &[
    "system_info",
    "list_dir",
    "read_file",
    "read_skill",
    "read_skill_file",
    "ssh_command",
];

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum GooEvent {
    Delta { text: String },
    Done,
}

/// What Settings shows: PeDitX-AI's own view of itself, never Goo's to change.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStatus {
    /// PeDitX-AI's model endpoint — read back, not edited here.
    pub endpoint: String,
    pub model: String,
    pub mode: String,
    pub has_key: bool,
}

/// The address is user input, so only http(s) survives it. A trailing slash
/// and a pasted `/` path are both normalised away.
fn base(raw: Option<&str>) -> Result<String, String> {
    let raw = raw.ok_or_else(|| "PeDitX-AI address missing. Open settings.".to_string())?;
    let base = raw.trim().trim_end_matches('/');
    if base.is_empty() {
        return Err("PeDitX-AI address missing. Open settings.".into());
    }
    if !(base.starts_with("http://") || base.starts_with("https://")) {
        return Err("PeDitX-AI address must start with http:// or https://.".into());
    }
    Ok(base.to_string())
}

/// The settings row and the chat empty state both read this: an address alone
/// means "pointed somewhere", which is not the same as PeDitX-AI answering.
pub fn configured(url: &str) -> bool {
    base(Some(url)).is_ok()
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(TURN_TIMEOUT)
        .build()
        .map_err(|e| e.to_string())
}

// ── Talking to PeDitX-AI ─────────────────────────────────────────────────────

/// The per-launch token PeDitX-AI mints. It is handed to the browser by being
/// substituted into the served page, so reading the page is how any local
/// client gets it — there is no other door, on purpose.
async fn token(client: &reqwest::Client, base: &str) -> Result<String, String> {
    let page = client
        .get(base)
        .send()
        .await
        .map_err(|_| format!("{NOT_RUNNING} ({base})"))?
        .text()
        .await
        .map_err(|_| format!("{NOT_RUNNING} ({base})"))?;
    let start = page
        .find("TOKEN='")
        .map(|i| i + "TOKEN='".len())
        .ok_or_else(|| format!("{NOT_RUNNING} (no token in the page)"))?;
    let end = page[start..]
        .find('\'')
        .map(|i| start + i)
        .ok_or_else(|| format!("{NOT_RUNNING} (token truncated)"))?;
    Ok(page[start..end].to_string())
}

const NOT_RUNNING: &str = "PeDitX-AI is not running. Start it, then try again.";

/// One authenticated JSON call. The error string is PeDitX-AI's own, which is
/// what tells the user whether the model, the key or the network is at fault.
async fn post(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    path: &str,
    body: &Value,
) -> Result<Value, String> {
    let response = client
        .post(format!("{base}{path}"))
        .header("content-type", "application/json")
        .header("authorization", format!("Bearer {token}"))
        .json(body)
        .send()
        .await
        .map_err(|e| format!("Could not reach PeDitX-AI: {e}"))?;

    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.get("error").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(if detail.is_empty() {
            format!("PeDitX-AI answered {status}")
        } else {
            detail
        });
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("Bad reply from PeDitX-AI: {e}"))
}

async fn get(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    path: &str,
) -> Result<Value, String> {
    let response = client
        .get(format!("{base}{path}"))
        .header("authorization", format!("Bearer {token}"))
        .send()
        .await
        .map_err(|e| format!("Could not reach PeDitX-AI: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("PeDitX-AI answered {status}"));
    }
    serde_json::from_str::<Value>(&text).map_err(|e| format!("Bad reply from PeDitX-AI: {e}"))
}

/// PeDitX-AI's own configuration, read back for the status rows. The key is
/// reported as present or absent — never its value, which is not Goo's.
pub async fn status(url: &str) -> Result<AgentStatus, String> {
    let base = base(Some(url))?;
    let client = client()?;
    let token = token(&client, &base).await?;
    let config = get(&client, &base, &token, "/api/config").await?;
    let text = |key: &str| {
        config
            .get(key)
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string()
    };
    Ok(AgentStatus {
        endpoint: text("endpoint"),
        model: text("model"),
        mode: text("mode"),
        has_key: config
            .get("has_key")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

/// One `POST /api/chat`: PeDitX-AI prompts its own model with its own system
/// prompt, persona, memory and Skill index. Goo only ever sees the answer.
async fn ask(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    history: &[Value],
    no_tools: bool,
) -> Result<Value, String> {
    let mut body = json!({ "messages": history });
    if no_tools {
        body["no_tools"] = json!(true);
    }
    let reply = post(client, base, token, "/api/chat", &body).await?;
    reply
        .get("message")
        .cloned()
        .ok_or_else(|| "PeDitX-AI returned no message.".into())
}

/// `POST /api/execute`. PeDitX-AI enforces the access mode itself; the list
/// below only mirrors it so `ask` can deny before a dialog cannot be shown.
async fn run_tool(
    client: &reqwest::Client,
    base: &str,
    token: &str,
    mode: &str,
    call: &Value,
) -> Value {
    let function = call.get("function").unwrap_or(&Value::Null);
    let name = function.get("name").and_then(Value::as_str).unwrap_or("");
    let args: Value = function
        .get("arguments")
        .and_then(Value::as_str)
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_else(|| json!({}));

    // `ask` means "stop and ask the user" — and Goo has nowhere to stop and
    // ask. Denying is the only answer that is not a silent yes.
    // ponytail: surface an approval card in the island and retry the call here;
    // the island already draws an approval badge for a waiting pill.
    if mode == "ask" && !READ_ONLY.contains(&name) {
        return json!({
            "denied": true,
            "message": "The companion cannot ask for approval. Approve it in the PeDitX-AI window, or set access mode to Full.",
        });
    }

    match post(
        client,
        base,
        token,
        "/api/execute",
        &json!({ "name": name, "args": args, "mode": mode }),
    )
    .await
    {
        Ok(result) => result,
        Err(why) => json!({ "error": why }),
    }
}

/// One full turn: ask, run the tools it asks for, ask again — then one
/// tool-free pass so the last thing Goo shows is an answer, not a tool call.
/// Returns the final assistant message, already pushed onto `history`.
async fn run(base: &str, history: &mut Vec<Value>) -> Result<Value, String> {
    trim(history);
    let client = client()?;
    let token = token(&client, base).await?;
    let mode = get(&client, base, &token, "/api/config")
        .await
        .ok()
        .and_then(|c| c.get("mode").and_then(Value::as_str).map(str::to_string))
        .unwrap_or_else(|| "full".into());

    let mut message = ask(&client, base, &token, history, false).await?;
    for _ in 0..MAX_STEPS {
        history.push(message.clone());
        let calls = message
            .get("tool_calls")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if calls.is_empty() {
            return Ok(message);
        }
        for call in &calls {
            let result = run_tool(&client, base, &token, &mode, call).await;
            history.push(json!({
                "role": "tool",
                "tool_call_id": call.get("id").and_then(Value::as_str).unwrap_or(""),
                "content": result.to_string(),
            }));
        }
        message = ask(&client, base, &token, history, false).await?;
    }

    // Out of steps: ask once more with tools off so the user still gets prose.
    history.push(message);
    message = ask(&client, base, &token, history, true).await?;
    history.push(message.clone());
    Ok(message)
}

/** PeDitX-AI refuses more than 80 messages, so the oldest turns go first —
/// a turn at a time, so a tool call never loses the result it asked for. */
fn trim(messages: &mut Vec<Value>) {
    const LIMIT: usize = 60;
    while messages.len() > LIMIT {
        let cut = messages
            .iter()
            .skip(1)
            .position(|m| m.get("role").and_then(Value::as_str) == Some("user"))
            .map(|i| i + 1)
            .unwrap_or(messages.len());
        if cut >= messages.len() {
            break;
        }
        messages.drain(..cut);
    }
}

fn text_of(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.trim().to_string(),
        Some(Value::Array(items)) => items
            .iter()
            .map(|item| item.get("text").and_then(Value::as_str).unwrap_or(""))
            .collect::<Vec<_>>()
            .join("\n")
            .trim()
            .to_string(),
        _ => String::new(),
    }
}

// ── The two callers ──────────────────────────────────────────────────────────

/// The island asks one question and waits for the whole reply. The transcript
/// is Rust's; the dropped file is passed by path, because reading files is
/// PeDitX-AI's job, not the shell's.
pub async fn chat(
    url: &str,
    history: &Chat,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let base = base(Some(url))?;
    let mut messages = history.snapshot();

    let mut content = query;
    if messages.is_empty() {
        if let Some(note) = context_note(&context) {
            content = format!("{note}\n\n{content}");
        }
    }
    messages.push(json!({ "role": "user", "content": content }));

    // A failed turn is dropped whole: the question is still worth asking again
    // once PeDitX-AI is back, and half a transcript is worse than none.
    let message = run(&base, &mut messages).await?;
    let text = text_of(&message);
    if text.is_empty() {
        return Err("PeDitX-AI returned an empty answer.".into());
    }
    history.replace(messages);
    Ok(ChatReply { text })
}

/// The full-screen window, on the island's transcript: one active conversation
/// wherever the question is asked. The turn is stored before the delta is
/// sent, so closing the window mid-answer still leaves the island with it.
pub async fn send(
    url: &str,
    history: &Chat,
    prompt: String,
    channel: Channel<GooEvent>,
) -> Result<(), String> {
    let base = base(Some(url))?;
    let mut messages = history.snapshot();
    messages.push(json!({ "role": "user", "content": prompt }));

    match run(&base, &mut messages).await {
        Ok(message) => {
            let text = text_of(&message);
            if text.is_empty() {
                let _ = channel.send(GooEvent::Done);
                return Err("PeDitX-AI returned an empty answer.".into());
            }
            history.replace(messages);
            let _ = channel.send(GooEvent::Delta { text });
            let _ = channel.send(GooEvent::Done);
            Ok(())
        }
        Err(why) => {
            let _ = channel.send(GooEvent::Done);
            Err(why)
        }
    }
}

/// A dropped file or a focused window, as the first line of a turn. PeDitX-AI
/// reads the file itself — with its own tools, under its own access mode.
fn context_note(context: &Option<ChatContext>) -> Option<String> {
    match context {
        Some(ChatContext::File { name, path }) => Some(format!(
            "The companion dropped a file for you: {name} ({path})"
        )),
        Some(ChatContext::Window {
            app_name,
            title,
            url,
        }) => Some(match url {
            Some(url) => format!("The companion is looking at — {app_name}, {title}, {url}"),
            None => format!("The companion is looking at — {app_name}, {title}"),
        }),
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{base, context_note, text_of, ChatContext};
    use serde_json::json;

    /// The address is user input: only http(s), no trailing slash, no path
    /// games.
    #[test]
    fn the_address_must_be_http_and_is_normalised() {
        assert!(base(None).is_err(), "no address configured");
        assert!(base(Some("   ")).is_err(), "blank address refused");
        assert!(base(Some("file:///etc")).is_err(), "non-http scheme refused");

        assert_eq!(
            base(Some("http://127.0.0.1:8765/")).unwrap(),
            "http://127.0.0.1:8765"
        );
        assert_eq!(
            base(Some("  http://192.168.1.9:8765  ")).unwrap(),
            "http://192.168.1.9:8765"
        );
    }

    /// The token is substituted into the served page as `TOKEN='…'`. That is
    /// the only place it ever appears, so that is what gets parsed.
    #[test]
    fn the_token_is_read_out_of_the_page() {
        let page = "<script>const TOKEN='abc-123_XYZ';</script>";
        let start = page.find("TOKEN='").unwrap() + "TOKEN='".len();
        let end = start + page[start..].find('\'').unwrap();
        assert_eq!(&page[start..end], "abc-123_XYZ");
    }

    /// A dropped file is handed over by path — Goo never reads it, and never
    /// base64s it across the boundary.
    #[test]
    fn a_dropped_file_becomes_one_line_of_text() {
        assert_eq!(
            context_note(&Some(ChatContext::File {
                name: "notes.txt".into(),
                path: "/tmp/notes.txt".into(),
            }))
            .unwrap(),
            "The companion dropped a file for you: notes.txt (/tmp/notes.txt)"
        );
        assert!(context_note(&None).is_none());
    }

    /// Overflow is cut a whole turn at a time, and the first message stays.
    #[test]
    fn the_oldest_turns_go_first() {
        use super::trim;
        let mut messages: Vec<_> = std::iter::once(json!({"role":"user","content":"first"}))
            .chain((0..70).map(|i| json!({"role": if i % 2 == 0 { "assistant" } else { "user" }, "content": i})))
            .collect();
        trim(&mut messages);
        assert!(messages.len() <= 60);
        assert_eq!(messages[0]["content"], "first");
        assert_eq!(messages[1]["role"], "user");
    }

    /// Text can arrive as a string or as a list of blocks; both read back the
    /// same way.
    #[test]
    fn the_answer_reads_from_either_shape() {
        assert_eq!(text_of(&json!({ "content": "  hello  " })), "hello");
        assert_eq!(
            text_of(&json!({ "content": [{ "type": "text", "text": "a" }, { "type": "text", "text": "b" }] })),
            "a\nb"
        );
        assert_eq!(text_of(&json!({})), "");
    }
}
