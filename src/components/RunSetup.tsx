import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { ProjectInfo } from "@/shared/protocol";

/** Asks the user to write how to serve the project; saved to .divina/run.json and run verbatim. */
export function RunSetup({
  project,
  open,
  onSaved,
  onCancel,
}: {
  project: ProjectInfo;
  open: boolean;
  onSaved: (p: ProjectInfo) => void;
  onCancel: () => void;
}) {
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [tagging, setTagging] = useState(false);
  const [error, setError] = useState("");

  // Editing shows what the user saved before; a first setup starts empty.
  useEffect(() => {
    if (!open) return;
    setCommand(project.run?.command ?? "");
    setUrl(project.run?.url ?? "");
    setTagging(project.run?.tagging ?? false);
    setError("");
  }, [open]);

  async function save() {
    if (!command.trim()) return setError("Write the command that starts this project.");
    try {
      onSaved(await api.saveRunConfig(project.root, { command: command.trim(), url: url.trim() || null, tagging: tagging && project.react }));
    } catch (e) {
      setError(String(e));
    }
  }

  const hint = project.suggestedRun;
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Set up preview</DialogTitle>
        <DialogDescription>
          Write the command that starts this project's dev server. Divina runs exactly this, in this folder, in your login shell.
        </DialogDescription>

        <label className="flex flex-col gap-1">
          <span className="font-medium">Run command</span>
          <Textarea
            autoFocus
            rows={3}
            className="font-mono"
            placeholder={hint.command ? `e.g. ${hint.command}` : "e.g. php artisan serve"}
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={(e) => {
              if (!((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
              // ⌘↵ is also the workspace's Apply shortcut; keep it from starting an agent run.
              e.preventDefault();
              e.stopPropagation();
              save();
            }}
          />
          <span className="text-xs text-muted-foreground">
            Several lines run in order, like a shell script. A line that keeps running blocks the next one, so end it with{" "}
            <code className="font-mono">&amp;</code> to run servers side by side, and keep the last one in the foreground. ⌘↵ to save.
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="font-medium">Preview URL <span className="font-normal text-muted-foreground">(optional)</span></span>
          <Input
            className="font-mono"
            placeholder={hint.url ? `e.g. ${hint.url}` : "Detected from the command's output"}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && save()}
          />
          <span className="text-xs text-muted-foreground">Set this when the command starts more than one server.</span>
        </label>

        {project.react && (
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={tagging} onChange={(e) => setTagging(e.target.checked)} />
            <span>
              Click-to-code source tagging
              <span className="block text-xs text-muted-foreground">
                Maps clicks in the preview to exact lines of code, and on Vite stops component thumbnails from reloading the preview. Your command is unchanged; Divina adds a dev-only <code className="font-mono">NODE_OPTIONS</code> preload for Vite and Next.js and keeps its files in the git-ignored <code className="font-mono">.divina/</code> folder.
              </span>
            </span>
          </label>
        )}

        {error && <p className="text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={save}>Start preview</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
