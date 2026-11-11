// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { calculateDropPosition, resolveSourceRef } from "./overlay.js";

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
