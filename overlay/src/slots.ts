import type { Position, Rect } from "../../src/shared/protocol.ts";

export type SlotAxis = "row" | "column";
export type DropSlot = { container: Element; index: number; total: number; axis: SlotAxis; direction: string; guide: Rect; position: Position; anchor: Element };

/** Reads layout geometry only; source tagging and overlay filtering are supplied by the caller. */
export function pickDropSlot(x: number, y: number, usable: (element: Element | null) => boolean, getUserCodeTarget: (element: Element) => Element | null, resolveSourceRef: (element: Element) => unknown): DropSlot | null {
  let hit: Element | null = document.elementFromPoint(x, y);
  while (hit && !usable(hit)) hit = hit.parentElement;
  if (!hit) return null;
  const userHit = getUserCodeTarget(hit) ?? hit;
  let container: Element | null = userHit;
  while (container) {
    const style = getComputedStyle(container);
    const display = style.display;
    const children = [...container.children].filter((child) => usable(child));
    if (display.includes("flex") || display.includes("grid") || (display === "block" && children.length)) break;
    container = container.parentElement;
  }
  if (!container || !usable(container)) return null;
  const style = getComputedStyle(container);
  const isGrid = style.display.includes("grid");
  const direction = isGrid ? style.gridAutoFlow || "row" : style.display.includes("flex") ? style.flexDirection || "row" : "column";
  const axis: SlotAxis = isGrid ? (direction.startsWith("column") ? "column" : "row") : direction.startsWith("row") ? "row" : "column";
  const reversed = !isGrid && direction.endsWith("reverse");
  const children = [...container.children].filter((child) => usable(child));
  const visualChildren = [...children].sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    const d = axis === "row" ? ar.left - br.left : ar.top - br.top;
    return reversed ? -d : d;
  });
  const rect = container.getBoundingClientRect();
  const horizontal = axis === "row";
  const pointer = horizontal ? x : y;
  const starts = visualChildren.map((child) => { const r = child.getBoundingClientRect(); return horizontal ? r.left : r.top; });
  const ends = visualChildren.map((child) => { const r = child.getBoundingClientRect(); return horizontal ? r.right : r.bottom; });
  const points = visualChildren.length ? [starts[0]!, ...visualChildren.slice(1).map((_, i) => (ends[i]! + starts[i + 1]!) / 2), ends[ends.length - 1]!] : [horizontal ? rect.left : rect.top];
  let index = points.reduce((best, point, i) => Math.abs(point - pointer) < Math.abs(points[best]! - pointer) ? i : best, 0);
  // ponytail: a 4px dead band stabilizes midpoint ties; a stateful drag threshold can replace it later.
  if (points.length > 1 && points.some((point, i) => i !== index && Math.abs(point - pointer) <= 4)) index = points.findIndex((point) => Math.abs(point - pointer) <= 4);
  const guideAt = points[index]!;
  const guide: Rect = horizontal ? { x: guideAt, y: rect.top, width: 0, height: rect.height } : { x: rect.left, y: guideAt, width: rect.width, height: 0 };
  if (!children.length) {
    const anchor = container;
    return { container, index: 0, total: 1, axis, direction, guide: { x: rect.left, y: rect.top, width: rect.width, height: 0 }, position: "inside-start", anchor };
  }
  const logicalIndex = reversed ? children.length - index : index;
  const anchor = children[Math.min(logicalIndex ? logicalIndex - 1 : 0, children.length - 1)]!;
  // Resolve here so callers can keep source-tagged anchors distinct from their DOM fallback.
  void resolveSourceRef(anchor);
  return { container, index: logicalIndex, total: children.length + 1, axis, direction, guide, position: logicalIndex ? "after" : "before", anchor };
}
