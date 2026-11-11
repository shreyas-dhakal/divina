use crate::protocol::{Framework, PackageManager, ProjectInfo, RunConfig};
use serde_json::Value;
use std::path::Path;
use std::process::Command;

#[tauri::command]
pub fn open_project(path: String) -> Result<ProjectInfo, String> {
    crate::devserver::stop();
    inspect(Path::new(&path))
}

/// Scaffold Vite + React + Tailwind + shadcn at `parent/name`.
#[tauri::command]
pub async fn create_project(parent: String, name: String) -> Result<ProjectInfo, String> {
    let ok_name = !name.is_empty()
        && name.chars().all(|c| c.is_ascii_alphanumeric() || "-_.".contains(c))
        && !name.starts_with('.');
    if !ok_name {
        return Err(format!("invalid project name {name:?} (use letters, digits, - _ .)"));
    }
    let dir = Path::new(&parent).join(&name);
    if dir.exists() {
        return Err(format!("{} already exists", dir.display()));
    }
    let parent2 = parent.clone();
    let name2 = name.clone();
    // shadcn's own Vite template already brings React + TS + Tailwind v4 + the `@` alias.
    let out = tauri::async_runtime::spawn_blocking(move || {
        Command::new("pnpm")
            .args(["dlx", "shadcn@latest", "init", "--template", "vite", "--defaults"])
            .args(["--yes", "--no-monorepo", "--name", &name2])
            .current_dir(&parent2)
            .env("CI", "1")
            .stdin(std::process::Stdio::null())
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("could not run pnpm: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "shadcn init failed:\n{}{}",
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
        (if at("pnpm-lock.yaml") { "pnpm dev" } else if at("yarn.lock") { "yarn dev" } else if at("bun.lock") { "bun dev" } else { "npm run dev" }, None)
    } else if pkg["scripts"]["start"].is_string() {
        ("npm start", None)
    } else if at("index.php") || at("public/index.php") {
        let docroot = if at("public/index.php") { "php -S 127.0.0.1:8000 -t public" } else { "php -S 127.0.0.1:8000" };
        (docroot, Some("http://127.0.0.1:8000"))
    } else {
        ("", None)
    };
    RunConfig { command: command.into(), url: url.map(Into::into), tagging: false }
}

fn inspect(root: &Path) -> Result<ProjectInfo, String> {
    let root = root.canonicalize().map_err(|e| format!("{}: {e}", root.display()))?;
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
    let backend = ["artisan", "manage.py", "bin/rails", "composer.json"].iter().any(|f| root.join(f).exists());
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
    fn detects_project() {
        let dir = std::env::temp_dir().join(format!("divina-proj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"scripts":{"dev":"vite"},"dependencies":{"react":"19"},"devDependencies":{"vite":"8","tailwindcss":"4"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        let info = inspect(&dir).unwrap();
        assert_eq!((info.framework, info.package_manager, info.tailwind), (Framework::Vite, PackageManager::Pnpm, true));
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
        assert_eq!(info.suggested_run.command, "php -S 127.0.0.1:8000 -t public");
        std::fs::remove_dir_all(dir).unwrap();
    }
}
