//! Reverse proxy in front of the dev server: injects the overlay into HTML, serves the overlay
//! bundle, passes everything else (including HMR websockets) through untouched.

use http_body_util::{BodyExt, Full, combinators::BoxBody};
use hyper::body::{Bytes, Incoming};
use hyper::header::{ACCEPT_ENCODING, CONTENT_LENGTH, CONTENT_TYPE, HOST, TRANSFER_ENCODING, UPGRADE};
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use std::sync::Mutex;
use tokio::net::{TcpListener, TcpStream};

pub const OVERLAY_PATH: &str = "/__divina/overlay.js";
const OVERLAY_TAG: &str = r#"<script src="/__divina/overlay.js"></script>"#;
const OVERLAY_FILE: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../overlay/dist/divina-overlay.js");

/// Debug builds read the overlay at request time (rebuild it without restarting the app);
/// release builds embed it, so the app never depends on the source tree.
fn overlay_js() -> std::io::Result<Vec<u8>> {
    #[cfg(debug_assertions)]
    return std::fs::read(OVERLAY_FILE);
    #[cfg(not(debug_assertions))]
    return Ok(include_bytes!("../../overlay/dist/divina-overlay.js").to_vec());
}

type Body = BoxBody<Bytes, hyper::Error>;

struct State {
    port: Option<u16>,
    /// Dev server `host:port` and the URL the frame should load, while running.
    target: Option<(String, String)>,
}

static STATE: Mutex<State> = Mutex::new(State { port: None, target: None });

/// Points the proxy at the dev server `url` (binding a free port on first use); returns the proxy URL.
pub async fn start(url: &str) -> Result<String, String> {
    let rest = url.strip_prefix("http://").ok_or("dev server URL must be http://")?;
    let (authority, path) = rest.split_at(rest.find('/').unwrap_or(rest.len()));
    let port = STATE.lock().unwrap().port;
    let port = match port {
        Some(p) => p,
        None => {
            let listener = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
            let p = listener.local_addr().map_err(|e| e.to_string())?.port();
            tauri::async_runtime::spawn(serve(listener));
            STATE.lock().unwrap().port = Some(p);
            p
        }
    };
    let proxy = format!("http://127.0.0.1:{port}{path}");
    STATE.lock().unwrap().target = Some((authority.to_string(), proxy.clone()));
    Ok(proxy)
}

pub fn clear() {
    STATE.lock().unwrap().target = None;
}

/// URL of the overlay-injecting proxy in front of the running dev server.
#[tauri::command]
pub fn proxy_url() -> Result<String, String> {
    STATE.lock().unwrap().target.as_ref().map(|t| t.1.clone()).ok_or_else(|| "dev server not running".into())
}

async fn serve(listener: TcpListener) {
    while let Ok((stream, _)) = listener.accept().await {
        tauri::async_runtime::spawn(async move {
            let svc = hyper::service::service_fn(handle);
            let _ = hyper::server::conn::http1::Builder::new()
                .serve_connection(TokioIo::new(stream), svc)
                .with_upgrades()
                .await;
        });
    }
}

async fn handle(req: Request<Incoming>) -> Result<Response<Body>, hyper::Error> {
    if req.uri().path() == OVERLAY_PATH {
        return Ok(match overlay_js() {
            Ok(js) => Response::builder()
                .header(CONTENT_TYPE, "text/javascript")
                .header("cache-control", "no-store")
                .body(full(js))
                .unwrap(),
            Err(_) => text(StatusCode::NOT_FOUND, "overlay not built: run `pnpm -C overlay build`"),
        });
    }
    let authority = STATE.lock().unwrap().target.as_ref().map(|t| t.0.clone());
    let Some(authority) = authority else {
        return Ok(text(StatusCode::BAD_GATEWAY, "dev server not running"));
    };
    // Library thumbnails (.divina/preview.html) are not editable pages.
    let overlay = !req.uri().path().starts_with("/.divina/");
    match forward(req, &authority, overlay).await {
        Ok(r) => Ok(r),
        Err(e) => Ok(text(StatusCode::BAD_GATEWAY, &format!("proxy: {e}"))),
    }
}

async fn forward(mut req: Request<Incoming>, authority: &str, overlay: bool) -> Result<Response<Body>, String> {
    // ponytail: one upstream connection per request; pool if page loads get slow.
    let stream = TcpStream::connect(authority).await.map_err(|e| e.to_string())?;
    let (mut sender, conn) = hyper::client::conn::http1::handshake(TokioIo::new(stream)).await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn(conn.with_upgrades());

    let client_upgrade = req.headers().contains_key(UPGRADE).then(|| hyper::upgrade::on(&mut req));
    req.headers_mut().insert(HOST, authority.parse().map_err(|_| "bad host")?);
    req.headers_mut().remove(ACCEPT_ENCODING); // keep HTML uncompressed so it can be rewritten
    let mut resp = sender.send_request(req).await.map_err(|e| e.to_string())?;

    if resp.status() == StatusCode::SWITCHING_PROTOCOLS {
        let (Some(client), upstream) = (client_upgrade, hyper::upgrade::on(&mut resp)) else {
            return Err("unexpected upgrade".into());
        };
        tauri::async_runtime::spawn(async move {
            if let (Ok(a), Ok(b)) = tokio::join!(client, upstream) {
                let _ = tokio::io::copy_bidirectional(&mut TokioIo::new(a), &mut TokioIo::new(b)).await;
            }
        });
        return Ok(resp.map(|_| Full::new(Bytes::new()).map_err(|e| match e {}).boxed()));
    }

    let is_html = resp.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("text/html"));
    if !is_html || !overlay {
        return Ok(resp.map(|b| b.boxed()));
    }
    let (mut parts, body) = resp.into_parts();
    let html = body.collect().await.map_err(|e| e.to_string())?.to_bytes();
    let html = inject(&String::from_utf8_lossy(&html));
    parts.headers.remove(TRANSFER_ENCODING); // body is now buffered (Next.js streams HTML chunked)
    parts.headers.insert(CONTENT_LENGTH, html.len().into());
    Ok(Response::from_parts(parts, full(html)))
}

/// Inserts the overlay script before `</head>` (or at the start when there is no head).
fn inject(html: &str) -> String {
    let at = html.to_ascii_lowercase().find("</head>").unwrap_or(0);
    format!("{}{OVERLAY_TAG}{}", &html[..at], &html[at..])
}

fn full(b: impl Into<Bytes>) -> Body {
    Full::new(b.into()).map_err(|e| match e {}).boxed()
}

fn text(status: StatusCode, msg: &str) -> Response<Body> {
    Response::builder().status(status).header(CONTENT_TYPE, "text/plain").body(full(msg.to_string())).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn injects_before_head_close() {
        assert_eq!(inject("<html><HEAD><title>x</title></HEAD><body></body>"),
            format!("<html><HEAD><title>x</title>{OVERLAY_TAG}</HEAD><body></body>"));
        assert_eq!(inject("<p>hi</p>"), format!("{OVERLAY_TAG}<p>hi</p>"));
    }

    #[tokio::test]
    async fn proxies_and_injects_html() {
        let upstream = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let up = upstream.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut s, _) = upstream.accept().await.unwrap();
            let mut buf = [0u8; 1024];
            let _ = s.read(&mut buf).await;
            let body = "<html><head></head><body>ok</body></html>";
            // chunked, like Next.js streaming
            let resp = format!("HTTP/1.1 200 OK\r\ncontent-type: text/html\r\ntransfer-encoding: chunked\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len());
            s.write_all(resp.as_bytes()).await.unwrap();
        });
        let proxy = start(&format!("http://{up}/")).await.unwrap();
        let mut c = TcpStream::connect(proxy.trim_start_matches("http://").trim_end_matches('/')).await.unwrap();
        c.write_all(b"GET / HTTP/1.1\r\nhost: x\r\nconnection: close\r\n\r\n").await.unwrap();
        let mut out = String::new();
        c.read_to_string(&mut out).await.unwrap();
        assert!(out.contains(&format!("{OVERLAY_TAG}</head>")), "{out}");
    }
}
