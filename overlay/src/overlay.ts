import { OWNERS_ATTR, SRC_ATTR, type DomAnchor, type EditRecord, type ElementIdentity, type SourceRef } from "../../src/shared/protocol.ts";

/** Where `rect` sits in a container's content box `box`, in whole px: the numbers a free edit carries and `measure_placement` reports. */
export const placeIn = (rect: { left: number; top: number; width: number; height: number }, box: { x: number; y: number; width: number; height: number }) =>
  ({ x: Math.round(rect.left - box.x), y: Math.round(rect.top - box.y), width: Math.round(rect.width), height: Math.round(rect.height), containerWidth: Math.round(box.width), containerHeight: Math.round(box.height) });
export const snapOffset = (value: number, step: number) => step > 0 ? Math.round(value / step) * step : value;

type Loc = Omit<SourceRef, "owners" | "list">;

/** "file:line:col", parsed from the right since paths may hold ":". */
function parseLoc(raw: string): Loc | null {
  const m = /^(.+):(\d+):(\d+)$/.exec(raw);
  return m ? { file: m[1], line: Number(m[2]), col: Number(m[3]) } : null;
}

function readSource(element: Element): Loc | null {
  const raw = element.getAttribute(SRC_ATTR);
  return raw ? parseLoc(raw) : null;
}

export function resolveSourceRef(element: Element): SourceRef | null {
  const src = readSource(element);
  if (!src) return null;
  // The tagger records owning components' usage sites (innermost first); without them
  // (e.g. Next.js), tagged DOM ancestors stand in, innermost first too.
  const tagged = element.getAttribute(OWNERS_ATTR)?.split(" ").map(parseLoc);
  const owners: SourceRef[] = [];
  const locs = tagged ?? [];
  if (!tagged) for (let a = element.parentElement; a; a = a.parentElement) locs.push(readSource(a));
  for (const o of locs) if (o) owners.push({ ...o, owners: [] });
  const peers = element.parentElement
    ? [...element.parentElement.children].filter((sibling) => {
        const candidate = readSource(sibling);
        return candidate?.file === src.file && candidate.line === src.line && candidate.col === src.col;
      })
    : [];
  const index = peers.indexOf(element);
  return {
    ...src,
    owners,
    ...(index > 0 || peers.length > 1 ? { list: { file: src.file, line: src.line, index } } : {}),
  };
}

type Named = { displayName?: string; name?: string; __name?: string; render?: Named; type?: Named };
const nameOf = (type: unknown): string | undefined => {
  if (!type || typeof type === "string") return undefined;
  const t = type as Named;
  return t.displayName || t.__name || t.name || nameOf(t.render) || nameOf(t.type);
};

/**
 * Name of the component whose root DOM node `element` is (e.g. "Card"), from framework dev data,
 * so it works without source tagging. React: the host fiber's parent is that component (forwardRef
 * and memo unwrap). Vue: the component instance whose rendered root is `element`.
 */
export function componentName(element: Element): string | undefined {
  const key = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
  const fiber = key && (element as unknown as Record<string, { return?: { type?: unknown } }>)[key];
  if (fiber) return nameOf(fiber.return?.type);
  const vue = (element as Element & { __vueParentComponent?: { type?: unknown; subTree?: { el?: unknown } } }).__vueParentComponent;
  return vue?.subTree?.el === element ? nameOf(vue.type) : undefined;
}

/**
 * What an element is, so a measured element can be checked against the one the user placed: its tag,
 * own visible text, and every component whose root DOM node it is, innermost first (a Button built on
 * a primitive is both). React walks the fibers up to the next DOM element; Vue gives the one name.
 */
export function identify(element: Element): ElementIdentity {
  const key = Object.keys(element).find((k) => k.startsWith("__reactFiber$"));
  type Fiber = { type?: unknown; return?: Fiber };
  const components: string[] = [];
  for (let fiber = key ? (element as unknown as Record<string, Fiber>)[key]?.return : undefined; fiber && typeof fiber.type !== "string"; fiber = fiber.return) {
    const name = nameOf(fiber.type);
    if (name) components.push(name);
  }
  const vue = components.length ? undefined : componentName(element);
  if (vue) components.push(vue);
  return { tag: element.tagName.toLowerCase(), text: visibleText(element), ...(components.length && { components }) };
}

export function getUserCodeTarget(element: Element): Element | null {
  let current: Element | null = element;
  while (current) {
    const ref = readSource(current);
    if (ref && !/(^|\/)components\/ui\/|(^|\/)node_modules\//.test(ref.file)) return current;
    current = current.parentElement;
  }
  return null;
}

export function buildDomAnchor(element: Element): DomAnchor {
  const parts: string[] = [];
  for (let current: Element | null = element; current && current !== document.body; current = current.parentElement) {
    // The side-by-side preview row (main.ts) isn't in the user's markup.
    if (current.hasAttribute("data-divina-row")) continue;
    const id = current.id;
    if (id && document.querySelectorAll(`#${CSS.escape(id)}`).length === 1) {
      parts.unshift(`#${CSS.escape(id)}`);
      break;
    }
    const tag = current.tagName.toLowerCase();
    const siblings = current.parentElement ? [...current.parentElement.children].filter((s) => s.tagName === current!.tagName) : [];
    parts.unshift(siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag);
  }
  const own = visibleText(element);
  const text = own || nearbyText(element);
  const svelte = (element as Element & { __svelte_meta?: { loc?: { file?: string; line?: number; column?: number } } }).__svelte_meta?.loc;
  let meta = svelte?.file ? `${svelte.file}:${svelte.line ?? 0}:${svelte.column ?? 0}` : undefined;
  if (!meta) {
    let current: Element | null = element;
    while (current && !meta) {
      const candidate = current as Element & { __vueParentComponent?: { type?: { __file?: string } }; __vnode?: { type?: { __file?: string } } };
      const file = candidate.__vueParentComponent?.type?.__file ?? candidate.__vnode?.type?.__file;
      if (file) meta = `${file}:0:0`;
      current = current.parentElement;
    }
  }
  return { selector: parts.join(" > "), tag: element.tagName.toLowerCase(), text: text.slice(0, 80), ...(meta ? { meta } : {}) };
}

function visibleText(element: Element): string {
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return "";
  // First text run, not all of textContent: a container's joined text never appears in the source.
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest("script, style")) continue;
    const text = (node.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  return "";
}

function nearbyText(element: Element): string {
  for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
    const text = visibleText(sibling);
    if (text) return text;
  }
  for (let sibling = element.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
    const text = visibleText(sibling);
    if (text) return text;
  }
  for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
    if (/^H[1-6]$/.test(parent.tagName)) return visibleText(parent);
  }
  return "";
}

const SPACING_PROPS: Record<string, string[]> = {
  p: ["padding"], px: ["paddingLeft", "paddingRight"], py: ["paddingTop", "paddingBottom"],
  m: ["margin"], gap: ["gap"], w: ["width"], h: ["height"],
};
const SIZES: Record<string, string> = { full: "100%", auto: "auto", fit: "fit-content", "1/2": "50%" };

/**
 * Optimistically applies a Properties edit to `element`; returns the revert. A single `prefix-value`
 * class replaces that prefix's class and is mirrored inline, since the dev server's Tailwind may not
 * have generated it yet; any other class string replaces the class list.
 */
export function applyPreview(element: HTMLElement, record: EditRecord): () => void {
  const [cls, style, text] = [element.getAttribute("class"), element.getAttribute("style"), element.textContent];
  if (record.kind === "text") element.textContent = record.payload.text;
  else if (record.kind === "style" || record.kind === "resize") {
    const { classes, props } = record.payload;
    const one = classes?.trim().match(/^([a-z]+)-(\S+)$/);
    if (one && SPACING_PROPS[one[1]]) {
      const [, prefix, value] = one;
      [...element.classList].forEach((c) => c.startsWith(`${prefix}-`) && element.classList.remove(c));
      element.classList.add(classes!.trim());
      const css = SIZES[value] ?? (Number.isFinite(+value) ? `calc(var(--spacing, 0.25rem) * ${value})` : "");
      for (const p of SPACING_PROPS[prefix]) element.style.setProperty(p.replace(/[A-Z]/g, (l) => `-${l.toLowerCase()}`), css);
    } else if (classes !== undefined) element.setAttribute("class", classes);
    for (const [k, v] of Object.entries(props ?? {})) element.style.setProperty(k, v);
  }
  return () => {
    if (record.kind === "text") element.textContent = text;
    for (const [name, value] of [["class", cls], ["style", style]] as const) {
      if (value === null) element.removeAttribute(name);
      else element.setAttribute(name, value);
    }
  };
}
