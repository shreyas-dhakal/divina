//! Suggests source locations for untagged elements by searching the project for their text.

use crate::protocol::DomAnchor;
use std::{fs, path::Path, process::Command};

const MAX: usize = 5;
const SKIP_DIRS: &[&str] = &["node_modules", "target", "dist", "build", ".divina", ".git"];
const LOCKFILES: &[&str] = &[
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lockb",
    "bun.lock",
    "Cargo.lock",
];

/// Up to MAX `file:line: text` candidates, framework dev metadata first when present.
pub fn candidates(root: &Path, dom: &DomAnchor) -> Vec<String> {
    let mut out: Vec<String> = dom
        .meta
        .iter()
        .map(|m| format!("{m} (framework dev metadata, most likely)"))
        .collect();
    let text = dom.text.trim();
    if text.chars().count() >= 3 {
        let hits = search(root, text, false);
        let hits = if hits.is_empty() { search(root, text, true) } else { hits };
        out.extend(hits);
    }
    out.truncate(MAX);
    out
}

fn search(root: &Path, text: &str, ignore_case: bool) -> Vec<String> {
    git_grep(root, text, ignore_case).unwrap_or_else(|| {
        let mut hits = Vec::new();
        walk(root, root, text, ignore_case, &mut hits);
        hits
    })
}

/// None when root is not inside a git work tree (or git is missing), so the caller walks instead.
fn git_grep(root: &Path, text: &str, ignore_case: bool) -> Option<Vec<String>> {
    let inside = Command::new("git")
        .current_dir(root)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .ok()?;
    if !inside.status.success() {
        return None;
    }
    let mut cmd = Command::new("git");
    // --untracked still honours .gitignore; -I skips binary files.
    cmd.current_dir(root)
        .args(["grep", "-n", "-I", "-F", "--untracked", "--no-color"]);
    if ignore_case {
        cmd.arg("-i");
    }
    cmd.arg("-e").arg(text).arg("--");
    for d in SKIP_DIRS {
        cmd.arg(format!(":(exclude,glob)**/{d}/**"));
    }
    for f in LOCKFILES {
        cmd.arg(format!(":(exclude,glob)**/{f}"));
    }
    // Exit 1 means no match; anything else unexpected falls back to the walker.
    let out = cmd.output().ok()?;
    match out.status.code() {
        Some(0) => {}
        Some(1) => return Some(Vec::new()),
        _ => return None,
    }
    Some(
        String::from_utf8_lossy(&out.stdout)
            .lines()
            .filter_map(|l| {
                let mut parts = l.splitn(3, ':');
                Some(fmt(parts.next()?, parts.next()?.parse().ok()?, parts.next()?))
            })
            .take(MAX)
            .collect(),
    )
}

// ponytail: reads every file into memory and scans sequentially; fine for typical frontends,
// add size limits or parallelism if large non-git projects get slow.
fn walk(root: &Path, dir: &Path, text: &str, ignore_case: bool, hits: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    let needle = text.to_lowercase();
    for entry in entries {
        if hits.len() >= MAX {
            return;
        }
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_dir() {
            if !SKIP_DIRS.contains(&name.as_ref()) {
                walk(root, &path, text, ignore_case, hits);
            }
            continue;
        }
        if !kind.is_file() || LOCKFILES.contains(&name.as_ref()) {
            continue;
        }
        // Non-UTF-8 or NUL-containing files are treated as binary.
        let Ok(content) = fs::read_to_string(&path) else { continue };
        if content.contains('\0') {
            continue;
        }
        let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy();
        for (i, line) in content.lines().enumerate() {
            let found = if ignore_case {
                line.to_lowercase().contains(&needle)
            } else {
                line.contains(text)
            };
            if found {
                hits.push(fmt(&rel, i + 1, line));
                if hits.len() >= MAX {
                    return;
                }
            }
        }
    }
}

fn fmt(file: &str, line: usize, text: &str) -> String {
    let text: String = text.trim().chars().take(160).collect();
    format!("{file}:{line}: {text}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn dom(text: &str, meta: Option<&str>) -> DomAnchor {
        DomAnchor {
            selector: "main > h2".into(),
            tag: "h2".into(),
            text: text.into(),
            meta: meta.map(Into::into),
        }
    }

    fn project(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("divina-locate-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("node_modules/pkg")).unwrap();
        fs::write(dir.join("src/App.svelte"), "<main>\n  <h2>Our Pricing</h2>\n</main>\n").unwrap();
        fs::write(dir.join("node_modules/pkg/index.js"), "Our Pricing\n").unwrap();
        fs::write(dir.join("package-lock.json"), "\"Our Pricing\"\n").unwrap();
        dir
    }

    #[test]
    fn finds_exact_text_and_skips_node_modules() {
        let dir = project("exact");
        assert_eq!(
            candidates(&dir, &dom("Our Pricing", None)),
            vec!["src/App.svelte:2: <h2>Our Pricing</h2>"]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn falls_back_to_case_insensitive() {
        let dir = project("case");
        assert_eq!(
            candidates(&dir, &dom("OUR PRICING", None)),
            vec!["src/App.svelte:2: <h2>Our Pricing</h2>"]
        );
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn caps_results_lists_meta_first_and_skips_short_text() {
        let dir = project("cap");
        fs::write(dir.join("src/many.html"), "Our Pricing\n".repeat(10)).unwrap();
        let found = candidates(&dir, &dom("Our Pricing", Some("src/App.svelte:2:3")));
        assert_eq!(found.len(), 5);
        assert!(found[0].starts_with("src/App.svelte:2:3 (framework dev metadata"));
        assert_eq!(candidates(&dir, &dom("Ou", None)), Vec::<String>::new());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn git_grep_respects_gitignore() {
        let dir = project("git");
        fs::write(dir.join(".gitignore"), "/ignored.txt\n").unwrap();
        fs::write(dir.join("ignored.txt"), "Our Pricing\n").unwrap();
        let ok = Command::new("git").current_dir(&dir).args(["init", "-q"]).status();
        if ok.is_ok_and(|s| s.success()) {
            assert_eq!(
                git_grep(&dir, "Our Pricing", false),
                Some(vec!["src/App.svelte:2: <h2>Our Pricing</h2>".to_string()])
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }
}
