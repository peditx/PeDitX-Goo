// PeDitX-Goo for Linux — app wiring and the commands the island calls.

mod backend;
mod chat;
mod files;
mod hotkey;
mod island;
mod log;
mod settings;
mod tray;

use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use serde_json::Value;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

use backend::GooEvent;
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use chat::{Chat, ChatContext, ChatReply};
use files::DroppedFile;
use island::{PollGate, ScreenInfo};
use settings::Settings;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    let settings = shared.settings.lock().unwrap().clone();
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) -> Result<(), String> {
    if !settings.sound_volume.is_finite() || !(0.0..=0.2).contains(&settings.sound_volume) {
        return Err("Sound volume must be between 0 and 0.2.".into());
    }
    if !settings.auto_close_interval.is_finite()
        || !(5.0..=120.0).contains(&settings.auto_close_interval)
    {
        return Err("Auto-close must be between 5 and 120 seconds.".into());
    }
    if !matches!(settings.screen.as_str(), "primary" | "cursor") {
        return Err("Choose a valid display option.".into());
    }
    backend::validate_address(&settings.backend_url)?;
    hotkey::validate(&settings)?;

    let (screen_changed, autostart_changed, hotkey_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen;
        let autostart_changed = current.autostart != settings.autostart;
        let hotkey_changed = current.hotkey != settings.hotkey
            || current.hotkey_enabled != settings.hotkey_enabled;
        settings::save(&settings).map_err(|err| format!("Settings could not be saved: {err}"))?;
        *current = settings.clone();
        (screen_changed, autostart_changed, hotkey_changed)
    };

    let mut warnings = Vec::new();
    if autostart_changed {
        let manager = app.autolaunch();
        let result = if settings.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            warnings.push(format!("the startup setting could not be applied: {err}"));
        }
    }
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(&app, &settings.screen, collapsed);
    }
    if hotkey_changed {
        if let Err(err) = hotkey::apply(&settings) {
            warnings.push(format!("the shortcut could not be applied: {err}"));
        }
    }
    // Keep the other window in step (island ⇄ settings window).
    let _ = app.emit("settings-changed", settings);
    if warnings.is_empty() {
        Ok(())
    } else {
        Err(format!("Settings were saved, but {}", warnings.join("; ")))
    }
}

/// Hidden island → shrink the window to the invisible wake strip and park the
/// cursor poll; anything else → full panel and 60 Hz polling.
#[tauri::command]
fn set_collapsed(app: AppHandle, shared: State<Shared>, collapsed: bool) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(!collapsed);
    crate::log::line(format!(
        "set_collapsed: {collapsed} -> poll {}", if collapsed { "parked" } else { "running" }
    ));
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
    shared.gate.forget_ignore_state();
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    island::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let pref = shared.settings.lock().unwrap().screen.clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &pref, collapsed);
}

#[tauri::command]
fn open_url(url: String) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    // Arguments, never a shell string: a URL is untrusted input.
    let _ = Command::new("xdg-open").arg(&url).spawn();
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ── Chat ─────────────────────────────────────────────────────────────────────

/// One island turn. The address is read fresh, so a change in Settings applies
/// to the next message; everything else about the answer is PeDitX-AI's.
/// Every window is told afterwards: the transcript is shared, not mirrored.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let url = shared.settings.lock().unwrap().backend_url.clone();
    let out = backend::chat(&url, &chat, query, context).await;
    if out.is_ok() {
        let _ = app.emit("chat-changed", ());
    }
    out
}

/// Every conversation, the active one marked — the island's history, the
/// overview's session list and the full-screen window's tabs all read this.
#[tauri::command]
fn session_list(chat: State<Chat>) -> Value {
    chat.list()
}

/// A fresh conversation. `force` makes one even when the active is empty
/// (the full-screen window's "+"); the island passes false.
#[tauri::command]
fn session_new(app: AppHandle, chat: State<Chat>, force: bool) -> Value {
    let state = chat.new_session(force);
    let _ = app.emit("chat-changed", ());
    state
}

/// Selecting a session anywhere: the island's transcript, the overview's list
/// and the next question all follow it.
#[tauri::command]
fn session_select(app: AppHandle, chat: State<Chat>, id: u64) -> Value {
    let state = chat.select_session(id);
    let _ = app.emit("chat-changed", ());
    state
}

#[tauri::command]
fn session_close(app: AppHandle, chat: State<Chat>, id: u64) -> Value {
    let state = chat.close_session(id);
    let _ = app.emit("chat-changed", ());
    state
}

/// One turn for the full-screen window, on the shared transcript. The answer
/// arrives as one delta; PeDitX-AI does not stream, and pretending otherwise
/// would only shuffle whitespace around on screen.
#[tauri::command]
async fn goo_send(
    app: AppHandle,
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    prompt: String,
    channel: Channel<GooEvent>,
) -> Result<(), String> {
    let url = shared.settings.lock().unwrap().backend_url.clone();
    let out = backend::send(&url, &chat, prompt, channel).await;
    if out.is_ok() {
        let _ = app.emit("chat-changed", ());
    }
    out
}

/// The chat window's empty state. Says "yes" or "no", never which half is
/// missing — the settings window is where that is worked out.
#[tauri::command]
async fn goo_configured(shared: State<'_, Shared>) -> Result<bool, String> {
    let url = shared.settings.lock().unwrap().backend_url.clone();
    backend::reachable(&url).await.map_err(|e| e.to_string())
}

/// PeDitX-AI's own view of itself: its endpoint, its model, its access mode.
/// Read back, never edited here — and the key is reported as present or
/// absent, never as a value.
#[tauri::command]
async fn agent_status(shared: State<'_, Shared>) -> Result<backend::AgentStatus, String> {
    let url = shared.settings.lock().unwrap().backend_url.clone();
    backend::status(&url).await
}

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
fn ingest_file(path: String) -> Result<DroppedFile, String> {
    files::ingest(&path)
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Windows ──────────────────────────────────────────────────────────────────

/// In a dev build the pages are served by Vite, so a second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path(&format!("/{page}"));
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App(page.into())
}

/// Hiding instead of closing, or the window could never be reopened.
fn hide_on_close(win: &tauri::WebviewWindow) {
    let hidden = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
        }
    });
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards.
fn create_settings_window(app: &AppHandle) {
    let url = page_url(app, "settings.html");
    match WebviewWindowBuilder::new(app, "settings", url)
        .title("Settings — PeDitX-Goo")
        .inner_size(560.0, 680.0)
        .min_inner_size(460.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => hide_on_close(&win),
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    // The island's setup does the same: .center() ran while the window was
    // still hidden, and the window manager places it itself on map.
    let _ = win.center();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

/// The full-screen chat. Maximised rather than exclusive-fullscreen: the user
/// can still pull it off the screen edge, which matters on a tiling WM.
fn create_goo_window(app: &AppHandle) {
    let url = page_url(app, "goo.html");
    match WebviewWindowBuilder::new(app, "goo", url)
        .title("PeDitX-Goo")
        .inner_size(1180.0, 780.0)
        .min_inner_size(720.0, 520.0)
        .resizable(true)
        .maximizable(true)
        .maximized(true)
        .visible(false)
        .build()
    {
        Ok(win) => hide_on_close(&win),
        Err(err) => log::line(format!("chat window failed: {err}")),
    }
}

pub fn show_goo_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("goo") else {
        log::line("chat window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    // The island's setup does the same: .center() ran while the window was
    // still hidden, and the window manager places it itself on map.
    let _ = win.center();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_goo_window(app: AppHandle) {
    show_goo_window(&app);
}

pub fn run() {
    let loaded = settings::load();
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Chat::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            set_collapsed,
            set_island_rect,
            focus_window,
            reposition,
            open_url,
            quit_app,
            log_line,
            chat_send,
            session_list,
            session_new,
            session_select,
            session_close,
            goo_send,
            goo_configured,
            agent_status,
            ingest_file,
            open_settings_window,
            open_goo_window,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            create_settings_window(&handle);
            create_goo_window(&handle);

            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win);
                island::apply_geometry(&handle, &loaded.screen, false);
                let _ = win.show();
                // mutter — and most window managers — place a window when it is
                // mapped, so a position asked for before show() is discarded and
                // the island lands wherever the WM chose (the right half of the
                // screen, on GNOME/X11). Ask again now that it is on screen.
                island::apply_geometry(&handle, &loaded.screen, false);
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());

            log::line(format!("--- PeDitX-Goo {} started ---", env!("CARGO_PKG_VERSION")));
            if let Err(err) = hotkey::apply(&loaded) {
                crate::log::line(format!("hotkey settings: {err}"));
            }

            // First run: no endpoint yet, so the window that sets one is the
            // first thing the user sees. It stops happening the moment the
            // address is saved, and never comes back.
            if !backend::configured(&loaded.backend_url) {
                show_settings_window(&handle);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running PeDitX-Goo");
}
