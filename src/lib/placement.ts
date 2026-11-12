import type { DomNode, EditRecord } from "@/shared/protocol";
import { followLine } from "./diffLines";

type PageRecord = DomNode;
const freeOf = (e: EditRecord) => e.kind === "insert" || e.kind === "move" ? e.payload.free : undefined;
const signature = (n: DomNode) => JSON.stringify([n.tag, n.text ?? "", n.components ?? []]);
const shown = (n: DomNode) => `<${n.tag}>${n.text ? ` "${n.text}"` : ""}`;

/**
 * Why a sent free edit is not in place on the `after` page; "" when it is. `diff` is the checkpoint
 * diff, used to tell a moved element from an identical twin by following source lines.
 */
export function placementProblem(edit: EditRecord, before: PageRecord | undefined, after: PageRecord, viewportWidth: number, diff?: string): string {
  const free = freeOf(edit);
  if (!free) return "";
  if (edit.viewport.width !== viewportWidth) return `edit ${edit.id} was placed at a ${edit.viewport.width}px wide viewport but the preview is at ${viewportWidth}px, so it can't be checked`;
  if (!before) return `edit ${edit.id}: placement check needs the edits to be sent from Divina`;

  const entries: Array<{ node: DomNode; ancestors: DomNode[] }> = [];
  const visit = (node: DomNode, ancestors: DomNode[]) => {
    entries.push({ node, ancestors });
    for (const child of node.children) visit(child, [...ancestors, node]);
  };
  visit(after, []);

  let candidates: Array<{ node: DomNode; ancestors: DomNode[] }>;
  if (edit.kind === "insert") {
    const beforeCounts = new Map<string, number>();
    for (const node of flatten(before)) beforeCounts.set(signature(node), (beforeCounts.get(signature(node)) ?? 0) + 1);
    const afterCounts = new Map<string, number>();
    for (const { node } of entries) afterCounts.set(signature(node), (afterCounts.get(signature(node)) ?? 0) + 1);
    const newSignatures = new Set([...afterCounts].filter(([sig, count]) => count > (beforeCounts.get(sig) ?? 0)).map(([sig]) => sig));
    let changed = entries.filter(({ node }) => newSignatures.has(signature(node)));
    if (entries.some(({ node }) => node.components?.length)) changed = changed.filter(({ node }) => node.components?.includes(edit.payload.component));
    const candidateSet = new Set(changed.map(({ node }) => node));
    candidates = changed.filter(({ ancestors }) => !ancestors.some((ancestor) => candidateSet.has(ancestor)));
    candidates = candidates.map((entry) => {
      let current = entry;
      while (current.node.children.length === 1) {
        const child = current.node.children[0];
        const childEntry = changed.find((candidate) => candidate.node === child);
        if (!childEntry) break;
        current = childEntry;
      }
      return current;
    });
  } else if (edit.kind === "move" && edit.payload?.moved) {
    const moved = edit.payload.moved;
    candidates = entries.filter(({ node }) => node.tag === moved.tag && (node.firstText ?? "") === moved.text && (!moved.components || !node.components || JSON.stringify(moved.components) === JSON.stringify(node.components)));
    // Identical twins: the page alone can't say which one moved, the source can. Each element is tagged
    // with its line, and the diff says where a line the agent left alone is now.
    const { file, line } = edit.target;
    if (candidates.length > 1 && file && diff !== undefined) {
      const at = (f: string, l: number | null) => ({ node }: { node: DomNode }) => l !== null && node.ref?.file === f && node.ref.line === l;
      const now = followLine(diff, file, line);
      if (now !== null) candidates = candidates.filter(at(file, now));
      else {
        // Its own line was rewritten or moved: it is whichever twin is not still on an untouched twin's line.
        const others = flatten(before).filter((n) => n.ref && n.tag === moved.tag && (n.firstText ?? "") === moved.text && !(n.ref.file === file && n.ref.line === line));
        const stayed = others.map((n) => at(n.ref!.file, followLine(diff, n.ref!.file, n.ref!.line)));
        candidates = candidates.filter((c) => !stayed.some((same) => same(c)));
      }
    }
  } else return "";

  if (!candidates.length) return `edit ${edit.id}: ${edit.kind === "insert" ? "no new element" : "no matching element"} was found`;
  let closest: { node: DomNode; dx: number; dy: number } | undefined;
  for (const { node, ancestors } of candidates) for (const container of ancestors) {
    const box = container.contentRect;
    if (!box || Math.abs(box.width - free.containerWidth) > 2) continue;
    const dx = Math.round(node.rect.x - box.x) - free.x, dy = Math.round(node.rect.y - box.y) - free.y;
    if (!closest || Math.hypot(dx, dy) < Math.hypot(closest.dx, closest.dy)) closest = { node, dx, dy };
    const slack = free.snapStep ? 0 : 2;
    if (Math.abs(dx) <= slack && Math.abs(dy) <= slack) return "";
  }
  if (!closest) return `edit ${edit.id}: no candidate was found in a container ${free.containerWidth}px wide`;
  const x = closest.dx < 0 ? `${Math.abs(closest.dx)}px too far left` : `${closest.dx}px too far right`;
  const y = closest.dy < 0 ? `${Math.abs(closest.dy)}px too high` : `${closest.dy}px too low`;
  return `edit ${edit.id}: closest match ${shown(closest.node)} is ${x} and ${y}`;
}
function flatten(root: PageRecord): PageRecord[] { return [root, ...root.children.flatMap(flatten)]; }
