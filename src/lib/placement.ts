import type { EditRecord, FreePlace } from "@/shared/protocol";

const freeOf = (e: EditRecord): FreePlace | undefined => (e.kind === "insert" || e.kind === "move" ? e.payload.free : undefined);

/** What `measure_placement` found for a sent edit, as the overlay and host report it. */
export interface Measured { x: number; y: number; matches: number; viewportWidth: number }

/**
 * Why a measured element is not where the edit put it; "" when it is. Grid-snapped edits must match
 * exactly, others within 2px. The text goes to the agent, and to the user if the agent gives up.
 */
export function placementProblem(edit: EditRecord, m: Measured): string {
  const free = freeOf(edit);
  if (!free) return "";
  if (m.viewportWidth !== edit.viewport.width) return `edit ${edit.id} was placed at a ${edit.viewport.width}px wide viewport but the preview is at ${m.viewportWidth}px, so it can't be checked`;
  if (m.matches !== 1) return `edit ${edit.id}: the selector matches ${m.matches} elements; give one that matches only the placed element`;
  const dx = m.x - free.x, dy = m.y - free.y, slack = free.snapStep ? 0 : 2;
  if (Math.abs(dx) <= slack && Math.abs(dy) <= slack) return "";
  return `edit ${edit.id} is at x ${m.x}, y ${m.y} but should be at x ${free.x}, y ${free.y} (off by ${dx}px, ${dy}px)`;
}

/** Free placements among the sent edits that are unmeasured or off; `checks` holds the last `placementProblem` per edit id. */
export function openPlacements(sent: EditRecord[], checks: Map<string, string>): string[] {
  return sent.filter(freeOf).map((e) => checks.get(e.id) ?? `edit ${e.id} was never checked with measure_placement`).filter(Boolean);
}
