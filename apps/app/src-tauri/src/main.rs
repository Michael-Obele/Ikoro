#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Prevents an extra console window on Windows in release builds.
fn main() {
    ikoro_lib::run()
}