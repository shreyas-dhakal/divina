//! Native screenshot of the preview frame (WKWebView takeSnapshot on macOS). In-page capture
//! can't render cross-origin styles into a canvas, so MCP `screenshot_frame` uses this first.

use tokio::sync::oneshot;

/// PNG data URL of the host webview region `x,y,width,height` (CSS px), resampled to `out_width` px wide.
#[tauri::command]
pub async fn snapshot_frame(
    window: tauri::WebviewWindow,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    out_width: f64,
) -> Result<String, String> {
    let (tx, rx) = oneshot::channel();
    window
        .with_webview(move |wv| imp::take(wv, (x, y, width, height), out_width, tx))
        .map_err(|e| e.to_string())?;
    rx.await.map_err(|_| "snapshot dropped".to_string())?
}

#[cfg(target_os = "macos")]
mod imp {
    use base64::Engine;
    use block2::RcBlock;
    use objc2::{MainThreadMarker, rc::Retained};
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError, NSNumber, NSPoint, NSRect, NSSize};
    use objc2_web_kit::{WKSnapshotConfiguration, WKWebView};
    use std::sync::Mutex;

    type Tx = tokio::sync::oneshot::Sender<Result<String, String>>;

    pub fn take(wv: tauri::webview::PlatformWebview, (x, y, w, h): (f64, f64, f64, f64), out_width: f64, tx: Tx) {
        let tx = Mutex::new(Some(tx));
        let send = move |r| {
            if let Some(tx) = tx.lock().unwrap().take() {
                let _ = tx.send(r);
            }
        };
        let Some(mtm) = MainThreadMarker::new() else { return send(Err("not on main thread".into())) };
        // SAFETY: on macOS `inner()` is the live WKWebView, and we are on the main thread.
        let webview: &WKWebView = unsafe { &*(wv.inner() as *const WKWebView) };
        let config = unsafe { WKSnapshotConfiguration::new(mtm) };
        unsafe {
            config.setRect(NSRect::new(NSPoint::new(x, y), NSSize::new(w, h)));
            config.setSnapshotWidth(Some(&NSNumber::new_f64(out_width)));
        }
        let block = RcBlock::new(move |image: *mut NSImage, err: *mut NSError| {
            let result = match unsafe { image.as_ref() } {
                Some(image) => png(image).ok_or_else(|| "could not encode snapshot".into()),
                None => Err(unsafe { err.as_ref() }.map_or("snapshot failed".into(), |e| e.localizedDescription().to_string())),
            };
            send(result);
        });
        unsafe { webview.takeSnapshotWithConfiguration_completionHandler(Some(&config), &block) };
    }

    fn png(image: &NSImage) -> Option<String> {
        let tiff = image.TIFFRepresentation()?;
        let rep: Retained<NSBitmapImageRep> = NSBitmapImageRep::imageRepWithData(&tiff)?;
        let data = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) }?;
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(data.to_vec())))
    }
}

#[cfg(not(target_os = "macos"))]
mod imp {
    pub fn take(_: tauri::webview::PlatformWebview, _: (f64, f64, f64, f64), _: f64, tx: tokio::sync::oneshot::Sender<Result<String, String>>) {
        let _ = tx.send(Err("native snapshot is macOS-only; using in-page capture".into()));
    }
}
