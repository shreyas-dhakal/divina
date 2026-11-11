import { OWNERS_ATTR, SRC_ATTR, type DomAnchor, type EditRecord, type Position, type SourceRef } from "../../src/shared/protocol.ts";

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
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
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

export function calculateDropPosition(target: Element, x: number, y: number): Position {
  const rect = target.getBoundingClientRect();
  const style = getComputedStyle(target.parentElement ?? target);
  const display = style.display;
  const horizontal = display.includes("grid")
    ? style.gridAutoFlow !== "row" && style.gridAutoFlow !== "row dense"
    : display.includes("flex") && style.flexDirection.startsWith("row");
  const children = [...target.children].filter((child) => !(child as HTMLElement).dataset.divinaUi);
  if (children.length === 0 && !display.includes("flex") && !display.includes("grid")) return x < rect.left + rect.width / 2 || y < rect.top + rect.height / 2 ? "inside-start" : "inside-end";
  return horizontal
    ? (x < rect.left + rect.width / 2 ? "before" : "after")
    : (y < rect.top + rect.height / 2 ? "before" : "after");
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
