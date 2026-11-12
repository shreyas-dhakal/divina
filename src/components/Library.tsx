import { useEffect, useState, type DragEvent } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AddLibrary } from "@/components/AddLibrary";
import { DRAG_MIME } from "@/components/Frame";
import { api } from "@/lib/api";
import type { CatalogLibrary, LibraryComponent, Stack } from "@/shared/protocol";

const SOURCES: Record<LibraryComponent["source"], string> = { shadcn: "shadcn/ui", package: "Packages", local: "Project" };
const PROJECT = "project";
const ADD = "add";

/** "Leptos 0.7", "React 19": major only, unless it's 0.x where the minor is the breaking one. */
function stackLabel(s: Stack | null) {
  if (!s || s.framework === "unknown") return "";
  const [major, minor] = (s.version ?? "").split(".");
  const name = s.framework[0].toUpperCase() + s.framework.slice(1);
  return [name, major === "0" ? `0.${minor}` : major].filter(Boolean).join(" ");
}

// WebKit creates no frame for iframes past 1000 per page (lazy ones count too), so a package with
// thousands of exports (lucide-react) left the preview frame empty. Past this, names only.
// ponytail: first N in list order; render thumbnails as they scroll into view if users miss them.
const MAX_THUMBS = 60;

/** What is being dragged: `live` is the project module the frame can render the real component from. */
export type LibraryDrag = { name: string; live?: string };

/** `previewUrl` is the proxied dev server; Vite projects get live thumbnails from it. */
export function Library({ root, previewUrl, onDragging }: { root: string; previewUrl: string | null; onDragging: (drag: LibraryDrag | null) => void }) {
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  /** Thumbnail result per `importFrom#name`; failed or empty ones fall back to the name. */
  const [rendered, setRendered] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [stack, setStack] = useState<Stack | null>(null);
  const [catalog, setCatalog] = useState<CatalogLibrary[]>([]);
  const [selected, setSelected] = useState(PROJECT);
  const [adding, setAdding] = useState(false);

  const refresh = () => api.listComponents(root).then(setComponents, () => setComponents([]));
  useEffect(() => {
    refresh();
    setSelected(PROJECT);
    // No backend support (or no catalog for this stack) just shows no catalog.
    api.detectStack(root).then(setStack, () => setStack(null));
    api.listCatalog(root).then(setCatalog, () => setCatalog([]));
    const un = api.onInstallerLog((l) => setOutput((o) => [...o.slice(-200), l.line]));
    const onMessage = (e: MessageEvent) => {
      const { divinaPreview: key, ok } = e.data ?? {};
      if (typeof key === "string") setRendered((r) => ({ ...r, [key]: ok === true }));
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      void un.then((f) => f());
    };
  }, [root]);

  async function install() {
    setInstalling(true);
    setOutput([`$ ${command}`]);
    try {
      setComponents(await api.runInstaller(root, command));
      setCommand("");
    } catch (e) {
      setOutput((o) => [...o, `error: ${e}`]);
    } finally {
      setInstalling(false);
    }
  }

  const q = query.toLowerCase();
  const shown = components.filter((c) => c.name.toLowerCase().includes(q));
  /** Thumbnail iframes rendered so far in this pass; see MAX_THUMBS. */
  let thumbs = 0;
  const lib = catalog.find((l) => l.id === selected);
  const items = [{ value: PROJECT, label: "Your project" }, ...catalog.map((l) => ({ value: l.id, label: l.name }))];

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm">
      <div className="flex items-center gap-2">
        <Select
          items={items}
          value={lib ? selected : PROJECT}
          onValueChange={(v) => (v === ADD ? setAdding(true) : v && setSelected(v))}
        >
          <SelectTrigger size="sm" className="min-w-0 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {items.map((i) => (
              <SelectItem key={i.value} value={i.value}>{i.label}</SelectItem>
            ))}
            <SelectSeparator />
            <SelectItem value={ADD}>Add library…</SelectItem>
          </SelectContent>
        </Select>
        <span className="shrink-0 text-xs text-muted-foreground">{stackLabel(stack)}</span>
      </div>
      <Input placeholder="Search components" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ScrollArea className="min-h-0 flex-1">
        {lib && <CatalogGrid lib={lib} query={q} project={components} onDragging={onDragging} />}
        {!lib && shown.length === 0 && <p className="p-2 text-muted-foreground">No components found.</p>}
        {!lib && (Object.keys(SOURCES) as LibraryComponent["source"][]).map((src) => {
          const group = shown.filter((c) => c.source === src);
          if (!group.length) return null;
          return (
            <div key={src} className="mb-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground uppercase">{SOURCES[src]}</h3>
              {group.map((c) => {
                const key = `${c.importFrom}#${c.name}`;
                const thumb = c.previewable && previewUrl && rendered[key] !== false && thumbs++ < MAX_THUMBS;
                const src = previewUrl && `${new URL("/.divina/preview.html", previewUrl)}?m=${encodeURIComponent(c.importFrom)}&n=${encodeURIComponent(c.name)}`;
                return (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "copy";
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(c));
                    dragChip(e, c.name);
                    onDragging({ name: c.name, ...(c.previewable && { live: c.importFrom }) });
                  }}
                  onDragEnd={() => onDragging(null)}
                  className="cursor-grab rounded px-2 py-1 hover:bg-muted"
                  title={c.importFrom}
                >
                  {thumb && (
                    <div className="relative mb-1 h-20 overflow-hidden rounded border bg-background">
                      {/* No pointer events, so the drag starts on this row, not inside the iframe. */}
                      <iframe
                        src={src!}
                        loading="lazy"
                        tabIndex={-1}
                        className={`pointer-events-none size-full ${rendered[key] ? "" : "opacity-0"}`}
                        // A page that never reports (not a Vite server, a 404) falls back to the name.
                        onLoad={() => setTimeout(() => setRendered((r) => (key in r ? r : { ...r, [key]: false })), 5000)}
                      />
                    </div>
                  )}
                  {c.name}
                </div>
                );
              })}
            </div>
          );
        })}
      </ScrollArea>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (command.trim() && !installing) install();
        }}
      >
        <Input
          placeholder="pnpm dlx shadcn@latest add button"
          value={command}
          disabled={installing}
          onChange={(e) => setCommand(e.target.value)}
          className="font-mono text-xs"
        />
      </form>
      {output.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-xs whitespace-pre-wrap">{output.join("\n")}</pre>
      )}
      <AddLibrary
        root={root}
        stack={stack}
        open={adding}
        onCancel={() => setAdding(false)}
        onSaved={(c, id) => {
          setCatalog(c);
          setSelected(id);
          setAdding(false);
        }}
      />
    </div>
  );
}

/** A small named chip under the cursor instead of the browser's snapshot of the whole card. */
function dragChip(e: DragEvent, name: string) {
  const chip = document.createElement("div");
  chip.textContent = name;
  chip.className = "fixed -top-96 rounded-md border border-primary bg-background px-3 py-1 text-xs font-medium text-primary shadow-lg";
  document.body.append(chip);
  e.dataTransfer.setDragImage(chip, 12, 12);
  // The drag image is captured synchronously, so the chip can go on the next tick.
  setTimeout(() => chip.remove());
}

function CatalogGrid({ lib, query, project, onDragging }: { lib: CatalogLibrary; query: string; project: LibraryComponent[]; onDragging: (drag: LibraryDrag | null) => void }) {
  const shown = lib.components.filter((c) => c.name.toLowerCase().includes(query));
  if (!shown.length) return <p className="p-2 text-muted-foreground">No components found.</p>;
  return (
    <div className="grid grid-cols-2 gap-2">
      {shown.map((c) => (
        <div
          key={c.name}
          draggable
          onDragStart={(e) => {
            // `library` marks a catalog drop; Workspace forwards it in preview-insert.
            const library = { id: lib.id, name: lib.name, install: lib.install, usage: c.usage };
            e.dataTransfer.effectAllowed = "copy";
            e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ name: c.name, importFrom: lib.importFrom ?? "", library }));
            dragChip(e, c.name);
            // Already installed in the project (shadcn copies components in): the frame can render the real one.
            const mine = project.find((p) => p.name === c.name && p.source === "shadcn" && p.previewable);
            onDragging({ name: c.name, ...(mine && { live: mine.importFrom }) });
          }}
          onDragEnd={() => onDragging(null)}
          className="cursor-grab overflow-hidden rounded border hover:bg-muted"
          title={c.usage || c.name}
        >
          {c.thumbnail && (
            <img
              src={c.thumbnail}
              alt=""
              draggable={false}
              loading="lazy"
              className="h-16 w-full border-b bg-background object-contain"
              onError={(e) => (e.currentTarget.hidden = true)}
            />
          )}
          <div className="truncate px-2 py-1 text-xs">{c.name}</div>
        </div>
      ))}
    </div>
  );
}
