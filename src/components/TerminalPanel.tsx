import { useEffect, useRef, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import { FitAddon, init, Terminal, type ITheme } from "ghostty-web";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { AgentInfo, TerminalKind } from "@/shared/protocol";

export interface TerminalTab {
  id: string;
  kind: TerminalKind;
  title: string;
  /** The child is gone (or never started); the tab stays until closed. */
  exited: boolean;
}

const KINDS: { kind: TerminalKind; name: string; login?: string }[] = [
  { kind: "shell", name: "Shell" },
  { kind: "claude", name: "Claude Code", login: "claude auth login" },
  { kind: "codex", name: "Codex", login: "codex login" },
  { kind: "opencode", name: "opencode", login: "opencode auth login" },
];
const FONT = '"SF Mono", Menlo, monospace';
const LIGHT: ITheme = { background: "#ffffff", foreground: "#1f1f1f", cursor: "#1f1f1f", selectionBackground: "#d4d4d8" };
const DARK: ITheme = { background: "#1c1c1c", foreground: "#e5e5e5", cursor: "#e5e5e5", selectionBackground: "#3f3f46" };
/** Loads the WASM once, on the first terminal (not at import, so tests can import this module). */
let ready: Promise<void> | undefined;

/** Why a kind can't start right now, or "" when it can. */
function unavailable(kind: TerminalKind, agents: AgentInfo[]) {
  if (kind === "shell") return "";
  const a = agents.find((x) => x.kind === kind);
  const k = KINDS.find((x) => x.kind === kind);
  if (!a) return "Not installed";
  return a.loggedIn ? "" : `Not logged in: run ${k?.login}`;
}

function nextTitle(kind: TerminalKind, tabs: TerminalTab[]) {
  const name = KINDS.find((k) => k.kind === kind)!.name;
  const used = new Set(tabs.map((t) => t.title));
  let n = 1;
  while (used.has(n === 1 ? name : `${name} ${n}`)) n++;
  return n === 1 ? name : `${name} ${n}`;
}

const decode = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const red = (s: string) => `\r\n\x1b[31m${s}\x1b[0m\r\n`;

/** Ghostty-style terminal tabs. Each tab keeps its terminal mounted so scrollback survives switching. */
export function TerminalPanel({
  root,
  agents,
  onActive,
}: {
  root: string;
  agents: AgentInfo[];
  onActive: (tab: TerminalTab | null) => void;
}) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const terms = useRef(new Map<string, Terminal>());
  /** Output that arrived before its terminal was created (the child starts before terminal_open resolves). */
  const early = useRef(new Map<string, (string | Uint8Array)[]>());
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;

  const write = (id: string, data: string | Uint8Array) => {
    const term = terms.current.get(id);
    if (term) term.write(data);
    else early.current.set(id, [...(early.current.get(id) ?? []), data]);
  };

  useEffect(() => {
    onActive(tabs.find((t) => t.id === active) ?? null);
  }, [tabs, active]);

  useEffect(() => {
    const unData = api.onTerminalData((d) => write(d.id, decode(d.data)));
    const unExit = api.onTerminalExit((e) => {
      write(e.id, `\r\n[process exited (${e.code ?? "signal"})]\r\n`);
      setTabs((ts) => ts.map((t) => (t.id === e.id ? { ...t, exited: true } : t)));
    });
    return () => {
      void unData.then((f) => f());
      void unExit.then((f) => f());
      api.terminalCloseAll().catch(() => {});
    };
  }, []);

  async function open(kind: TerminalKind) {
    const title = nextTitle(kind, tabsRef.current);
    // Opened at a guess; the view fits and resizes the PTY once it's mounted.
    try {
      const info = await api.terminalOpen(root, kind, 80, 24);
      setTabs((ts) => [...ts, { id: info.id, kind, title, exited: false }]);
      setActive(info.id);
    } catch (e) {
      const id = crypto.randomUUID();
      write(id, red(`Could not start ${title}: ${e}`));
      setTabs((ts) => [...ts, { id, kind, title, exited: true }]);
      setActive(id);
    }
  }

  function close(id: string) {
    api.terminalClose(id).catch(() => {});
    terms.current.delete(id);
    early.current.delete(id);
    const ts = tabsRef.current;
    const i = ts.findIndex((t) => t.id === id);
    const rest = ts.filter((t) => t.id !== id);
    setTabs(rest);
    if (activeRef.current === id) setActive(rest[Math.min(i, rest.length - 1)]?.id ?? null);
  }

  // Shortcuts, captured before the focused terminal sees them.
  const openRef = useRef(open);
  openRef.current = open;
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const ts = tabsRef.current;
      const i = ts.findIndex((t) => t.id === activeRef.current);
      let handled = true;
      if (e.code === "KeyT" && !e.shiftKey) openRef.current(ts[i]?.kind ?? "shell");
      // Swallowed even with no tabs, so ⌘W never closes the window.
      else if (e.code === "KeyW" && !e.shiftKey) activeRef.current && closeRef.current(activeRef.current);
      else if (/^Digit[1-9]$/.test(e.code) && !e.shiftKey) {
        const n = Number(e.code.slice(5));
        const t = n === 9 ? ts[ts.length - 1] : ts[n - 1];
        if (t) setActive(t.id);
      } else if ((e.code === "BracketLeft" || e.code === "BracketRight") && e.shiftKey && ts.length) {
        const step = e.code === "BracketLeft" ? -1 : 1;
        setActive(ts[(i + step + ts.length) % ts.length].id);
      } else handled = false;
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    if (active) terms.current.get(active)?.focus();
  }, [active]);

  const menu = (
    <Menu.Root>
      <Menu.Trigger render={<Button size="icon-xs" variant="ghost" aria-label="New tab" title="New tab (⌘T)" />}>
        <Plus />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner className="isolate z-50" sideOffset={4} align="end">
          <Menu.Popup className="min-w-44 rounded-lg bg-popover p-1 text-xs text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none">
            {KINDS.map(({ kind, name }) => {
              const why = unavailable(kind, agents);
              return (
                <Menu.Item
                  key={kind}
                  disabled={!!why}
                  onClick={() => open(kind)}
                  className="flex cursor-default flex-col rounded-md px-2 py-1 outline-none select-none data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                >
                  <span>{name}</span>
                  {why && <span className="text-muted-foreground">{why}</span>}
                </Menu.Item>
              );
            })}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-0.5 border-b px-1 text-xs">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((t, i) => (
            <div
              key={t.id}
              role="tab"
              aria-selected={t.id === active}
              title={i < 9 ? `${t.title} (⌘${i + 1})` : t.title}
              onClick={() => setActive(t.id)}
              className={`group flex min-w-0 flex-1 basis-24 cursor-default items-center gap-1 rounded-t-md px-2 py-1 ${
                t.id === active ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <span className={`flex-1 truncate text-center ${t.exited ? "italic" : ""}`}>{t.title}</span>
              <button
                aria-label={`Close ${t.title}`}
                className="rounded opacity-0 group-hover:opacity-100 hover:bg-foreground/10 group-aria-selected:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.id);
                }}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        {menu}
      </div>
      {tabs.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-muted-foreground">
          <p>Run a shell or an agent CLI here. Agents get Divina's canvas tools.</p>
          <div className="flex flex-wrap justify-center gap-1">
            {KINDS.map(({ kind, name }) => {
              const why = unavailable(kind, agents);
              return (
                <Button key={kind} size="xs" variant="outline" disabled={!!why} title={why || undefined} onClick={() => open(kind)}>
                  {name}
                </Button>
              );
            })}
          </div>
        </div>
      )}
      {tabs.map((t) => (
        <TerminalView
          key={t.id}
          id={t.id}
          hidden={t.id !== active}
          onReady={(term) => {
            terms.current.set(t.id, term);
            for (const d of early.current.get(t.id) ?? []) term.write(d);
            early.current.delete(t.id);
          }}
          exited={t.exited}
        />
      ))}
    </div>
  );
}

function TerminalView({
  id,
  hidden,
  exited,
  onReady,
}: {
  id: string;
  hidden: boolean;
  exited: boolean;
  onReady: (term: Terminal) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const exitedRef = useRef(exited);
  exitedRef.current = exited;

  useEffect(() => {
    let term: Terminal | undefined;
    let gone = false;
    void (ready ??= init()).then(() => {
      if (gone || !ref.current) return;
      // ponytail: theme is fixed when the tab opens (ghostty-web can't retheme after open()); new tabs follow a theme switch.
      const dark = document.documentElement.classList.contains("dark");
      term = new Terminal({ fontFamily: FONT, fontSize: 12, cursorBlink: true, theme: dark ? DARK : LIGHT });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(ref.current);
      term.onData((data) => {
        if (!exitedRef.current) api.terminalWrite(id, data).catch(() => {});
      });
      term.onResize(({ cols, rows }) => {
        if (!exitedRef.current) api.terminalResize(id, cols, rows).catch(() => {});
      });
      fit.fit();
      fit.observeResize();
      onReady(term);
      term.focus();
    }, (e) => {
      if (ref.current) ref.current.textContent = `Terminal failed to load: ${e}`;
    });
    return () => {
      gone = true;
      term?.dispose();
    };
  }, [id]);

  return <div ref={ref} hidden={hidden} className="min-h-0 flex-1 overflow-hidden p-1" />;
}
