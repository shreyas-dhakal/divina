import type { InsertAlignment, InsertPlace, Rect } from "../../src/shared/protocol.ts";

const THIRDS = ["start", "center", "end"] as const;
/** How close (px) the pointer may come to a child before the drop snaps between children instead. */
const CLEARANCE = 24;

/**
 * Empty-space drop: when the pointer is clear of every child, the container's content box is split
 * 3×3 and the cell under the pointer is the placement. Near a child, null (gap snapping applies).
 */
export function zoneAt(box: Rect, children: Rect[], x: number, y: number): InsertPlace | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const near = (r: Rect) => x > r.x - CLEARANCE && x < r.x + r.width + CLEARANCE && y > r.y - CLEARANCE && y < r.y + r.height + CLEARANCE;
  if (children.some(near)) return null;
  const third = (value: number, start: number, size: number) => THIRDS[Math.min(2, Math.max(0, Math.floor(((value - start) / size) * 3)))]!;
  return { x: third(x, box.x, box.width), y: third(y, box.y, box.height) };
}

/** Top-left for an element of `size` placed at `zone` within `box`: flush to the edge, or centred. */
export function zoneOffset(box: Rect, size: { width: number; height: number }, zone: InsertPlace) {
  const along = (align: InsertAlignment, start: number, room: number, extent: number) =>
    align === "start" ? start : align === "end" ? start + room - extent : start + (room - extent) / 2;
  return { x: along(zone.x, box.x, box.width, size.width), y: along(zone.y, box.y, box.height, size.height) };
}

export function zoneName(zone: InsertPlace): string {
  return `${{ start: "top", center: "middle", end: "bottom" }[zone.y]} ${{ start: "left", center: "centre", end: "right" }[zone.x]}`;
}
