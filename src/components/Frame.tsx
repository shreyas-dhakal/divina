import { useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fitScale, PRESETS, toFrameCoords } from "@/lib/viewport";
import type { LibraryComponent, Viewport } from "@/shared/protocol";

export const DRAG_MIME = "application/x-divina-component";

interface Props {
  url: string | null;
  error: string;
  onRetry: () => void;
  viewport: Viewport;
  setViewport: (vp: Viewport) => void;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  dragging: boolean;
  onDrop: (c: LibraryComponent, x: number, y: number) => void;
  /** Drag position in frame coords; off-frame (-1,-1) when the drag leaves. */
  onHover: (p: { x: number; y: number }) => void;
}

export function Frame({ url, error, onRetry, viewport, setViewport, iframeRef, dragging, onDrop, onHover }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState({ w: 1, h: 1 });

  useEffect(() => {
    const el = boxRef.current!;
    const ro = new ResizeObserver(() => setAvail({ w: el.clientWidth - 32, h: el.clientHeight - 32 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scale = fitScale(viewport, avail.w, avail.h);
  const custom = (w: number, h: number) => setViewport({ preset: "custom", width: w || 1, height: h || 1 });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b p-2">
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
        <span className="ml-auto text-xs text-muted-foreground">{Math.round(scale * 100)}%</span>
      </div>

      <div ref={boxRef} className="flex flex-1 items-center justify-center overflow-hidden bg-muted/40">
        {url ? (
          <div
            ref={frameRef}
            className="relative shadow-lg"
            style={{ width: viewport.width * scale, height: viewport.height * scale }}
          >
            <iframe
              ref={iframeRef}
              src={url}
              title="Preview"
              className="origin-top-left border-0 bg-white"
              style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
            />
            {/* The iframe swallows drag events, so a catcher sits on top while dragging. */}
            {dragging && (
              <div
                className="absolute inset-0 outline-2 outline-dashed outline-primary"
                onDragOver={(e) => {
                  e.preventDefault();
                  onHover(toFrameCoords(e.clientX, e.clientY, frameRef.current!.getBoundingClientRect(), scale));
                }}
                onDragLeave={() => onHover({ x: -1, y: -1 })}
                onDrop={(e) => {
                  e.preventDefault();
                  const data = e.dataTransfer.getData(DRAG_MIME);
                  if (!data) return;
                  const { x, y } = toFrameCoords(e.clientX, e.clientY, frameRef.current!.getBoundingClientRect(), scale);
                  onDrop(JSON.parse(data), x, y);
                }}
              />
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <p>{error || "Starting dev server…"}</p>
            {error && <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>}
          </div>
        )}
      </div>
    </div>
  );
}
