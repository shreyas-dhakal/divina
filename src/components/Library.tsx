import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DRAG_MIME } from "@/components/Frame";
import { api } from "@/lib/api";
import type { LibraryComponent } from "@/shared/protocol";

const SOURCES: Record<LibraryComponent["source"], string> = { shadcn: "shadcn/ui", package: "Packages", local: "Project" };

/** `previewUrl` is the proxied dev server; Vite projects get live thumbnails from it. */
export function Library({ root, previewUrl, onDragging }: { root: string; previewUrl: string | null; onDragging: (d: boolean) => void }) {
  const [components, setComponents] = useState<LibraryComponent[]>([]);
  /** Thumbnail result per `importFrom#name`; failed or empty ones fall back to the name. */
  const [rendered, setRendered] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);

  const refresh = () => api.listComponents(root).then(setComponents, () => setComponents([]));
  useEffect(() => {
    refresh();
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

  return (
    <div className="flex h-full flex-col gap-2 p-2 text-sm">
      <Input placeholder="Search components" value={query} onChange={(e) => setQuery(e.target.value)} />
      <ScrollArea className="min-h-0 flex-1">
        {shown.length === 0 && <p className="p-2 text-muted-foreground">No components found.</p>}
        {(Object.keys(SOURCES) as LibraryComponent["source"][]).map((src) => {
          const group = shown.filter((c) => c.source === src);
          if (!group.length) return null;
          return (
            <div key={src} className="mb-3">
              <h3 className="px-2 pb-1 text-xs font-medium text-muted-foreground uppercase">{SOURCES[src]}</h3>
              {group.map((c) => {
                const key = `${c.importFrom}#${c.name}`;
                const thumb = c.previewable && previewUrl && rendered[key] !== false;
                const src = previewUrl && `${new URL("/.divina/preview.html", previewUrl)}?m=${encodeURIComponent(c.importFrom)}&n=${encodeURIComponent(c.name)}`;
                return (
                <div
                  key={key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(c));
                    onDragging(true);
                  }}
                  onDragEnd={() => onDragging(false)}
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
    </div>
  );
}
