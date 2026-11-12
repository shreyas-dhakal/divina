import { useEffect, useRef } from "react";

// [radius, inclination, spin speed, phase]
const RINGS = [
  [1.0, 1.5708, 0.05, 0.0],
  [1.0, 0.0, 0.11, 0.6],
  [0.88, 1.05, -0.08, 1.9],
  [0.76, 0.4, 0.14, 3.1],
  [0.62, 1.31, -0.19, 4.4],
  [0.47, 0.7, 0.25, 0.9],
  [0.3, 0.17, -0.33, 2.2],
] as const;
const SEG = 120;
const TAU = Math.PI * 2;

/** The orbiting-rings drawing from the website hero, in the text colour so it follows the theme. */
export function Orbis({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current!;
    const c = el.getContext("2d")!;
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ptr = { x: 0, y: 0, tx: 0, ty: 0 };
    const onMove = (e: PointerEvent) => {
      ptr.tx = (e.clientX / innerWidth) * 2 - 1;
      ptr.ty = (e.clientY / innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", onMove);

    const draw = (t: number) => {
      const w = el.clientWidth, h = el.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
        el.width = Math.round(w * dpr);
        el.height = Math.round(h * dpr);
      }
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const ink = getComputedStyle(el).color;
      c.strokeStyle = c.fillStyle = ink;
      c.lineWidth = 1;
      c.lineCap = "round";
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.4;
      const grow = 1 - Math.pow(1 - Math.min(1, t / 3.2), 3);
      const tilt = 0.42 + ptr.y * 0.3, ct = Math.cos(tilt), st = Math.sin(tilt);
      const circle = (r: number, alpha: number) => {
        c.globalAlpha = alpha;
        c.beginPath(); c.arc(cx, cy, r, 0, TAU); c.stroke();
      };

      // outer dial
      circle(R * grow, 0.5);
      circle(R * 1.085 * grow, 0.28);
      c.globalAlpha = 0.55;
      c.beginPath();
      for (let i = 0; i < 144; i++) {
        const a = t * 0.012 + (i / 144) * TAU;
        const r0 = R * 1.085 * grow, r1 = R * (i % 12 === 0 ? 1.135 : i % 4 === 0 ? 1.11 : 1.097) * grow;
        c.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
        c.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
      }
      c.stroke();

      RINGS.forEach(([radius, a, speed, phase], k) => {
        const rr = radius * R * grow, b = phase + speed * t * grow + (1 - grow) * 2 + ptr.x * 0.5;
        const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        // A point on the ring at angle th, as [screen x, screen y, depth].
        const at = (th: number) => {
          const x = Math.cos(th), y = Math.sin(th) * ca, z = Math.sin(th) * sa;
          const z2 = -x * sb + z * cb;
          return [cx + (x * cb + z * sb) * rr, cy + (y * ct - z2 * st) * rr, y * st + z2 * ct] as const;
        };
        // Back half faint, front half strong.
        for (const front of [false, true]) {
          c.globalAlpha = front ? 0.8 : 0.2;
          c.beginPath();
          let pen = false;
          for (let i = 0; i <= SEG; i++) {
            const [px, py, z] = at((i / SEG) * TAU);
            if (z >= 0 !== front) { pen = false; continue; }
            if (pen) c.lineTo(px, py); else { c.moveTo(px, py); pen = true; }
          }
          c.stroke();
        }
        if (k >= 2) {
          const [qx, qy, qz] = at(t * (0.22 + k * 0.05) + k);
          c.globalAlpha = qz >= 0 ? 1 : 0.3;
          c.beginPath(); c.arc(qx, qy, qz >= 0 ? 3.2 : 2.2, 0, TAU); c.fill();
        }
      });
      c.globalAlpha = 1;
      c.beginPath(); c.arc(cx, cy, R * 0.035 * grow, 0, TAU); c.fill();
    };

    let frame = 0, clock = 0, last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      clock += Math.min(0.05, (now - last) / 1000);
      last = now;
      ptr.x += (ptr.tx - ptr.x) * 0.06;
      ptr.y += (ptr.ty - ptr.y) * 0.06;
      draw(clock);
    };
    const redraw = () => draw(14);
    if (still) { redraw(); window.addEventListener("resize", redraw); }
    else frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("resize", redraw);
    };
  }, []);

  return <canvas ref={ref} aria-hidden className={className} />;
}
