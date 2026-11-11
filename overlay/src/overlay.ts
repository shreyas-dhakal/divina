import { OWNERS_ATTR, SRC_ATTR, type EditRecord, type Position, type SourceRef } from "../../src/shared/protocol.ts";

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
