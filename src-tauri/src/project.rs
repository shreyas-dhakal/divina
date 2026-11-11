use crate::protocol::{Framework, PackageManager, ProjectInfo, ProjectTemplate, RunConfig};
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectInfo, String> {
    crate::devserver::stop();
    inspect(Path::new(&path))
}

#[tauri::command]
pub fn list_templates() -> Vec<ProjectTemplate> {
    let pnpm = tool_available("pnpm", &["--version"]);
    let cargo = tool_available("cargo", &["--version"]);
    let trunk = tool_available("trunk", &["--version"]);
    let wasm = Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .is_some_and(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l == "wasm32-unknown-unknown")
        });
    [
        template(
            "react-vite",
            "react",
            "React + Vite",
            "React + Vite + shadcn/ui",
            pnpm,
            (!pnpm).then_some("pnpm: install pnpm".into()),
        ),
        template(
            "next",
            "next",
            "Next.js",
            "Next.js + shadcn/ui",
            pnpm,
            (!pnpm).then_some("pnpm: install pnpm".into()),
        ),
        template(
            "vue",
            "vue",
            "Vue + Vite",
            "Vue + Vite + TypeScript",
            pnpm,
            (!pnpm).then_some("pnpm: install pnpm".into()),
        ),
        template(
            "svelte",
            "svelte",
            "SvelteKit",
            "SvelteKit minimal + TypeScript",
            pnpm,
            (!pnpm).then_some("pnpm: install pnpm".into()),
        ),
        template(
            "leptos",
            "leptos",
            "Leptos",
            "Leptos CSR + Thaw, served by Trunk",
            cargo,
            {
                let mut missing = Vec::new();
                if !cargo {
                    missing.push("cargo: install Rust");
                }
                if !trunk {
                    missing.push("trunk: cargo install trunk");
                }
                if !wasm {
                    missing
                        .push("wasm32-unknown-unknown: rustup target add wasm32-unknown-unknown");
                }
                (!missing.is_empty()).then(|| missing.join(" · "))
            },
        ),
    ]
    .into_iter()
    .collect()
}

fn template(
    id: &str,
    framework: &str,
    name: &str,
    description: &str,
    available: bool,
    missing: Option<String>,
) -> ProjectTemplate {
    ProjectTemplate {
        id: id.into(),
        name: name.into(),
        framework: framework.into(),
        description: description.into(),
        available,
        missing,
    }
}

fn tool_available(command: &str, args: &[&str]) -> bool {
    Command::new(command)
        .args(args)
        .stdin(std::process::Stdio::null())
        .output()
        .is_ok_and(|o| o.status.success())
}

/// Scaffold a bundled starter project at `parent/name`.
#[tauri::command]
pub async fn create_project(
    parent: String,
    name: String,
    template: String,
) -> Result<ProjectInfo, String> {
    let ok_name = !name.is_empty()
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        && !name.starts_with('.');
    if !ok_name {
        return Err(format!(
            "invalid project name {name:?} (use letters, digits, - _ .)"
        ));
    }
    let dir = Path::new(&parent).join(&name);
    if dir.exists() {
        return Err(format!("{} already exists", dir.display()));
    }
    if !["react-vite", "next", "vue", "svelte", "leptos"].contains(&template.as_str()) {
        return Err(format!("unknown project template {template:?}"));
    }
    if template == "leptos" {
        if !tool_available("cargo", &["--version"]) {
            return Err("cargo is required to create a Leptos project".into());
        }
        write_leptos_files(&dir, &name)?;
        let lock = Command::new("cargo")
            .arg("generate-lockfile")
            .current_dir(&dir)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .output()
            .map_err(|e| format!("could not run cargo: {e}"))?;
        if !lock.status.success() {
            return Err(format!(
                "cargo generate-lockfile failed:\n{}{}",
                String::from_utf8_lossy(&lock.stdout),
                String::from_utf8_lossy(&lock.stderr)
            ));
        }
        return inspect(&dir);
    }
    if !tool_available("pnpm", &["--version"]) {
        return Err("pnpm is required to create this project".into());
    }
    let parent2 = parent.clone();
    let name2 = name.clone();
    let template2 = template.clone();
    // shadcn's own Vite template already brings React + TS + Tailwind v4 + the `@` alias.
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut command = Command::new("pnpm");
        match template2.as_str() {
            "react-vite" | "next" => {
                command.args([
                    "dlx",
                    "shadcn@latest",
                    "init",
                    "--template",
                    if template2 == "next" { "next" } else { "vite" },
                    "--defaults",
                    "--yes",
                    "--no-monorepo",
                    "--name",
                    &name2,
                ]);
            }
            "vue" => {
                command.args(["create", "vite@latest", &name2, "--template", "vue-ts"]);
            }
            "svelte" => {
                command.args([
                    "dlx",
                    "sv",
                    "create",
                    &name2,
                    "--template",
                    "minimal",
                    "--types",
                    "ts",
                    "--no-add-ons",
                    "--no-install",
                ]);
            }
            _ => unreachable!(),
        }
        let out = command
            .current_dir(&parent2)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .output()?;
        if out.status.success() && (template2 == "vue" || template2 == "svelte") {
            return Command::new("pnpm")
                .arg("install")
                .current_dir(Path::new(&parent2).join(&name2))
                .env("CI", "1")
                .stdin(std::process::Stdio::null())
                .output();
        }
        Ok(out)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("could not run pnpm: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "project creation failed:\n{}{}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    inspect(&dir)
}

/// Saved run config, if the user has confirmed one for this project.
const RUN_FILE: &str = ".divina/run.json";

pub fn load_run(root: &Path) -> Option<RunConfig> {
    serde_json::from_str(&std::fs::read_to_string(root.join(RUN_FILE)).ok()?).ok()
}

#[tauri::command]
pub fn save_run_config(root: String, run: RunConfig) -> Result<ProjectInfo, String> {
    let dir = Path::new(&root).join(".divina");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".gitignore"), "*\n").map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&run).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("run.json"), json).map_err(|e| e.to_string())?;
    inspect(Path::new(&root))
}

/// Placeholder hint for the setup dialog, from marker files. Never run on its own.
fn suggest(root: &Path, pkg: &Value) -> RunConfig {
    let at = |f: &str| root.join(f).exists();
    let (command, url) = if at("artisan") {
        ("php artisan serve", Some("http://127.0.0.1:8000"))
    } else if at("manage.py") {
        ("python manage.py runserver", Some("http://127.0.0.1:8000"))
    } else if at("bin/rails") {
        ("bin/rails server", Some("http://127.0.0.1:3000"))
    } else if pkg["scripts"]["dev"].is_string() {
        (
            if at("pnpm-lock.yaml") {
                "pnpm dev"
            } else if at("yarn.lock") {
                "yarn dev"
            } else if at("bun.lock") {
                "bun dev"
            } else {
                "npm run dev"
            },
            None,
        )
    } else if pkg["scripts"]["start"].is_string() {
        ("npm start", None)
    } else if at("index.php") || at("public/index.php") {
        let docroot = if at("public/index.php") {
            "php -S 127.0.0.1:8000 -t public"
        } else {
            "php -S 127.0.0.1:8000"
        };
        (docroot, Some("http://127.0.0.1:8000"))
    } else if at("Trunk.toml")
        && at("index.html")
        && at("Cargo.toml")
        && std::fs::read_to_string(root.join("Cargo.toml")).is_ok_and(|s| s.contains("leptos"))
    {
        ("trunk serve", Some("http://127.0.0.1:8080"))
    } else {
        ("", None)
    };
    RunConfig {
        command: command.into(),
        url: url.map(Into::into),
        tagging: false,
    }
}

fn write_leptos_files(dir: &Path, name: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir.join("src")).map_err(|e| e.to_string())?;
    let cargo = format!(
        "[package]\nname = {}\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\nleptos = {{ version = \"0.7.8\", features = [\"csr\"] }}\nthaw = \"0.4.8\"\n",
        serde_json::to_string(name).map_err(|e| e.to_string())?
    );
    std::fs::write(dir.join("Cargo.toml"), cargo).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("src/main.rs"), "use leptos::prelude::*;\nuse thaw::{Button, ConfigProvider};\n\n#[component]\nfn App() -> impl IntoView {\n    view! { <ConfigProvider><main><h1>\"Hello, Leptos!\"</h1><Button>\"Click me\"</Button></main></ConfigProvider> }\n}\n\nfn main() {\n    mount_to_body(App);\n}\n").map_err(|e| e.to_string())?;
    std::fs::write(dir.join("index.html"), "<!doctype html>\n<html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><link data-trunk rel=\"rust\" href=\"Cargo.toml\"></head><body></body></html>\n").map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join("Trunk.toml"),
        "[build]\ntarget = \"index.html\"\n\n[watch]\nwatch = [\"src\"]\n",
    )
    .map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".gitignore"), "target/\ndist/\n").map_err(|e| e.to_string())?;
    Ok(())
}

fn inspect(root: &Path) -> Result<ProjectInfo, String> {
    let root = root
        .canonicalize()
        .map_err(|e| format!("{}: {e}", root.display()))?;
    if !root.is_dir() {
        return Err(format!("{} is not a folder", root.display()));
    }
    // No package.json is fine (PHP, Python, Ruby...): such projects run with a custom command.
    let pkg: Value = match std::fs::read_to_string(root.join("package.json")) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("package.json: {e}"))?,
        Err(_) => Value::Null,
    };
    let has = |dep: &str| {
        ["dependencies", "devDependencies"]
            .iter()
            .any(|k| pkg[k].get(dep).is_some())
    };
    // Divina only starts plain React + Vite/Next itself; a backend in front (artisan, rails...) means custom.
    let backend = ["artisan", "manage.py", "bin/rails", "composer.json"]
        .iter()
        .any(|f| root.join(f).exists());
    let framework = match (has("react"), has("next"), has("vite")) {
        (true, true, _) if !backend => Framework::Next,
        (true, _, true) if !backend => Framework::Vite,
        _ => Framework::Custom,
    };
    let lock = |f: &str| root.join(f).exists();
    let package_manager = if lock("pnpm-lock.yaml") {
        PackageManager::Pnpm
    } else if lock("bun.lock") || lock("bun.lockb") {
        PackageManager::Bun
    } else if lock("yarn.lock") {
        PackageManager::Yarn
    } else {
        PackageManager::Npm
    };
    let suggested_run = suggest(&root, &pkg);
    Ok(ProjectInfo {
        run: load_run(&root),
        root: root.to_string_lossy().into_owned(),
        framework,
        package_manager,
        tailwind: has("tailwindcss"),
        react: has("react"),
        suggested_run,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_have_stable_ids_and_order() {
        let ids: Vec<_> = list_templates().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, ["react-vite", "next", "vue", "svelte", "leptos"]);
    }

    #[test]
    fn leptos_suggests_trunk_serve() {
        let dir = std::env::temp_dir().join(format!("divina-leptos-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("Cargo.toml"),
            "[dependencies]\nleptos = { version = \"0.8\", features = [\"csr\"] }\n",
        )
        .unwrap();
        std::fs::write(dir.join("Trunk.toml"), "").unwrap();
        std::fs::write(dir.join("index.html"), "").unwrap();
        let suggestion = suggest(&dir, &Value::Null);
        assert_eq!(suggestion.command, "trunk serve");
        assert_eq!(suggestion.url.as_deref(), Some("http://127.0.0.1:8080"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn leptos_files_are_written() {
        let dir = std::env::temp_dir().join(format!("divina-leptos-files-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        write_leptos_files(&dir, "demo-app").unwrap();
        for file in ["Cargo.toml", "src/main.rs", "index.html", ".gitignore"] {
            assert!(dir.join(file).is_file(), "missing {file}");
        }
        assert!(
            std::fs::read_to_string(dir.join("src/main.rs"))
                .unwrap()
                .contains("ConfigProvider")
        );
        assert!(
            std::fs::read_to_string(dir.join("Cargo.toml"))
                .unwrap()
                .contains("name = \"demo-app\"")
        );
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn detects_project() {
        let dir = std::env::temp_dir().join(format!("divina-proj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite"},"dependencies":{"react":"19"},"devDependencies":{"vite":"8","tailwindcss":"4"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        let info = inspect(&dir).unwrap();
        assert_eq!(
            (info.framework, info.package_manager, info.tailwind),
            (Framework::Vite, PackageManager::Pnpm, true)
        );
        assert_eq!(info.run, None);
        assert_eq!(info.suggested_run.command, "pnpm dev");
        std::fs::write(dir.join("artisan"), "").unwrap();
        let info = inspect(&dir).unwrap();
        assert_eq!(info.framework, Framework::Custom);
        assert_eq!(info.suggested_run.command, "php artisan serve");
        save_run_config(info.root.clone(), info.suggested_run.clone()).unwrap();
        assert_eq!(inspect(&dir).unwrap().run, Some(info.suggested_run));
        // Plain PHP: no package.json, public/index.php.
        let php = dir.join("php");
        std::fs::create_dir_all(php.join("public")).unwrap();
        std::fs::write(php.join("public/index.php"), "<?php").unwrap();
        let info = inspect(&php).unwrap();
        assert_eq!(info.framework, Framework::Custom);
        assert_eq!(
            info.suggested_run.command,
            "php -S 127.0.0.1:8000 -t public"
        );
        std::fs::remove_dir_all(dir).unwrap();
    }
}
