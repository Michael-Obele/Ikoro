//! Ikoro desktop shell.
//!
//! Thin by design: the window, the notification plugin, and the six alarm
//! commands in `alarms.rs`. Everything about *what* an alarm is lives in
//! TypeScript, where it can be tested without a Rust toolchain.
//!
//! DESKTOP ONLY, deliberately. The Android build ships through Capacitor from
//! the same SvelteKit bundle, so a second native shell for the same app would be
//! two things to keep in step for no user. There is no `mobile` capability file
//! and no `mobile_entry_point` — if someone ever wants Tauri for Android, that
//! is a decision to make once, not a flag to leave lying around.

mod alarms;

use tauri_plugin_notification::init as init_notifications;

pub fn run() {
    tauri::Builder::default()
        .plugin(init_notifications())
        .invoke_handler(tauri::generate_handler![
            alarms::alarm_probe,
            alarms::alarm_arm,
            alarms::alarm_cancel,
            alarms::alarm_list,
            alarms::alarm_stamps,
            alarms::alarm_clear_stamps,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ikoro");
}