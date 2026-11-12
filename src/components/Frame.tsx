import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { Hand, Minus, MousePointer2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Plus } from "lucide-react";
import { Delete02 } from "@/components/animate-ui/icons/hugeicons/delete-02";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { backgroundStyle, BACKGROUNDS, canvasAction, fitScale, PRESETS, stepZoom, toFrameCoords, zoomView, type Background, type CanvasAction, type View } from "@/lib/viewport";
import type { LibraryComponent, OverlayToHost, Rect, Viewport } from "@/shared/protocol";

export const DRAG_MIME = "application/x-divina-component";

const BACKGROUND_KEY = "divina.canvasBackground";
const BACKGROUND_ITEMS = BACKGROUNDS.map((b) => ({ value: b, label: b[0].toUpperCase() + b.slice(1) }));
function loadBackground(): Background {
  try {
    const b = localStorage.getItem(BACKGROUND_KEY) as Background;
    return BACKGROUNDS.includes(b) ? b : "plain";
  } catch {
    return "plain";
  }
}

interface Props {
  url: string | null;
  error: string;
  onRetry: () => void;
  viewport: Viewport;
  setViewport: (vp: Viewport) => void;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  dragging: boolean;
  /** Canvas drag reported by the overlay; shows the trash zone it hit-tests. */
  canvasDrag: "idle" | "moving" | "over-trash";
  /** Trash button rect in frame coords, sent when a canvas drag starts. */
  onTrashZone: (rect: Rect) => void;
  /** `free`: the component lands where it is released; false (Shift held) snaps it into the layout. */
  onDrop: (c: LibraryComponent, x: number, y: number, free: boolean) => void;
  /** Drag position in frame coords; off-frame (-1,-1) when the drag leaves. */
  onHover: (p: { x: number; y: number; free?: boolean }) => void;
  sidebars: { left: boolean; right: boolean };
  /** "both" hides both if either is open, else shows both (⌘\). */
  onToggleSidebar: (side: "left" | "right" | "both") => void;
}

export function Frame({ url, error, onRetry, viewport, setViewport, iframeRef, dragging, canvasDrag, onTrashZone, onDrop, onHover, sidebars, onToggleSidebar }: Props) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const trashRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1, h: 1 });
  /** null fits and centres the frame; otherwise the camera the user zoomed or panned to. */
  const [camera, setCamera] = useState<View | null>(null);
  const [tool, setTool] = useState<"select" | "hand">("select");
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const [background, setBackground] = useState(loadBackground);
  const panFrom = useRef<{ id: number; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = canvasRef.current!;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => setCamera(null), [viewport.width, viewport.height]);

  const fit = fitScale(viewport, size.w - 32, size.h - 32);
  const view = camera ?? { scale: fit, x: (size.w - viewport.width * fit) / 2, y: (size.h - viewport.height * fit) / 2 };
  const { scale } = view;
  // Gesture steps can land faster than renders, so they build on the latest camera, not the rendered one.
  const live = useRef(view);
  live.current = view;
  const move = (next: View) => setCamera((live.current = next));

  /** Zoom around client point (cx, cy); the canvas centre when omitted. */
  function zoomBy(factor: number, cx?: number, cy?: number) {
    const r = canvasRef.current!.getBoundingClientRect();
    move(zoomView(live.current, factor, (cx ?? r.left + r.width / 2) - r.left, (cy ?? r.top + r.height / 2) - r.top));
  }
  const panBy = (dx: number, dy: number) => move({ ...live.current, x: live.current.x + dx, y: live.current.y + dy });
  function act(action: CanvasAction) {
    if (action === "fit") setCamera(null);
    else if (action === "actual") zoomBy(1 / live.current.scale);
    else if (action === "toggle-ui") onToggleSidebar("both");
    else if (action === "zoom-in" || action === "zoom-out") zoomBy(stepZoom(live.current.scale, action === "zoom-in" ? 1 : -1) / live.current.scale);
    else setTool(action);
  }
  /** Shared by host key events and the overlay's forwarded ones. */
  function key(code: string, down: boolean, meta: boolean, shift: boolean) {
    if (code === "Space") {
      setSpaceHeld(down);
      return true;
    }
    const action = down && canvasAction(code, meta, shift);
    if (action) act(action);
    return !!action;
  }
  const handlers = useRef({ zoomBy, panBy, key });
  handlers.current = { zoomBy, panBy, key };

  // Trackpad scroll pans the canvas and pinch or ⌘/Ctrl+scroll zooms; inside the page, the
  // overlay keeps plain scrolling for the page and forwards zoom gestures and shortcuts here.
  useEffect(() => {
    const el = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) handlers.current.zoomBy(Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      else handlers.current.panBy(-e.deltaX, -e.deltaY);
    };
    let last = 1;
    const onGesture = (e: Event) => {
      const g = e as Event & { scale: number; clientX: number; clientY: number };
      e.preventDefault();
      if (e.type === "gesturestart") last = 1;
      else handlers.current.zoomBy(g.scale / last, g.clientX, g.clientY);
      last = g.scale;
    };
    const onKey = (e: KeyboardEvent) => {
      const at = e.target as HTMLElement;
      if (at.closest?.("input, textarea, select, [contenteditable=true], .xterm")) return;
      if (e.code === "Space" && at.closest?.("button")) return; // Space still presses a focused button
      if (handlers.current.key(e.code, e.type === "keydown", e.metaKey || e.ctrlKey, e.shiftKey)) e.preventDefault();
    };
    const onBlur = () => setSpaceHeld(false);
    const onMessage = (e: MessageEvent<OverlayToHost>) => {
      const f = frameRef.current?.getBoundingClientRect();
      if (e.source !== iframeRef.current?.contentWindow || !f) return;
      const m = e.data;
      const s = live.current.scale;
      if (m.type === "zoom") handlers.current.zoomBy(m.factor, f.left + m.x * s, f.top + m.y * s);
      else if (m.type === "canvas-key") handlers.current.key(m.code, m.down, m.meta, m.shift);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    for (const t of ["gesturestart", "gesturechange"]) el.addEventListener(t, onGesture);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKey);
    window.addEventListener("blur", onBlur);
    window.addEventListener("message", onMessage);
    return () => {
      el.removeEventListener("wheel", onWheel);
      for (const t of ["gesturestart", "gesturechange"]) el.removeEventListener(t, onGesture);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKey);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const hand = tool === "hand" || spaceHeld || panning;
  const startPan = (e: ReactPointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    panFrom.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setPanning(true);
    e.preventDefault();
  };
  const endPan = () => {
    panFrom.current = null;
    setPanning(false);
  };

  const draggingOnCanvas = canvasDrag !== "idle";
  useEffect(() => {
    if (!draggingOnCanvas || !frameRef.current || !trashRef.current) return;
    const t = trashRef.current.getBoundingClientRect();
    const { x, y } = toFrameCoords(t.left, t.top, frameRef.current.getBoundingClientRect(), scale);
    onTrashZone({ x, y, width: t.width / scale, height: t.height / scale });
  }, [draggingOnCanvas, scale]);
  function pickBackground(b: Background) {
    setBackground(b);
    try {
      localStorage.setItem(BACKGROUND_KEY, b);
    } catch {
      /* storage unavailable: background resets next launch */
    }
  }
  const custom = (w: number, h: number) => setViewport({ preset: "custom", width: w || 1, height: h || 1 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b p-2">
        <Button size="icon-sm" variant="ghost" aria-label="Toggle left sidebar" aria-pressed={sidebars.left} title={`${sidebars.left ? "Hide" : "Show"} library (⌘\\ for both)`} onClick={() => onToggleSidebar("left")}>
          {sidebars.left ? <PanelLeftClose /> : <PanelLeftOpen />}
        </Button>
        {PRESETS.map((p) => (
          <Button
            key={p.preset}
            size="sm"
            variant={viewport.preset === p.preset ? "secondary" : "ghost"}
            onClick={() => setViewport(p)}
          >
            {p.preset[0].toUpperCase() + p.preset.slice(1)}
          </Button>
        ))}
        <Input
          className="h-7 w-20"
          type="number"
          aria-label="Width"
          value={viewport.width}
          onChange={(e) => custom(+e.target.value, viewport.height)}
        />
        <span className="text-xs text-muted-foreground">×</span>
        <Input
          className="h-7 w-20"
          type="number"
          aria-label="Height"
          value={viewport.height}
          onChange={(e) => custom(viewport.width, +e.target.value)}
        />
        <div className="ml-auto flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          <Button size="icon-xs" variant={tool === "select" ? "secondary" : "ghost"} aria-label="Select" title="Select (V)" onClick={() => setTool("select")}>
            <MousePointer2 />
          </Button>
          <Button size="icon-xs" variant={tool === "hand" ? "secondary" : "ghost"} aria-label="Hand" title="Hand (H, or hold Space)" onClick={() => setTool("hand")}>
            <Hand />
          </Button>
        </div>
        <div className="flex items-center rounded-md border bg-background p-0.5">
          <Button size="icon-xs" variant="ghost" aria-label="Zoom out" title="Zoom out (⌘−)" onClick={() => act("zoom-out")}>
            <Minus />
          </Button>
          <button
            className="h-6 w-12 rounded-sm text-xs tabular-nums text-muted-foreground hover:bg-muted hover:text-foreground"
            title={camera === null ? "Fitted. Click for 100% (⇧0)" : "Click to fit (⇧1)"}
            onClick={() => act(camera === null ? "actual" : "fit")}
          >
            {Math.round(scale * 100)}%
          </button>
          <Button size="icon-xs" variant="ghost" aria-label="Zoom in" title="Zoom in (⌘+)" onClick={() => act("zoom-in")}>
            <Plus />
          </Button>
        </div>
        <Select items={BACKGROUND_ITEMS} value={background} onValueChange={(v) => v && pickBackground(v)}>
          <SelectTrigger size="sm" aria-label="Canvas background" title="Canvas background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BACKGROUND_ITEMS.map((b) => (
              <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="icon-sm" variant="ghost" aria-label="Toggle right sidebar" aria-pressed={sidebars.right} title={`${sidebars.right ? "Hide" : "Show"} properties and terminal (⌘\\ for both)`} onClick={() => onToggleSidebar("right")}>
          {sidebars.right ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-muted/40">
        {/* ponytail: pinned to the pane's corner, so it can overlap the frame when both axes are tight; reserve a strip if that bites. */}
        <div
          ref={trashRef}
          aria-hidden
          className={cn(
            "pointer-events-none absolute right-3 bottom-3 z-10 flex size-14 items-center justify-center rounded-xl bg-destructive text-white shadow-lg transition-all duration-200",
            draggingOnCanvas ? "opacity-100" : "scale-90 opacity-0",
            canvasDrag === "over-trash" && "scale-115 shadow-xl",
          )}
        >
          <Delete02 size={26} animate={canvasDrag === "over-trash"} />
        </div>
        <div
          ref={canvasRef}
          data-canvas
          className={cn("absolute inset-0 overflow-hidden", hand && (panning ? "cursor-grabbing" : "cursor-grab"))}
          // Middle-drag pans on the grey canvas (the page takes it over the frame); with Hand or Space, the left button does too.
          onPointerDown={(e) => (e.button === 1 || (hand && e.button === 0)) && startPan(e)}
          onPointerMove={(e) => {
            const from = panFrom.current;
            if (from?.id !== e.pointerId) return;
            panBy(e.clientX - from.x, e.clientY - from.y);
            panFrom.current = { ...from, x: e.clientX, y: e.clientY };
          }}
          onPointerUp={(e) => panFrom.current?.id === e.pointerId && endPan()}
          onPointerCancel={endPan}
          style={backgroundStyle(background, view)}
        >
          {url ? (
            <div
              ref={frameRef}
              className="absolute top-0 left-0 overflow-hidden rounded-sm shadow-xl ring-1 ring-black/5"
              style={{ width: viewport.width * scale, height: viewport.height * scale, transform: `translate(${view.x}px, ${view.y}px)` }}
            >
              <iframe
                ref={iframeRef}
                src={url}
                title="Preview"
                className="origin-top-left border-0 bg-white"
                style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
              />
              {/* The page would take the pointer; while panning, this sits over it. */}
              {hand && <div className="absolute inset-0" />}
              {/* The iframe swallows drag events, so a catcher sits on top while dragging. */}
              {dragging && (
                <div
                  className="absolute inset-0 outline-2 -outline-offset-2 outline-dashed outline-primary"
                  // WebKit only treats this as a drop target if dragenter is cancelled too.
                  onDragEnter={(e) => e.preventDefault()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "copy";
                    onHover({ ...toFrameCoords(e.clientX, e.clientY, frameRef.current!.getBoundingClientRect(), scale), free: !e.shiftKey });
                  }}
                  onDragLeave={() => onHover({ x: -1, y: -1 })}
                  onDrop={(e) => {
                    e.preventDefault();
                    const data = e.dataTransfer.getData(DRAG_MIME);
                    if (!data) return;
                    const { x, y } = toFrameCoords(e.clientX, e.clientY, frameRef.current!.getBoundingClientRect(), scale);
                    onDrop(JSON.parse(data), x, y, !e.shiftKey);
                  }}
                />
              )}
            </div>
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <p>{error || "Starting dev server…"}</p>
              {error && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

