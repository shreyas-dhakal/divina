import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { AgentInfo, AgentKind } from "@/shared/protocol";

export interface ChatEntry {
  role: "user" | "agent" | "tool" | "error";
  text: string;
}

const ROLE_STYLE: Record<ChatEntry["role"], string> = {
  user: "self-end bg-primary text-primary-foreground",
  agent: "bg-muted",
  tool: "font-mono text-xs text-muted-foreground",
  error: "text-destructive",
};

interface Props {
  transcript: ChatEntry[];
  agents: AgentInfo[];
  agent: AgentKind | null;
  setAgent: (a: AgentKind) => void;
  draft: string;
  setDraft: (s: string) => void;
  running: boolean;
  onSend: () => void;
  onCancel: () => void;
}

export function AgentChat({ transcript, agents, agent, setAgent, draft, setDraft, running, onSend, onCancel }: Props) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2 text-sm">
      <select
        className="h-8 rounded-md border bg-background px-2"
        value={agent ?? ""}
        onChange={(e) => setAgent(e.target.value as AgentKind)}
        disabled={running}
      >
        {agents.length === 0 && <option value="">No agent CLI detected</option>}
        {agents.map((a) => (
          <option key={a.kind} value={a.kind} disabled={!a.loggedIn}>
            {a.kind}
            {a.loggedIn ? "" : " (not logged in)"}
          </option>
        ))}
      </select>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-2">
          {transcript.map((m, i) => (
            <div key={i} className={`max-w-[90%] rounded-lg px-2 py-1 whitespace-pre-wrap ${ROLE_STYLE[m.role]}`}>
              {m.text}
            </div>
          ))}
          {running && <div className="text-xs text-muted-foreground">Agent is working…</div>}
        </div>
      </ScrollArea>
      <Textarea
        placeholder="Ask the agent… (⌘↵ to send with pending edits)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      {running ? (
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
      ) : (
        <Button disabled={!agent || !draft.trim()} onClick={onSend}>Send</Button>
      )}
    </div>
  );
}
