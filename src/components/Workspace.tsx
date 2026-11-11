import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { AgentChat, type ChatEntry } from "@/components/AgentChat";
import { Frame } from "@/components/Frame";
import { Library } from "@/components/Library";
import { editKey, Properties, sameRef, type Selection } from "@/components/Properties";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { PRESETS, scopeFor } from "@/lib/viewport";
import type {
  AgentInfo,
  AgentKind,
  DevServerStatus,
  EditRecord,
  HostToOverlay,
  OverlayToHost,
  ProjectInfo,
} from "@/shared/protocol";

interface DiffResult {
  diff: string;
  files: string[];
  flagged: string[];
}

const sameFile = (a: string, b: string) => a === b || a.endsWith("/" + b) || b.endsWith("/" + a);

/** Files touched by a unified diff, and which of them fall outside the edited files. */
export function changedFiles(diff: string, editFiles: string[]) {
  const files = [...diff.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1]);
  return { files, flagged: files.filter((f) => !editFiles.some((e) => sameFile(e, f))) };
}

function describe(e: EditRecord) {
  const p = e.payload;
  const detail =
    e.kind === "insert" ? p && "component" in p && `${p.component} ${p.position}` :
    e.kind === "move" ? p && "position" in p && p.position :
    e.kind === "text" ? p && "text" in p && `"${p.text}"` :
    p && "classes" in p && p.classes;
  return `${e.kind} ${e.target.file.split("/").pop()}:${e.target.line}${detail ? ` → ${detail}` : ""}`;
}

export function Workspace({ project, onClose }: { project: ProjectInfo; onClose: () => void }) {
  const { root } = project;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewport, setViewport] = useState(PRESETS[0]);
  const scope = scopeFor(viewport);
  const [url, setUrl] = useState<string | null>(null);
  const [frameError, setFrameError] = useState("");
  const [status, setStatus] = useState<DevServerStatus>({ state: "starting" });
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [edits, setEdits] = useState<EditRecord[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [agent, setAgent] = useState<AgentKind | null>(null);
  const [transcript, setTranscript] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [notice, setNotice] = useState("");
  const appliedRef = useRef<EditRecord[]>([]);

  const say = (role: ChatEntry["role"], text: string) => setTranscript((t) => [...t, { role, text }]);
  const post = (msg: HostToOverlay) => iframeRef.current?.contentWindow?.postMessage(msg, "*");

  const connect = () => {
    setFrameError("");
    api.proxyUrl().then(setUrl, (e) => setFrameError(`Preview unavailable: ${e}`));
  };

  // Dev server, logs, proxy URL.
  useEffect(() => {
    api.startDevServer(root).then(setStatus, (e) => setLogs((l) => [...l, `start failed: ${e}`]));
    connect();
    const un = api.onDevServerLog((l) => setLogs((prev) => [...prev.slice(-500), l.line]));
    const poll = setInterval(() => api.devServerStatus().then(setStatus, () => {}), 2000);
    api.detectAgents().then((list) => {
      setAgents(list);
      setAgent(list.find((a) => a.loggedIn)?.kind ?? null);
    }, () => {});
    return () => {
      clearInterval(poll);
      api.stopDevServer().catch(() => {});
      void un.then((f) => f());
    };
  }, [root]);

  useEffect(() => {
    if (status.state === "running" && !url) connect();
  }, [status.state]);

  // Overlay messages. Overlay records get the host's viewport/scope, which the overlay can't know.
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  useEffect(() => {
    const onMessage = (e: MessageEvent<OverlayToHost>) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      const msg = e.data;
      if (msg.type === "ready") post({ type: "set-mode", mode: "select" });
      else if (msg.type === "select") setSelection({ ref: msg.ref, rect: msg.rect, computed: msg.computed });
      else if (msg.type === "edit") {
        const vp = viewportRef.current;
        setEdits((q) => [...q, { ...msg.record, viewport: vp, scope: scopeFor(vp) }]);
      } else if (msg.type === "console-error") setLogs((l) => [...l, `[frame] ${msg.message}`]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function addEdit(partial: Pick<EditRecord, "kind" | "payload">) {
    if (!selection) return;
    const record = { ...partial, id: crypto.randomUUID(), target: selection.ref, viewport, scope } as EditRecord;
    // A newer value for the same control, element and scope replaces the older one.
    setEdits((q) => [
      ...q.filter((e) => !(sameRef(e.target, record.target) && e.scope === scope && editKey(e) === editKey(record))),
      record,
    ]);
  }

  async function latestCheckpoint() {
    const list = await api.listCheckpoints(root);
    return list.reduce<(typeof list)[number] | undefined>((a, c) => (!a || c.createdAt > a.createdAt ? c : a), undefined);
  }

  async function showDiff() {
    try {
      const cp = await latestCheckpoint();
      if (!cp) return;
      const text = await api.diffSinceCheckpoint(root, cp.id);
      setDiff({ diff: text, ...changedFiles(text, appliedRef.current.map((e) => e.target.file)) });
    } catch (e) {
      setNotice(`Diff unavailable: ${e}`);
    }
  }

  function finish(ok: boolean) {
    setRunning(false);
    post({ type: "clear-optimistic" });
    if (ok) setEdits((q) => q.filter((e) => !appliedRef.current.includes(e)));
    showDiff();
  }
  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    const un = api.onAgentEvent((ev) => {
      if (ev.type === "text") say("agent", ev.text);
      else if (ev.type === "tool") say("tool", `${ev.name} ${JSON.stringify(ev.input)}`);
      else if (ev.type === "error") say("error", ev.message);
      else finishRef.current(ev.ok);
    });
    return () => void un.then((f) => f());
  }, []);

  async function run() {
    const prompt = draft.trim();
    if (running || !agent || (!prompt && !edits.length)) return;
    appliedRef.current = edits;
    setRunning(true);
    setDraft("");
    setDiff(null);
    setNotice("");
    if (prompt) say("user", prompt);
    if (edits.length) say("user", `Apply ${edits.length} edit(s)`);
    // ponytail: UI checkpoints before every run; drop if run_agent starts checkpointing itself.
    await api.createCheckpoint(root, prompt || `Apply ${edits.length} edit(s)`).catch((e) => setNotice(`No checkpoint: ${e}`));
    try {
      await api.runAgent(agent, prompt, edits);
    } catch (e) {
      say("error", String(e));
      finishRef.current(false);
    }
  }
  const runRef = useRef(run);
  runRef.current = run;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        runRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function undo() {
    try {
      const cp = await latestCheckpoint();
      if (!cp) return setNotice("No checkpoint to restore.");
      await api.restoreCheckpoint(root, cp.id);
      post({ type: "clear-optimistic" });
      setDiff(null);
      setNotice(`Restored "${cp.label}".`);
    } catch (e) {
      setNotice(`Undo failed: ${e}`);
    }
  }

  return (
    <ResizablePanelGroup className="h-screen bg-background text-foreground">
      <ResizablePanel defaultSize="20" minSize="12">
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b p-2 text-xs">
            <Button size="xs" variant="ghost" onClick={onClose}>← Projects</Button>
            <span className="truncate text-muted-foreground" title={root}>{root.split("/").pop()}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Library root={root} onDragging={setDragging} />
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="55">
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <Frame
              url={url}
              error={frameError}
              onRetry={connect}
              viewport={viewport}
              setViewport={setViewport}
              iframeRef={iframeRef}
              dragging={dragging}
              onDrop={(c, x, y) => {
                setDragging(false);
                post({ type: "preview-insert", component: c.name, importFrom: c.importFrom, x, y });
              }}
            />
          </div>
          <div className="border-t">
            <button className="w-full px-2 py-1 text-left text-xs text-muted-foreground" onClick={() => setLogsOpen(!logsOpen)}>
              {logsOpen ? "▾" : "▸"} Dev server: {status.state}
              {status.state === "running" && ` · ${status.url}`}
            </button>
            {logsOpen && (
              <pre className="h-48 overflow-auto bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap">{logs.join("\n")}</pre>
            )}
          </div>
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="25" minSize="16">
        <div className="flex h-full flex-col">
          <Tabs defaultValue="properties" className="min-h-0 flex-1 p-2">
            <TabsList>
              <TabsTrigger value="properties">Properties</TabsTrigger>
              <TabsTrigger value="agent">Agent</TabsTrigger>
            </TabsList>
            <TabsContent value="properties" className="min-h-0 overflow-auto">
              <Properties selection={selection} scope={scope} edits={edits} onEdit={addEdit} />
            </TabsContent>
            <TabsContent value="agent" className="min-h-0">
              <AgentChat
                transcript={transcript}
                agents={agents}
                agent={agent}
                setAgent={setAgent}
                draft={draft}
                setDraft={setDraft}
                running={running}
                onSend={run}
                onCancel={() => api.cancelAgent().catch((e) => say("error", String(e)))}
              />
            </TabsContent>
          </Tabs>

          <div className="flex max-h-[45%] flex-col gap-2 overflow-auto border-t p-2 text-xs">
            <div className="flex items-center justify-between font-medium">
              <span>Pending edits ({edits.length})</span>
              <span className="text-muted-foreground">{running ? "Agent running…" : ""}</span>
            </div>
            {edits.map((e) => (
              <div key={e.id} className="flex items-center gap-1">
                <span className="flex-1 truncate font-mono" title={`${e.target.file}:${e.target.line}:${e.target.col}`}>
                  {describe(e)}
                </span>
                <Badge variant="outline">{e.scope}</Badge>
                <Button size="icon-xs" variant="ghost" aria-label="Remove edit" onClick={() => setEdits((q) => q.filter((x) => x !== e))}>
                  <X />
                </Button>
              </div>
            ))}
            <div className="flex gap-2">
              <Button className="flex-1" size="sm" disabled={running || !agent || (!edits.length && !draft.trim())} onClick={run}>
                Apply ⌘↵
              </Button>
              <Button size="sm" variant="outline" disabled={running} onClick={undo}>Undo</Button>
            </div>
            {!agent && <p className="text-muted-foreground">No logged-in agent CLI detected.</p>}
            {notice && <p className="text-muted-foreground">{notice}</p>}
            {diff && (
              <div className="flex flex-col gap-1">
                <div className="font-medium">Changed files</div>
                {diff.files.length === 0 && <p className="text-muted-foreground">No changes.</p>}
                {diff.files.map((f) => (
                  <div key={f} className="flex items-center gap-1 font-mono">
                    <span className="truncate">{f}</span>
                    {diff.flagged.includes(f) && <Badge variant="destructive">outside edits</Badge>}
                  </div>
                ))}
                <pre className="max-h-48 overflow-auto rounded bg-muted p-1 font-mono whitespace-pre">{diff.diff}</pre>
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
