import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import type { CatalogLibrary, Stack } from "@/shared/protocol";

/** Lets the user describe a library the catalog lacks. The install command is only passed to the agent, never run. */
export function AddLibrary({
  root,
  stack,
  open,
  onSaved,
  onCancel,
}: {
  root: string;
  stack: Stack | null;
  open: boolean;
  onSaved: (catalog: CatalogLibrary[], id: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [framework, setFramework] = useState("");
  const [install, setInstall] = useState("");
  const [importFrom, setImportFrom] = useState("");
  const [docs, setDocs] = useState("");
  const [components, setComponents] = useState("");
  const [global, setGlobal] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setName("");
    setFramework(stack && stack.framework !== "unknown" ? stack.framework : "");
    setInstall("");
    setImportFrom("");
    setDocs("");
    setComponents("");
    setGlobal(false);
    setError("");
  }, [open]);

  async function save() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const list = components
      .split("\n")
      .map((l) => {
        const [n, ...usage] = l.split("|");
        return { name: n.trim(), usage: usage.join("|").trim() };
      })
      .filter((c) => c.name);
    if (!id) return setError("Name the library.");
    if (!list.length) return setError("List at least one component.");
    const library: CatalogLibrary = {
      id,
      name: name.trim(),
      framework: framework.trim(),
      versions: "*",
      install: install.trim(),
      importFrom: importFrom.trim() || undefined,
      docs: docs.trim() || undefined,
      custom: true,
      components: list,
    };
    try {
      onSaved(await api.saveLibrary(root, library, global), id);
    } catch (e) {
      setError(String(e));
    }
  }

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string, optional = false) => (
    <label className="flex flex-col gap-1">
      <span className="font-medium">
        {label} {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </span>
      <Input placeholder={placeholder} value={value} onChange={(e) => set(e.target.value)} />
    </label>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Add library</DialogTitle>
        <DialogDescription>
          Describe a component library. When you drop one of its components, the agent gets the install command and usage; Divina never runs it.
        </DialogDescription>
        {field("Name", name, setName, "e.g. Thaw UI")}
        {field("Framework", framework, setFramework, "e.g. leptos")}
        {field("Install command", install, setInstall, "e.g. cargo add thaw")}
        {field("Import path", importFrom, setImportFrom, "e.g. thaw", true)}
        {field("Docs URL", docs, setDocs, "https://…", true)}
        <label className="flex flex-col gap-1">
          <span className="font-medium">Components</span>
          <Textarea
            rows={5}
            className="font-mono"
            placeholder={"Button | <Button>Click</Button>\nCard"}
            value={components}
            onChange={(e) => setComponents(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            One per line: <code className="font-mono">Name</code> or <code className="font-mono">Name | usage</code>.
          </span>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={global} onChange={(e) => setGlobal(e.target.checked)} />
          Save for all my projects
        </label>
        {error && <p className="text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
