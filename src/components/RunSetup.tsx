import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import type { ProjectInfo } from "@/shared/protocol";

const EXAMPLES = ["php artisan serve", "composer run dev", "python manage.py runserver", "bin/rails server", "npm run dev"];

/** Asks how to serve the project for the preview, and saves it to .divina/run.json. */
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
  const known = project.framework !== "custom";
  const start = project.run ?? project.suggestedRun;
  const [custom, setCustom] = useState(!known || !!start.command);
  const [command, setCommand] = useState(start.command);
  const [url, setUrl] = useState(start.url ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setCustom(!known || !!start.command);
    setCommand(start.command);
    setUrl(start.url ?? "");
    setError("");
  }, [open]);

  async function save() {
    const run = custom ? { command: command.trim(), url: url.trim() || null } : { command: "", url: null };
    if (custom && !run.command) return setError("Enter the command that starts this project.");
    try {
      onSaved(await api.saveRunConfig(project.root, run));
    } catch (e) {
      setError(String(e));
    }
  }

  const name = project.framework === "next" ? "Next.js" : "Vite";
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Set up preview</DialogTitle>
        <DialogDescription>
          {known
            ? `This is a React + ${name} project. Divina can start it for you with source tagging, so clicks map to exact lines of code.`
            : "How do you start this project's dev server? Divina runs it in this folder, in your login shell."}
        </DialogDescription>

        {known && (
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="radio" checked={!custom} onChange={() => setCustom(false)} />
              Let Divina start it (recommended)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={custom} onChange={() => setCustom(true)} />
              Use my own command (no source tagging)
            </label>
          </div>
        )}

        {custom && (
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1">
              <span className="font-medium">Run command</span>
              <Input
                autoFocus
                className="font-mono"
                placeholder="php artisan serve"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <span className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="rounded bg-muted px-1 font-mono hover:text-foreground" onClick={() => setCommand(ex)}>
                    {ex}
                  </button>
                ))}
              </span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium">Preview URL <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Input
                className="font-mono"
                placeholder="Detected from the command's output"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
              />
              <span className="text-xs text-muted-foreground">
                Set this when the command starts several servers, e.g. <code className="font-mono">http://127.0.0.1:8000</code> for Laravel.
              </span>
            </label>
          </div>
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
