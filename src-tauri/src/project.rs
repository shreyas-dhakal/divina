use crate::protocol::{Framework, PackageManager, ProjectInfo};
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

fn inspect(root: &Path) -> Result<ProjectInfo, String> {
    let root = root.canonicalize().map_err(|e| format!("{}: {e}", root.display()))?;
    let pkg = std::fs::read_to_string(root.join("package.json"))
        .map_err(|_| "no package.json in this folder".to_string())?;
    let pkg: Value = serde_json::from_str(&pkg).map_err(|e| format!("package.json: {e}"))?;
    let has = |dep: &str| {
        ["dependencies", "devDependencies"]
            .iter()
            .any(|k| pkg[k].get(dep).is_some())
    };
    if !has("react") {
        return Err("not a React project (no react dependency)".into());
    }
    let framework = if has("next") {
        Framework::Next
    } else if has("vite") {
        Framework::Vite
    } else {
        return Err("unsupported project: needs Vite or Next.js".into());
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
    Ok(ProjectInfo {
        root: root.to_string_lossy().into_owned(),
        framework,
        package_manager,
        tailwind: has("tailwindcss"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_project() {
        let dir = std::env::temp_dir().join(format!("divina-proj-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("package.json"), r#"{"dependencies":{"react":"19"},"devDependencies":{"vite":"8","tailwindcss":"4"}}"#).unwrap();
        std::fs::write(dir.join("pnpm-lock.yaml"), "").unwrap();
        let info = inspect(&dir).unwrap();
        assert_eq!((info.framework, info.package_manager, info.tailwind), (Framework::Vite, PackageManager::Pnpm, true));
        std::fs::write(dir.join("package.json"), r#"{"dependencies":{"vue":"3"}}"#).unwrap();
        assert!(inspect(&dir).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
}
