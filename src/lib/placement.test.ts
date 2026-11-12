import { expect, test } from "vitest";
import type { DomNode, EditRecord } from "@/shared/protocol";
import { placementProblem } from "./placement";

const src = { file: "src/App.tsx", line: 1, col: 1, owners: [] };
const edit = (kind: "insert" | "move" = "insert", x = 10): EditRecord => ({
  id: "e",
  kind,
  target: src,
  viewport: { preset: "mobile", width: 390, height: 800 },
  scope: "mobile-down",
  payload: kind === "insert"
    ? { component: "Button", importFrom: "", anchor: src, position: "after", free: { x, y: 20, width: 50, height: 20, containerWidth: 300, containerHeight: 100 } }
    : { anchor: src, position: "after", moved: { tag: "button", text: "Save" }, free: { x, y: 20, width: 50, height: 20, containerWidth: 300, containerHeight: 100 } },
} as EditRecord);
const node = (tag: string, text = "", x = 10, y = 20, children: DomNode[] = [], components?: string[]): DomNode => ({
  tag,
  text,
  rect: { x, y, width: 50, height: 20 },
  contentRect: { x: 0, y: 0, width: 300, height: 100 },
  children,
  ...(components && { components }),
});
const page = (...children: DomNode[]): DomNode => node("body", "", 0, 0, children);

test("insert passes and viewport mismatch fails", () => {
  const before = page();
  const after = page(node("button", "Save", 10, 20, [], ["Button"]));
  expect(placementProblem(edit(), before, after, 390)).toBe("");
  expect(placementProblem(edit(), before, after, 1024)).toContain("can't be checked");
});

test("insert reports the closest candidate when off", () => {
  expect(placementProblem(edit(), page(), page(node("button", "Save", 18)), 390))
    .toContain('closest match <button> "Save" is 8px too far right');
});

test("new wrapper descends to the inserted component", () => {
  const wrapper = node("div", "", 10, 20, [node("button", "Save", 10, 20, [], ["Button"])], ["Wrapper"]);
  expect(placementProblem(edit(), page(), page(wrapper), 390)).toBe("");
});

test("all after elements with a twin signature are considered new", () => {
  const existing = node("button", "Save", 10, 20, [], ["Button"]);
  const added = node("button", "Save", 18, 20, [], ["Button"]);
  expect(placementProblem(edit(), page(existing), page(existing, added), 390)).toBe("");
});

test("move passes and a missing moved element is reported", () => {
  const move = edit("move");
  // The moved element's text is its first visible run, which here sits in a child, not in its own text nodes.
  expect(placementProblem(move, page(), page({ ...node("button", "", 10, 20, [node("span", "Save", 12, 22)]), firstText: "Save" }), 390)).toBe("");
  expect(placementProblem(move, page(), page(node("p", "Other")), 390)).toContain("no matching element");
});

test("a candidate in the wrong width container fails", () => {
  const after = page(node("button", "Save", 10, 20, [], ["Button"]));
  after.contentRect!.width = 250;
  expect(placementProblem(edit(), page(), after, 390)).toContain("no candidate was found in a container 300px wide");
});
