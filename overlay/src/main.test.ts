// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyPreview, buildDomAnchor, resolveSourceRef } from "./overlay.js";
import { pickDropSlot } from "./slots.js";

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

describe("drop slots", () => {
  const setup = (direction = "row") => {
    document.body.innerHTML = `<main><section class="flex-col"><button>A</button><button>B</button></section></main>`;
    const container = document.querySelector("section")!;
    container.style.display = "flex";
    container.style.flexDirection = direction;
    const children = [...container.children];
    const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, width, height, left, top, right: left + width, bottom: top + height, toJSON() {} });
    container.getBoundingClientRect = () => box(0, 0, 200, 100);
    children[0]!.getBoundingClientRect = () => box(0, 0, direction.startsWith("row") ? 80 : 200, direction.startsWith("row") ? 100 : 40);
    children[1]!.getBoundingClientRect = () => box(direction.startsWith("row") ? 120 : 0, direction.startsWith("row") ? 0 : 60, direction.startsWith("row") ? 80 : 200, direction.startsWith("row") ? 100 : 40);
    return { container, children };
  };
  const pick = (x: number, y: number) => pickDropSlot(x, y, (el) => !!el && el !== document.body && el !== document.documentElement && !el.closest("[data-divina-ui], [data-divina-placeholder]"), (el) => el, resolveSourceRef);
  it("uses row and column layout axes and picks the nearest slot between siblings", () => {
    const { children } = setup("row");
    document.elementFromPoint = () => children[0]!;
    const row = pick(100, 20)!;
    expect([row.axis, row.index, row.position, row.anchor]).toEqual(["row", 1, "after", children[0]]);
    setup("column");
    const vertical = document.querySelector("button")!;
    document.elementFromPoint = () => vertical;
    expect(pick(20, 50)?.axis).toBe("column");
  });
  it("moves a leaf hit to its parent container and maps slots to anchors", () => {
    const { container, children } = setup("row");
    document.elementFromPoint = () => children[0]!;
    const slot = pick(4, 20)!;
    expect(slot.container).toBe(container);
    expect([slot.index, slot.position, slot.anchor]).toEqual([0, "before", children[0]]);
  });
  it("returns inside-start for an empty container", () => {
    document.body.innerHTML = "<main><section></section></main>";
    const container = document.querySelector("section")!;
    container.style.display = "flex";
    container.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 80, left: 0, top: 0, right: 100, bottom: 80, toJSON() {} });
    document.elementFromPoint = () => container;
    expect(pick(50, 40)).toMatchObject({ container, index: 0, total: 1, position: "inside-start", anchor: container });
  });
});

describe("DOM anchors", () => {
  it("builds a body-relative path with nth-of-type and extracts nearby text", () => {
    document.body.innerHTML = `<main><section></section><section><h2>  Helpful   heading </h2><button></button></section></main>`;
    const button = document.querySelector("button")!;
    expect(buildDomAnchor(button)).toMatchObject({
      selector: "main > section:nth-of-type(2) > button", tag: "button", text: "Helpful heading",
    });
  });

  it("reads Svelte and Vue development metadata", () => {
    document.body.innerHTML = `<main><p></p><div></div></main>`;
    const [svelte, vue] = [...document.querySelectorAll("main > *")];
    Object.defineProperty(svelte!, "__svelte_meta", { value: { loc: { file: "/project/src/App.svelte", line: 4, column: 2 } } });
    Object.defineProperty(vue!, "__vueParentComponent", { value: { type: { __file: "/project/src/Card.vue" } } });
    expect(buildDomAnchor(svelte!).meta).toBe("/project/src/App.svelte:4:2");
    expect(buildDomAnchor(vue!).meta).toBe("/project/src/Card.vue:0:0");
  });

  it("uses a container's first text run, not all its text joined", () => {
    document.body.innerHTML = `<section><h2>Our Services</h2><p>We build things.</p></section>`;
    expect(buildDomAnchor(document.querySelector("section")!).text).toBe("Our Services");
  });

  it("keeps empty text when no nearby text exists", () => {
    document.body.innerHTML = "<main><div></div></main>";
    expect(buildDomAnchor(document.querySelector("div")!).text).toBe("");
  });
});

describe("untagged library insert", () => {
  it("sends an edit with a DOM anchor and empty source target", async () => {
    const sent: MessageEvent[] = [];
    window.parent.postMessage = ((message: unknown) => sent.push({ data: message } as MessageEvent)) as typeof window.parent.postMessage;
    document.body.innerHTML = "<main><h1>Title</h1></main>";
    const target = document.querySelector("h1")!;
    document.elementFromPoint = () => target;
    await import("./main.js");
    window.dispatchEvent(new MessageEvent("message", { source: window.parent, origin: "http://localhost", data: { type: "preview-insert", component: "Button", importFrom: "@/button", x: 5, y: 5, library: { id: "ui", name: "UI", install: "", usage: "<Button/>" } } }));
    const edit = sent.map((event) => event.data as { type?: string; record?: { target: { file: string }; dom?: { selector: string }; payload?: { library?: { id: string } } } }).find((message) => message.type === "edit")!;
    expect(edit.record?.target.file).toBe("");
    expect(edit.record?.dom?.selector).toBe("main > h1");
    expect(edit.record?.payload?.library?.id).toBe("ui");
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
