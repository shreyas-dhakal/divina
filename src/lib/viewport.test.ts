import { expect, test } from "vitest";
import { fitScale, PRESETS, scopeFor, toFrameCoords } from "./viewport";

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

test("diff files outside the edit list are flagged", async () => {
  const { changedFiles } = await import("@/components/Workspace");
  const diff = "diff --git a/src/Hero.tsx b/src/Hero.tsx\n+x\ndiff --git a/package.json b/package.json\n+y\n";
  expect(changedFiles(diff, ["/abs/proj/src/Hero.tsx"])).toEqual({
    files: ["src/Hero.tsx", "package.json"],
    flagged: ["package.json"],
  });
});
