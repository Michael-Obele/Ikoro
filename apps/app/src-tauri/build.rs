fn main() {
    // Plain and boring on purpose: it validates tauri.conf.json and emits the
    // context and capability schemas. Every extra attribute here is another API
    // to guess at, and none of them buy anything for this app.
    tauri_build::build()
}
