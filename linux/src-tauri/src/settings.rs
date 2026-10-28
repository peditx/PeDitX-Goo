// Preferences, stored as plain JSON in $XDG_CONFIG_HOME/peditx-goo/settings.json.
// No secret ever lands here — the endpoint key lives in the Secret Service.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    /// Where PeDitX-AI is listening — `http://127.0.0.1:8765` unless the user
    /// moved it. Goo has no endpoint, no key and no model of its own; this is
    /// the address of the agent it is the face of. Plain text on purpose: an
    /// address is not a secret, and hiding it would make a mistype invisible.
    /// Empty = not configured.
    #[serde(default)]
    pub backend_url: String,
    /// Global shortcut that reveals the island, written as `Ctrl+Shift+N`.
    /// Written into the desktop's own shortcut registry — see `hotkey.rs`.
    #[serde(default = "default_hotkey")]
    pub hotkey: String,
    /// Whether the desktop is holding that shortcut for us.
    /// Off by default: a global shortcut steals the keys from every other app.
    #[serde(default)]
    pub hotkey_enabled: bool,
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
            // PeDitX-AI is installed next door and listens here by default.
            backend_url: crate::backend::DEFAULT_AGENT.into(),
            hotkey: default_hotkey(),
            hotkey_enabled: false,
        }
    }
}

/// `$XDG_CONFIG_HOME/peditx-goo` (defaults to `~/.config/peditx-goo`).
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("XDG_CONFIG_HOME") {
        return PathBuf::from(dir).join("peditx-goo");
    }
    home().join(".config").join("peditx-goo")
}

/// `$XDG_STATE_HOME/peditx-goo` (defaults to `~/.local/state/peditx-goo`) —
/// where the dropped-file inbox and the log live.
pub fn local_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("XDG_STATE_HOME") {
        return PathBuf::from(dir).join("peditx-goo");
    }
    home().join(".local").join("state").join("peditx-goo")
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
        Ok(bytes) => {
            let mut settings: Settings = serde_json::from_slice(&bytes).unwrap_or_default();
            // Up to 0.1.12 this field held the *model* endpoint, so a value
            // with a model path in it is left over from the old meaning. Using
            // it as PeDitX-AI's address would fail with a confusing error, so
            // it goes back to the default instead.
            let url = settings.backend_url.trim_end_matches('/');
            if url.ends_with("/v1") || url.ends_with("/chat/completions") {
                settings.backend_url = crate::backend::DEFAULT_AGENT.into();
            }
            settings
        }
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
