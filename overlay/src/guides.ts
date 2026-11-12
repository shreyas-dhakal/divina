import type { Rect } from "../../src/shared/protocol.ts";
import type { SlotAxis } from "./slots.js";

/** A measured span along the slot axis; `at` is the cross-axis coordinate to draw it on, `edge` marks padding rather than a sibling. */
export type Gap = { start: number; end: number; at: number; edge: boolean };

/**
 * Space from the ghost to its nearest neighbours on the same line, or to the container's
 * content edge (`inner`, the padding box minus padding) when it's first or last.
 */
export function measureGaps(ghost: Rect, siblings: Rect[], inner: Rect, axis: SlotAxis): Gap[] {
  const row = axis === "row";
  const start = (r: Rect) => (row ? r.x : r.y);
  const end = (r: Rect) => (row ? r.x + r.width : r.y + r.height);
  const crossStart = (r: Rect) => (row ? r.y : r.x);
  const crossEnd = (r: Rect) => (row ? r.y + r.height : r.x + r.width);
  // Only siblings sharing the ghost's line; wrapped rows and grid tracks would otherwise measure across lines.
  const line = siblings.filter((r) => crossStart(r) < crossEnd(ghost) && crossEnd(r) > crossStart(ghost));
  const prev = line.map(end).filter((e) => e <= start(ghost) + 0.5);
  const next = line.map(start).filter((s) => s >= end(ghost) - 0.5);
  const at = (crossStart(ghost) + crossEnd(ghost)) / 2;
  return [
    { start: prev.length ? Math.max(...prev) : start(inner), end: start(ghost), at, edge: !prev.length },
    { start: end(ghost), end: next.length ? Math.min(...next) : end(inner), at, edge: !next.length },
  ].filter((gap) => gap.end - gap.start >= 1);
}

// Tailwind's default spacing scale (multiples of 4px), so labels only name classes a designer would type.
const scale = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96];

/** "16px · gap-4" when the gap is a container `gap` on the default scale, otherwise just "16px". */
export function spacingLabel(px: number, usesGap: boolean): string {
  const rounded = Math.round(px);
  const step = rounded / 4;
  const name = rounded === 1 ? "px" : scale.includes(step) ? String(step) : "";
  return usesGap && name ? `${rounded}px · gap-${name}` : `${rounded}px`;
}
