import { expect, test } from "vitest";
import type { EditRecord } from "@/shared/protocol";
import { openPlacements, placementProblem } from "./placement";

const src = { file: "src/App.tsx", line: 4, col: 2, owners: [] };
const edit = (id: string, snapStep?: number): EditRecord => ({
  id, kind: "insert", target: src, viewport: { preset: "mobile", width: 390, height: 844 }, scope: "mobile-down",
  payload: { component: "Button", importFrom: "@/button", anchor: src, position: "after", free: { x: 120, y: 48, width: 76, height: 36, containerWidth: 358, containerHeight: 300, ...(snapStep && { snapStep }) } },
});
const at = (x: number, y: number, matches = 1, viewportWidth = 390) => ({ x, y, containerWidth: 358, matches, viewportWidth });

test("a snapped placement must match exactly, a free one within 2px", () => {
  expect(placementProblem(edit("a", 4), at(120, 48))).toBe("");
  expect(placementProblem(edit("a", 4), at(121, 48))).toContain("off by 1px, 0px");
  expect(placementProblem(edit("a"), at(122, 46))).toBe("");
  expect(placementProblem(edit("a"), at(123, 48))).toContain("should be at x 120, y 48");
});

test("an ambiguous selector or another viewport is not a pass", () => {
  expect(placementProblem(edit("a"), at(120, 48, 2))).toContain("matches 2 elements");
  expect(placementProblem(edit("a"), at(120, 48, 1, 1280))).toContain("can't be checked");
});

test("open placements are the unmeasured and the off ones", () => {
  const sent = [edit("a"), edit("b"), edit("c"), { id: "d", kind: "delete", target: src, viewport: edit("a").viewport, scope: "all" } as EditRecord];
  expect(openPlacements(sent, new Map([["a", ""], ["b", "edit b is off"]]))).toEqual(["edit b is off", "edit c was never checked with measure_placement"]);
});

test("the measured element and container must be the ones the user placed", () => {
  const button = { tag: "button", text: "Save", components: ["Primitive.button", "Button"] };
  expect(placementProblem(edit("a"), { ...at(120, 48), element: button })).toBe("");
  expect(placementProblem(edit("a"), { ...at(120, 48), element: { tag: "div", text: "", components: ["Card"] } })).toContain("not the root element of the inserted <Button>");
  expect(placementProblem(edit("a"), { ...at(120, 48), containerWidth: 200 })).toContain("dropped in one 358px wide");
  const move: EditRecord = { ...edit("m"), kind: "move", payload: { anchor: src, position: "after", free: { x: 120, y: 48, width: 76, height: 36, containerWidth: 358, containerHeight: 300 }, moved: { tag: "h2", text: "Pricing" } } };
  expect(placementProblem(move, { ...at(120, 48), element: { tag: "h2", text: "Pricing" } })).toBe("");
  expect(placementProblem(move, { ...at(120, 48), element: { tag: "h2", text: "Features" } })).toContain('not the moved <h2> "Pricing"');
});
