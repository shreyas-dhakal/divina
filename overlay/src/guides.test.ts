import { describe, expect, it } from "vitest";
import { measureGaps, spacingLabel } from "./guides.js";

const r = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });

describe("spacing guides", () => {
  it("measures to the nearest siblings on the ghost's line", () => {
    const ghost = r(96, 0, 40, 20);
    const siblings = [r(0, 0, 80, 20), r(152, 0, 40, 20), r(0, 40, 300, 20)]; // last one wraps onto the next line
    expect(measureGaps(ghost, siblings, r(0, 0, 300, 60), "row")).toEqual([
      { start: 80, end: 96, at: 10, edge: false },
      { start: 136, end: 152, at: 10, edge: false },
    ]);
  });
  it("falls back to the container's padding edge when the ghost is first or last", () => {
    expect(measureGaps(r(0, 24, 40, 20), [r(0, 60, 100, 20)], r(0, 8, 100, 100), "column")).toEqual([
      { start: 8, end: 24, at: 20, edge: true },
      { start: 44, end: 60, at: 20, edge: false },
    ]);
  });
  it("names gap classes only on the default scale", () => {
    expect(spacingLabel(16, true)).toBe("16px · gap-4");
    expect(spacingLabel(6, true)).toBe("6px · gap-1.5");
    expect(spacingLabel(1, true)).toBe("1px · gap-px");
    expect(spacingLabel(52.2, true)).toBe("52px"); // gap-13 isn't on the default scale
    expect(spacingLabel(16, false)).toBe("16px");
    expect(spacingLabel(17, true)).toBe("17px");
  });
});
