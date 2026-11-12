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

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
export const clampZoom = (z: number) => Math.min(4, Math.max(0.1, z));
/** Next preset zoom above (dir 1) or below (dir -1) `z`, for the toolbar buttons and ⌘+/⌘−. */
export function stepZoom(z: number, dir: 1 | -1): number {
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.005) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.005);
  return next ?? z;
}

/** Canvas camera: frame scale and its top-left offset inside the canvas, in host px. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

/** Zooms `view` by `factor` keeping canvas point (px, py) still. */
export function zoomView(view: View, factor: number, px: number, py: number): View {
  const scale = clampZoom(view.scale * factor);
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

export type CanvasAction = "zoom-in" | "zoom-out" | "fit" | "actual" | "hand" | "select";
/** Figma / Illustrator shortcuts by `KeyboardEvent.code`; Space (hold to pan) is handled separately. */
export function canvasAction(code: string, meta: boolean, shift: boolean): CanvasAction | null {
  if (meta) return ({ Equal: "zoom-in", Minus: "zoom-out", Digit0: "fit", Digit1: "actual" } as const)[code as "Equal"] ?? null;
  if (shift) return ({ Digit1: "fit", Digit0: "actual" } as const)[code as "Digit1"] ?? null;
  return ({ KeyH: "hand", KeyV: "select" } as const)[code as "KeyH"] ?? null;
}
