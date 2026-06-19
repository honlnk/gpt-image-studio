// Desktop shell for GPT Image Studio.
//
// The shell is intentionally minimal: it only boots a window that loads the
// existing Vue web app. All product logic lives in the frontend (under `src/`)
// and talks to IndexedDB / the optional external companion exactly as it does
// in the browser. No Rust commands are exposed in the first version.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| Ok(()))
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
