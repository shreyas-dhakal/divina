import type { DomNode, EditRecord, HostToOverlay, OverlayMode, OverlayToHost, Position, Rect, Scope, SourceRef, Viewport } from "../../src/shared/protocol.ts";
import { calculateDropPosition, getUserCodeTarget, resolveSourceRef } from "./overlay.js";

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
ui.append(outline, indicator);
(document.documentElement ?? document.body).append(ui);

function usable(element: Element | null): boolean {
  return !!element && !ui.contains(element) && !element.closest("[data-divina-ui]");
}
function record(kind: EditRecord["kind"], target: SourceRef, payload?: EditRecord["payload"]): EditRecord {
  return { id: id(), kind, target, viewport: viewport(), scope: scope(), ...(payload === undefined ? {} : { payload }) } as EditRecord;
}
function updateOutline(element: Element | null) {
  if (!element || !usable(element)) { outline.style.display = "none"; return; }
  const rect = rectOf(element);
  Object.assign(outline.style, { display: "block", left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  label.textContent = element.tagName.toLowerCase();
}
function targetAt(x: number, y: number): Element | null {
  let element: Element | null = document.elementFromPoint(x, y);
  while (element && !usable(element)) element = element.parentElement;
  return element ? getUserCodeTarget(element) : null;
}
function showDrop(target: Element, position: Position) {
  const rect = target.getBoundingClientRect();
  const horizontal = getComputedStyle(target.parentElement ?? target).display.includes("flex") && getComputedStyle(target.parentElement ?? target).flexDirection.startsWith("row");
  const inside = position.startsWith("inside");
  if (inside) Object.assign(indicator.style, { left: `${rect.left}px`, top: `${position === "inside-start" ? rect.top : rect.bottom}px`, width: `${rect.width}px`, height: "2px" });
  else if (horizontal) Object.assign(indicator.style, { left: `${position === "before" ? rect.left : rect.right}px`, top: `${rect.top}px`, width: "2px", height: `${rect.height}px` });
  else Object.assign(indicator.style, { left: `${rect.left}px`, top: `${position === "before" ? rect.top : rect.bottom}px`, width: `${rect.width}px`, height: "2px" });
  indicator.style.display = "block";
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

let drag: { element: Element; x: number; y: number; parent: Node; next: Node | null; target: Element | null; position: Position } | null = null;
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
    const target = targetAt(event.clientX, event.clientY);
    if (target && target !== drag.element && !drag.element.contains(target)) {
      drag.target = target;
      drag.position = calculateDropPosition(target, event.clientX, event.clientY);
      showDrop(target, drag.position);
    }
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
  if (selected && usable(event.target as Element) && (event.target === selected || selected.contains(event.target as Node))) {
    const parent = selected.parentNode;
    if (!parent) return;
    drag = { element: selected, x: event.clientX, y: event.clientY, parent, next: selected.nextSibling, target: null, position: "after" };
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
    indicator.style.display = "none";
    const target = current.target;
    if (!target || !current.element.parentNode) return;
    const anchor = resolveSourceRef(target);
    const source = resolveSourceRef(current.element);
    if (!anchor || !source) return;
    if (current.position.startsWith("inside")) {
      target.insertBefore(current.element, current.position === "inside-start" ? target.firstChild : null);
    } else {
      const parent = target.parentNode;
      if (!parent) return;
      parent.insertBefore(current.element, current.position === "before" ? target : target.nextSibling);
    }
    revert.push(() => current.parent.insertBefore(current.element, current.next?.parentNode === current.parent ? current.next : null));
    selected = current.element;
    updateOutline(selected);
    send({ type: "edit", record: record("move", source, { anchor, position: current.position }) });
  }
}
/** Host-driven drop of a library component at frame coords (pointer events never reach the iframe during a host drag). */
function dropInsert(component: string, importFrom: string, x: number, y: number) {
  indicator.style.display = "none";
  const target = targetAt(x, y);
  const anchor = target && resolveSourceRef(target);
  if (!target || !anchor) return;
  const position = calculateDropPosition(target, x, y);
  const box = document.createElement("div");
  box.dataset.divinaPlaceholder = "true";
  box.textContent = component;
  box.style.cssText = "border:1px dashed #7c3aed;background:#7c3aed12;color:#6d28d9;padding:16px;text-align:center";
  if (position.startsWith("inside")) target.insertBefore(box, position === "inside-start" ? target.firstChild : null);
  else target.parentNode?.insertBefore(box, position === "before" ? target : target.nextSibling);
  revert.push(() => box.remove());
  send({ type: "edit", record: record("insert", anchor, { component, importFrom, anchor, position }) });
}
function onClick(event: MouseEvent) {
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
function showInsertHover(x: number, y: number) {
  const target = targetAt(x, y);
  if (target) showDrop(target, calculateDropPosition(target, x, y));
  else indicator.style.display = "none";
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
      showInsertHover(message.x, message.y);
      break;
    case "preview-insert":
      dropInsert(message.component, message.importFrom, message.x, message.y);
      break;
    case "clear-optimistic":
      for (const undo of revert.splice(0).reverse()) undo();
      selected = null;
      updateOutline(null);
      indicator.style.display = "none";
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
window.addEventListener("resize", () => updateOutline(selected));
const originalError = console.error.bind(console);
console.error = (...args: unknown[]) => {
  originalError(...args);
  send({ type: "console-error", message: args.map(String).join(" ") });
};

send({ type: "ready", url: location.href });
