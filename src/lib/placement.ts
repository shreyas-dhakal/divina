import type { EditRecord, ElementIdentity, FreePlace } from "@/shared/protocol";

const freeOf = (e: EditRecord): FreePlace | undefined => (e.kind === "insert" || e.kind === "move" ? e.payload.free : undefined);

/** What `measure_placement` found for a sent edit, as the overlay and host report it. */
export interface Measured { x: number; y: number; containerWidth: number; matches: number; viewportWidth: number; element?: ElementIdentity }

/**
 * Why a measured element is not where the edit put it; "" when it is. Grid-snapped edits must match
 * exactly, others within 2px. The text goes to the agent, and to the user if the agent gives up.
 * The agent picks the selectors, so the element and container are checked against what the user
 * dragged: an insert must be the inserted component, a move the same tag and text, and the container
 * as wide as the one dropped on (its height may grow with the new content).
 */
export function placementProblem(edit: EditRecord, m: Measured): string {
  const free = freeOf(edit);
  if (!free) return "";
  if (m.viewportWidth !== edit.viewport.width) return `edit ${edit.id} was placed at a ${edit.viewport.width}px wide viewport but the preview is at ${m.viewportWidth}px, so it can't be checked`;
  if (m.matches !== 1) return `edit ${edit.id}: the selector matches ${m.matches} elements; give one that matches only the placed element`;
  const el = m.element, shown = el ? `<${el.tag}>${el.text ? ` "${el.text}"` : ""}` : "";
  // Component names need React or Vue dev data; without them an insert's identity can't be checked.
  if (edit.kind === "insert" && el?.components && !el.components.includes(edit.payload.component)) return `edit ${edit.id}: the selector names ${shown} (${el.components.join(", ")}), not the root element of the inserted <${edit.payload.component}>`;
  const moved = edit.kind === "move" ? edit.payload.moved : undefined;
  if (moved && el && (el.tag !== moved.tag || el.text !== moved.text)) return `edit ${edit.id}: the selector names ${shown}, not the moved <${moved.tag}>${moved.text ? ` "${moved.text}"` : ""}`;
  if (Math.abs(m.containerWidth - free.containerWidth) > 2) return `edit ${edit.id}: measured in a container ${m.containerWidth}px wide, but it was dropped in one ${free.containerWidth}px wide; pass that container as \`container\``;
  const dx = m.x - free.x, dy = m.y - free.y, slack = free.snapStep ? 0 : 2;
  if (Math.abs(dx) <= slack && Math.abs(dy) <= slack) return "";
  return `edit ${edit.id} is at x ${m.x}, y ${m.y} but should be at x ${free.x}, y ${free.y} (off by ${dx}px, ${dy}px)`;
}

/** Free placements among the sent edits that are unmeasured or off; `checks` holds the last `placementProblem` per edit id. */
export function openPlacements(sent: EditRecord[], checks: Map<string, string>): string[] {
  return sent.filter(freeOf).map((e) => checks.get(e.id) ?? `edit ${e.id} was never checked with measure_placement`).filter(Boolean);
}
