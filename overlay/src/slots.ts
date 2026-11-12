import type { Position, Rect } from "../../src/shared/protocol.ts";

const LEAF_TAGS = /^(IMG|INPUT|TEXTAREA|SELECT|VIDEO|AUDIO|CANVAS|IFRAME|HR|BR|PROGRESS|METER)$/;
/** How far (px) into a child's left or right edge a pointer counts as a side drop. */
const SIDE_BAND = 24;
/** Moving these in the DOM reloads or pauses them, so they take no side drops (whose preview wraps the anchor). */
const MEDIA = "iframe, video, audio, object, embed";

export type SlotAxis = "row" | "column";
/** `beside`: a drop on a stacked child's left or right side, asking to share one row with `anchor`. */
export type DropSlot = { container: Element; index: number; total: number; axis: SlotAxis; direction: string; guide: Rect; position: Position; anchor: Element; beside?: boolean };

/**
 * Reads layout geometry only; source tagging and overlay filtering are supplied by the caller.
 * `isChild` widens what counts as a sibling to drop next to (dropped placeholders) without making
 * those hit targets or containers.
 */
export function pickDropSlot(x: number, y: number, usable: (element: Element | null) => boolean, getUserCodeTarget: (element: Element) => Element | null, isChild: (element: Element) => boolean = usable): DropSlot | null {
  let hit: Element | null = document.elementFromPoint(x, y);
  while (hit && !usable(hit)) hit = hit.parentElement;
  if (!hit) return null;
  const userHit = getUserCodeTarget(hit) ?? hit;
  let container: Element | null = userHit;
  while (container) {
    const display = getComputedStyle(container).display;
    // Inline elements (an inline-flex Button, even with an icon child) are leaves; only a real empty
    // HTML box takes an inside drop, not an icon, image or form control. Empty means no text of its
    // own: text inside overlay elements doesn't count.
    const ownText = [...container.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!display.startsWith("inline") && ([...container.children].some(isChild) || (container instanceof HTMLElement && !LEAF_TAGS.test(container.tagName) && !ownText))) break;
    container = container.parentElement;
  }
  if (!container || !usable(container)) return null;
  const style = getComputedStyle(container);
  const isGrid = style.display.includes("grid");
  const isFlex = style.display.includes("flex");
  const direction = isGrid ? style.gridAutoFlow || "row" : isFlex ? style.flexDirection || "row" : "column";
  const reversed = !isGrid && direction.endsWith("reverse");
  const children = [...container.children].filter(isChild);
  const rect = container.getBoundingClientRect();
  if (!children.length) {
    const axis: SlotAxis = direction.startsWith("row") ? "row" : "column";
    return { container, index: 0, total: 1, axis, direction, guide: { x: rect.left, y: rect.top, width: rect.width, height: 0 }, position: "inside-start", anchor: container };
  }
  // The child nearest the pointer decides: wrapped rows, grids and inline runs have no single line to sort along.
  const rects = children.map((child) => child.getBoundingClientRect());
  const distance = (r: DOMRect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  const nearest = rects.reduce((best, r, i) => distance(r) < distance(rects[best]!) ? i : best, 0);
  const r = rects[nearest]!;
  // Flow layout has no direction of its own: inline children run along the line, blocks stack.
  const axis: SlotAxis = isGrid ? (direction.startsWith("column") ? "column" : "row")
    : isFlex ? (direction.startsWith("row") ? "row" : "column")
    : getComputedStyle(children[nearest]!).display.startsWith("inline") ? "row" : "column";
  const total = children.length + 1;
  // Stacked children take side drops: the middle of a child's left or right edge (its top and
  // bottom quarters stay before/after) puts the drop on the same row.
  const band = Math.min(SIDE_BAND, r.width / 4);
  const wrappable = !children[nearest]!.matches(MEDIA) && !children[nearest]!.querySelector(MEDIA);
  const side = axis === "column" && wrappable && y > r.top + r.height / 4 && y < r.bottom - r.height / 4 ? (x < r.left + band ? "before" : x > r.right - band ? "after" : null) : null;
  if (side) {
    const guide = { x: side === "after" ? r.right : r.left, y: r.top, width: 0, height: r.height };
    return { container, index: nearest + (side === "after" ? 1 : 0), total, axis, direction, guide, position: side, anchor: children[nearest]!, beside: true };
  }
  const horizontal = axis === "row";
  const trailing = (horizontal ? x : y) >= (horizontal ? (r.left + r.right) / 2 : (r.top + r.bottom) / 2);
  const guide: Rect = horizontal
    ? { x: trailing ? r.right : r.left, y: r.top, width: 0, height: r.height }
    : { x: r.left, y: trailing ? r.bottom : r.top, width: r.width, height: 0 };
  const index = nearest + (trailing !== reversed ? 1 : 0);
  return { container, index, total, axis, direction, guide, position: index ? "after" : "before", anchor: children[Math.max(index - 1, 0)]! };
}
