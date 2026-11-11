/// URL of the overlay-injecting proxy in front of the running dev server.
#[tauri::command]
pub fn proxy_url() -> Result<String, String> {
    Err("unimplemented".into())
}
