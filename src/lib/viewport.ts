import type { Scope, Viewport } from "@/shared/protocol";

export const PRESETS: Viewport[] = [
  { preset: "desktop", width: 1440, height: 900 },
  { preset: "tablet", width: 768, height: 1024 },
  { preset: "mobile", width: 390, height: 844 },
];

/** Desktop edits apply everywhere; smaller viewports scope edits to that size and below. */
export function scopeFor(vp: Viewport): Scope {
  if (vp.width < 768) return "mobile-down";
  if (vp.width < 1024) return "tablet-down";
  return "all";
}

/** Scale that fits the viewport inside the available box, never upscaling. */
export function fitScale(vp: Viewport, availW: number, availH: number): number {
  return Math.min(1, availW / vp.width, availH / vp.height);
}

/** Map a host pointer position to coordinates inside the scaled frame. */
export function toFrameCoords(clientX: number, clientY: number, frame: { left: number; top: number }, scale: number) {
  return { x: (clientX - frame.left) / scale, y: (clientY - frame.top) / scale };
}
