//! Working-tree snapshots stored as commits under `refs/divina/checkpoints/<n>`.
//! Every git call that touches an index uses a throwaway GIT_INDEX_FILE, so the
//! user's index, HEAD, branches and stash are never modified.

use crate::protocol::{Checkpoint, CheckpointDiff};
use std::path::{Path, PathBuf};
use std::process::Command;

/// Error returned when `root` is not inside a git repo; the UI asks consent, then calls `init_git`.
pub const NO_GIT_REPO: &str = "NO_GIT_REPO";
const REFS: &str = "refs/divina/checkpoints";

fn git(root: &str, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
    let mut cmd = Command::new("git");
    cmd.current_dir(root).args(args);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    // commit-tree needs an identity; don't depend on the user's git config.
    for (k, v) in [("GIT_AUTHOR_NAME", "Divina"), ("GIT_AUTHOR_EMAIL", "divina@localhost")] {
        cmd.env(k, v).env(k.replace("AUTHOR", "COMMITTER"), v);
    }
    let out = cmd.output().map_err(|e| format!("git: {e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Throwaway index file, deleted on drop.
struct TempIndex(PathBuf);

impl TempIndex {
    fn new() -> Self {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        Self(std::env::temp_dir().join(format!("divina-index-{}-{nanos}", std::process::id())))
    }
}

impl Drop for TempIndex {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

fn ensure_repo(root: &str) -> Result<(), String> {
    git(root, None, &["rev-parse", "--git-dir"]).map(|_| ()).map_err(|_| NO_GIT_REPO.to_string())
}

/// Index holding the current working tree (tracked + untracked, minus ignored) under `root`.
fn snapshot_index(root: &str) -> Result<TempIndex, String> {
    let index = TempIndex::new();
    if git(root, None, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok() {
        git(root, Some(&index.0), &["read-tree", "HEAD"])?;
    }
    git(root, Some(&index.0), &["add", "-A", "--", "."])?;
    Ok(index)
}

fn snapshot_tree(root: &str) -> Result<String, String> {
    let index = snapshot_index(root)?;
    Ok(git(root, Some(&index.0), &["write-tree"])?.trim().to_string())
}

fn checkpoint_ref(id: &str) -> Result<String, String> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(format!("bad checkpoint id: {id}"));
    }
    Ok(format!("{REFS}/{id}"))
}

#[tauri::command]
pub fn init_git(root: String) -> Result<(), String> {
    git(&root, None, &["init"]).map(|_| ())
}

#[tauri::command]
pub fn create_checkpoint(root: String, label: String) -> Result<Checkpoint, String> {
    ensure_repo(&root)?;
    let tree = snapshot_tree(&root)?;
    let commit = git(&root, None, &["commit-tree", &tree, "-m", &label])?;
    let next = list(&root)?.last().map_or(1, |c| c.id.parse::<u64>().unwrap() + 1).to_string();
    git(&root, None, &["update-ref", &checkpoint_ref(&next)?, commit.trim()])?;
    list(&root)?.pop().ok_or_else(|| "checkpoint vanished".into())
}

fn list(root: &str) -> Result<Vec<Checkpoint>, String> {
    let out = git(root, None, &["for-each-ref", REFS, "--format=%(refname:lstrip=3) %(creatordate:unix) %(subject)"])?;
    let mut cps: Vec<Checkpoint> = out
        .lines()
        .filter_map(|l| {
            let mut parts = l.splitn(3, ' ');
            let id = parts.next()?.to_string();
            id.parse::<u64>().ok()?;
            let created_at = parts.next()?.parse::<u64>().ok()? * 1000;
            Some(Checkpoint { id, created_at, label: parts.next().unwrap_or("").to_string() })
        })
        .collect();
    cps.sort_by_key(|c| c.id.parse::<u64>().unwrap());
    Ok(cps)
}

#[tauri::command]
pub fn list_checkpoints(root: String) -> Result<Vec<Checkpoint>, String> {
    ensure_repo(&root)?;
    list(&root)
}

/// Restore the working tree under `root` to checkpoint `id`; files created since are removed.
/// HEAD and the user's index are untouched. The current state is checkpointed first so it's never lost.
#[tauri::command]
pub fn restore_checkpoint(root: String, id: String) -> Result<(), String> {
    ensure_repo(&root)?;
    let r = checkpoint_ref(&id)?;
    git(&root, None, &["rev-parse", "--verify", "-q", &r]).map_err(|_| format!("no checkpoint {id}"))?;
    create_checkpoint(root.clone(), format!("Before restore to {id}"))?;
    // The temp index lists every current file, so `restore` deletes those absent from the checkpoint.
    let index = snapshot_index(&root)?;
    git(&root, Some(&index.0), &["restore", "--source", &r, "--worktree", "--", "."])?;
    Ok(())
}

#[tauri::command]
pub fn diff_since_checkpoint(root: String, id: String) -> Result<CheckpointDiff, String> {
    ensure_repo(&root)?;
    let r = checkpoint_ref(&id)?;
    let tree = snapshot_tree(&root)?;
    let args = |extra: &str| git(&root, None, &["diff", "--relative", "--src-prefix=a/", "--dst-prefix=b/", extra, &r, &tree, "--", "."]);
    let files = args("--name-only")?.lines().map(str::to_string).collect();
    Ok(CheckpointDiff { files, diff: args("--no-ext-diff")? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn sh(root: &Path, args: &[&str]) -> String {
        git(root.to_str().unwrap(), None, args).unwrap()
    }

    #[test]
    fn checkpoint_restore_leaves_head_index_branches_alone() {
        let dir = std::env::temp_dir().join(format!("divina-cp-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let root = dir.to_str().unwrap().to_string();

        assert_eq!(create_checkpoint(root.clone(), "x".into()).unwrap_err(), NO_GIT_REPO);
        init_git(root.clone()).unwrap();
        fs::write(dir.join(".gitignore"), "ignored.txt\n").unwrap();
        fs::write(dir.join("tracked.txt"), "v1\n").unwrap();
        sh(&dir, &["add", "."]);
        sh(&dir, &["commit", "-qm", "init"]);

        // uncommitted edit, staged edit, untracked file, ignored file
        fs::write(dir.join("tracked.txt"), "v2 uncommitted\n").unwrap();
        fs::write(dir.join("staged.txt"), "staged\n").unwrap();
        sh(&dir, &["add", "staged.txt"]);
        fs::write(dir.join("untracked.txt"), "untracked\n").unwrap();
        fs::write(dir.join("ignored.txt"), "ignored\n").unwrap();

        let state = |d: &Path| (sh(d, &["rev-parse", "HEAD"]), sh(d, &["ls-files", "-s"]),
            sh(d, &["for-each-ref", "refs/heads", "refs/stash"]), sh(d, &["symbolic-ref", "HEAD"]));
        let before = state(&dir);

        let cp = create_checkpoint(root.clone(), "first".into()).unwrap();
        assert_eq!((cp.id.as_str(), cp.label.as_str()), ("1", "first"));

        fs::write(dir.join("tracked.txt"), "v3\n").unwrap();
        fs::remove_file(dir.join("untracked.txt")).unwrap();
        fs::write(dir.join("new.txt"), "new\n").unwrap();

        let d = diff_since_checkpoint(root.clone(), "1".into()).unwrap();
        assert_eq!(d.files, ["new.txt", "tracked.txt", "untracked.txt"]);
        assert!(d.diff.contains("+v3"));

        restore_checkpoint(root.clone(), "1".into()).unwrap();
        let read = |f: &str| fs::read_to_string(dir.join(f)).ok();
        assert_eq!(read("tracked.txt").as_deref(), Some("v2 uncommitted\n"));
        assert_eq!(read("untracked.txt").as_deref(), Some("untracked\n"));
        assert_eq!(read("staged.txt").as_deref(), Some("staged\n"));
        assert_eq!(read("ignored.txt").as_deref(), Some("ignored\n"));
        assert_eq!(read("new.txt"), None);
        assert_eq!(state(&dir), before);

        // restore auto-saved the pre-restore state as checkpoint 2
        let cps = list_checkpoints(root.clone()).unwrap();
        assert_eq!(cps.iter().map(|c| c.id.as_str()).collect::<Vec<_>>(), ["1", "2"]);
        restore_checkpoint(root.clone(), "2".into()).unwrap();
        assert_eq!(read("tracked.txt").as_deref(), Some("v3\n"));
        assert_eq!(read("new.txt").as_deref(), Some("new\n"));
        assert!(diff_since_checkpoint(root, "2".into()).unwrap().files.is_empty());
        let _ = fs::remove_dir_all(&dir);
    }
}
