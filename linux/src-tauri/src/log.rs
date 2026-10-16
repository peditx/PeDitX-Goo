// Small append-only log at $XDG_STATE_HOME/peditx-goo/goo.log — the Linux
// equivalent of nbLog() in HookServer.swift. Nothing leaves the machine.

use std::io::Write;

use crate::settings;

/// Local time split out for the two formats we need (log line, backup stamp).
/// libc keeps us off chrono just for this.
pub(crate) fn local_parts() -> (i32, i32, i32, i32, i32, i32) {
    unsafe {
        let now = libc::time(std::ptr::null_mut());
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&now, &mut tm).is_null() {
            return (1970, 1, 1, 0, 0, 0);
        }
        (
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
        )
    }
}

pub fn line(message: impl AsRef<str>) {
    let (y, mo, d, h, mi, s) = local_parts();
    let stamp = format!("{y:04}-{mo:02}-{d:02} {h:02}:{mi:02}:{s:02}");
    let dir = settings::local_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("goo.log");
    // Keep it from growing forever: start fresh past ~1 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{stamp} {}", message.as_ref());
    }
}
