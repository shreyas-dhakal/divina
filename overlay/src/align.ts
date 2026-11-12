import type { Rect } from "../../src/shared/protocol.ts";
import type { SlotAxis } from "./slots.js";

export type CrossAlignment = "start" | "center" | "end";

/** Returns an alignment only when the cross-axis pointer is close to a content edge or its centre. */
export function detectAlignment(rect: Rect, axis: SlotAxis, pointer: { x: number; y: number }, isFlex: boolean): CrossAlignment | null {
  if (!isFlex) return null;
  const start = axis === "row" ? rect.y : rect.x;
  const size = axis === "row" ? rect.height : rect.width;
  if (size <= 0) return null;
  const value = axis === "row" ? pointer.y : pointer.x;
  const points = [start, start + size / 2, start + size];
  const nearest = points.reduce((best, point, index) => Math.abs(point - value) < Math.abs(points[best]! - value) ? index : best, 0);
  return Math.abs(points[nearest]! - value) <= Math.min(12, size / 4) ? (["start", "center", "end"] as const)[nearest]! : null;
}
