//! Linux desktop alarm scheduling, via systemd **user** timers.
//!
//! # Why systemd at all
//!
//! Tauri's official notification plugin cannot schedule on desktop. Its reference
//! says, verbatim: *"Scheduling is only supported on mobile; desktop
//! notifications are always shown immediately."* `pending()` is mobile-only and
//! there is no cancel API (upstream: plugins-workspace#2141, open since 2022). So
//! the plugin can only *show* a notification immediately — it is not a scheduler.
//!
//! We need a scheduler the operating system owns, so an alarm survives the app
//! being closed. On Linux that is `systemd --user`: no root, no polkit prompt,
//! and `Persistent=true` gives boot catch-up for free.
//!
//! # What this file deliberately does NOT do
//!
//! It does not compute the task hash, and it does not build the unit content.
//! Both of those live in TypeScript (`src/lib/alarms/systemd.ts`), where the
//! rules — especially systemd's `%`-escaping — can be unit-tested without
//! compiling Rust. The build plan had both languages implement them and share a
//! fixed test vector; that is two implementations of the same escaping rules, and
//! a drift between them means an alarm that cancels the wrong unit, or a unit
//! file that will not load at all.
//!
//! This file is therefore a thin, auditable wrapper over `systemctl` and the
//! filesystem. It receives finished, already-escaped text and puts it in the
//! right place.

use std::fs;
use std::path::PathBuf;
use std::process::Command;

const UNIT_DIR: &str = ".config/systemd/user";
const STATE_DIR: &str = ".local/state/ikoro/fired";

/// One-shot probe: can this machine schedule alarms that outlive the app?
#[derive(serde::Serialize)]
pub struct Probe {
    /// `systemd` when the user manager is usable, else the in-process fallback.
    pub mode: String,
    pub systemd: bool,
    pub notify_send: bool,
    /// False means alarms stop when the user logs out.
    pub linger: bool,
    /// One sentence, shown verbatim in Settings.
    pub detail: String,
    /// The resolved home directory, so JS can build absolute stamp paths.
    pub home: String,
}

/// Run a command, returning (success, stdout+stderr).
fn run(program: &str, args: &[&str]) -> (bool, String) {
    match Command::new(program).args(args).output() {
        Ok(out) => {
            let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&out.stderr));
            (out.status.success(), text)
        }
        Err(err) => (false, format!("{program}: {err}")),
    }
}

fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

fn unit_dir() -> PathBuf {
    PathBuf::from(home_dir()).join(UNIT_DIR)
}

/// Whether `systemctl --user` can actually schedule anything right now.
///
/// `is-system-running` returns `running` OR `degraded`. Both are usable: a
/// degraded manager still arms timers, and treating it as unusable would strip
/// real alarm capability from anyone with one unrelated failed unit on their
/// machine.
fn user_systemd_usable() -> bool {
    let (ok, out) = run("systemctl", &["--user", "is-system-running"]);
    if !ok {
        return false;
    }
    let state = out.trim();
    state == "running" || state == "degraded"
}

fn notify_send_available() -> bool {
    PathBuf::from("/usr/bin/notify-send").exists()
}

fn has_linger() -> bool {
    let user = std::env::var("USER").unwrap_or_default();
    let (ok, out) = run("loginctl", &["show-user", &user]);
    ok && out.lines().any(|line| line.trim() == "Linger=yes")
}

/// Probe the machine. Never throws: a failed probe means the fallback, not a crash.
#[tauri::command]
pub fn alarm_probe() -> Probe {
    let systemd = user_systemd_usable();
    let notify_send = notify_send_available();
    let linger = has_linger();
    let usable = systemd && notify_send;

    let detail = if usable {
        "Alarms are scheduled by the system — they fire even when Ikoro is closed.".to_string()
    } else if !systemd {
        "No systemd user session on this machine, so alarms are not scheduled by the system. \
         Ikoro must be running to remind you."
            .to_string()
    } else {
        "notify-send is missing, so alarms are not scheduled by the system. Ikoro must be \
         running to remind you."
            .to_string()
    };

    Probe {
        mode: if usable { "systemd" } else { "timer" }.to_string(),
        systemd,
        notify_send,
        linger,
        detail,
        home: home_dir(),
    }
}

/// Write both units, reload, and start the timer.
///
/// `service` and `timer` are finished, already-escaped unit file contents built
/// by TypeScript. This function never sees a task title, so there is nothing
/// here that can be injected through one.
#[tauri::command]
pub fn alarm_arm(hash: String, service: String, timer: String) -> Result<String, String> {
    validate_hash(&hash)?;

    let dir = unit_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {dir:?}: {e}"))?;

    let service_path = dir.join(format!("ikoro-{hash}.service"));
    let timer_path = dir.join(format!("ikoro-{hash}.timer"));

    fs::write(&service_path, service).map_err(|e| format!("cannot write {service_path:?}: {e}"))?;
    fs::write(&timer_path, timer).map_err(|e| format!("cannot write {timer_path:?}: {e}"))?;

    let (ok, out) = run("systemctl", &["--user", "daemon-reload"]);
    if !ok {
        return Err(format!("daemon-reload failed: {out}"));
    }

    // Restart, not start: re-arming an already-armed alarm must replace it, and
    // `start` on a loaded timer is a no-op.
    let (ok, out) = run("systemctl", &["--user", "restart", &format!("ikoro-{hash}.timer")]);
    if !ok {
        return Err(format!("could not start the timer: {out}"));
    }

    Ok(format!("systemd:{hash}"))
}

/// Stop the timer and remove both unit files.
///
/// Idempotent by construction: `systemctl stop` on a timer that was never
/// created is a non-zero exit we deliberately ignore, and removing a file that is
/// already gone is not an error. Cancelling an alarm that does not exist must
/// succeed, because the UI does this on every reconcile.
#[tauri::command]
pub fn alarm_cancel(hash: String) -> Result<(), String> {
    validate_hash(&hash)?;

    let service = format!("ikoro-{hash}.service");
    let timer = format!("ikoro-{hash}.timer");

    // Best-effort; a missing unit is the normal case, not a failure.
    run("systemctl", &["--user", "stop", &timer]);
    run("systemctl", &["--user", "disable", &timer]);

    let dir = unit_dir();
    let _ = fs::remove_file(dir.join(&service));
    let _ = fs::remove_file(dir.join(&timer));

    run("systemctl", &["--user", "daemon-reload"]);
    Ok(())
}

/// Every `ikoro-*` timer the user manager currently knows about.
#[tauri::command]
pub fn alarm_list() -> Result<Vec<String>, String> {
    let (ok, out) = run(
        "systemctl",
        &["--user", "list-timers", "--all", "--no-legend", "--plain"],
    );
    if !ok {
        // An unusable user manager means "nothing is armed", not "throw". A
        // reconcile that crashes here would leave every alarm silently un-armed.
        return Ok(Vec::new());
    }

    Ok(out.lines()
        .filter_map(|line| {
            let unit = line.split_whitespace().last()?;
            unit.strip_prefix("ikoro-")?.strip_suffix(".timer").map(str::to_string)
        })
        .collect())
}

/// Hashes whose stamp file exists — i.e. alarms the OS actually delivered.
#[tauri::command]
pub fn alarm_stamps() -> Result<Vec<String>, String> {
    let dir = PathBuf::from(home_dir()).join(STATE_DIR);
    let entries = match fs::read_dir(&dir) {
        Ok(entries) => entries,
        // No state directory means nothing has ever fired. Not an error.
        Err(_) => return Ok(Vec::new()),
    };

    Ok(entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .collect())
}

/// Clear fired-stamps. Used by "I have dealt with these" after a miss is shown.
#[tauri::command]
pub fn alarm_clear_stamps() -> Result<(), String> {
    let dir = PathBuf::from(home_dir()).join(STATE_DIR);
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.filter_map(Result::ok) {
            let _ = fs::remove_file(entry.path());
        }
    }
    Ok(())
}

/// A hash arrives from the webview and becomes part of a FILENAME.
///
/// Reject anything that is not a plain 32-bit decimal. This is not paranoia
/// about the app's own code — it is the boundary between a webview and a path,
/// and `../../` in a unit name would write outside the user's systemd directory.
fn validate_hash(hash: &str) -> Result<(), String> {
    if hash.is_empty() || hash.len() > 20 || !hash.chars().all(|c| c.is_ascii_digit()) {
        return Err(format!("not a valid alarm hash: {hash:?}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::validate_hash;

    #[test]
    fn accepts_a_decimal_hash() {
        assert!(validate_hash("1234567890").is_ok());
    }

    #[test]
    fn rejects_path_traversal() {
        assert!(validate_hash("../../etc/passwd").is_err());
        assert!(validate_hash("123; rm -rf /").is_err());
        assert!(validate_hash("").is_err());
        assert!(validate_hash("abc").is_err());
    }
}