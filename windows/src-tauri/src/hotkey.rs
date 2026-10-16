// A global shortcut on Windows is RegisterHotKey: the system holds the key and
// posts WM_HOTKEY to the thread that asked for it, so registration and the
// message pump belong to one dedicated thread started at setup. Settings
// changes reach that loop as a thread message, which also wakes it — no polling.

use std::sync::mpsc::{self, Receiver, Sender};
use std::sync::OnceLock;
use std::thread;

use tauri::{AppHandle, Emitter};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_SHIFT, MOD_WIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetMessageW, PeekMessageW, PostThreadMessageW, TranslateMessage, MSG,
    PM_NOREMOVE, WM_APP, WM_HOTKEY,
};

use crate::island::WINDOW_LABEL;
use crate::log;
use crate::settings::Settings;

const ID: i32 = 1;
/// WM_APP + 1 — "settings changed, re-register", posted to our own thread.
const WM_APPLY: u32 = WM_APP + 1;

struct Port {
    thread: u32,
    tx: Sender<(bool, String)>,
}

static PORT: OnceLock<Port> = OnceLock::new();

/// Open the pump. Returns once the thread can be addressed, so an `update`
/// right after startup cannot be lost.
pub fn start(app: AppHandle, settings: &Settings) {
    // Copy the values out first: the caller's `Settings` may not outlive the
    // setup closure it lives in, and this thread outlives that.
    let initial = (settings.hotkey_enabled, settings.hotkey.clone());
    let (tx, rx) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::channel();
    thread::spawn(move || {
        // A thread owns no message queue until it first asks for one, and
        // PostThreadMessageW needs it to exist before we publish our id.
        let mut scratch = MSG::default();
        unsafe { PeekMessageW(&mut scratch, None, 0, 0, PM_NOREMOVE) };
        let _ = PORT.set(Port {
            thread: unsafe { GetCurrentThreadId() },
            tx,
        });
        let _ = ready_tx.send(());
        run(app, rx, initial);
    });
    let _ = ready_rx.recv();
}

/// Ask the pump thread to hold the shortcut the settings ask for — or none.
pub fn update(settings: &Settings) {
    let Some(port) = PORT.get() else { return };
    if port
        .tx
        .send((settings.hotkey_enabled, settings.hotkey.clone()))
        .is_err()
    {
        return;
    }
    let _ = unsafe {
        PostThreadMessageW(
            port.thread,
            WM_APPLY,
            Default::default(),
            Default::default(),
        )
    };
}

fn run(app: AppHandle, rx: Receiver<(bool, String)>, initial: (bool, String)) {
    let mut held = false;
    let mut current = (false, String::new());
    // Registration belongs to this thread, so every change — including the
    // one the app started with — goes through here.
    let mut apply = |next: (bool, String)| {
        if held {
            let _ = unsafe { UnregisterHotKey(None, ID) };
            held = false;
        }
        if next.0 {
            match accel(&next.1) {
                Some((mods, vk)) => match unsafe { RegisterHotKey(None, ID, mods, vk) } {
                    Ok(()) => {
                        held = true;
                        log::line(format!("hotkey: {} held by the system", next.1));
                    }
                    Err(err) => log::line(format!("hotkey: RegisterHotKey failed: {err}")),
                },
                None => log::line(format!(
                    "hotkey: \"{}\" is not a shortcut (try Ctrl+Shift+N)",
                    next.1
                )),
            }
        } else if current.0 {
            log::line("hotkey: released");
        }
        current = next;
    };

    apply(initial);
    loop {
        // Apply every change queued while the previous GetMessageW slept.
        while let Ok(next) = rx.try_recv() {
            apply(next);
        }

        let mut msg = MSG::default();
        // False only for WM_QUIT: the pump is done.
        if !unsafe { GetMessageW(&mut msg, None, 0, 0) }.as_bool() {
            break;
        }
        if msg.message == WM_HOTKEY {
            let _ = app.emit_to(WINDOW_LABEL, "tray", "open".to_string());
            continue;
        }
        unsafe {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

/// "Ctrl+Shift+N" → the modifier flags and virtual key RegisterHotKey wants.
/// Needs at least one modifier: a bare key would be stolen from every app.
fn accel(src: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut mods = HOT_KEY_MODIFIERS(0);
    let mut vk: Option<u32> = None;
    for token in src.split('+').map(str::trim).filter(|t| !t.is_empty()) {
        match token.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "alt" | "option" => mods |= MOD_ALT,
            "shift" => mods |= MOD_SHIFT,
            "super" | "win" | "meta" | "cmd" => mods |= MOD_WIN,
            _ => {
                if vk.replace(virtual_key(token)?).is_some() {
                    return None; // two non-modifier keys
                }
            }
        }
    }
    if mods.0 == 0 {
        return None;
    }
    Some((mods, vk?))
}

fn virtual_key(token: &str) -> Option<u32> {
    if token.len() == 1 {
        let c = token.chars().next()?;
        if c.is_ascii_alphabetic() {
            return Some(c.to_ascii_uppercase() as u32); // VK_A…VK_Z
        }
        if c.is_ascii_digit() {
            return Some(c as u32); // VK_0…VK_9
        }
    }
    let upper = token.to_ascii_uppercase();
    if let Some(n) = upper
        .strip_prefix('F')
        .filter(|n| !n.is_empty() && n.chars().all(|c| c.is_ascii_digit()))
        .and_then(|n| n.parse::<u32>().ok())
    {
        return (1..=24).contains(&n).then(|| 0x70 + (n - 1)); // VK_F1…
    }
    Some(match upper.as_str() {
        "SPACE" => 0x20,
        "ENTER" | "RETURN" => 0x0D,
        "TAB" => 0x09,
        "ESC" | "ESCAPE" => 0x1B,
        "BACKSPACE" => 0x08,
        "UP" => 0x26,
        "DOWN" => 0x28,
        "LEFT" => 0x25,
        "RIGHT" => 0x27,
        _ => return None,
    })
}
