// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { calculateDropPosition, resolveSourceRef } from "./overlay.js";

describe("source references", () => {
  it("builds an owner chain from marked ancestors and computes a map index", () => {
    const root = document.createElement("main");
    root.innerHTML = `
      <section data-divina-src='{"file":"src/App.tsx","line":4,"col":2,"component":"App"}'>
        <div data-divina-src='{"file":"src/List.tsx","line":9,"col":4,"component":"Row"}'></div>
        <div data-divina-src='{"file":"src/List.tsx","line":9,"col":4,"component":"Row"}'></div>
      </section>`;
    const item = root.querySelectorAll("div")[1]!;
    expect(resolveSourceRef(item)).toEqual({
      file: "src/List.tsx", line: 9, col: 4, component: "Row",
      owners: [{ file: "src/App.tsx", line: 4, col: 2, component: "App", owners: [] }],
      list: { file: "src/List.tsx", line: 9, index: 1 },
    });
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
