//! Component discovery (shadcn ui dir, React packages, local components) and the one-line installer.

use crate::protocol::{ComponentSource, DevServerLog, LibraryComponent, LogStream};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Emitter};

/// Emitted per installer output line with a `DevServerLog` payload.
pub const LOG_EVENT: &str = "library://log";

/// Package scan results per project root, keyed by a hash of package.json + lockfile.
static PACKAGE_CACHE: LazyLock<Mutex<HashMap<String, (u64, Vec<LibraryComponent>)>>> =
    LazyLock::new(Default::default);

#[tauri::command(async)]
pub fn list_components(root: String) -> Vec<LibraryComponent> {
    let root = Path::new(&root);
    let pkg = read_json(&root.join("package.json")).unwrap_or(Value::Null);
    let has_dep = |name: &str| ["dependencies", "devDependencies"].iter().any(|k| pkg[k].get(name).is_some());
    // Thumbnails are a page the Vite dev server serves from .divina/; Next.js would need a route in app/.
    let previewable = has_dep("vite") && !has_dep("next");
    let aliases = aliases(root);
    let mut out = Vec::new();
    // importFrom -> specifier mount.tsx can import without the project's aliases.
    let mut specs = BTreeMap::new();

    let ui_dir = shadcn_ui(root, &aliases).map(|(alias, dir)| {
        for file in source_files(&dir, &[], false) {
            let stem = file.file_stem().unwrap().to_string_lossy();
            let import_from = format!("{alias}/{stem}");
            let names = component_exports(&file).0;
            if !names.is_empty() {
                specs.insert(import_from.clone(), root_url(root, &file));
            }
            for name in names {
                out.push(LibraryComponent { name, import_from: import_from.clone(), source: ComponentSource::Shadcn, previewable });
            }
        }
        dir
    });

    out.extend(packages(root, &pkg, previewable));
    for c in out.iter().filter(|c| c.source == ComponentSource::Package) {
        specs.insert(c.import_from.clone(), c.import_from.clone());
    }

    let skip: Vec<PathBuf> = ui_dir.into_iter().collect();
    for dir in ["src", "app", "components"] {
        for file in source_files(&root.join(dir), &skip, true) {
            let rel = file.strip_prefix(root).unwrap().with_extension("");
            let import_from = to_import(&rel.to_string_lossy(), &aliases);
            let names = component_exports(&file).0;
            if !names.is_empty() {
                specs.insert(import_from.clone(), root_url(root, &file));
            }
            for name in names {
                out.push(LibraryComponent { name, import_from: import_from.clone(), source: ComponentSource::Local, previewable });
            }
        }
    }
    if previewable {
        write_preview(root, &specs);
    }
    out
}

/// Root-relative URL of a project file, which Vite serves without alias resolution.
fn root_url(root: &Path, file: &Path) -> String {
    format!("/{}", file.strip_prefix(root).unwrap().to_string_lossy())
}

/// Writes the thumbnail page the Library loads in iframes: `/.divina/preview.html?m=<importFrom>&n=<name>`,
/// and `mount.tsx`, which the overlay also imports to render a dropped component in the page itself.
/// The user's own Vite server transforms them, so components render with the project's React and CSS.
fn write_preview(root: &Path, specs: &BTreeMap<String, String>) {
    let cfg = read_json(&root.join("components.json")).unwrap_or(Value::Null);
    let css = cfg["tailwind"]["css"].as_str().map(str::to_string)
        .or_else(|| ["src/index.css", "src/globals.css", "app/globals.css"].into_iter().find(|f| root.join(f).is_file()).map(str::to_string))
        .map(|f| format!("import {};\n", json_str(&format!("/{}", f.trim_start_matches("./")))))
        .unwrap_or_default();
    let modules: String = specs.iter().map(|(k, v)| format!("  {}: () => import({}),\n", json_str(k), json_str(v))).collect();
    let dir = root.join(".divina");
    let _ = std::fs::create_dir_all(&dir);
    for (name, body) in [
        (".gitignore", "*\n".to_string()),
        ("preview.html", PREVIEW_HTML.to_string()),
        ("preview.tsx", PREVIEW_TSX.replace("/*CSS*/\n", &css)),
        ("mount.tsx", MOUNT_TSX.replace("/*MODULES*/\n", &modules)),
    ] {
        // Unchanged files stay untouched so Vite doesn't reload open previews.
        if std::fs::read_to_string(dir.join(name)).ok().as_deref() != Some(body.as_str()) {
            let _ = std::fs::write(dir.join(name), body);
        }
    }
}

fn json_str(s: &str) -> String {
    serde_json::to_string(s).unwrap()
}

const PREVIEW_HTML: &str = r#"<!doctype html>
<html>
  <head><meta charset="UTF-8" /></head>
  <body style="margin:0;height:100vh;display:grid;place-items:center;overflow:hidden;background:transparent">
    <div id="divina-preview" style="width:max-content;max-width:640px;transform-origin:center"></div>
    <script type="module" src="./preview.tsx"></script>
  </body>
</html>
"#;

const PREVIEW_TSX: &str = r#"// Generated by Divina for component thumbnails. Rewritten whenever the library is listed.
/*CSS*/
import { mount } from "./mount";

const q = new URLSearchParams(location.search);
const [m, n] = [q.get("m") ?? "", q.get("n") ?? ""];
const report = (ok: boolean) => parent.postMessage({ divinaPreview: `${m}#${n}`, ok }, "*");
const el = document.getElementById("divina-preview")!;

mount(el, m, n)
  .then(() => {
    const r = el.getBoundingClientRect();
    el.style.transform = `scale(${Math.min(1, (innerWidth - 12) / r.width, (innerHeight - 12) / r.height)})`;
    report(true);
  })
  .catch(() => report(false));
"#;

// No CSS import here: the overlay loads this into the user's own page, which has its styles already.
const MOUNT_TSX: &str = r#"// Generated by Divina: renders a library component for thumbnails and for drops on the canvas.
// Rewritten whenever the library is listed.
import { Component, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

const modules: Record<string, () => Promise<Record<string, unknown>>> = {
/*MODULES*/
};

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Renders component `n` of module `m` into `el`. Resolves to an unmount once it has a size; rejects if it renders nothing. */
export async function mount(el: HTMLElement, m: string, n: string): Promise<() => void> {
  const mod = await (modules[m]?.() ?? Promise.reject(new Error("unknown module")));
  const C = mod[n] as never;
  const root = createRoot(el);
  // With the name as children first (Button, Badge); void elements like Input reject children.
  root.render(
    createElement(Boundary, { fallback: createElement(Boundary, { fallback: null }, createElement(C)) }, createElement(C, null, n)),
  );
  await new Promise((done) => setTimeout(done, 300));
  // `el` may be `display: contents` (the overlay's), which has no box of its own.
  const r = (el.firstElementChild ?? el).getBoundingClientRect();
  if (!r.width || !r.height) {
    root.unmount();
    throw new Error("rendered nothing");
  }
  return () => root.unmount();
}
"#;

/// Run a one-line install command (e.g. `pnpm dlx shadcn@latest add button`) in the project,
/// streaming output on LOG_EVENT, then return the refreshed component list.
#[tauri::command]
pub async fn run_installer(app: AppHandle, root: String, command: String) -> Result<Vec<LibraryComponent>, String> {
    let command = command.trim().to_string();
    if command.is_empty() || command.contains(['\n', '\r']) {
        return Err("installer takes exactly one non-empty line".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Login shell so a GUI-launched app sees the user's PATH (pnpm, nvm, ...).
        // ponytail: -l reads .zprofile, not .zshrc; switch to -ilc if PATH setup lives in rc files.
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
        let mut child = Command::new(shell)
            .args(["-lc", &command])
            .current_dir(&root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("spawn: {e}"))?;
        let pump = |r: Box<dyn Read + Send>, stream: LogStream| {
            let app = app.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(r).lines().map_while(Result::ok) {
                    let _ = app.emit(LOG_EVENT, DevServerLog { stream, line });
                }
            })
        };
        let pumps = [
            pump(Box::new(child.stdout.take().unwrap()), LogStream::Stdout),
            pump(Box::new(child.stderr.take().unwrap()), LogStream::Stderr),
        ];
        let status = child.wait().map_err(|e| e.to_string())?;
        pumps.into_iter().for_each(|p| drop(p.join()));
        if !status.success() {
            return Err(format!("`{command}` failed ({status})"));
        }
        Ok(list_components(root))
    })
    .await
    .map_err(|e| e.to_string())?
}

fn read_json(path: &Path) -> Option<Value> {
    serde_json::from_str(&strip_jsonc(&std::fs::read_to_string(path).ok()?)).ok()
}

/// Drop comments and trailing commas (tsconfig is JSONC).
fn strip_jsonc(s: &str) -> String {
    let (mut out, mut chars, mut in_str) = (String::new(), s.chars().peekable(), false);
    while let Some(c) = chars.next() {
        if in_str {
            out.push(c);
            match c {
                '\\' => out.extend(chars.next()),
                '"' => in_str = false,
                _ => {}
            }
            continue;
        }
        match (c, chars.peek()) {
            ('"', _) => {
                in_str = true;
                out.push(c);
            }
            ('/', Some('/')) => while chars.next_if(|&c| c != '\n').is_some() {},
            ('/', Some('*')) => {
                chars.next();
                while let Some(c) = chars.next() {
                    if c == '*' && chars.next_if_eq(&'/').is_some() {
                        break;
                    }
                }
            }
            (']' | '}', _) => {
                let trimmed = out.trim_end().len();
                if out[..trimmed].ends_with(',') {
                    out.truncate(trimmed - 1);
                }
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}

/// Import-alias prefix -> project-relative dir prefix, e.g. ("@/", "src/"), from tsconfig/jsconfig paths.
fn aliases(root: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for cfg in ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"] {
        let Some(json) = read_json(&root.join(cfg)) else { continue };
        let opts = &json["compilerOptions"];
        let base = opts["baseUrl"].as_str().unwrap_or(".");
        for (alias, targets) in opts["paths"].as_object().into_iter().flatten() {
            let Some(target) = targets.get(0).and_then(Value::as_str) else { continue };
            let dir = Path::new(base).join(target.trim_end_matches('*'));
            let dir = dir.to_string_lossy().replace("/./", "/");
            let dir = dir.trim_start_matches("./").trim_start_matches('.').trim_start_matches('/');
            out.push((alias.trim_end_matches('*').to_string(), dir.to_string()));
        }
    }
    if out.is_empty() {
        out.push(("@/".into(), if root.join("src").is_dir() { "src/".into() } else { String::new() }));
    }
    out
}

fn to_import(rel: &str, aliases: &[(String, String)]) -> String {
    aliases
        .iter()
        .find_map(|(alias, dir)| Some(format!("{alias}{}", rel.strip_prefix(dir.as_str())?)))
        .unwrap_or_else(|| rel.to_string())
}

/// (ui import alias, ui dir) from components.json.
fn shadcn_ui(root: &Path, aliases: &[(String, String)]) -> Option<(String, PathBuf)> {
    let cfg = read_json(&root.join("components.json"))?;
    let ui = match cfg["aliases"]["ui"].as_str() {
        Some(ui) => ui.to_string(),
        None => format!("{}/ui", cfg["aliases"]["components"].as_str()?),
    };
    let dir = aliases.iter().find_map(|(alias, dir)| Some(format!("{dir}{}", ui.strip_prefix(alias.as_str())?)))?;
    Some((ui, root.join(dir)))
}

/// .tsx/.jsx (and .ts/.js unless `jsx_only`) files under `dir`, skipping node_modules, dot dirs,
/// `skip`, tests/stories and Next.js route files.
fn source_files(dir: &Path, skip: &[PathBuf], jsx_only: bool) -> Vec<PathBuf> {
    const ROUTE_FILES: [&str; 8] = ["page", "layout", "route", "loading", "error", "not-found", "template", "default"];
    let mut out = Vec::new();
    for entry in std::fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || name == "node_modules" || skip.contains(&path) {
            continue;
        }
        if path.is_dir() {
            out.extend(source_files(&path, skip, jsx_only));
            continue;
        }
        let (stem, ext) = name.rsplit_once('.').unwrap_or((&name, ""));
        let exts: &[&str] = if jsx_only { &["tsx", "jsx"] } else { &["tsx", "jsx", "ts", "js"] };
        if exts.contains(&ext)
            && !stem.ends_with(".d")
            && ![".test", ".spec", ".stories"].iter().any(|s| stem.ends_with(s))
            && !ROUTE_FILES.contains(&stem)
        {
            out.push(path);
        }
    }
    out.sort();
    out
}

fn packages(root: &Path, pkg: &Value, previewable: bool) -> Vec<LibraryComponent> {
    let mut hasher = std::hash::DefaultHasher::new();
    for f in ["package.json", "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock", "bun.lockb"] {
        std::fs::read(root.join(f)).ok().hash(&mut hasher);
    }
    let hash = hasher.finish();
    let key = root.to_string_lossy().into_owned();
    if let Some((h, cached)) = PACKAGE_CACHE.lock().unwrap().get(&key) {
        if *h == hash {
            return cached.clone();
        }
    }

    let mut out = Vec::new();
    for dep in pkg["dependencies"].as_object().into_iter().flat_map(|d| d.keys()) {
        if dep == "react" || dep == "react-dom" {
            continue;
        }
        let dir = root.join("node_modules").join(dep);
        let Some(meta) = read_json(&dir.join("package.json")) else { continue };
        let uses_react = ["peerDependencies", "dependencies"].iter().any(|k| meta[k].get("react").is_some());
        let Some(entry) = types_entry(&meta).map(|e| dir.join(e)).filter(|e| e.is_file()) else { continue };
        if !uses_react {
            continue;
        }
        let (mut seen, mut names) = (HashSet::new(), Vec::new());
        collect_dts(&entry, &mut seen, &mut names);
        let mut unique = HashSet::new();
        for name in names.into_iter().filter(|n| unique.insert(n.clone())) {
            out.push(LibraryComponent { name, import_from: dep.clone(), source: ComponentSource::Package, previewable });
        }
    }
    PACKAGE_CACHE.lock().unwrap().insert(key, (hash, out.clone()));
    out
}

/// The package's root type declarations: `types`/`typings`, else the `types` condition of `exports["."]`.
fn types_entry(meta: &Value) -> Option<String> {
    fn find(v: &Value) -> Option<String> {
        match v {
            Value::String(s) if s.ends_with(".d.ts") || s.ends_with(".d.mts") || s.ends_with(".d.cts") => Some(s.clone()),
            Value::Object(o) => o.get("types").and_then(find).or_else(|| o.values().find_map(find)),
            _ => None,
        }
    }
    let exports = &meta["exports"];
    meta["types"].as_str().or(meta["typings"].as_str()).map(str::to_string)
        .or_else(|| find(exports.get(".").unwrap_or(exports)))
        .or_else(|| Some("index.d.ts".into()))
}

/// PascalCase exports of a .d.ts, following relative `export * from` re-exports.
fn collect_dts(file: &Path, seen: &mut HashSet<PathBuf>, names: &mut Vec<String>) {
    // ponytail: file cap keeps huge libs (icons, MUI) cheap; raise if exports go missing.
    if seen.len() >= 300 || !seen.insert(file.to_path_buf()) {
        return;
    }
    let (found, stars) = component_exports(file);
    names.extend(found);
    let dir = file.parent().unwrap();
    for spec in stars.iter().filter(|s| s.starts_with('.')) {
        let base = spec.trim_end_matches(".js").trim_end_matches(".mjs");
        let next = [format!("{base}.d.ts"), format!("{base}.d.mts"), format!("{base}/index.d.ts"), spec.clone()]
            .into_iter()
            .map(|c| dir.join(c))
            .find(|p| p.is_file());
        if let Some(next) = next {
            collect_dts(&next, seen, names);
        }
    }
}

fn component_exports(file: &Path) -> (Vec<String>, Vec<String>) {
    let (names, stars) = exports(&std::fs::read_to_string(file).unwrap_or_default());
    let is_component = |n: &String| {
        n.starts_with(|c: char| c.is_ascii_uppercase()) && n.chars().any(|c| c.is_ascii_lowercase())
            // Type-only/value helpers libraries export beside components (base-ui: AccordionRootDataAttributes).
            && !["Props", "DataAttributes", "CssVariables", "Context", "State", "Config"].iter().any(|s| n.ends_with(s))
    };
    let mut seen = HashSet::new();
    (names.into_iter().filter(|n| is_component(n) && seen.insert(n.clone())).collect(), stars)
}

/// (exported value names, `export * from` specifiers). Heuristic token scan, no real parser.
fn exports(src: &str) -> (Vec<String>, Vec<String>) {
    let is_ident = |c: char| c.is_alphanumeric() || c == '_' || c == '$';
    let first_ident = |s: &str| s.trim_start().split(|c| !is_ident(c)).next().unwrap_or("").to_string();
    let (mut names, mut stars, mut pos) = (Vec::new(), Vec::new(), 0);
    while let Some(off) = src[pos..].find("export") {
        let i = pos + off;
        pos = i + "export".len();
        if src[..i].ends_with(is_ident) || src[pos..].starts_with(is_ident) {
            continue;
        }
        let rest = src[pos..].trim_start();
        if let Some(list) = rest.strip_prefix('{') {
            for item in list[..list.find('}').unwrap_or(0)].split(',').map(str::trim) {
                if !item.starts_with("type ") {
                    names.push(item.rsplit(" as ").next().unwrap().trim().to_string());
                }
            }
        } else if let Some(star) = rest.strip_prefix('*') {
            let star = star.trim_start();
            if let Some(alias) = star.strip_prefix("as ") {
                names.push(first_ident(alias));
            } else if let Some(spec) = star.split(['"', '\'']).nth(1) {
                stars.push(spec.to_string());
            }
        } else {
            let mut words = rest.split(|c| !is_ident(c)).filter(|w| !w.is_empty());
            while let Some(word) = words.next() {
                match word {
                    "default" | "async" | "declare" | "abstract" => continue,
                    "function" | "const" | "let" | "var" | "class" => names.extend(words.next().map(str::to_string)),
                    _ => {}
                }
                break;
            }
        }
    }
    (names, stars)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scans_shadcn_packages_and_local_components() {
        let dir = std::env::temp_dir().join(format!("divina-lib-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let w = |p: &str, s: &str| {
            let p = dir.join(p);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, s).unwrap();
        };
        w("package.json", r#"{"dependencies": {"react": "19", "fancy-ui": "1", "lodash": "4"}, "devDependencies": {"vite": "7"}}"#);
        w("tsconfig.json", "{\n // comment\n \"compilerOptions\": { /* x */ \"paths\": { \"@/*\": [\"./src/*\"], }, },\n}");
        w("components.json", r#"{"aliases": {"components": "@/components", "ui": "@/components/ui"}}"#);
        w("src/components/ui/button.tsx", "function Button() {}\nconst buttonVariants = 1\nexport { Button, buttonVariants }");
        w("src/components/Hero.tsx", "export function Hero() {}\nexport const Card = () => <div/>\nexport const API_URL = ''\n\
            function Inner() {}\nexport { Inner as Wrapped, type HeroProps }\nexport default async function Page() {}");
        w("src/lib/utils.ts", "export function Helper() {}");
        w("src/App.test.tsx", "export function Nope() {}");
        w("app/page.tsx", "export default function Home() {}");
        w("node_modules/fancy-ui/package.json", r#"{"peerDependencies": {"react": "*"}, "exports": {".": {"import": {"types": "./dist/index.d.ts"}}}}"#);
        w("node_modules/fancy-ui/dist/index.d.ts", "export * from './dialog.js';\nexport * as Tabs from './tabs';\nexport declare const Badge: FC;\nexport type { BadgeProps };");
        w("node_modules/fancy-ui/dist/dialog.d.ts", "export declare function Dialog(): JSX.Element;\nexport { DialogProps, DialogRootDataAttributes };");
        w("node_modules/lodash/package.json", r#"{"types": "index.d.ts"}"#);
        w("node_modules/lodash/index.d.ts", "export declare function Chain(): void;");

        let got: Vec<_> = list_components(dir.to_string_lossy().into_owned())
            .into_iter()
            .map(|c| (c.name, c.import_from, c.source))
            .collect();
        let s = |n: &str, f: &str, src| (n.to_string(), f.to_string(), src);
        use ComponentSource::*;
        assert_eq!(got, [
            s("Button", "@/components/ui/button", Shadcn),
            s("Tabs", "fancy-ui", Package),
            s("Badge", "fancy-ui", Package),
            s("Dialog", "fancy-ui", Package),
            s("Hero", "@/components/Hero", Local),
            s("Card", "@/components/Hero", Local),
            s("Wrapped", "@/components/Hero", Local),
            s("Page", "@/components/Hero", Local),
        ]);
        let preview = fs::read_to_string(dir.join(".divina/mount.tsx")).unwrap();
        assert!(preview.contains(r#"  "@/components/ui/button": () => import("/src/components/ui/button.tsx"),"#), "{preview}");
        assert!(preview.contains(r#"  "fancy-ui": () => import("fancy-ui"),"#), "{preview}");
        let _ = fs::remove_dir_all(&dir);
    }
}
