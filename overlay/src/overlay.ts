import type { Position, SourceRef } from "../../src/shared/protocol.ts";

const sourceAttribute = "data-divina-src";

function readSource(element: Element): Omit<SourceRef, "owners" | "list"> | null {
  const raw = element.getAttribute(sourceAttribute);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SourceRef>;
    if (typeof value.file !== "string" || !Number.isFinite(value.line) || !Number.isFinite(value.col)) return null;
    return {
      file: value.file,
      line: Number(value.line),
      col: Number(value.col),
      ...(typeof value.component === "string" ? { component: value.component } : {}),
    };
  } catch {
    return null;
  }
}

export function resolveSourceRef(element: Element): SourceRef | null {
  const src = readSource(element);
  if (!src) return null;
  const owners: SourceRef[] = [];
  let ancestor = element.parentElement;
  while (ancestor) {
    const owner = readSource(ancestor);
    if (owner) owners.unshift({ ...owner, owners: [] });
    ancestor = ancestor.parentElement;
  }
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
