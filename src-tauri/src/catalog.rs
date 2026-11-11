use crate::protocol::{CatalogLibrary, Language, Stack};
use semver::{Version, VersionReq};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

const BUNDLED: &str = include_str!("../catalog/catalog.json");

#[tauri::command]
pub fn detect_stack(root: String) -> Stack {
    detect_stack_at(Path::new(&root))
}

fn detect_stack_at(root: &Path) -> Stack {
    let package: JsonValue = std::fs::read_to_string(root.join("package.json"))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(JsonValue::Null);
    let js_deps = [&package["dependencies"], &package["devDependencies"]];
    let js_has = |name: &str| js_deps.iter().any(|deps| deps.get(name).is_some());
    let js_version = |name: &str| -> Option<String> {
        let installed = root.join("node_modules").join(name).join("package.json");
        if let Ok(text) = std::fs::read_to_string(installed) {
            if let Ok(value) = serde_json::from_str::<JsonValue>(&text) {
                if let Some(version) = value["version"].as_str() {
                    return Some(version.to_owned());
                }
            }
        }
        js_deps
            .iter()
            .find_map(|deps| deps[name].as_str())
            .map(strip_prefixes)
    };
    let tailwind = root.join("node_modules/tailwindcss/package.json");
    let tailwind_version = std::fs::read_to_string(tailwind)
        .ok()
        .and_then(|s| serde_json::from_str::<JsonValue>(&s).ok())
        .and_then(|v| v["version"].as_str().map(str::to_owned));

    for framework in ["react", "vue", "svelte"] {
        if js_has(framework) {
            return Stack {
                language: Language::Javascript,
                framework: framework.into(),
                version: js_version(framework),
                tailwind: tailwind_version,
            };
        }
    }
    let rust_projects = rust_project_dirs(root);
    for project in &rust_projects {
        let Ok(manifest) = std::fs::read_to_string(project.join("Cargo.toml")) else {
            continue;
        };
        let parsed: toml::Value = match toml::from_str(&manifest) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let deps = parsed.get("dependencies").and_then(toml::Value::as_table);
        let workspace_deps = parsed
            .get("workspace")
            .and_then(|w| w.get("dependencies"))
            .and_then(toml::Value::as_table);
        for framework in ["leptos", "yew", "dioxus"] {
            let declared = deps
                .and_then(|d| d.get(framework))
                .or_else(|| workspace_deps.and_then(|d| d.get(framework)));
            if let Some(declared) = declared {
                let lock_version = lock_package_version(&project.join("Cargo.lock"), framework)
                    .or_else(|| lock_package_version(&root.join("Cargo.lock"), framework));
                let declared_version =
                    dependency_version(declared).map(|version| strip_prefixes(&version));
                return Stack {
                    language: Language::Rust,
                    framework: framework.into(),
                    version: lock_version.or(declared_version),
                    tailwind: None,
                };
            }
        }
    }
    if package.is_object() {
        Stack {
            language: Language::Javascript,
            framework: "unknown".into(),
            version: None,
            tailwind: tailwind_version,
        }
    } else if root.join("Cargo.toml").exists() {
        Stack {
            language: Language::Rust,
            framework: "unknown".into(),
            version: None,
            tailwind: None,
        }
    } else {
        Stack {
            language: Language::Other,
            framework: "unknown".into(),
            version: None,
            tailwind: None,
        }
    }
}

fn rust_project_dirs(root: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![root.to_path_buf()];
    if let Ok(text) = std::fs::read_to_string(root.join("Cargo.toml")) {
        if let Ok(manifest) = toml::from_str::<toml::Value>(&text) {
            if let Some(members) = manifest
                .get("workspace")
                .and_then(|w| w.get("members"))
                .and_then(toml::Value::as_array)
            {
                for member in members.iter().filter_map(toml::Value::as_str) {
                    if !member.contains('*') {
                        dirs.push(root.join(member));
                    }
                }
            }
        }
    }
    dirs
}

fn dependency_version(value: &toml::Value) -> Option<String> {
    value.as_str().map(str::to_owned).or_else(|| {
        value
            .get("version")
            .and_then(toml::Value::as_str)
            .map(str::to_owned)
    })
}

fn lock_package_version(lock: &Path, package: &str) -> Option<String> {
    let text = std::fs::read_to_string(lock).ok()?;
    let parsed: toml::Value = toml::from_str(&text).ok()?;
    parsed
        .get("package")?
        .as_array()?
        .iter()
        .find(|p| p.get("name").and_then(toml::Value::as_str) == Some(package))?
        .get("version")?
        .as_str()
        .map(str::to_owned)
}

fn strip_prefixes(version: &str) -> String {
    version.trim().trim_start_matches(['^', '~']).to_owned()
}

#[tauri::command]
pub fn list_catalog(root: String) -> Vec<CatalogLibrary> {
    list_catalog_at(Path::new(&root), &global_catalog_dir())
}

fn global_catalog_dir() -> PathBuf {
    dirs_home().join(".divina")
}
fn dirs_home() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

fn list_catalog_at(root: &Path, global_dir: &Path) -> Vec<CatalogLibrary> {
    let stack = detect_stack_at(root);
    let mut libraries: Vec<CatalogLibrary> = serde_json::from_str(BUNDLED).unwrap_or_default();
    libraries.retain(|lib| {
        lib.framework == stack.framework && matches_version(&lib.versions, stack.version.as_deref())
    });
    let mut custom: HashMap<String, CatalogLibrary> = HashMap::new();
    for file in [
        global_dir.join("libraries.json"),
        root.join(".divina/libraries.json"),
    ] {
        if let Ok(text) = std::fs::read_to_string(file) {
            if let Ok(entries) = serde_json::from_str::<Vec<CatalogLibrary>>(&text) {
                for mut entry in entries {
                    entry.custom = true;
                    custom.insert(entry.id.clone(), entry);
                }
            }
        }
    }
    // Project entries are read last and replace global entries sharing an id.
    for (id, entry) in custom {
        if let Some(i) = libraries.iter().position(|lib| lib.id == id) {
            libraries[i] = entry;
        } else {
            libraries.push(entry);
        }
    }
    libraries
}

fn matches_version(range: &str, version: Option<&str>) -> bool {
    let Some(version) = version.and_then(|v| Version::parse(v).ok()) else {
        return true;
    };
    VersionReq::parse(range)
        .map(|req| req.matches(&version))
        .unwrap_or(true)
}

#[tauri::command]
pub fn save_library(
    root: String,
    library: CatalogLibrary,
    global: bool,
) -> Result<Vec<CatalogLibrary>, String> {
    let root = PathBuf::from(root);
    let global_dir = if global {
        global_catalog_dir()
    } else {
        root.join(".divina")
    };
    save_library_at(&root, &global_dir, library)?;
    Ok(list_catalog_at(&root, &global_catalog_dir()))
}

fn save_library_at(
    root: &Path,
    target_dir: &Path,
    mut library: CatalogLibrary,
) -> Result<(), String> {
    library.custom = true;
    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    if target_dir == root.join(".divina") {
        let ignore = target_dir.join(".gitignore");
        if !ignore.exists() {
            std::fs::write(ignore, "*\n").map_err(|e| e.to_string())?;
        }
    }
    let path = target_dir.join("libraries.json");
    let mut entries: Vec<CatalogLibrary> = std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    if let Some(existing) = entries.iter_mut().find(|entry| entry.id == library.id) {
        *existing = library;
    } else {
        entries.push(library);
    }
    std::fs::write(
        path,
        serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::CatalogComponent;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    fn temp() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "divina-catalog-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
    fn write(path: &Path, value: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, value).unwrap();
    }
    fn custom(id: &str, framework: &str) -> CatalogLibrary {
        CatalogLibrary {
            id: id.into(),
            name: id.into(),
            framework: framework.into(),
            versions: "*".into(),
            install: "install".into(),
            import_from: None,
            docs: None,
            custom: false,
            components: vec![CatalogComponent {
                name: "Thing".into(),
                usage: "<Thing />".into(),
                thumbnail: None,
            }],
        }
    }
    #[test]
    fn detects_react_vite_next_leptos_and_unknown() {
        let vite = temp();
        write(
            &vite.join("package.json"),
            r#"{"dependencies":{"react":"^19.0.0"},"devDependencies":{"vite":"^7"}}"#,
        );
        write(
            &vite.join("node_modules/react/package.json"),
            r#"{"version":"19.1.0"}"#,
        );
        assert_eq!(detect_stack_at(&vite).framework, "react");
        assert_eq!(detect_stack_at(&vite).version.as_deref(), Some("19.1.0"));
        let next = temp();
        write(
            &next.join("package.json"),
            r#"{"dependencies":{"react":"^18.2.0","next":"15"}}"#,
        );
        assert_eq!(detect_stack_at(&next).framework, "react");
        let svelte = temp();
        write(&svelte.join("package.json"), r#"{"devDependencies":{"svelte":"^5.1.0"}}"#);
        assert_eq!(detect_stack_at(&svelte).framework, "svelte");
        assert_eq!(detect_stack_at(&svelte).version.as_deref(), Some("5.1.0"));
        let rust = temp();
        write(
            &rust.join("Cargo.toml"),
            "[dependencies]\nleptos = \"0.7\"\n",
        );
        write(
            &rust.join("Cargo.lock"),
            "[[package]]\nname = \"leptos\"\nversion = \"0.7.8\"\n",
        );
        assert_eq!(detect_stack_at(&rust).version.as_deref(), Some("0.7.8"));
        let unknown = temp();
        write(&unknown.join("package.json"), "{}");
        assert_eq!(detect_stack_at(&unknown).framework, "unknown");
    }
    #[test]
    fn filters_catalog_by_framework_and_version() {
        let root = temp();
        write(
            &root.join("package.json"),
            r#"{"dependencies":{"react":"17.0.0"}}"#,
        );
        assert!(
            list_catalog_at(&root, &temp())
                .iter()
                .all(|l| l.id != "shadcn")
        );
        write(
            &root.join("node_modules/react/package.json"),
            r#"{"version":"19.0.0"}"#,
        );
        assert!(
            list_catalog_at(&root, &temp())
                .iter()
                .any(|l| l.id == "shadcn")
        );
        let vue = temp();
        write(&vue.join("package.json"), r#"{"dependencies":{"vue":"^3.5.0"}}"#);
        let vue_catalog = list_catalog_at(&vue, &temp());
        assert!(vue_catalog.iter().any(|l| l.id == "shadcn-vue"));
        assert!(vue_catalog.iter().all(|l| l.id != "shadcn"));

        let svelte = temp();
        write(&svelte.join("package.json"), r#"{"dependencies":{"svelte":"^5.0.0"}}"#);
        let svelte_catalog = list_catalog_at(&svelte, &temp());
        assert!(svelte_catalog.iter().any(|l| l.id == "shadcn-svelte"));
        assert!(svelte_catalog.iter().all(|l| l.id != "shadcn"));
    }
    #[test]
    fn saves_project_and_global_upserts() {
        let root = temp();
        write(
            &root.join("package.json"),
            r#"{"dependencies":{"react":"19"}}"#,
        );
        let global = temp();
        let mut item = custom("mine", "react");
        save_library_at(&root, &root.join(".divina"), item.clone()).unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(".divina/.gitignore")).unwrap(),
            "*\n"
        );
        item.id = "global".into();
        item.name = "updated".into();
        save_library_at(&root, &global, item).unwrap();
        assert_eq!(
            list_catalog_at(&root, &global)
                .iter()
                .find(|l| l.id == "global")
                .unwrap()
                .name,
            "updated"
        );
    }
}
