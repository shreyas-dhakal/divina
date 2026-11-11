import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { AgentChat, type ChatEntry } from "@/components/AgentChat";
import { Frame } from "@/components/Frame";
import { Library } from "@/components/Library";
import { RunSetup } from "@/components/RunSetup";
import { SettingsFooter } from "@/components/Settings";
import { editKey, Properties, sameRef, type Selection } from "@/components/Properties";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { installMcpBridge, type McpRequest } from "@/lib/mcpBridge";
import { PRESETS, scopeFor } from "@/lib/viewport";
import type {
  AgentInfo,
  AgentKind,
  DevServerStatus,
  EditRecord,
  HostToOverlay,
  LibraryComponent,
  LibraryRef,
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
  const [info, setInfo] = useState(project);
  /** First open of a project asks how to run it; the dev server starts once that's saved. */
  const [setupOpen, setSetupOpen] = useState(project.run === null);
  const [runKey, setRunKey] = useState(0);
  const [status, setStatus] = useState<DevServerStatus>({ state: project.run ? "starting" : "stopped" });
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
  /** Checkpoints taken before each run, newest last; Undo walks back through them. */
  const runCheckpoints = useRef<string[]>([]);
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const consoleErrors = useRef<string[]>([]);
  /** Overlay replies (dom-snapshot, screenshot-response) awaited by requestId. */
  const pending = useRef(new Map<string, (value: unknown) => void>());

  const say = (role: ChatEntry["role"], text: string) => setTranscript((t) => [...t, { role, text }]);
  const post = (msg: HostToOverlay) => iframeRef.current?.contentWindow?.postMessage(msg, "*");

  const connect = () => {
    setFrameError("");
    api.proxyUrl().then(setUrl, (e) => setFrameError(`Preview unavailable: ${e}`));
  };

  // Dev server, logs, proxy URL.
  useEffect(() => {
    if (info.run) {
      setStatus({ state: "starting" });
      setUrl(null);
      api.startDevServer(root).then(setStatus, (e) => {
        if (String(e) === "NEEDS_RUN_CONFIG") setSetupOpen(true);
        else setLogs((l) => [...l, `start failed: ${e}`]);
      });
      connect();
    }
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
  }, [root, runKey]);

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
      } else if (msg.type === "dom-snapshot") pending.current.get(msg.requestId)?.(msg.root);
      else if (msg.type === "screenshot-response") pending.current.get(msg.requestId)?.({ dataUrl: msg.dataUrl });
      else if (msg.type === "console-error") {
        consoleErrors.current = [...consoleErrors.current.slice(-99), msg.message];
        setLogs((l) => [...l, `[frame] ${msg.message}`]);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  function askOverlay(msg: HostToOverlay & { requestId: string }) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("preview did not answer")), 8000);
      pending.current.set(msg.requestId, (v) => {
        clearTimeout(timer);
        pending.current.delete(msg.requestId);
        resolve(v);
      });
      post(msg);
    });
  }

  // MCP bridge: the agent's tool calls are answered from host state or the preview iframe.
  useEffect(() => {
    const relay = async (req: McpRequest): Promise<unknown> => {
      const requestId = req.id;
      if (req.tool === "get_pending_edits") return editsRef.current;
      if (req.tool === "get_console_errors") return consoleErrors.current;
      if (req.tool === "get_dom_snapshot") return askOverlay({ type: "request-snapshot", requestId });
      const frame = iframeRef.current?.getBoundingClientRect();
      if (frame) {
        try {
          return { dataUrl: await api.snapshotFrame(frame, viewportRef.current.width) };
        } catch (e) {
          setLogs((l) => [...l, `native snapshot failed, using in-page capture: ${e}`]);
        }
      }
      return askOverlay({ type: "screenshot-request", requestId });
    };
    const un = installMcpBridge(relay);
    return () => void un.then((f) => f());
  }, []);

  function addEdit(partial: Pick<EditRecord, "kind" | "payload">) {
    if (!selection) return;
    const record = { ...partial, id: crypto.randomUUID(), target: selection.ref, viewport, scope } as EditRecord;
    // A newer value for the same control, element and scope replaces the older one.
    setEdits((q) => [
      ...q.filter((e) => !(sameRef(e.target, record.target) && e.scope === scope && editKey(e) === editKey(record))),
      record,
    ]);
    post({ type: "preview-edit", record });
  }

  async function showDiff() {
    const cp = runCheckpoints.current[runCheckpoints.current.length - 1];
    if (!cp) return;
    try {
      const d = await api.diffSinceCheckpoint(root, cp);
      setDiff({ diff: d.diff, ...changedFiles(d.diff, appliedRef.current.map((e) => e.target.file)) });
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
      else if (ev.type === "tool") say("tool", `${ev.name} ${JSON.stringify(ev.input)}`.slice(0, 300));
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
    // The agent works from the edit list; previews left in the DOM would mix with its HMR'd result.
    post({ type: "clear-optimistic" });
    try {
      let cp;
      try {
        cp = await api.runAgent(agent, root, prompt, edits);
      } catch (e) {
        // Checkpoints need git; ask once, then retry.
        if (String(e) !== "NO_GIT_REPO") throw e;
        const ok = await ask("This project isn't a git repository. Divina keeps undo checkpoints in git. Initialise one here?", {
          title: "Enable checkpoints",
        });
        if (!ok) throw new Error("Cancelled: checkpoints need a git repository.");
        await api.initGit(root);
        cp = await api.runAgent(agent, root, prompt, edits);
      }
      runCheckpoints.current.push(cp.id);
    } catch (e) {
      say("error", String(e));
      setRunning(false);
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
    const cp = runCheckpoints.current[runCheckpoints.current.length - 1];
    if (!cp) return setNotice("Nothing to undo.");
    try {
      await api.restoreCheckpoint(root, cp);
      runCheckpoints.current.pop();
      post({ type: "clear-optimistic" });
      setDiff(null);
      setNotice(`Restored checkpoint ${cp}.`);
    } catch (e) {
      setNotice(`Undo failed: ${e}`);
    }
  }

  return (
    // The panel group sets an inline height:100%, so the viewport height lives on a wrapper.
    <div className="h-screen bg-background text-foreground">
    <ResizablePanelGroup>
      <ResizablePanel defaultSize="20" minSize="12">
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b p-2 text-xs">
            <Button size="xs" variant="ghost" onClick={onClose}>← Projects</Button>
            <span className="truncate text-muted-foreground" title={root}>{root.split("/").pop()}</span>
          </div>
          <div className="min-h-0 flex-1">
            <Library root={root} previewUrl={url} onDragging={setDragging} />
          </div>
          <SettingsFooter
            onAgents={(list) => {
              setAgents(list);
              setAgent((cur) => (list.some((a) => a.kind === cur && a.loggedIn) ? cur : list.find((a) => a.loggedIn)?.kind ?? null));
            }}
          />
        </div>
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel defaultSize="55">
        <div className="flex h-full flex-col">
          <div className="min-h-0 flex-1">
            <Frame
              url={url}
              error={info.run ? frameError : "Preview not set up yet."}
              onRetry={info.run ? connect : () => setSetupOpen(true)}
              viewport={viewport}
              setViewport={setViewport}
              iframeRef={iframeRef}
              dragging={dragging}
              onHover={({ x, y }) => post({ type: "insert-hover", x, y })}
              onDrop={(c, x, y) => {
                setDragging(false);
                // Catalog cards carry `library`; project components don't, so their payload is unchanged.
                const { library } = c as LibraryComponent & { library?: LibraryRef };
                post({ type: "preview-insert", component: c.name, importFrom: c.importFrom, x, y, ...(library && { library }) });
              }}
            />
          </div>
          <div className="border-t">
            <div className="flex items-center text-xs text-muted-foreground">
              <button className="flex-1 truncate px-2 py-1 text-left" onClick={() => setLogsOpen(!logsOpen)}>
                {logsOpen ? "▾" : "▸"} Dev server: {info.run ? status.state : "not set up"}
                {status.state === "running" && ` · ${status.url}`}
                {info.run?.command && ` · ${info.run.command.split("\n")[0]}${info.run.command.includes("\n") ? " …" : ""}`}
              </button>
              <Button size="xs" variant="ghost" onClick={() => setSetupOpen(true)}>
                {info.run ? "Run command…" : "Set up preview"}
              </Button>
            </div>
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
    <RunSetup
      project={info}
      open={setupOpen}
      onCancel={() => setSetupOpen(false)}
      onSaved={(p) => {
        setInfo(p);
        setSetupOpen(false);
        setRunKey((k) => k + 1);
      }}
    />
    </div>
  );
}
