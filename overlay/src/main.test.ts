// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { applyPreview, buildDomAnchor, resolveSourceRef } from "./overlay.js";
import { pickDropSlot } from "./slots.js";
import { detectAlignment } from "./align.js";

describe("cross-axis alignment", () => {
  const rect = { x: 0, y: 0, width: 200, height: 100 };
  it("snaps flex row pointers to start, center and end on the cross axis", () => {
    expect(detectAlignment(rect, "row", { x: 20, y: 3 }, true)).toBe("start");
    expect(detectAlignment(rect, "row", { x: 20, y: 50 }, true)).toBe("center");
    expect(detectAlignment(rect, "row", { x: 20, y: 98 }, true)).toBe("end");
  });
  it("uses the horizontal cross axis for columns and ignores non-flex containers", () => {
    expect(detectAlignment(rect, "column", { x: 2, y: 20 }, true)).toBe("start");
    expect(detectAlignment(rect, "column", { x: 100, y: 20 }, true)).toBe("center");
    expect(detectAlignment(rect, "column", { x: 198, y: 20 }, true)).toBe("end");
    expect(detectAlignment(rect, "row", { x: 0, y: 50 }, false)).toBeNull();
    expect(detectAlignment(rect, "row", { x: 0, y: 20 }, true)).toBeNull();
  });
});

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
  const pick = (x: number, y: number) => pickDropSlot(x, y, (el) => !!el && el !== document.body && el !== document.documentElement && !el.closest("[data-divina-ui], [data-divina-placeholder]"), (el) => el);
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
  it("walks past a text-only inline-flex button to its flex column", () => {
    document.body.innerHTML = `<main><section><button>text</button><button>next</button></section></main>`;
    const container = document.querySelector("section")!;
    const [button, next] = [...container.children];
    container.style.display = "flex";
    container.style.flexDirection = "column";
    (button as HTMLElement).style.display = "inline-flex";
    const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, width, height, left, top, right: left + width, bottom: top + height, toJSON() {} });
    container.getBoundingClientRect = () => box(0, 0, 100, 100);
    button!.getBoundingClientRect = () => box(0, 0, 100, 40);
    next!.getBoundingClientRect = () => box(0, 60, 100, 40);
    document.elementFromPoint = () => button!;
    expect(pick(10, 10)).toMatchObject({ container, axis: "column", index: 0, position: "before", anchor: button });
    expect(pick(10, 55)).toMatchObject({ container, axis: "column", index: 1, position: "after", anchor: button });
  });
  it("walks past an inline-flex button with an icon child", () => {
    document.body.innerHTML = `<main><section><button><svg></svg>Save</button></section></main>`;
    const container = document.querySelector("section")!;
    const button = container.querySelector("button")!;
    container.style.display = "flex";
    container.style.flexDirection = "column";
    button.style.display = "inline-flex";
    container.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 100, left: 0, top: 0, right: 100, bottom: 100, toJSON() {} });
    button.getBoundingClientRect = () => ({ x: 0, y: 0, width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40, toJSON() {} });
    document.elementFromPoint = () => button.querySelector("svg");
    // jsdom computes inline-flex as flex; report what a browser does.
    const real = getComputedStyle;
    const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el) => el === button ? ({ ...real(el), display: "inline-flex" }) as CSSStyleDeclaration : real(el));
    expect(pick(10, 35)).toMatchObject({ container, position: "after", anchor: button });
    spy.mockRestore();
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
    document.body.innerHTML = "<main><section style='display:flex;flex-direction:column'><h1>Title</h1><p>Text</p></section></main>";
    const section = document.querySelector("section")!;
    const target = document.querySelector("h1")!;
    document.elementFromPoint = () => target;
    const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height, left: x, top: y, right: x + width, bottom: y + height, toJSON() {} });
    section.getBoundingClientRect = () => box(0, 0, 200, 100);
    target.getBoundingClientRect = () => box(0, 0, 200, 40);
    document.querySelector("p")!.getBoundingClientRect = () => box(0, 60, 200, 40);
    await import("./main.js");
    window.dispatchEvent(new MessageEvent("message", { source: window.parent, origin: "http://localhost", data: { type: "preview-insert", component: "Button", importFrom: "@/button", x: 2, y: 5, library: { id: "ui", name: "UI", install: "", usage: "<Button/>" } } }));
    const edit = sent.map((event) => event.data as { type?: string; record?: { target: { file: string }; dom?: { selector: string }; payload?: { align?: string; library?: { id: string } } } }).find((message) => message.type === "edit")!;
    expect(edit.record?.target.file).toBe("");
    expect(edit.record?.dom?.selector).toBe("main > section > h1");
    expect(edit.record?.payload?.library?.id).toBe("ui");
    expect(edit.record?.payload?.align).toBe("start");
    expect(document.querySelector("[data-divina-placeholder]")?.getAttribute("style")).toContain("align-self: flex-start");
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

describe("library drag ghost", () => {
  const box = (left: number, top: number, width: number, height: number) => ({ x: left, y: top, width, height, left, top, right: left + width, bottom: top + height, toJSON() {} });
  const post = (data: object) => window.dispatchEvent(new MessageEvent("message", { source: window.parent, origin: "http://localhost", data }));
  const setup = async () => {
    window.parent.postMessage = (() => {}) as typeof window.parent.postMessage;
    await import("./main.js");
    document.body.innerHTML = `<main><section><button>A</button><button>B</button></section></main>`;
    const container = document.querySelector("section")!;
    container.style.display = "flex";
    const [a, b] = [...container.children];
    container.getBoundingClientRect = () => box(0, 0, 200, 100);
    a!.getBoundingClientRect = () => box(0, 0, 80, 100);
    b!.getBoundingClientRect = () => box(120, 0, 80, 100);
    document.elementFromPoint = (x) => (x < 0 ? null : a!);
    const ghost = () => container.querySelector("[data-divina-ui]");
    return { container, a: a!, b: b!, ghost };
  };
  it("sits at the slot, holds it while the pointer is over it, and leaves with the hover", async () => {
    const { container, a, ghost } = await setup();
    post({ type: "insert-hover", x: 100, y: 20 });
    const element = ghost()!;
    expect([...container.children]).toEqual([a, element, container.children[2]]);
    expect((element as HTMLElement).style.pointerEvents).toBe("none");
    // Siblings unchanged, so x=170 alone would pick "after B"; the pointer is over the ghost, so the slot holds.
    element.getBoundingClientRect = () => box(80, 0, 100, 100);
    post({ type: "insert-hover", x: 170, y: 20 });
    expect(container.children[1]).toBe(element);
    post({ type: "insert-hover", x: 190, y: 20 });
    expect(container.lastElementChild).toBe(element);
    const labels = () => [...document.querySelectorAll("[data-divina-ui]")].filter((el) => /^\d+px/.test(el.textContent ?? ""));
    expect(labels()).not.toHaveLength(0);
    post({ type: "insert-hover", x: -1, y: -1 });
    expect(ghost()).toBeNull();
    expect(labels()).toHaveLength(0);
  });
  it("is replaced on drop by the placeholder in the same slot", async () => {
    const { container, a, b, ghost } = await setup();
    post({ type: "insert-hover", x: 100, y: 20 });
    post({ type: "preview-insert", component: "Card", importFrom: "@/card", x: 100, y: 20 });
    expect(ghost()).toBeNull();
    expect([...container.children].map((el) => el.textContent)).toEqual(["A", "Card", "B"]);
    expect([container.children[0], container.children[2]]).toEqual([a, b]);
  });
});
