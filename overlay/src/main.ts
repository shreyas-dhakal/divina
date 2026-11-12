import type { DomAnchor, DomNode, EditRecord, FreePlace, HostToOverlay, InsertPayload, InsertPlace, LibraryRef, OverlayMode, OverlayToHost, Rect, Scope, SourceRef, Viewport } from "../../src/shared/protocol.ts";
import { applyPreview, buildDomAnchor, componentName, getUserCodeTarget, identify, placeIn, resolveSourceRef, snapOffset } from "./overlay.js";
import { measureGaps, spacingLabel } from "./guides.js";
import { pickDropSlot, type DropSlot } from "./slots.js";
import { detectAlignment, type CrossAlignment } from "./align.js";
import { zoneAt, zoneName, zoneOffset } from "./zones.js";
import { CANVAS_KEYS } from "../../src/shared/protocol.ts";

const hostOrigin = (() => {
  try { return new URL(document.referrer).origin; } catch { return ""; }
})();
let mode: OverlayMode = "off";
let snapStep = 8;
let selected: Element | null = null;
let hovered: Element | null = null;
let trustedOrigin = hostOrigin;
const revert: Array<() => void> = [];
const id = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const rectOf = (element: Element): Rect => {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
};
const viewport = (): Viewport => {
  const width = window.innerWidth;
  const preset = width <= 767 ? "mobile" : width <= 1023 ? "tablet" : "desktop";
  return { preset, width, height: window.innerHeight };
};
const scope = (): Scope => viewport().preset === "mobile" ? "mobile-down" : viewport().preset === "tablet" ? "tablet-down" : "all";
function send(message: OverlayToHost) {
  // Without a referrer (e.g. tauri:// host) the origin is learned from the host's first message; "ready" prompts it.
  const origin = trustedOrigin || (message.type === "ready" ? "*" : "");
  if (origin) window.parent.postMessage(message, origin);
}

const ui = document.createElement("div");
ui.dataset.divinaUi = "true";
ui.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;font:12px/1.3 system-ui,sans-serif";
const outline = document.createElement("div");
outline.dataset.divinaUi = "true";
outline.style.cssText = "position:fixed;display:none;border:1px solid #7c3aed;background:#7c3aed12;box-sizing:border-box;pointer-events:none";
const indicator = document.createElement("div");
indicator.dataset.divinaUi = "true";
indicator.style.cssText = "position:fixed;display:none;background:#7c3aed;pointer-events:none";
const label = document.createElement("div");
label.dataset.divinaUi = "true";
label.style.cssText = "position:absolute;right:0;top:-19px;background:#7c3aed;color:white;padding:2px 5px;border-radius:3px;white-space:nowrap";
const handles = document.createElement("div");
handles.dataset.divinaUi = "true";
handles.style.cssText = "position:absolute;right:-5px;bottom:-5px;width:10px;height:10px;border-radius:50%;background:white;border:1px solid #7c3aed;pointer-events:auto;cursor:nwse-resize";
outline.append(label, handles);
const containerHighlight = document.createElement("div");
containerHighlight.dataset.divinaUi = "true";
containerHighlight.style.cssText = "position:fixed;display:none;border:2px dashed #7c3aed;box-sizing:border-box;pointer-events:none";
const slotLabel = document.createElement("div");
slotLabel.dataset.divinaUi = "true";
slotLabel.style.cssText = "position:absolute;left:0;top:-21px;background:#7c3aed;color:white;padding:2px 5px;border-radius:3px;white-space:nowrap;font:12px/1.3 system-ui,sans-serif";
containerHighlight.append(slotLabel);
const spacing = document.createElement("div");
spacing.dataset.divinaUi = "true";
const alignmentGuide = document.createElement("div");
alignmentGuide.dataset.divinaUi = "true";
alignmentGuide.style.cssText = "position:fixed;display:none;border-color:#d946ef;border-style:dashed;pointer-events:none;box-sizing:border-box";
const alignmentLabel = document.createElement("div");
alignmentLabel.dataset.divinaUi = "true";
alignmentLabel.style.cssText = "position:absolute;background:#d946ef;color:white;padding:1px 4px;border-radius:3px;white-space:nowrap;font:10px/1.2 system-ui,sans-serif";
alignmentGuide.append(alignmentLabel);
/** Faint 3×3 grid over a container's free space while a drop is in placement-zone mode. */
const zoneGuide = document.createElement("div");
zoneGuide.dataset.divinaUi = "true";
zoneGuide.style.cssText = "position:fixed;display:none;grid-template:repeat(3,1fr)/repeat(3,1fr);pointer-events:none";
for (let i = 0; i < 9; i++) zoneGuide.append(Object.assign(document.createElement("div"), { style: "border:1px dashed #7c3aed40" }));
ui.append(outline, indicator, containerHighlight, spacing, alignmentGuide, zoneGuide);
const snapGuide = document.createElement("div");
snapGuide.dataset.divinaUi = "true";
snapGuide.style.cssText = "position:fixed;display:none;pointer-events:none;z-index:1";
ui.append(snapGuide);
(document.documentElement ?? document.body).append(ui);
// In select mode clicks select rather than activate, so the page's own cursors (pointer on links,
// text on inputs) would mislead; one cursor for the whole page follows the current action instead.
const cursorStyle = document.createElement("style");
cursorStyle.dataset.divinaUi = "true";
cursorStyle.textContent = `html[data-divina-cursor], html[data-divina-cursor] :not([data-divina-ui]) { cursor: var(--divina-cursor) !important }
html[data-divina-cursor] [contenteditable="true"] { cursor: text !important }`;
ui.append(cursorStyle);
function setCursor(cursor: string | null) {
  const root = document.documentElement;
  if (root.style.getPropertyValue("--divina-cursor") === (cursor ?? "")) return;
  if (cursor) { root.dataset.divinaCursor = ""; root.style.setProperty("--divina-cursor", cursor); }
  else { delete root.dataset.divinaCursor; root.style.removeProperty("--divina-cursor"); }
}

function usable(element: Element | null): boolean {
  return !!element && element !== document.documentElement && element !== document.body && !ui.contains(element) && !element.closest("[data-divina-ui], [data-divina-placeholder]");
}
/** Wrapper the side-by-side preview puts around two elements; real layout, but not in the source. */
const ROW = "[data-divina-row]";
/** Dropped placeholders are siblings a drop can land next to, though not selectable page elements. */
const slotChild = (element: Element) => usable(element) || element.matches("[data-divina-placeholder]");
/** Queued insert per dropped placeholder: a later drop next to it is recorded relative to that edit. */
const drops = new WeakMap<Element, Extract<EditRecord, { kind: "insert" }>>();
function record(kind: EditRecord["kind"], target: SourceRef, payload?: EditRecord["payload"]): EditRecord {
  return { id: id(), kind, target, viewport: viewport(), scope: scope(), ...(payload === undefined ? {} : { payload }) } as EditRecord;
}
const emptyRef = (): SourceRef => ({ file: "", line: 0, col: 0, owners: [] });
/** Where an edit on `element` points: its source tag, or (untagged) an empty ref plus a DOM anchor the agent searches by. */
function targetOf(element: Element): { target: SourceRef; dom?: DomAnchor } {
  const ref = resolveSourceRef(element);
  const component = componentName(element);
  if (ref) return { target: { ...ref, ...(component ? { component } : {}) } };
  return { target: { ...emptyRef(), ...(component ? { component } : {}) }, dom: buildDomAnchor(element) };
}
function edit(kind: EditRecord["kind"], element: Element, payload?: EditRecord["payload"]): EditRecord {
  const { target, dom } = targetOf(element);
  return { ...record(kind, target, payload), ...(dom ? { dom } : {}) } as EditRecord;
}
function updateOutline(element: Element | null) {
  if (!element || !(usable(element) || element.matches("[data-divina-placeholder]"))) { outline.style.display = "none"; return; }
  const rect = rectOf(element);
  Object.assign(outline.style, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  label.textContent = drops.get(element)?.payload.component ?? componentName(element) ?? element.tagName.toLowerCase();
}
function targetAt(x: number, y: number): Element | null {
  let element: Element | null = document.elementFromPoint(x, y);
  while (element && !usable(element)) element = element.parentElement;
  return element ? getUserCodeTarget(element) ?? element : null;
}
function findSlot(x: number, y: number) { return pickDropSlot(x, y, usable, getUserCodeTarget, slotChild); }
/** The container and nearest sibling for a free drop: past the end of the page's content, the nearest top-level element still takes it. */
function freeSlot(x: number, y: number) {
  const slot = findSlot(x, y);
  if (slot) return slot;
  const near = (r: DOMRect) => Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
  const root = [...document.body.children].filter(usable).map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height).sort((a, b) => near(a) - near(b))[0];
  return root ? findSlot(Math.min(Math.max(x, root.left + 1), root.right - 1), Math.min(Math.max(y, root.top + 1), root.bottom - 1)) : null;
}
function showSlot(slot: DropSlot | null) {
  if (!slot) { indicator.style.display = "none"; containerHighlight.style.display = "none"; alignmentGuide.style.display = "none"; return; }
  const rect = slot.container.getBoundingClientRect();
  Object.assign(containerHighlight.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const firstClass = [...slot.container.classList].find((name) => !name.startsWith("data-"));
  slotLabel.textContent = `${slot.container.tagName.toLowerCase()}${firstClass ? `.${firstClass}` : ""} · ${slot.index + 1} of ${slot.total || 1} ${slot.axis === "row" || slot.beside ? "→" : "↓"}`;
  Object.assign(indicator.style, { left: `${slot.guide.x}px`, top: `${slot.guide.y}px`, width: `${slot.guide.width || 3}px`, height: `${slot.guide.height || 3}px` });
  indicator.style.display = "block";
}
// The fallback look when the real component can't be rendered: a pill sized to its label.
const pillStyle = "display:block;width:fit-content;align-self:flex-start;border:1px dashed #7c3aed;border-radius:6px;background:#7c3aed12;color:#6d28d9;padding:4px 12px;font:12px/1.5 system-ui";
/** Module Divina writes for Vite + React projects (library.rs); it renders a library component into an element. */
const MOUNT = "/.divina/mount.tsx";
const unmounts = new WeakMap<Element, () => void>();
const PILL_LOOK = ["border", "border-radius", "background", "color", "padding", "font"];
/** A picture of the component (a cropped catalog thumbnail) in place of the pill. */
function showPicture(box: HTMLElement, image: string) {
  const picture = Object.assign(document.createElement("img"), { src: image, alt: "", draggable: false });
  picture.style.cssText = "display:block;max-width:100%;pointer-events:none";
  for (const property of PILL_LOOK) box.style.removeProperty(property);
  box.replaceChildren(picture);
  box.dataset.divinaView = "image";
}
/**
 * Stand-in for a dragged or dropped library component, in order of preference:
 * - `live` (the module to load it from): the project's dev server renders the real component in
 *   place, so it looks and lays out as it will;
 * - `image`: a picture of it, when it can't render (needs props or context, not installed, not Vite);
 * - else a pill with its name.
 */
function makeBox(component: string, live?: string, image?: string): HTMLElement {
  const box = document.createElement("div");
  box.style.cssText = pillStyle;
  const fallback = () => { if (image) showPicture(box, image); else box.textContent = component; };
  if (!live) { fallback(); return box; }
  // Pointer events stay on the box, so a click selects the placeholder rather than pressing the component.
  const host = document.createElement("div");
  host.style.cssText = "display:contents;pointer-events:none";
  box.replaceChildren(host);
  (import(/* @vite-ignore */ MOUNT) as Promise<{ mount(el: HTMLElement, module: string, name: string): Promise<() => void> }>)
    .then((m) => m.mount(host, live, component))
    .then((unmount) => {
      unmounts.set(box, unmount);
      for (const property of ["width", "align-self", ...PILL_LOOK]) box.style.removeProperty(property);
      // The box takes the component's own outer display, so inline ones sit side by side and blocks stack.
      box.style.display = getComputedStyle(host.firstElementChild ?? host).display.startsWith("inline") ? "inline-block" : "block";
      box.dataset.divinaView = "live";
    }, fallback)
    .then(() => {
      // It was placed and measured as a pill; the component or picture has its own size.
      if (ghost?.element === box) ghost.free ? float(box, ghost.free) : ghost.zone ? placeInZone(box, ghost.slot.container, ghost.zone, "fixed") : showSpacing(box, ghost.slot);
      // Dropped before it finished rendering: it keeps its centre, and the edit gets its real size.
      const at = pins.get(box);
      const drop = drops.get(box);
      if (at && drop?.payload.free) {
        const now = box.getBoundingClientRect();
        at.x -= (now.width - drop.payload.free.width) / 2;
        at.y -= (now.height - drop.payload.free.height) / 2;
        pin(box);
        drop.payload.free = freeAt(box, at.container);
        send({ type: "discard-edit", id: drop.id });
        send({ type: "edit", record: drop });
      }
      updateOutline(selected);
    });
  return box;
}
function discard(box: Element) {
  const from = box.parentElement;
  box.remove();
  tidy(from);
  unmounts.get(box)?.();
}
/** A side-by-side row left with a single member dissolves back into its parent. */
function tidy(row: Element | null) {
  if (!row?.matches(ROW) || row.children.length > 1) return;
  const parent = row.parentElement;
  row.replaceWith(...row.children);
  if (parent && ![...parent.children].some((child) => child.matches(ROW))) for (const method of ["removeChild", "insertBefore"]) Reflect.deleteProperty(parent, method);
}
/**
 * While a row holds one of `parent`'s children, the parent still answers its framework: React removes
 * and inserts through the element it rendered into, which throws for a child that now sits in the row.
 */
function standIn(parent: Node) {
  const inRow = (node: Node | null | undefined): Element | null => {
    const row = node?.parentNode;
    return row instanceof Element && row.parentNode === parent && row.matches(ROW) ? row : null;
  };
  Object.assign(parent, {
    removeChild(child: Node) {
      const row = inRow(child);
      const removed = Node.prototype.removeChild.call(row ?? parent, child);
      tidy(row);
      return removed;
    },
    insertBefore(node: Node, before: Node | null) {
      return Node.prototype.insertBefore.call(parent, node, inRow(before) ?? before);
    },
  });
}
/** The element an edit is recorded against: a side-by-side row stands for its first or last member. */
function through(anchor: Element, position: string): Element {
  return (anchor.matches(ROW) ? (position === "before" ? anchor.firstElementChild : anchor.lastElementChild) : null) ?? anchor;
}
const sideBySide = (slot: DropSlot) => !!slot.beside || slot.container.matches(ROW);
// A side drop moves the anchor into a wrapper row. The row takes over the anchor's place as a flex
// item, and `standIn` keeps the framework's own removals and insertions working meanwhile.
// ponytail: parent selectors that name the anchor (`> h1`, `:nth-child`) stop matching it; preview
// with inline styles and a pinned element if that bites.
function placeAt(element: Element, slot: DropSlot) {
  const from = element.parentElement;
  const before = slot.position === "before";
  if (slot.position.startsWith("inside")) slot.container.insertBefore(element, slot.container.firstChild);
  else if (slot.beside && slot.anchor.matches(ROW)) slot.anchor.insertBefore(element, before ? slot.anchor.firstChild : null);
  else {
    if (slot.beside) {
      const row = document.createElement("div");
      row.dataset.divinaRow = "true";
      const item = getComputedStyle(slot.anchor);
      row.style.cssText = `display:flex;flex-direction:row;align-items:center;gap:8px;flex:${item.flex};align-self:${item.alignSelf};order:${item.order}`;
      if (slot.anchor.parentNode) standIn(slot.anchor.parentNode);
      slot.anchor.replaceWith(row);
      row.append(slot.anchor);
    }
    slot.anchor.parentNode?.insertBefore(element, before ? slot.anchor : slot.anchor.nextSibling);
  }
  if (from !== element.parentElement) tidy(from);
}
/**
 * A library-drag target. Free (the default): the pointer itself, with the slot only naming the
 * container and the nearest sibling. Snapped: a slot between children, or a placement zone on the
 * container's empty space.
 */
type Hover = { slot: DropSlot; zone: InsertPlace | null; free?: { x: number; y: number } };
/** Live stand-in during a library drag: under the pointer, or (snapped) in the flow so siblings reflow. */
let ghost: { element: HTMLElement; slot: DropSlot; zone: InsertPlace | null; free?: { x: number; y: number }; component: string } | null = null;
function hoverAt(x: number, y: number, free = false): Hover | null {
  const inFlow = ghost && !ghost.zone && !ghost.free;
  // Inserting the ghost shifts siblings under a still pointer; holding the slot while the pointer
  // is over the ghost stops it hopping back and forth. `usable` already keeps it out of slot geometry.
  const r = inFlow && !free ? ghost!.element.getBoundingClientRect() : null;
  // (A slot whose anchor was a dissolved row is stale and measured again.)
  if (ghost && r && ghost.slot.anchor.isConnected && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { slot: ghost.slot, zone: null };
  // Measure the page without the ghost: it grows its container, so the same point would otherwise
  // pick a different slot depending on where the ghost last was.
  const shown = ghost?.element.style.display;
  if (ghost && inFlow) ghost.element.style.display = "none";
  const slot = free ? freeSlot(x, y) : findSlot(x, y);
  if (ghost && inFlow) ghost.element.style.display = shown!;
  if (!slot) return null;
  if (free) return { slot, zone: null, free: { x, y } };
  // A side-by-side row only exists in the preview, so nothing is placed in its free space.
  return { slot, zone: slot.container.matches(ROW) ? null : zoneAt(contentRect(slot.container), [...slot.container.children].filter(slotChild).map(rectOf), x, y) };
}
/** Where `element` sits in `container`'s content box, for the brief and for pinning it there again. */
function freeAt(element: Element, container: Element): FreePlace {
  const at = placeIn(element.getBoundingClientRect(), contentRect(container));
  return { ...at, x: snapOffset(at.x, snapStep), y: snapOffset(at.y, snapStep), ...(snapStep > 0 && { snapStep }) };
}

function showSnapGrid(container: Element | null) {
  if (!container || snapStep <= 0) { snapGuide.style.display = "none"; return; }
  const box = contentRect(container);
  Object.assign(snapGuide.style, { display: "block", left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px`, backgroundImage: "radial-gradient(#64748b55 1px, transparent 1px)", backgroundSize: `${snapStep}px ${snapStep}px` });
}
/** Freely placed placeholders: out of the flow on the body, at an offset in their container's content box. */
const pins = new WeakMap<Element, { container: Element; x: number; y: number }>();
// ponytail: pinned in page coordinates, re-pinned on resize only; a reflow that moves the container
// without a resize leaves it behind until the next one.
function pin(element: HTMLElement) {
  const at = pins.get(element);
  if (!at) return;
  const box = contentRect(at.container);
  if (element.parentElement !== document.body) { const from = element.parentElement; document.body.append(element); tidy(from); }
  Object.assign(element.style, { position: "absolute", left: `${box.x + at.x + scrollX}px`, top: `${box.y + at.y + scrollY}px`, margin: "0" });
}
/** Centres the floating ghost on the pointer. */
function float(box: HTMLElement, at: { x: number; y: number }) {
  if (box.parentElement !== document.body) { const from = box.parentElement; document.body.append(box); tidy(from); }
  box.style.position = "fixed";
  const size = box.getBoundingClientRect();
  Object.assign(box.style, { left: `${at.x - size.width / 2}px`, top: `${at.y - size.height / 2}px`, margin: "0" });
}
/** Pins `element` at `zone` of the container's content box; out of the page's flow, so it is preview only. */
function placeInZone(element: HTMLElement, container: Element, zone: InsertPlace, position: "fixed" | "absolute") {
  element.style.position = position;
  const at = zoneOffset(contentRect(container), element.getBoundingClientRect(), zone);
  const scroll = position === "absolute" ? { x: scrollX, y: scrollY } : { x: 0, y: 0 };
  Object.assign(element.style, { left: `${at.x + scroll.x}px`, top: `${at.y + scroll.y}px`, margin: "0" });
}
function showZones(container: Element, zone: InsertPlace | null) {
  if (!zone) { zoneGuide.style.display = "none"; return; }
  const box = contentRect(container);
  Object.assign(zoneGuide.style, { display: "grid", left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
  const active = { start: 0, center: 1, end: 2 };
  [...zoneGuide.children].forEach((cell, i) => {
    (cell as HTMLElement).style.background = i === active[zone.y] * 3 + active[zone.x] ? "#7c3aed14" : "";
  });
}
function showGhost(hover: Hover | null, align: CrossAlignment | null = null, component = "Drop here", live?: string, image?: string) {
  showZones(hover?.slot.container ?? document.body, hover?.zone ?? null);
  if (ghost && (!hover || ghost.component !== component)) { discard(ghost.element); ghost = null; }
  if (!hover) { spacing.replaceChildren(); return; }
  const { slot, zone, free } = hover;
  const same = ghost && !ghost.zone && !ghost.free && !zone && ghost.slot.container === slot.container && ghost.slot.anchor === slot.anchor && ghost.slot.position === slot.position;
  if (!ghost) {
    const element = makeBox(component, live, image);
    element.dataset.divinaUi = "true";
    element.style.pointerEvents = "none";
    ghost = { element, slot, zone, component };
  }
  const box = ghost.element;
  const view = box.dataset.divinaView;
  // The picture can arrive after the drag starts (the host crops it on first use).
  if (image && !view && box.textContent) showPicture(box, image);
  // A rendered component aligns as itself; the pill or picture stays small unless an alignment is snapped.
  box.style.alignSelf = align ? selfValue(align) : view === "live" ? "" : "flex-start";
  if (free) {
    Object.assign(ghost, { slot, zone: null, free });
    float(box, free);
    spacing.replaceChildren();
    return;
  }
  if (zone) {
    Object.assign(ghost, { slot, zone, free: undefined });
    // On the body rather than the overlay root, so a rendered component inherits the page's text styles.
    document.body.append(box);
    placeInZone(box, slot.container, zone, "fixed");
    spacing.replaceChildren();
    return;
  }
  // Until (or unless) the component renders, the pill or picture follows the line it lands on:
  // beside inline siblings, else on its own line.
  if (view !== "live") box.style.display = slot.axis === "row" && !/flex|grid/.test(getComputedStyle(slot.container).display) ? "inline-block" : "block";
  if (same) return;
  if (ghost.zone || ghost.free) Object.assign(box.style, { position: "", left: "", top: "", margin: "" });
  Object.assign(ghost, { slot, zone: null, free: undefined });
  placeAt(box, slot);
  showSpacing(box, slot);
}
function showSpacing(element: Element, slot: DropSlot) {
  // A side drop sits in its row, not directly in the slot's container.
  const container = element.parentElement ?? slot.container;
  const axis = container.matches(ROW) ? "row" : slot.axis;
  const style = getComputedStyle(container);
  const box = container.getBoundingClientRect();
  const px = (value: string) => parseFloat(value) || 0;
  const inner: Rect = { x: box.left + px(style.paddingLeft), y: box.top + px(style.paddingTop), width: box.width - px(style.paddingLeft) - px(style.paddingRight), height: box.height - px(style.paddingTop) - px(style.paddingBottom) };
  const siblings = [...container.children].filter(slotChild).map(rectOf);
  const usesGap = /flex|grid/.test(style.display) && px(axis === "row" ? style.columnGap : style.rowGap) > 0;
  spacing.replaceChildren(...measureGaps(rectOf(element), siblings, inner, axis).flatMap((gap) => {
    const row = axis === "row";
    const line = document.createElement("div");
    line.style.cssText = `position:fixed;pointer-events:none;background:#ef4444;${row ? `left:${gap.start}px;top:${gap.at}px;width:${gap.end - gap.start}px;height:1px` : `left:${gap.at}px;top:${gap.start}px;width:1px;height:${gap.end - gap.start}px`}`;
    const text = document.createElement("div");
    const mid = (gap.start + gap.end) / 2;
    text.textContent = spacingLabel(gap.end - gap.start, usesGap && !gap.edge);
    text.style.cssText = `position:fixed;pointer-events:none;transform:translate(-50%,-50%);background:#ef4444;color:white;padding:0 3px;border-radius:2px;font:10px/1.4 system-ui,sans-serif;white-space:nowrap;left:${row ? mid : gap.at}px;top:${row ? gap.at : mid}px`;
    for (const mark of [line, text]) mark.dataset.divinaUi = "true";
    return [line, text];
  }));
}
function selfValue(align: CrossAlignment) {
  return align === "start" ? "flex-start" : align === "end" ? "flex-end" : "center";
}
function alignmentFor(slot: DropSlot, x: number, y: number): CrossAlignment | null {
  return detectAlignment(contentRect(slot.container), slot.axis, { x, y }, getComputedStyle(slot.container).display.includes("flex"));
}
function contentRect(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  const px = (value: string) => Number.parseFloat(value) || 0;
  const left = px(style.borderLeftWidth) + px(style.paddingLeft);
  const right = px(style.borderRightWidth) + px(style.paddingRight);
  const top = px(style.borderTopWidth) + px(style.paddingTop);
  const bottom = px(style.borderBottomWidth) + px(style.paddingBottom);
  return { x: rect.left + left, y: rect.top + top, width: Math.max(0, rect.width - left - right), height: Math.max(0, rect.height - top - bottom) };
}
function showAlignment(slot: DropSlot | null, alignment: CrossAlignment | null) {
  if (!slot || !alignment) { alignmentGuide.style.display = "none"; return; }
  const rect = contentRect(slot.container);
  const horizontal = slot.axis === "row";
  const position = alignment === "start" ? (horizontal ? rect.y : rect.x) : alignment === "end" ? (horizontal ? rect.y + rect.height : rect.x + rect.width) : (horizontal ? rect.y + rect.height / 2 : rect.x + rect.width / 2);
  Object.assign(alignmentGuide.style, horizontal
    ? { display: "block", left: `${rect.x}px`, top: `${position}px`, width: `${rect.width}px`, height: "0", borderTopWidth: "1px" }
    : { display: "block", left: `${position}px`, top: `${rect.y}px`, width: "0", height: `${rect.height}px`, borderLeftWidth: "1px" });
  alignmentLabel.textContent = `self-${alignment}`;
  Object.assign(alignmentLabel.style, horizontal
    ? { left: "0", top: alignment === "start" ? "2px" : "-17px" }
    : { left: "2px", top: "0" });
}
export function snapshot(element: Element): DomNode {
  const hidden = (node: Element | null): boolean => !!node && (getComputedStyle(node).display === "none" || getComputedStyle(node).visibility === "hidden" || hidden(node.parentElement));
  const text = hidden(element) ? undefined : [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE && !node.parentElement?.closest("script, style")).map((node) => node.textContent ?? "").join(" ").replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
  const classes = [...element.classList].slice(0, 12);
  const node: DomNode = { tag: element.tagName.toLowerCase(), rect: rectOf(element), contentRect: contentRect(element), children: [...element.children].filter(usable).map(snapshot) };
  const identity = identify(element);
  if (identity.components) node.components = identity.components;
  const ref = resolveSourceRef(element);
  if (ref) node.ref = ref;
  if (text) node.text = text;
  if (classes.length) node.classes = classes.join(" ");
  return node;
}

let drag: { element: Element; x: number; y: number; parent: Node; next: Node | null; slot: DropSlot | null } | null = null;
// The host shows a trash button outside the frame while an element is dragged, and sends its
// rect in frame coords; pointer capture keeps events coming once the pointer leaves the iframe.
let trashZone: Rect | null = null;
/** See-through copy that follows the pointer while the original stays faded in place. */
let follower: { clone: HTMLElement; element: HTMLElement; opacity: string } | null = null;
function lift(element: Element) {
  if (!(element instanceof HTMLElement)) return;
  const r = element.getBoundingClientRect();
  // ponytail: a bare clone loses styles from ancestor selectors and inherited text styles, and is
  // clipped at the frame edge; snapshot computed styles or draw it in the host if that misleads.
  const clone = element.cloneNode(true) as HTMLElement;
  clone.dataset.divinaUi = "true";
  delete clone.dataset.divinaPlaceholder;
  Object.assign(clone.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", boxSizing: "border-box", pointerEvents: "none", opacity: "0.85", boxShadow: "0 8px 24px #0003", transition: "none" });
  ui.append(clone);
  follower = { clone, element, opacity: element.style.opacity };
  setCursor("grabbing");
  element.style.opacity = "0.3";
}
function land() {
  if (!follower) return;
  follower.clone.remove();
  follower.element.style.opacity = follower.opacity;
  follower = null;
  setCursor("grab");
}
let dragState: "idle" | "moving" | "over-trash" = "idle";
function setDragState(state: typeof dragState) {
  if (state !== dragState) send({ type: "drag", state: (dragState = state) });
}
const overTrash = (x: number, y: number) =>
  !!trashZone && x >= trashZone.x && x <= trashZone.x + trashZone.width && y >= trashZone.y && y <= trashZone.y + trashZone.height;
let resize: { element: HTMLElement; x: number; y: number; width: number; height: number; old: string } | null = null;
function onPointerMove(event: PointerEvent) {
  if (resize) {
    const width = Math.max(1, resize.width + event.clientX - resize.x);
    const height = Math.max(1, resize.height + event.clientY - resize.y);
    resize.element.style.width = `${width}px`;
    resize.element.style.height = `${height}px`;
    updateOutline(resize.element);
    return;
  }
  if (drag) {
    if (dragState === "idle") {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 4) return;
      // Captured by the dragged element itself, so the click that ends the drag re-selects it and not
      // whatever the pointer happened to cross first.
      drag.element.setPointerCapture?.(event.pointerId);
      lift(drag.element);
    }
    if (follower) follower.clone.style.transform = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
    if (overTrash(event.clientX, event.clientY)) { setDragState("over-trash"); drag.slot = null; showSlot(null); showSnapGrid(null); return; }
    setDragState("moving");
    // Free by default: the element lands where it is released. Shift snaps it into a layout slot.
    const slot = event.shiftKey ? findSlot(event.clientX, event.clientY) : freeSlot(event.clientX, event.clientY);
    showSnapGrid(!event.shiftKey && snapStep > 0 ? slot?.container ?? null : null);
    if (slot && slot.container !== drag.element && !drag.element.contains(slot.container)) { drag.slot = slot; showSlot(slot); }
    else { drag.slot = null; showSlot(null); }
    return;
  }
  if (mode !== "select") return;
  hovered = targetAt(event.clientX, event.clientY);
  const over = event.target as Node;
  setCursor(selected && (selected === over || selected.contains(over)) && !(selected as HTMLElement).isContentEditable ? "grab" : "default");
  updateOutline(selected ?? hovered);
  send({ type: "hover", ref: hovered ? resolveSourceRef(hovered) : null, rect: hovered ? rectOf(hovered) : null });
}
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.target === handles && selected instanceof HTMLElement) {
    const rect = selected.getBoundingClientRect();
    resize = { element: selected, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, old: selected.getAttribute("style") ?? "" };
    setCursor("nwse-resize");
    event.preventDefault();
    return;
  }
  const placeholder = selected?.matches("[data-divina-placeholder]");
  if (selected && (placeholder || usable(event.target as Element)) && (event.target === selected || selected.contains(event.target as Node))) {
    const parent = selected.parentNode;
    if (!parent) return;
    drag = { element: selected, x: event.clientX, y: event.clientY, parent, next: selected.nextSibling, slot: null };
    event.preventDefault(); // no text selection while dragging
  }
}
function onPointerUp(event: PointerEvent) {
  if (resize) {
    const current = resize;
    if (event.clientX !== current.x || event.clientY !== current.y) {
      const width = Math.round(current.element.getBoundingClientRect().width);
      const height = Math.round(current.element.getBoundingClientRect().height);
      revert.push(() => current.element.setAttribute("style", current.old));
      send({ type: "edit", record: edit("resize", current.element, { props: { width: `${width}px`, height: `${height}px` } }) });
    } else current.element.setAttribute("style", current.old);
    resize = null;
    setCursor("default");
  }
  if (drag) {
    const current = drag;
    drag = null;
    const trashed = overTrash(event.clientX, event.clientY) && dragState !== "idle";
    setDragState("idle");
    land();
    if (trashed) { selected = current.element; deleteSelected(); return; }
    const finalSlot = (event.shiftKey ? findSlot : freeSlot)(event.clientX, event.clientY);
    showSnapGrid(null);
    current.slot = finalSlot && finalSlot.container !== current.element && !current.element.contains(finalSlot.container) ? finalSlot : null;
    showSlot(null);
    const slot = current.slot;
    if (!current.element.parentNode) return;
    if (!event.shiftKey) { if (current.element instanceof HTMLElement) moveFreely(current.element, slot, event.clientX - current.x, event.clientY - current.y); return; }
    if (!slot) return;
    const target = through(slot.anchor, slot.position);
    const anchor = resolveSourceRef(target);
    const source = resolveSourceRef(current.element);
    if (!anchor || !source || target === current.element) return;
    const beside = sideBySide(slot);
    placeAt(current.element, slot);
    revert.push(() => {
      const from = current.element.parentElement;
      current.parent.insertBefore(current.element, current.next?.parentNode === current.parent ? current.next : null);
      tidy(from);
    });
    selected = current.element;
    updateOutline(selected);
    send({ type: "edit", record: record("move", source, { anchor, position: slot.position, ...(beside ? { beside } : {}) }) });
  }
}
/** Free moves so far per element: the offset shown, and the queued edit a further move replaces. */
const shifts = new WeakMap<Element, { x: number; y: number; id: string }>();
/**
 * Leaves `element` where it was released, `dx`/`dy` from where it was picked up. `slot` (the drop
 * point's container and nearest sibling) says where that is in the code. Nothing is reparented: a
 * dropped placeholder is re-pinned, a page element is shifted with `translate`.
 */
function moveFreely(element: HTMLElement, slot: DropSlot | null, dx: number, dy: number) {
  const container = slot?.container ?? pins.get(element)?.container ?? element.parentElement!;
  const drop = drops.get(element);
  if (drop) {
    const r = element.getBoundingClientRect();
    const box = contentRect(container);
    pins.set(element, { container, x: snapOffset(r.left + dx - box.x, snapStep), y: snapOffset(r.top + dy - box.y, snapStep) });
    pin(element);
    // Same id, so the host's queue keeps one insert for this placeholder.
    const { component, importFrom, library } = drop.payload;
    const next = { ...insertRecord({ component, importFrom, ...(library ? { library } : {}), free: freeAt(element, container) }, slot ?? null, container), id: drop.id };
    drops.set(element, next);
    send({ type: "discard-edit", id: drop.id });
    send({ type: "edit", record: next });
  } else {
    const before = element.style.translate;
    const was = shifts.get(element);
    const total = { x: (was?.x ?? 0) + dx, y: (was?.y ?? 0) + dy };
    const box = contentRect(container);
    const rect = element.getBoundingClientRect();
    const snapped = { x: total.x + snapOffset(rect.left + dx - box.x, snapStep) - (rect.left + dx - box.x), y: total.y + snapOffset(rect.top + dy - box.y, snapStep) - (rect.top + dy - box.y) };
    element.style.translate = `${snapped.x}px ${snapped.y}px`;
    const anchor = slot ? through(slot.anchor, slot.position) : element;
    const move = edit("move", element, { anchor: targetOf(anchor).target, position: slot?.position ?? "after", free: freeAt(element, container), moved: identify(element) });
    shifts.set(element, { ...snapped, id: move.id });
    revert.push(() => { element.style.translate = before; shifts.delete(element); });
    if (was) send({ type: "discard-edit", id: was.id });
    send({ type: "edit", record: move });
  }
  selected = element;
  updateOutline(element);
}
/** The insert edit for a component landing at `slot` (in `container` when there is no sibling to name). */
function insertRecord(payload: Omit<InsertPayload, "anchor" | "position">, slot: DropSlot | null, container: Element, inside = !slot) {
  const anchor = inside || !slot ? container : through(slot.anchor, slot.position);
  // Next to a component that is itself still a pending drop: same code location, ordered against that edit.
  const sibling = drops.get(anchor);
  const { target, dom } = sibling ?? targetOf(anchor);
  const full = { ...payload, anchor: target, position: inside || !slot ? "inside-end" as const : slot.position, ...(sibling ? { sibling: sibling.id } : {}) };
  return { ...record("insert", target, full), ...(dom ? { dom } : {}) } as Extract<EditRecord, { kind: "insert" }>;
}
/** Host-driven drop of a library component at frame coords (pointer events never reach the iframe during a host drag). */
function dropInsert(component: string, importFrom: string, x: number, y: number, library?: LibraryRef, live?: string, image?: string, free?: boolean, step?: number) {
  if (step !== undefined) snapStep = step;
  const hover = hoverAt(x, y, free);
  const align = hover && !hover.free && !hover.zone && !hover.slot.beside ? alignmentFor(hover.slot, x, y) : null;
  // The ghost goes to the drop point and stays there as the placeholder, so what was dragged is what lands.
  showGhost(hover, align, component, live, image);
  snapFloatingGhost(hover, x, y);
  showSlot(null);
  showZones(document.body, null);
  showSnapGrid(null);
  spacing.replaceChildren();
  if (!hover || !ghost) return;
  const box = ghost.element;
  ghost = null;
  const { slot, zone } = hover;
  // ponytail: the zone placeholder is pinned in page coordinates, so it drifts if the layout reflows
  // before the agent runs; render it with real layout classes if that misleads.
  if (zone) placeInZone(box, slot.container, zone, "absolute");
  const at = hover.free ? freeAt(box, slot.container) : null;
  if (at) { pins.set(box, { container: slot.container, x: at.x, y: at.y }); pin(box); }
  // A zone drop goes at the end of the container; `place` tells the agent where it should render.
  const insert = insertRecord({
    component, importFrom,
    ...(align ? { align } : {}), ...(zone ? { place: zone } : {}), ...(library ? { library } : {}),
    ...(!zone && !at && sideBySide(slot) ? { beside: true } : {}), ...(at ? { free: at } : {}),
  }, slot, slot.container, !!zone);
  delete box.dataset.divinaUi;
  box.style.pointerEvents = "";
  // The edit id lets deleting the placeholder drop its queued insert.
  box.dataset.divinaPlaceholder = insert.id;
  drops.set(box, insert);
  revert.push(() => discard(box));
  send({ type: "edit", record: insert });
}
/** A dropped placeholder is just discarded; a real element is hidden and queued as a `delete` edit. */
function deleteSelected() {
  const element = selected;
  if (!(element instanceof HTMLElement)) return;
  selected = null;
  updateOutline(null);
  const placed = element.dataset.divinaPlaceholder;
  if (placed) { discard(element); send({ type: "discard-edit", id: placed }); return; }
  const display = element.style.display;
  element.style.display = "none";
  revert.push(() => { element.style.display = display; });
  send({ type: "edit", record: edit("delete", element) });
}
function onKeyDown(event: KeyboardEvent) {
  if (mode !== "select" || !selected || (event.key !== "Delete" && event.key !== "Backspace")) return;
  const at = event.target as HTMLElement;
  if (at.isContentEditable || at.closest?.("input, textarea, select")) return;
  event.preventDefault();
  deleteSelected();
}
function onClick(event: MouseEvent) {
  const placed = mode === "select" && (event.target as Element).closest?.("[data-divina-placeholder]");
  if (placed) { selected = placed; updateOutline(placed); return; }
  if (mode !== "select" || !usable(event.target as Element)) return;
  // Untagged pages select the clicked element itself; edits then carry a DOM anchor.
  const target = getUserCodeTarget(event.target as Element) ?? (event.target as Element);
  selected = target;
  updateOutline(target);
  const { target: ref, dom } = targetOf(target);
  const computed = getComputedStyle(target);
  const styles: Record<string, string> = {};
  for (const property of ["display", "position", "width", "height", "margin", "padding", "fontSize", "fontWeight", "color", "backgroundColor", "gap", "flexDirection", "gridTemplateColumns"]) styles[property] = computed.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  // Seed the host's Text / Tailwind classes fields; text only for leaf elements.
  styles.text = target.children.length ? "" : (target.textContent ?? "");
  styles.className = target.getAttribute("class") ?? "";
  send({ type: "select", ref, rect: rectOf(target), computed: styles, ...(dom ? { dom } : {}) });
}
function onDoubleClick(event: MouseEvent) {
  if (mode !== "select" || !usable(event.target as Element)) return;
  const target = getUserCodeTarget(event.target as Element) ?? (event.target as Element);
  if (!(target instanceof HTMLElement)) return;
  const before = target.textContent ?? "";
  target.contentEditable = "true";
  target.focus();
  const finish = () => {
    target.contentEditable = "false";
    target.removeEventListener("blur", finish);
    if (target.textContent === before) return;
    const after = target.textContent ?? "";
    // The anchor's text is what the agent searches for, so it's taken from the original text.
    target.textContent = before;
    const text = edit("text", target, { text: after });
    target.textContent = after;
    revert.push(() => { target.textContent = before; });
    send({ type: "edit", record: text });
  };
  target.addEventListener("blur", finish);
}
function showInsertHover(x: number, y: number, component?: string, live?: string, image?: string, free?: boolean, step?: number) {
  if (step !== undefined) snapStep = step;
  if (x < 0 || y < 0) { showSnapGrid(null); showGhost(null); showSlot(null); showZones(document.body, null); return; }
  const hover = hoverAt(x, y, free);
  showSnapGrid(free && snapStep > 0 ? hover?.slot.container ?? null : null);
  const align = hover && !hover.free && !hover.zone && !hover.slot.beside ? alignmentFor(hover.slot, x, y) : null;
  showGhost(hover, align, component, live, image);
  snapFloatingGhost(hover, x, y);
  showSlot(hover?.slot ?? null);
  // The ghost marks the spot; the slot line was measured before the ghost reflowed its siblings.
  indicator.style.display = "none";
  if (hover?.zone) slotLabel.textContent = slotLabel.textContent!.replace(/ · .*/, ` · ${zoneName(hover.zone)}`);
  if (hover?.free && ghost) { const at = freeAt(ghost.element, hover.slot.container); slotLabel.textContent = slotLabel.textContent!.replace(/ · .*/, ` · ${at.x}, ${at.y}`); }
  showAlignment(hover?.slot ?? null, align);
}
function snapFloatingGhost(hover: Hover | null, x: number, y: number) {
  if (!hover?.free || !ghost || snapStep <= 0) return;
  const box = contentRect(hover.slot.container);
  const size = ghost.element.getBoundingClientRect();
  float(ghost.element, { x: box.x + snapOffset(x - box.x - size.width / 2, snapStep) + size.width / 2, y: box.y + snapOffset(y - box.y - size.height / 2, snapStep) + size.height / 2 });
}
async function renderScreenshot(requestId: string) {
  const clone = document.documentElement.cloneNode(true) as HTMLElement;
  clone.querySelector("[data-divina-ui]")?.remove();
  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${innerWidth}" height="${innerHeight}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml">${serialized}</div></foreignObject></svg>`;
  const image = new Image();
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  try {
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    send({ type: "screenshot-response", requestId, dataUrl: canvas.toDataURL("image/png") });
  } catch (error) {
    send({ type: "console-error", message: `Screenshot failed: ${String(error)}` });
    send({ type: "screenshot-response", requestId, dataUrl: "data:image/png;base64," });
  }
}

function receive(event: MessageEvent<HostToOverlay>) {
  if (event.source !== window.parent || !event.origin || (trustedOrigin && event.origin !== trustedOrigin)) return;
  if (!trustedOrigin) trustedOrigin = event.origin;
  const message = event.data;
  if (!message || typeof message !== "object") return;
  switch (message.type) {
    case "set-mode":
      mode = message.mode;
      setCursor(mode === "select" ? "default" : null);
      if (mode !== "select") updateOutline(null);
      else updateOutline(selected);
      break;
    case "insert-hover":
      showInsertHover(message.x, message.y, message.component, message.live, message.image, message.free, message.snapStep);
      break;
    case "preview-insert":
      dropInsert(message.component, message.importFrom, message.x, message.y, message.library, message.live, message.image, message.free, message.snapStep);
      break;
    case "set-snap-step": snapStep = message.snapStep; break;
    case "preview-edit": {
      const { file, line, col } = message.record.target;
      const at = `${file}:${line}:${col}`;
      // Properties edits target the current selection; untagged ones have no src to look up.
      const el = message.record.dom || selected?.getAttribute("data-divina-src") === at ? selected : document.querySelector(`[data-divina-src="${CSS.escape(at)}"]`);
      if (el instanceof HTMLElement) {
        revert.push(applyPreview(el, message.record));
        updateOutline(selected);
      }
      break;
    }
    case "trash-zone":
      trashZone = message.rect;
      break;
    case "clear-optimistic":
      for (const undo of revert.splice(0).reverse()) undo();
      selected = null;
      updateOutline(null);
      showSlot(null);
      showGhost(null);
      break;
    case "request-snapshot":
      if (message.requestId) send({ type: "dom-snapshot", requestId: message.requestId, root: snapshot(document.body) });
      break;
    case "screenshot-request":
      if (message.requestId) void renderScreenshot(message.requestId);
      break;
  }
}
window.addEventListener("message", receive);
document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerdown", onPointerDown);
document.addEventListener("pointerup", onPointerUp);
document.addEventListener("click", onClick, true);
document.addEventListener("dblclick", onDoubleClick);
document.addEventListener("keydown", onKeyDown);
// Canvas zoom gestures and shortcuts belong to the host; the page would scroll or zoom itself.
document.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  send({ type: "zoom", factor: Math.exp(-event.deltaY * 0.01), x: event.clientX, y: event.clientY });
}, { passive: false });
let gestureScale = 1;
for (const type of ["gesturestart", "gesturechange"]) document.addEventListener(type, (event) => {
  const gesture = event as Event & { scale: number; clientX: number; clientY: number };
  event.preventDefault();
  if (type === "gesturechange") send({ type: "zoom", factor: gesture.scale / gestureScale, x: gesture.clientX, y: gesture.clientY });
  gestureScale = type === "gesturestart" ? 1 : gesture.scale;
});
// The host maps these to actions; Space and ⌘ combos would otherwise scroll or zoom the page.
for (const type of ["keydown", "keyup"] as const) document.addEventListener(type, (event) => {
  const at = event.target as HTMLElement;
  if (!CANVAS_KEYS.includes(event.code) || event.altKey || at.isContentEditable || at.closest?.("input, textarea, select")) return;
  const meta = event.metaKey || event.ctrlKey;
  if (event.code === "Space" || meta) event.preventDefault();
  if (!event.repeat) send({ type: "canvas-key", code: event.code, down: type === "keydown", meta, shift: event.shiftKey });
});
window.addEventListener("resize", () => {
  for (const placed of document.querySelectorAll<HTMLElement>("body > [data-divina-placeholder]")) pin(placed);
  updateOutline(selected);
});
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  originalError(...args);
  send({ type: "console-error", message: args.map(String).join(" ") });
};

send({ type: "ready", url: location.href });
