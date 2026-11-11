import { OWNERS_ATTR, SRC_ATTR, type Position, type SourceRef } from "../../src/shared/protocol.ts";

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
