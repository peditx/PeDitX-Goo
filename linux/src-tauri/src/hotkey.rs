// The global shortcut lives in the desktop's registry, not in our process.
//
// GNOME/Wayland offers a client no way to ask for a key: XGrabKey never fires
// under XWayland, and this desktop ships no org.freedesktop.portal.
// GlobalShortcuts. So we write a custom keybinding into
// org.gnome.settings-daemon.plugins.media-keys and let gsd-media-keys — which
// does hold the grab — run the binary a second time; single-instance turns that
// launch into "reveal the island".
//
// ponytail: GNOME only. Any other desktop gets one log line and keeps the tray
// as the way in. Upgrade path: the GlobalShortcuts portal, when a shipped
// desktop offers it.

use std::process::Command;

use crate::log;
use crate::settings::Settings;

const SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys";
const ITEM_SCHEMA: &str = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";
const PATH: &str = "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/peditx-goo/";
const OURS: &str = "PeDitX-Goo";

fn item() -> String {
    format!("{ITEM_SCHEMA}:{PATH}")
}

/// `gsettings get|set|reset` — the same writer GNOME Settings uses, no new
/// dependency. `None` means the desktop could not be asked at all.
fn gsettings(args: &[&str]) -> Option<String> {
    let out = Command::new("gsettings").args(args).output().ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn item_get(key: &str) -> Option<String> {
    gsettings(&["get", &item(), key])
}

fn item_set(key: &str, value: &str) -> bool {
    // gsettings parses every value as GVariant text, so a string needs quotes.
    gsettings(&["set", &item(), key, &format!("'{value}'")]).is_some()
}

/// `['/path/a/', '/path/b/']` → the paths inside it.
fn paths(raw: &str) -> Vec<String> {
    raw.split('\'')
        .skip(1)
        .step_by(2)
        .map(str::to_string)
        .collect()
}

fn list_variant(paths: &[String]) -> String {
    let items: Vec<String> = paths.iter().map(|p| format!("'{p}'")).collect();
    format!("[{}]", items.join(", "))
}

fn gnome_session() -> bool {
    let desktop = ["XDG_CURRENT_DESKTOP", "DESKTOP_SESSION", "GDMSESSION"]
        .iter()
        .filter_map(|k| std::env::var(k).ok())
        .collect::<Vec<_>>()
        .join(":")
        .to_ascii_lowercase();
    desktop.contains("gnome") || desktop.contains("ubuntu") || desktop.contains("unity")
}

/// "Ctrl+Shift+N" → `<Control><Shift>n`, the form gsettings stores.
/// Needs at least one modifier: a bare key would be stolen from every app.
fn accel(src: &str) -> Option<String> {
    let mut mods: Vec<&str> = Vec::new();
    let mut key: Option<String> = None;
    for token in src.split('+').map(str::trim).filter(|t| !t.is_empty()) {
        let m = match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => "Control",
            "alt" | "option" => "Alt",
            "shift" => "Shift",
            "super" | "win" | "meta" | "cmd" => "Super",
            _ => "",
        };
        if !m.is_empty() {
            if !mods.contains(&m) {
                mods.push(m);
            }
        } else if key.replace(keysym(token)?).is_some() {
            return None; // two non-modifier keys
        }
    }
    let key = key?;
    if mods.is_empty() {
        return None;
    }
    let head: String = mods.iter().map(|m| format!("<{m}>")).collect();
    Some(format!("{head}{key}"))
}

fn keysym(token: &str) -> Option<String> {
    if token.len() == 1 && token.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Some(token.to_ascii_lowercase());
    }
    let upper = token.to_ascii_uppercase();
    if let Some(n) = upper
        .strip_prefix('F')
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .and_then(|n| n.parse::<u32>().ok())
    {
        return (1..=12).contains(&n).then(|| format!("F{n}"));
    }
    Some(
        match upper.as_str() {
            "SPACE" => "space",
            "ENTER" | "RETURN" => "Return",
            "TAB" => "Tab",
            "ESC" | "ESCAPE" => "Escape",
            "BACKSPACE" => "BackSpace",
            "UP" => "Up",
            "DOWN" => "Down",
            "LEFT" => "Left",
            "RIGHT" => "Right",
            _ => return None,
        }
        .to_string(),
    )
}

fn our_exe() -> Option<String> {
    Some(
        std::env::current_exe()
            .ok()?
            .to_string_lossy()
            .trim_start_matches("file://")
            .to_string(),
    )
}

/// gsd-media-keys is the only process that can hold the key, and it is not
/// D-Bus activatable: if it died, the binding we write is never grabbed until
/// the next login. Worth saying out loud rather than failing silently.
fn grabber_running() -> bool {
    Command::new("gdbus")
        .args([
            "call",
            "--session",
            "--dest",
            "org.gnome.SettingsDaemon.MediaKeys",
            "--object-path",
            "/org/gnome/SettingsDaemon/MediaKeys",
            "--method",
            "org.freedesktop.DBus.Peer.Ping",
        ])
        .output()
        .map(|out| out.status.success())
        .unwrap_or(false)
}

/// Make the desktop hold exactly the shortcut the settings ask for — or none.
/// Reads before writing, so an unchanged setup costs two `gsettings` calls.
pub fn apply(settings: &Settings) {
    if !gnome_session() {
        if settings.hotkey_enabled {
            log::line("hotkey: no GNOME session — open the island from the tray instead");
        }
        return;
    }
    let Some(raw) = gsettings(&["get", SCHEMA, "custom-keybindings"]) else {
        log::line("hotkey: gsettings is unavailable — open the island from the tray instead");
        return;
    };
    let mut list = paths(&raw);
    let present = list.iter().any(|p| p == PATH);

    let wanted = match (settings.hotkey_enabled, accel(&settings.hotkey)) {
        (false, _) => None,
        (true, None) => {
            log::line(format!(
                "hotkey: \"{}\" is not a shortcut (try Ctrl+Shift+N)",
                settings.hotkey
            ));
            None
        }
        (true, Some(a)) => Some(a),
    };

    match wanted {
        None => {
            if !present {
                return;
            }
            list.retain(|p| p != PATH);
            gsettings(&["set", SCHEMA, "custom-keybindings", &list_variant(&list)]);
            for key in ["name", "binding", "command"] {
                gsettings(&["reset", &item(), key]);
            }
            log::line("hotkey: released");
        }
        Some(accel) => {
            let Some(exe) = our_exe() else {
                log::line("hotkey: cannot find our own binary");
                return;
            };
            let held = item_get("binding") == Some(format!("'{accel}'"))
                && item_get("command") == Some(format!("'{exe}'"));
            if present && held {
                return;
            }
            // Keys first, then the list: gsd-media-keys reads the keys the
            // moment a path appears, and dies if they are not there yet.
            if !grabber_running() {
                log::line(
                    "hotkey: GNOME's key grabber is not running — log out and back in for it to fire",
                );
            }
            item_set("name", OURS);
            item_set("binding", &accel);
            item_set("command", &exe);
            if !present {
                list.push(PATH.to_string());
                gsettings(&["set", SCHEMA, "custom-keybindings", &list_variant(&list)]);
            }
            log::line(format!("hotkey: {accel} runs {exe}"));
        }
    }
}
