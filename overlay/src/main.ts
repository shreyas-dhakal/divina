import type { DomNode, EditRecord, HostToOverlay, InsertPlace, OverlayMode, OverlayToHost, Rect, Scope, SourceRef, Viewport } from "../../src/shared/protocol.ts";
import { applyPreview, buildDomAnchor, getUserCodeTarget, resolveSourceRef } from "./overlay.js";
import { measureGaps, spacingLabel } from "./guides.js";
import { pickDropSlot, type DropSlot } from "./slots.js";
import { detectAlignment, type CrossAlignment } from "./align.js";
import { zoneAt, zoneName, zoneOffset } from "./zones.js";

const hostOrigin = (() => {
  try { return new URL(document.referrer).origin; } catch { return ""; }
})();
let mode: OverlayMode = "off";
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
(document.documentElement ?? document.body).append(ui);

function usable(element: Element | null): boolean {
  return !!element && element !== document.documentElement && element !== document.body && !ui.contains(element) && !element.closest("[data-divina-ui], [data-divina-placeholder]");
}
function record(kind: EditRecord["kind"], target: SourceRef, payload?: EditRecord["payload"]): EditRecord {
  return { id: id(), kind, target, viewport: viewport(), scope: scope(), ...(payload === undefined ? {} : { payload }) } as EditRecord;
}
function updateOutline(element: Element | null) {
  if (!element || !(usable(element) || element.matches("[data-divina-placeholder]"))) { outline.style.display = "none"; return; }
  const rect = rectOf(element);
  Object.assign(outline.style, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  label.textContent = element.tagName.toLowerCase();
}
function targetAt(x: number, y: number): Element | null {
  let element: Element | null = document.elementFromPoint(x, y);
  while (element && !usable(element)) element = element.parentElement;
  return element ? getUserCodeTarget(element) ?? element : null;
}
function findSlot(x: number, y: number) { return pickDropSlot(x, y, usable, getUserCodeTarget); }
function showSlot(slot: DropSlot | null) {
  if (!slot) { indicator.style.display = "none"; containerHighlight.style.display = "none"; alignmentGuide.style.display = "none"; return; }
  const rect = slot.container.getBoundingClientRect();
  Object.assign(containerHighlight.style, { display: "block", left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  const firstClass = [...slot.container.classList].find((name) => !name.startsWith("data-"));
  slotLabel.textContent = `${slot.container.tagName.toLowerCase()}${firstClass ? `.${firstClass}` : ""} · ${slot.index + 1} of ${slot.total || 1} ${slot.axis === "row" ? "→" : "↓"}`;
  Object.assign(indicator.style, { left: `${slot.guide.x}px`, top: `${slot.guide.y}px`, width: `${slot.guide.width || 3}px`, height: `${slot.guide.height || 3}px` });
  indicator.style.display = "block";
}
// Sized to its label, not the full row, but on its own line in a block container (inline-block sat
// beside an inline Button, where a real component wouldn't).
const placeholderStyle = "display:block;width:fit-content;align-self:flex-start;border:1px dashed #7c3aed;border-radius:6px;background:#7c3aed12;color:#6d28d9;padding:4px 12px;font:12px/1.5 system-ui";
function placeAt(element: Element, slot: DropSlot) {
  if (slot.position.startsWith("inside")) slot.container.insertBefore(element, slot.container.firstChild);
  else slot.anchor.parentNode?.insertBefore(element, slot.position === "before" ? slot.anchor : slot.anchor.nextSibling);
}
/** A library-drag target: a slot between children, or a placement zone on the container's empty space. */
type Hover = { slot: DropSlot; zone: InsertPlace | null };
/** Live stand-in during a library drag, so siblings reflow where the drop will land. */
let ghost: { element: HTMLElement; slot: DropSlot; zone: InsertPlace | null } | null = null;
function hoverAt(x: number, y: number): Hover | null {
  // Inserting the ghost shifts siblings under a still pointer; holding the slot while the pointer
  // is over the ghost stops it hopping back and forth. `usable` already keeps it out of slot geometry.
  const r = ghost && !ghost.zone ? ghost.element.getBoundingClientRect() : null;
  if (ghost && r && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return { slot: ghost.slot, zone: null };
  // Measure the page without the ghost: it grows its container, so the same point would otherwise
  // pick a different slot depending on where the ghost last was.
  if (ghost) ghost.element.style.display = "none";
  const slot = findSlot(x, y);
  const hover = slot && { slot, zone: zoneAt(contentRect(slot.container), [...slot.container.children].filter(usable).map(rectOf), x, y) };
  if (ghost) ghost.element.style.display = "";
  return hover;
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
function showGhost(hover: Hover | null, align: CrossAlignment | null = null, component = "Drop here") {
  showZones(hover?.slot.container ?? document.body, hover?.zone ?? null);
  if (!hover) { ghost?.element.remove(); ghost = null; spacing.replaceChildren(); return; }
  const { slot, zone } = hover;
  const same = ghost && !ghost.zone && !zone && ghost.slot.container === slot.container && ghost.slot.anchor === slot.anchor && ghost.slot.position === slot.position;
  if (!ghost) {
    const element = document.createElement("div");
    element.dataset.divinaUi = "true";
    element.style.cssText = `${placeholderStyle};pointer-events:none`;
    // Label in a shadow root: light-DOM text would make an empty container look non-empty to pickDropSlot.
    element.attachShadow({ mode: "open" });
    ghost = { element, slot, zone };
  }
  ghost.element.shadowRoot!.textContent = component;
  ghost.element.style.alignSelf = align ? selfValue(align) : "flex-start";
  if (zone) {
    Object.assign(ghost, { slot, zone });
    ui.append(ghost.element);
    placeInZone(ghost.element, slot.container, zone, "fixed");
    spacing.replaceChildren();
    return;
  }
  if (same) return;
  if (ghost.zone) Object.assign(ghost.element.style, { position: "", left: "", top: "", margin: "" });
  Object.assign(ghost, { slot, zone: null });
  placeAt(ghost.element, slot);
  showSpacing(ghost.element, slot);
}
function showSpacing(element: Element, slot: DropSlot) {
  const style = getComputedStyle(slot.container);
  const box = slot.container.getBoundingClientRect();
  const px = (value: string) => parseFloat(value) || 0;
  const inner: Rect = { x: box.left + px(style.paddingLeft), y: box.top + px(style.paddingTop), width: box.width - px(style.paddingLeft) - px(style.paddingRight), height: box.height - px(style.paddingTop) - px(style.paddingBottom) };
  const siblings = [...slot.container.children].filter(usable).map(rectOf);
  const usesGap = /flex|grid/.test(style.display) && px(slot.axis === "row" ? style.columnGap : style.rowGap) > 0;
  spacing.replaceChildren(...measureGaps(rectOf(element), siblings, inner, slot.axis).flatMap((gap) => {
    const row = slot.axis === "row";
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
function snapshot(element: Element): DomNode {
  const text = element.children.length ? undefined : (element.textContent ?? "").trim().slice(0, 160) || undefined;
  const classes = [...element.classList].slice(0, 12);
  const node: DomNode = { tag: element.tagName.toLowerCase(), rect: rectOf(element), children: [...element.children].filter(usable).slice(0, 40).map(snapshot) };
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
  element.style.opacity = "0.3";
}
function land() {
  if (!follower) return;
  follower.clone.remove();
  follower.element.style.opacity = follower.opacity;
  follower = null;
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
      (event.target as Element).setPointerCapture?.(event.pointerId);
      lift(drag.element);
    }
    if (follower) follower.clone.style.transform = `translate(${event.clientX - drag.x}px, ${event.clientY - drag.y}px)`;
    if (overTrash(event.clientX, event.clientY)) { setDragState("over-trash"); drag.slot = null; showSlot(null); return; }
    setDragState("moving");
    const slot = findSlot(event.clientX, event.clientY);
    if (slot && slot.container !== drag.element && !drag.element.contains(slot.container)) { drag.slot = slot; showSlot(slot); }
    return;
  }
  if (mode !== "select") return;
  hovered = targetAt(event.clientX, event.clientY);
  updateOutline(selected ?? hovered);
  send({ type: "hover", ref: hovered ? resolveSourceRef(hovered) : null, rect: hovered ? rectOf(hovered) : null });
}
function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  if (event.target === handles && selected instanceof HTMLElement) {
    const rect = selected.getBoundingClientRect();
    resize = { element: selected, x: event.clientX, y: event.clientY, width: rect.width, height: rect.height, old: selected.getAttribute("style") ?? "" };
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
    const ref = resolveSourceRef(current.element);
    if (ref && (event.clientX !== current.x || event.clientY !== current.y)) {
      const width = Math.round(current.element.getBoundingClientRect().width);
      const height = Math.round(current.element.getBoundingClientRect().height);
      revert.push(() => current.element.setAttribute("style", current.old));
      send({ type: "edit", record: record("resize", ref, { props: { width: `${width}px`, height: `${height}px` } }) });
    } else current.element.setAttribute("style", current.old);
    resize = null;
  }
  if (drag) {
    const current = drag;
    drag = null;
    const trashed = overTrash(event.clientX, event.clientY) && dragState !== "idle";
    setDragState("idle");
    land();
    if (trashed) { selected = current.element; deleteSelected(); return; }
    const finalSlot = findSlot(event.clientX, event.clientY);
    current.slot = finalSlot && finalSlot.container !== current.element && !current.element.contains(finalSlot.container) ? finalSlot : null;
    showSlot(null);
    const slot = current.slot;
    if (!slot || !current.element.parentNode) return;
    const target = slot.anchor;
    const anchor = resolveSourceRef(target);
    const source = resolveSourceRef(current.element);
    if (!anchor || !source) return;
    if (slot.position.startsWith("inside")) {
      slot.container.insertBefore(current.element, slot.container.firstChild);
    } else {
      const parent = target.parentNode;
      if (!parent) return;
      parent.insertBefore(current.element, slot.position === "before" ? target : target.nextSibling);
    }
    revert.push(() => current.parent.insertBefore(current.element, current.next?.parentNode === current.parent ? current.next : null));
    selected = current.element;
    updateOutline(selected);
    send({ type: "edit", record: record("move", source, { anchor, position: slot.position }) });
  }
}
/** Host-driven drop of a library component at frame coords (pointer events never reach the iframe during a host drag). */
function dropInsert(component: string, importFrom: string, x: number, y: number, library?: import("../../src/shared/protocol.ts").LibraryRef) {
  const hover = hoverAt(x, y);
  const align = hover && !hover.zone ? alignmentFor(hover.slot, x, y) : null;
  showGhost(null);
  showSlot(null);
  if (!hover) return;
  const { slot, zone } = hover;
  // A zone drop goes at the end of the container; `place` tells the agent where it should render.
  const target = zone ? slot.container : slot.anchor;
  const anchor = resolveSourceRef(target);
  const position = zone ? "inside-end" : slot.position;
  const box = document.createElement("div");
  box.textContent = component;
  box.style.cssText = placeholderStyle;
  if (align) box.style.alignSelf = selfValue(align);
  // ponytail: the zone placeholder is pinned in page coordinates, so it drifts if the layout reflows
  // before the agent runs; render it with real layout classes if that misleads.
  if (zone) { document.body.append(box); placeInZone(box, slot.container, zone, "absolute"); }
  else placeAt(box, slot);
  revert.push(() => box.remove());
  const extra = { ...(align ? { align } : {}), ...(zone ? { place: zone } : {}), ...(library ? { library } : {}) };
  const emptyTarget: SourceRef = { file: "", line: 0, col: 0, owners: [] };
  const insert = anchor
    ? record("insert", anchor, { component, importFrom, anchor, position, ...extra })
    : { ...record("insert", emptyTarget, { component, importFrom, anchor: emptyTarget, position, ...extra }), dom: buildDomAnchor(target) };
  // The edit id lets deleting the placeholder drop its queued insert.
  box.dataset.divinaPlaceholder = insert.id;
  send({ type: "edit", record: insert });
}
/** A dropped placeholder is just discarded; a real element is hidden and queued as a `delete` edit. */
function deleteSelected() {
  const element = selected;
  if (!(element instanceof HTMLElement)) return;
  selected = null;
  updateOutline(null);
  const placed = element.dataset.divinaPlaceholder;
  if (placed) { element.remove(); send({ type: "discard-edit", id: placed }); return; }
  const ref = resolveSourceRef(element);
  if (!ref) return;
  const display = element.style.display;
  element.style.display = "none";
  revert.push(() => { element.style.display = display; });
  send({ type: "edit", record: record("delete", ref) });
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
  const target = getUserCodeTarget(event.target as Element);
  if (!target) return;
  selected = target;
  updateOutline(target);
  const ref = resolveSourceRef(target);
  if (!ref) return;
  const computed = getComputedStyle(target);
  const styles: Record<string, string> = {};
  for (const property of ["display", "position", "width", "height", "margin", "padding", "fontSize", "fontWeight", "color", "backgroundColor", "gap", "flexDirection", "gridTemplateColumns"]) styles[property] = computed.getPropertyValue(property.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`));
  // Seed the host's Text / Tailwind classes fields; text only for leaf elements.
  styles.text = target.children.length ? "" : (target.textContent ?? "");
  styles.className = target.getAttribute("class") ?? "";
  send({ type: "select", ref, rect: rectOf(target), computed: styles });
}
function onDoubleClick(event: MouseEvent) {
  if (mode !== "select" || !usable(event.target as Element)) return;
  const target = getUserCodeTarget(event.target as Element);
  if (!(target instanceof HTMLElement) || !resolveSourceRef(target)) return;
  const before = target.textContent ?? "";
  target.contentEditable = "true";
  target.focus();
  const finish = () => {
    target.contentEditable = "false";
    target.removeEventListener("blur", finish);
    if (target.textContent === before) return;
    const ref = resolveSourceRef(target);
    if (!ref) return;
    revert.push(() => { target.textContent = before; });
    send({ type: "edit", record: record("text", ref, { text: target.textContent ?? "" }) });
  };
  target.addEventListener("blur", finish);
}
function showInsertHover(x: number, y: number, component?: string) {
  const hover = hoverAt(x, y);
  const align = hover && !hover.zone ? alignmentFor(hover.slot, x, y) : null;
  showGhost(hover, align, component);
  showSlot(hover?.slot ?? null);
  // The ghost marks the spot; the slot line was measured before the ghost reflowed its siblings.
  indicator.style.display = "none";
  if (hover?.zone) slotLabel.textContent = slotLabel.textContent!.replace(/ · .*/, ` · ${zoneName(hover.zone)}`);
  showAlignment(hover?.slot ?? null, align);
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
      document.documentElement.style.cursor = mode === "select" ? "crosshair" : "";
      if (mode !== "select") updateOutline(null);
      else updateOutline(selected);
      break;
    case "insert-hover":
      showInsertHover(message.x, message.y, message.component);
      break;
    case "preview-insert":
      dropInsert(message.component, message.importFrom, message.x, message.y, message.library);
      break;
    case "preview-edit": {
      const { file, line, col } = message.record.target;
      const at = `${file}:${line}:${col}`;
      const el = selected?.getAttribute("data-divina-src") === at ? selected : document.querySelector(`[data-divina-src="${CSS.escape(at)}"]`);
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
window.addEventListener("resize", () => updateOutline(selected));
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  originalError(...args);
  send({ type: "console-error", message: args.map(String).join(" ") });
};

send({ type: "ready", url: location.href });
