// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyPreview, calculateDropPosition, resolveSourceRef } from "./overlay.js";

describe("source references", () => {
  it("reads file:line:col tags, the owner chain and a map index", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-divina-src="src/App.tsx:4:2">
        <div data-divina-src="src/my:dir/List.tsx:9:4" data-divina-owners="src/App.tsx:12:5 src/main.tsx:3:1"></div>
        <div data-divina-src="src/my:dir/List.tsx:9:4" data-divina-owners="src/App.tsx:12:5 src/main.tsx:3:1"></div>
      </section>`;
    const item = root.querySelectorAll("div")[1]!;
    expect(resolveSourceRef(item)).toEqual({
      file: "src/my:dir/List.tsx", line: 9, col: 4,
      owners: [{ file: "src/App.tsx", line: 12, col: 5, owners: [] }, { file: "src/main.tsx", line: 3, col: 1, owners: [] }],
      list: { file: "src/my:dir/List.tsx", line: 9, index: 1 },
    });
    // No owners attribute: tagged ancestors stand in.
    const p = root.querySelector("section")!.appendChild(document.createElement("p"));
    p.setAttribute("data-divina-src", "app/page.tsx:7:9");
    expect(resolveSourceRef(p)?.owners).toEqual([{ file: "src/App.tsx", line: 4, col: 2, owners: [] }]);
  });
});

describe("drop positions", () => {
  it("chooses before or after along the parent's flex direction", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    document.body.append(parent);
    const target = document.createElement("div");
    parent.append(target);
    target.getBoundingClientRect = () => ({ x: 10, y: 20, width: 100, height: 40, top: 20, right: 110, bottom: 60, left: 10, toJSON() {} });
    expect(calculateDropPosition(target, 20, 30)).toBe("before");
    expect(calculateDropPosition(target, 100, 30)).toBe("after");
  });

  it("uses inside positions for a container without layout children", () => {
    const container = document.createElement("div");
    container.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 100, top: 0, right: 100, bottom: 100, left: 0, toJSON() {} });
    expect(calculateDropPosition(container, 50, 50)).toBe("inside-end");
  });
});

describe("optimistic Properties preview", () => {
  const target = { file: "src/App.tsx", line: 7, col: 9, owners: [] };
  const viewport = { preset: "mobile" as const, width: 390, height: 844 };
  it("replaces a spacing class, mirrors it inline, edits text, and reverts exactly", () => {
    const el = document.createElement("h1");
    el.className = "text-2xl p-6";
    el.textContent = "Welcome";
    const undoPad = applyPreview(el, { id: "1", kind: "style", target, viewport, scope: "mobile-down", payload: { classes: "p-4" } });
    expect(el.className).toBe("text-2xl p-4");
    expect(el.style.padding).toBe("calc(var(--spacing, 0.25rem) * 4)");
    const undoText = applyPreview(el, { id: "2", kind: "text", target, viewport, scope: "mobile-down", payload: { text: "Hi" } });
    expect(el.textContent).toBe("Hi");
    undoText();
    undoPad();
    expect([el.className, el.getAttribute("style"), el.textContent]).toEqual(["text-2xl p-6", null, "Welcome"]);
  });

  it("sets a full class list from the Tailwind classes field", () => {
    const el = document.createElement("div");
    el.className = "flex";
    applyPreview(el, { id: "3", kind: "style", target, viewport, scope: "all", payload: { classes: "grid gap-2" } });
    expect(el.className).toBe("grid gap-2");
  });
});
