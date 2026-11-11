import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SettingsFooter } from "@/components/Settings";
import { api } from "@/lib/api";
import type { ProjectInfo, ProjectTemplate } from "@/shared/protocol";

const RECENT_KEY = "divina.recent";

function loadRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
  } catch {
    return [];
  }
}

function saveRecent(root: string) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([root, ...loadRecent().filter((r) => r !== root)].slice(0, 8)));
  } catch {
    /* storage unavailable: recents just won't persist */
  }
}

/** Folder picker; falls back to the typed path if the dialog plugin isn't available. */
async function pickFolder(fallback: string): Promise<string> {
  try {
    const picked = await open({ directory: true });
    return typeof picked === "string" ? picked : fallback;
  } catch {
    return fallback;
  }
}

export function Welcome({ onOpen }: { onOpen: (p: ProjectInfo) => void }) {
  const [path, setPath] = useState("");
  const [parent, setParent] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("react-vite");
  useEffect(() => { api.listTemplates().then(setTemplates, () => setTemplates([])); }, []);
  const activeTemplate = templates.find((t) => t.id === selectedTemplate);
  const recent = loadRecent();

  async function run(task: () => Promise<ProjectInfo>) {
    setBusy(true);
    setError("");
    try {
      const info = await task();
      saveRecent(info.root);
      onOpen(info);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-screen items-center justify-center bg-background text-foreground">
      <div className="absolute bottom-0 left-0 w-60">
        <SettingsFooter />
      </div>
      <div className="flex w-[28rem] flex-col gap-6">
        <h1 className="text-2xl font-semibold">Divina</h1>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Open project folder</h2>
          <div className="flex gap-2">
            <Input placeholder="/path/to/project" value={path} onChange={(e) => setPath(e.target.value)} />
            <Button variant="outline" onClick={async () => setPath(await pickFolder(path))}>Browse…</Button>
          </div>
          <Button disabled={!path || busy} onClick={() => run(() => api.openProject(path))}>Open</Button>
        </section>

        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-medium">Create new project</h2>
          <div className="flex gap-2">
            <Input placeholder="Parent folder" value={parent} onChange={(e) => setParent(e.target.value)} />
            <Button variant="outline" onClick={async () => setParent(await pickFolder(parent))}>Browse…</Button>
          </div>
          <Input placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
          <Select value={selectedTemplate} onValueChange={(v) => v && setSelectedTemplate(v)}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Choose a template" /></SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id} disabled={!template.available}>
                  <span className="flex flex-col items-start gap-0.5 whitespace-normal">
                    <span>{template.name}</span>
                    <span className="text-xs text-muted-foreground">{template.description}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {activeTemplate?.missing && <p className="text-xs text-muted-foreground">{activeTemplate.missing}</p>}
          <Button disabled={!parent || !name || busy || !activeTemplate?.available} onClick={() => run(() => api.createProject(parent, name, selectedTemplate))}>
            Create
          </Button>
        </section>

        {recent.length > 0 && (
          <section className="flex flex-col gap-1">
            <h2 className="text-sm font-medium">Recent</h2>
            {recent.map((r) => (
              <button
                key={r}
                className="truncate rounded px-2 py-1 text-left text-sm text-muted-foreground hover:bg-muted"
                onClick={() => run(() => api.openProject(r))}
              >
                {r}
              </button>
            ))}
          </section>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </div>
  );
}
