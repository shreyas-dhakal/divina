import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Settings as SettingsIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import type { AgentInfo, AgentKind } from "@/shared/protocol";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "divina.theme";

export function loadTheme(): Theme {
  try {
    return (localStorage.getItem(THEME_KEY) as Theme) || "system";
  } catch {
    return "system";
  }
}

export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

const CONNECTORS: { kind: AgentKind; name: string; install: string; login: string }[] = [
  { kind: "claude", name: "Claude Code", install: "npm i -g @anthropic-ai/claude-code", login: "claude auth login" },
  { kind: "codex", name: "Codex", install: "npm i -g @openai/codex", login: "codex login" },
  { kind: "opencode", name: "opencode", install: "npm i -g opencode-ai", login: "opencode auth login" },
];

type Section = "general" | "connectors" | "about";

/** Bottom-left account row: the user's name and a settings button that opens the settings dialog. */
export function SettingsFooter({ onAgents }: { onAgents?: (agents: AgentInfo[]) => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("general");
  const [name, setName] = useState("");
  const [theme, setTheme] = useState(loadTheme);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
    api.userName().then(setName, () => {});
    getVersion().then(setVersion, () => {});
  }, []);

  function scan() {
    setScanning(true);
    api.detectAgents()
      .then((list) => {
        setAgents(list);
        onAgents?.(list);
      }, () => setAgents([]))
      .finally(() => setScanning(false));
    api.startMcpServer().then((i) => setMcpUrl(i.url), () => setMcpUrl(""));
  }

  useEffect(() => {
    if (open && section === "connectors" && agents === null) scan();
  }, [open, section]);

  function pickTheme(t: Theme) {
    setTheme(t);
    applyTheme(t);
    try {
      localStorage.setItem(THEME_KEY, t);
    } catch {
      /* storage unavailable: theme resets next launch */
    }
  }

  const label = name || "Settings";
  return (
    <>
      <button
        className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-muted"
        onClick={() => setOpen(true)}
        aria-label="Open settings"
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
          {label[0]?.toUpperCase()}
        </span>
        <span className="flex-1 truncate">{label}</span>
        <SettingsIcon className="size-4 text-muted-foreground" />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[28rem] gap-0 p-0 sm:max-w-2xl">
          <nav className="flex w-40 shrink-0 flex-col gap-1 border-r p-2">
            <DialogTitle className="px-2 py-1 text-sm">Settings</DialogTitle>
            {(["general", "connectors", "about"] as const).map((s) => (
              <button
                key={s}
                className={`rounded-md px-2 py-1 text-left text-sm capitalize ${section === s ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted"}`}
                onClick={() => setSection(s)}
              >
                {s}
              </button>
            ))}
          </nav>

          <div className="min-w-0 flex-1 overflow-auto p-4">
            {section === "general" && (
              <div className="flex flex-col gap-4">
                <h3 className="font-medium">General</h3>
                <div className="flex items-center justify-between">
                  <span>Appearance</span>
                  <div className="flex gap-1">
                    {(["system", "light", "dark"] as const).map((t) => (
                      <Button key={t} size="sm" variant={theme === t ? "default" : "outline"} className="capitalize" onClick={() => pickTheme(t)}>
                        {t}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {section === "connectors" && (
              <div className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">Connectors</h3>
                  <Button size="sm" variant="outline" disabled={scanning} onClick={scan}>
                    {scanning ? "Checking…" : "Refresh"}
                  </Button>
                </div>
                <p className="text-muted-foreground">
                  Divina uses the coding agents installed on this Mac, with your existing logins. No API key needed.
                </p>
                {CONNECTORS.map((c) => {
                  const found = agents?.find((a) => a.kind === c.kind);
                  const state = agents === null ? "checking" : !found ? "missing" : found.loggedIn ? "connected" : "logged-out";
                  return (
                    <div key={c.kind} className="flex flex-col gap-1 rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{c.name}</span>
                        {state === "connected" && <Badge>Connected</Badge>}
                        {state === "logged-out" && <Badge variant="secondary">Not logged in</Badge>}
                        {state === "missing" && <Badge variant="outline">Not installed</Badge>}
                        {state === "checking" && <Badge variant="outline">Checking…</Badge>}
                      </div>
                      {found && (
                        <span className="truncate font-mono text-xs text-muted-foreground" title={found.path}>
                          {found.version} · {found.path}
                        </span>
                      )}
                      {(state === "missing" || state === "logged-out") && (
                        <span className="text-xs text-muted-foreground">
                          Run in a terminal: <code className="rounded bg-muted px-1 font-mono">{state === "missing" ? c.install : c.login}</code>, then Refresh.
                        </span>
                      )}
                    </div>
                  );
                })}
                <div className="flex flex-col gap-1 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">Divina preview tools (MCP)</span>
                    <Badge variant={mcpUrl ? "default" : "outline"}>{mcpUrl ? "Running" : "Stopped"}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    Lets the agent take screenshots of the frame and read the page. Connected to agents automatically.
                  </span>
                  {mcpUrl && <span className="font-mono text-xs text-muted-foreground">{mcpUrl}</span>}
                </div>
              </div>
            )}

            {section === "about" && (
              <div className="flex flex-col gap-2">
                <h3 className="font-medium">Divina {version}</h3>
                <p className="text-muted-foreground">Figma for a real frontend.</p>
                <p className="text-muted-foreground">Licensed under AGPL-3.0.</p>
                <Button size="sm" variant="outline" className="self-start" onClick={() => openUrl("https://github.com/shreyas-dhakal/divina")}>
                  GitHub
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
