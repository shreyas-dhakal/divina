import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy, Info, Keyboard, Monitor, Moon, Plug, RefreshCw, Settings as SettingsIcon, SlidersHorizontal, Sun } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Item, ItemActions, ItemContent, ItemDescription, ItemFooter, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import icon from "@/assets/icon.svg";
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

const THEMES = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
] as const;

const SECTIONS = [
  { value: "general", label: "General", icon: SlidersHorizontal },
  { value: "connectors", label: "Connectors", icon: Plug },
  { value: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { value: "about", label: "About", icon: Info },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

// Mirrors docs/PRODUCT.md (canvas zoom, pan, tools); each entry is one or more alternative key combos.
const SHORTCUTS: { group: string; rows: { label: string; keys: string[][] }[] }[] = [
  { group: "Tools", rows: [
    { label: "Select", keys: [["V"]] },
    { label: "Hand (pan)", keys: [["H"], ["Space", "drag"]] },
    { label: "Snap into the layout while dragging", keys: [["⇧", "drag"]] },
  ] },
  { group: "Zoom", rows: [
    { label: "Zoom in / out", keys: [["⌘", "+"], ["⌘", "−"]] },
    { label: "Zoom around the pointer", keys: [["⌘", "scroll"]] },
    { label: "Fit the frame", keys: [["⌘", "0"], ["⇧", "1"]] },
    { label: "100%", keys: [["⌘", "1"], ["⇧", "0"]] },
  ] },
  { group: "Panels", rows: [{ label: "Hide or show both sidebars", keys: [["⌘", "\\"]] }] },
];

function Heading({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-medium">{title}</h3>
        {children && <p className="text-sm text-muted-foreground">{children}</p>}
      </div>
      {action}
    </div>
  );
}

/** A terminal command with a copy button; Divina never runs it for the user. */
function Command({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex w-full items-center gap-2 rounded-md bg-muted px-2 py-1">
      <code className="min-w-0 flex-1 truncate font-mono text-xs">{children}</code>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copy command"
        onClick={() => navigator.clipboard.writeText(children).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {})}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  );
}

/** Bottom-left settings row, and the settings dialog it opens. */
export function SettingsFooter({ onAgents }: { onAgents?: (agents: AgentInfo[]) => void }) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("general");
  const [theme, setTheme] = useState(loadTheme);
  const [agents, setAgents] = useState<AgentInfo[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [mcpUrl, setMcpUrl] = useState("");
  const [version, setVersion] = useState("");

  useEffect(() => {
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

  return (
    <>
      <button
        className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        <SettingsIcon className="size-4" />
        Settings
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="h-[32rem] gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <Tabs orientation="vertical" value={section} onValueChange={(v) => setSection(v as Section)} className="h-full min-h-0 gap-0">
            <nav className="flex w-48 shrink-0 flex-col gap-3 border-r bg-muted/40 p-3">
              <div className="flex flex-col gap-0.5 px-2 pt-1">
                <DialogTitle>Settings</DialogTitle>
                <DialogDescription className="text-xs">Saved on this Mac.</DialogDescription>
              </div>
              <TabsList variant="line" className="w-full">
                {SECTIONS.map((s) => (
                  <TabsTrigger key={s.value} value={s.value} className="justify-start gap-2 px-2 py-1.5">
                    <s.icon />
                    {s.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </nav>

            <div className="min-w-0 flex-1 overflow-auto p-6">
              <TabsContent value="general" className="flex flex-col gap-4">
                <Heading title="General">How Divina looks.</Heading>
                <Item variant="outline">
                  <ItemContent>
                    <ItemTitle>Appearance</ItemTitle>
                    <ItemDescription>System follows your Mac as it switches between light and dark.</ItemDescription>
                  </ItemContent>
                  <ItemActions>
                    <ToggleGroup variant="outline" size="sm" spacing={0} value={[theme]} onValueChange={(v) => v[0] && pickTheme(v[0] as Theme)}>
                      {THEMES.map((t) => (
                        <ToggleGroupItem key={t.value} value={t.value} aria-label={t.label}>
                          <t.icon />
                          {t.label}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </ItemActions>
                </Item>
              </TabsContent>

              <TabsContent value="connectors" className="flex flex-col gap-4">
                <Heading
                  title="Connectors"
                  action={
                    <Button size="sm" variant="outline" className="mr-8" disabled={scanning} onClick={scan}>
                      <RefreshCw className={scanning ? "animate-spin" : undefined} />
                      {scanning ? "Checking…" : "Refresh"}
                    </Button>
                  }
                >
                  Divina uses the coding agents installed on this Mac, with your existing logins. No API key needed.
                </Heading>
                <ItemGroup className="gap-2">
                  {CONNECTORS.map((c) => {
                    const found = agents?.find((a) => a.kind === c.kind);
                    const state = agents === null ? "checking" : !found ? "missing" : found.loggedIn ? "connected" : "logged-out";
                    return (
                      <Item key={c.kind} variant="outline">
                        <ItemContent>
                          <ItemTitle>{c.name}</ItemTitle>
                          <ItemDescription className="truncate font-mono text-xs" title={found?.path}>
                            {found ? `${found.version} · ${found.path}` : state === "checking" ? "Looking for it…" : "Not found on this Mac."}
                          </ItemDescription>
                        </ItemContent>
                        <ItemActions>
                          {state === "connected" && <Badge>Connected</Badge>}
                          {state === "logged-out" && <Badge variant="secondary">Not logged in</Badge>}
                          {state === "missing" && <Badge variant="outline">Not installed</Badge>}
                          {state === "checking" && <Badge variant="outline">Checking…</Badge>}
                        </ItemActions>
                        {(state === "missing" || state === "logged-out") && (
                          <ItemFooter className="flex-col items-start gap-1.5">
                            <span className="text-xs text-muted-foreground">Run this in a terminal, then Refresh:</span>
                            <Command>{state === "missing" ? c.install : c.login}</Command>
                          </ItemFooter>
                        )}
                      </Item>
                    );
                  })}
                  <Item variant="muted">
                    <ItemContent>
                      <ItemTitle>Divina preview tools (MCP)</ItemTitle>
                      <ItemDescription>
                        Lets the agent take screenshots of the frame and read the page. Connected to agents automatically.
                      </ItemDescription>
                      {mcpUrl && <span className="font-mono text-xs text-muted-foreground">{mcpUrl}</span>}
                    </ItemContent>
                    <ItemActions>
                      <Badge variant={mcpUrl ? "default" : "outline"}>{mcpUrl ? "Running" : "Stopped"}</Badge>
                    </ItemActions>
                  </Item>
                </ItemGroup>
              </TabsContent>

              <TabsContent value="shortcuts" className="flex flex-col gap-4">
                <Heading title="Shortcuts">They work on the canvas and inside the page, except while you type.</Heading>
                {SHORTCUTS.map((g) => (
                  <div key={g.group} className="flex flex-col gap-1">
                    <h4 className="text-xs font-medium text-muted-foreground">{g.group}</h4>
                    <div className="divide-y rounded-lg border">
                      {g.rows.map((r) => (
                        <div key={r.label} className="flex items-center justify-between gap-4 px-3 py-2 text-sm">
                          {r.label}
                          <span className="flex items-center gap-2 text-xs text-muted-foreground">
                            {r.keys.map((combo, i) => (
                              <span key={i} className="flex items-center gap-2">
                                {i > 0 && "or"}
                                <KbdGroup>{combo.map((k) => <Kbd key={k}>{k}</Kbd>)}</KbdGroup>
                              </span>
                            ))}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="about" className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <img src={icon} alt="" className="size-12" />
                  <div className="flex flex-col">
                    <h3 className="text-base font-medium">Divina</h3>
                    <span className="text-sm text-muted-foreground">Version {version || "…"}</span>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">Figma for a real frontend. Licensed under AGPL-3.0.</p>
                <Button size="sm" variant="outline" className="self-start" onClick={() => openUrl("https://github.com/shreyas-dhakal/divina")}>
                  GitHub
                </Button>
              </TabsContent>
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
