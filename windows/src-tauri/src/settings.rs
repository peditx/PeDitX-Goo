// Preferences, stored as plain JSON in %APPDATA%\PeDitX-Goo\settings.json.
// No secret ever lands here — the endpoint key lives in the Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    /// OpenAI-compatible base URL: `http://192.168.1.1:8765/v1`, 9Router, or a
    /// public gateway. Plain text on purpose — an address is not a secret, and
    /// hiding it would make a mistyped IP invisible. The key beside it is a
    /// secret and never lands in this file. Empty = not configured.
    #[serde(default)]
    pub backend_url: String,
    /// Model sent with every turn. Empty until Settings fills it from
    /// `GET /models` — a gateway's model list is not something to guess.
    /// Explicitly defaulted so a settings.json written by an older build loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Global shortcut that reveals the island, written as `Ctrl+Shift+N`.
    /// Written into the desktop's own shortcut registry — see `hotkey.rs`.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// Whether the desktop is holding that shortcut for us.
    /// Off by default: a global shortcut steals the keys from every other app.
    #[serde(default)]
    pub hotkey_enabled: bool,
}

fn default_model() -> String {
    crate::chat::DEFAULT_MODEL.to_string()
}

fn default_hotkey() -> String {
    "Ctrl+Shift+N".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            screen: "primary".into(),
            autostart: false,
            backend_url: String::new(),
            model: default_model(),
            hotkey: default_hotkey(),
            hotkey_enabled: false,
        }
    }
}

/// %APPDATA%\PeDitX-Goo
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("PeDitX-Goo")
}

/// %LOCALAPPDATA%\PeDitX-Goo — where the dropped-file inbox and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("PeDitX-Goo")
}

pub fn home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
