import { expect, test } from "vitest";
import { canvasAction, clampZoom, fitScale, PRESETS, scopeFor, stepZoom, toFrameCoords, zoomView } from "./viewport";

test("viewport -> scope", () => {
  expect(PRESETS.map(scopeFor)).toEqual(["all", "tablet-down", "mobile-down"]);
  expect(scopeFor({ preset: "custom", width: 1024, height: 700 })).toBe("all");
  expect(scopeFor({ preset: "custom", width: 600, height: 700 })).toBe("mobile-down");
});

test("fit scale and coordinate mapping", () => {
  const [desktop, , mobile] = PRESETS;
  expect(fitScale(desktop, 720, 900)).toBe(0.5);
  expect(fitScale(mobile, 2000, 2000)).toBe(1);
  expect(toFrameCoords(110, 70, { left: 10, top: 20 }, 0.5)).toEqual({ x: 200, y: 100 });
});

test("zoom steps and clamp", () => {
  expect(stepZoom(0.72, 1)).toBe(0.75);
  expect(stepZoom(0.72, -1)).toBe(0.67);
  expect(stepZoom(1, 1)).toBe(1.25);
  expect(stepZoom(4, 1)).toBe(4);
  expect(stepZoom(0.1, -1)).toBe(0.1);
  expect(clampZoom(9)).toBe(4);
  expect(clampZoom(0.01)).toBe(0.1);
});

test("zoom keeps the point under the cursor still", () => {
  const v = zoomView({ scale: 0.5, x: 100, y: 50 }, 2, 300, 250);
  expect(v).toEqual({ scale: 1, x: -100, y: -150 });
  // Canvas point (300,250) was frame point (400,400) before and after.
  expect([(300 - v.x) / v.scale, (250 - v.y) / v.scale]).toEqual([400, 400]);
});

test("canvas shortcuts", () => {
  expect(canvasAction("Equal", true, false)).toBe("zoom-in");
  expect(canvasAction("Digit0", true, false)).toBe("fit");
  expect(canvasAction("Digit1", false, true)).toBe("fit");
  expect(canvasAction("Digit0", false, true)).toBe("actual");
  expect(canvasAction("KeyH", false, false)).toBe("hand");
  expect(canvasAction("Backslash", true, false)).toBe("toggle-ui");
  expect(canvasAction("KeyV", true, false)).toBe(null); // ⌘V is paste
});

test("diff files outside the edit list are flagged", async () => {
  const { changedFiles } = await import("@/components/Workspace");
  const diff = "diff --git a/src/Hero.tsx b/src/Hero.tsx\n+x\ndiff --git a/package.json b/package.json\n+y\n";
  expect(changedFiles(diff, ["/abs/proj/src/Hero.tsx"])).toEqual({
    files: ["src/Hero.tsx", "package.json"],
    flagged: ["package.json"],
  });
});
