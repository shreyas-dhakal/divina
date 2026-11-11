import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { EditRecord, Rect, Scope, SourceRef } from "@/shared/protocol";

export interface Selection {
  ref: SourceRef;
  rect: Rect;
  computed: Record<string, string>;
}

const SPACING = ["0", "1", "2", "3", "4", "6", "8", "12", "16"];
const SIZE = ["auto", "full", "fit", "1/2", "32", "48", "64", "96"];
const CONTROLS: [prefix: string, label: string, values: string[]][] = [
  ["p", "Padding", SPACING],
  ["px", "Padding X", SPACING],
  ["py", "Padding Y", SPACING],
  ["m", "Margin", SPACING],
  ["gap", "Gap", SPACING],
  ["w", "Width", SIZE],
  ["h", "Height", SIZE],
];

export const sameRef = (a: SourceRef, b: SourceRef) => a.file === b.file && a.line === b.line && a.col === b.col;

/** Which control an edit belongs to, so a newer value replaces an older one in the queue. */
export function editKey(e: EditRecord): string {
  if (e.kind !== "style") return e.kind;
  const prefix = e.payload.classes?.match(/^([a-z]+)-\S+$/)?.[1];
  return prefix && CONTROLS.some(([p]) => p === prefix) ? prefix : "classes";
}

interface Props {
  selection: Selection | null;
  scope: Scope;
  edits: EditRecord[];
  onEdit: (e: Pick<EditRecord, "kind" | "payload">) => void;
}

export function Properties({ selection, scope, edits, onEdit }: Props) {
  const [text, setText] = useState("");
  const [classes, setClasses] = useState("");
  useEffect(() => {
    setText(selection?.computed.text ?? "");
    setClasses(selection?.computed.className ?? "");
  }, [selection]);

  if (!selection) return <p className="p-3 text-sm text-muted-foreground">Select an element in the frame.</p>;
  const { ref } = selection;
  const mine = edits.filter((e) => sameRef(e.target, ref));
  const latest = (key: string) => mine.filter((e) => editKey(e) === key).pop();
  const ScopeBadge = ({ k }: { k: string }) => {
    const s = latest(k)?.scope;
    return <span>{s && <Badge variant="secondary">{s}</Badge>}</span>;
  };

  return (
    <div className="flex flex-col gap-4 p-3 text-sm">
      <div>
        <div className="font-medium">{ref.component ?? "Element"}</div>
        <div className="font-mono text-xs text-muted-foreground">
          {ref.file}:{ref.line}:{ref.col}
        </div>
        {ref.list && (
          <div className="text-xs text-muted-foreground">
            item {ref.list.index} of list at {ref.list.file}:{ref.list.line}
          </div>
        )}
        <div className="mt-1 text-xs text-muted-foreground">
          Edits apply to <Badge variant="outline">{scope}</Badge>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2">Text <ScopeBadge k="text" /></span>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => text !== (selection.computed.text ?? "") && onEdit({ kind: "text", payload: { text } })}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="flex items-center gap-2">Tailwind classes <ScopeBadge k="classes" /></span>
        <Input
          className="font-mono text-xs"
          value={classes}
          onChange={(e) => setClasses(e.target.value)}
          onBlur={() =>
            classes !== (selection.computed.className ?? "") && onEdit({ kind: "style", payload: { classes } })
          }
        />
      </label>

      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        {CONTROLS.map(([prefix, label, values]) => {
          const last = latest(prefix);
          const value = last?.kind === "style" ? last.payload.classes?.slice(prefix.length + 1) : "";
          return [
            <span key={prefix + "l"}>{label}</span>,
            <select
              key={prefix}
              className="h-7 rounded-md border bg-background px-1 text-xs"
              value={value ?? ""}
              onChange={(e) => e.target.value && onEdit({ kind: "style", payload: { classes: `${prefix}-${e.target.value}` } })}
            >
              <option value="">—</option>
              {values.map((v) => (
                <option key={v} value={v}>{`${prefix}-${v}`}</option>
              ))}
            </select>,
            <ScopeBadge key={prefix + "b"} k={prefix} />,
          ];
        })}
      </div>
    </div>
  );
}
