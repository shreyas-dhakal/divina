import { describe, expect, it } from "vitest";
import { zoneAt, zoneName, zoneOffset } from "./zones.js";

const box = { x: 0, y: 0, width: 300, height: 300 };

describe("placement zones", () => {
  it("picks the 3×3 cell under the pointer when clear of children", () => {
    expect(zoneAt(box, [], 150, 150)).toEqual({ x: "center", y: "center" });
    expect(zoneAt(box, [], 290, 10)).toEqual({ x: "end", y: "start" });
    expect(zoneAt(box, [], 10, 299)).toEqual({ x: "start", y: "end" });
  });
  it("defers to gap snapping near a child", () => {
    const child = { x: 0, y: 0, width: 100, height: 40 };
    expect(zoneAt(box, [child], 110, 50)).toBeNull();
    expect(zoneAt(box, [child], 200, 200)).toEqual({ x: "end", y: "end" });
  });
  it("places flush to edges or centred", () => {
    const size = { width: 100, height: 20 };
    expect(zoneOffset(box, size, { x: "center", y: "center" })).toEqual({ x: 100, y: 140 });
    expect(zoneOffset(box, size, { x: "end", y: "start" })).toEqual({ x: 200, y: 0 });
    expect(zoneName({ x: "center", y: "end" })).toBe("bottom centre");
  });
});
