//! Ikoro desktop shell.
//!
//! Thin by design: the window, the notification plugin, and the six alarm
//! commands in `alarms.rs`. Everything about *what* an alarm is lives in
//! TypeScript, where it can be tested without a Rust toolchain.

mod alarms;

use tauri_plugin_notification::init as init_notifications;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
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