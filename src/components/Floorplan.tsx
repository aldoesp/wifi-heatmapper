"use client";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  FlaskConical,
  Maximize2,
  Minus,
  MousePointerClick,
  Plus,
  ScanLine,
  Undo2,
} from "lucide-react";

import { useSettings } from "./GlobalSettings";
import { useAppStatus } from "@/hooks/useAppStatus";
import MeasurementPanel from "@/components/MeasurementPanel";
import PopupDetails from "@/components/PopupDetails";
import { Button } from "@/components/ui/button";
import { getColorAt, objectToRGBAString } from "@/lib/utils-gradient";
import {
  getDefaultWifiResults,
  getDefaultIperfResults,
  percentageToRssi,
  delay,
} from "@/lib/utils";
import { SurveyPoint, SurveyResult } from "@/lib/types";
import { getLogger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const logger = getLogger("Floorplan");

/** Give up waiting for a measurement after this long. */
const MEASUREMENT_TIMEOUT_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 700;

type XY = { x: number; y: number };

/**
 * Marker sizes in image pixels. They grow with the image so dots are never
 * tiny on big plans, and never shrink below a readable size on screen
 * (`scale` is CSS px per image px).
 */
function markerSizes(imageWidth: number, scale: number) {
  const s = scale > 0 ? scale : 1;
  const R = Math.max(7, 0.008 * imageWidth, 9 / s);
  return {
    R,
    font: Math.max(11, 0.012 * imageWidth, 11 / s),
    labelOffset: R * 1.9,
    pad: Math.max(2, 0.004 * imageWidth, 2.5 / s),
  };
}

export default function ClickableFloorplan() {
  const { settings, updateSettings, surveyPointActions, loading } =
    useSettings();
  const status = useAppStatus();

  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureRef = useRef<{
    startDistance: number;
    startZoom: number;
    last: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [hoveringPoint, setHoveringPoint] = useState(false);

  const scale = baseScale * zoom;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedPoint = useMemo(
    () => settings.surveyPoints.find((p) => p.id === selectedId) ?? null,
    [settings.surveyPoints, selectedId],
  );

  const [pending, setPending] = useState<XY | null>(null); // image coords
  const [panelOpen, setPanelOpen] = useState(false);
  const [measureError, setMeasureError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const measuring = pending !== null && panelOpen;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  /* ---------- image ---------- */

  useEffect(() => {
    setImage(null);
    setImageError(null);
    setSelectedId(null);
    if (!settings.floorplanImagePath) return;
    const img = new Image();
    img.onload = () => {
      setImage(img);
      if (
        img.naturalWidth !== settings.dimensions.width ||
        img.naturalHeight !== settings.dimensions.height
      ) {
        updateSettings({
          dimensions: { width: img.naturalWidth, height: img.naturalHeight },
        });
      }
    };
    img.onerror = () =>
      setImageError(
        `The floor plan "${settings.floorplanImageName}" could not be loaded. Pick another one in Settings.`,
      );
    img.src = settings.floorplanImagePath;
    // dimensions are written by this effect, not read from settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.floorplanImagePath]);

  /* ---------- scale to container ---------- */

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !image) return;
    const update = () => {
      setBaseScale(el.clientWidth / image.naturalWidth);
      setZoom(1);
      setPan({ x: 0, y: 0 });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  const clampPan = useCallback(
    (next: { x: number; y: number }) => {
      const viewport = containerRef.current;
      if (!viewport || !image) return next;
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      return {
        x: Math.min(0, Math.max(viewport.clientWidth - width, next.x)),
        y: Math.min(0, Math.max(viewport.clientHeight - height, next.y)),
      };
    },
    [image, scale],
  );

  const changeZoom = useCallback(
    (nextZoom: number) => {
      const value = Math.min(4, Math.max(1, nextZoom));
      setZoom(value);
      setPan((current) => clampPan(current));
    },
    [clampPan],
  );

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /* ---------- drawing ---------- */

  const drawPoint = useCallback(
    (ctx: CanvasRenderingContext2D, point: SurveyPoint, W: number) => {
      const { R, font, labelOffset, pad } = markerSizes(W, scale);
      const wifi = point.wifiData;
      if (!wifi) return;
      const selected = point.id === selectedId;

      ctx.save();
      // marker
      ctx.beginPath();
      ctx.arc(point.x, point.y, R, 0, Math.PI * 2);
      ctx.fillStyle = point.isEnabled
        ? objectToRGBAString({
            ...getColorAt(wifi.signalStrength / 100, settings.gradient),
            a: 1,
          })
        : "rgba(160, 165, 175, 0.9)";
      ctx.fill();
      ctx.lineWidth = Math.max(1, R * 0.18);
      ctx.strokeStyle = "rgba(20, 24, 33, 0.65)";
      if (!point.isEnabled) ctx.setLineDash([R * 0.6, R * 0.5]);
      ctx.stroke();
      ctx.setLineDash([]);
      if (selected) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, R + Math.max(3, R * 0.5), 0, Math.PI * 2);
        ctx.lineWidth = Math.max(2, R * 0.25);
        ctx.strokeStyle = "hsl(252 56% 57%)";
        ctx.stroke();
      }

      // label
      const text = `${wifi.signalStrength}%`;
      ctx.font = `600 ${font}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const w = ctx.measureText(text).width + pad * 2;
      const h = font * 1.25 + pad * 2;
      const x = point.x - w / 2;
      const y = point.y + labelOffset;
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, pad);
      ctx.fill();
      ctx.fillStyle = point.isEnabled ? "#14181f" : "#6b7280";
      ctx.fillText(text, point.x, y + pad);
      ctx.restore();
    },
    [selectedId, settings.gradient, scale],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0);
    for (const p of settings.surveyPoints) drawPoint(ctx, p, canvas.width);
  }, [image, settings.surveyPoints, drawPoint]);

  /* ---------- hit testing ---------- */

  const toImageCoords = (e: React.MouseEvent<HTMLCanvasElement>): XY => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale,
    };
  };

  const hitTest = (pt: XY): SurveyPoint | undefined => {
    const W = image?.naturalWidth ?? 0;
    const { R } = markerSizes(W, scale);
    // generous on touch screens: at least 14 CSS px
    const tolerance = Math.max(R * 1.6, 14 / scale);
    let best: SurveyPoint | undefined;
    let bestD = Infinity;
    for (const p of settings.surveyPoints) {
      const d = Math.hypot(p.x - pt.x, p.y - pt.y);
      if (d < tolerance && d < bestD) {
        best = p;
        bestD = d;
      }
    }
    return best;
  };

  /* ---------- measuring ---------- */

  const startMeasurement = useCallback(async () => {
    if (!pending) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;
    const x = Math.round(pending.x);
    const y = Math.round(pending.y);

    try {
      const res = await fetch("/api/start-task?action=start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          settings: {
            iperfServerAdrs: settings.iperfServerAdrs,
            testDuration: settings.testDuration,
            sudoerPassword: settings.sudoerPassword,
            iperfCommands: settings.iperfCommands,
          },
        }),
        signal,
      });
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);

      const deadline = Date.now() + MEASUREMENT_TIMEOUT_MS;
      let result: SurveyResult = { state: "pending" };
      while (!signal.aborted && Date.now() < deadline) {
        await delay(POLL_INTERVAL_MS);
        try {
          const r = await fetch("/api/start-task?action=results", { signal });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          result = await r.json();
        } catch (err) {
          if (signal.aborted) return;
          logger.debug(`results poll failed: ${err}`);
          continue;
        }
        if (result.state !== "pending") break;
      }
      if (signal.aborted) return;

      if (result.state === "pending") {
        throw new Error("The measurement did not finish in time.");
      }
      if (result.state === "error") {
        throw new Error(result.explanation ?? "The measurement failed.");
      }
      const data = result.results;
      if (!data?.wifiData || !data?.iperfData) {
        throw new Error("The measurement returned no data.");
      }
      surveyPointActions.add({
        wifiData: data.wifiData,
        iperfData: data.iperfData,
        x,
        y,
        timestamp: Date.now(),
        isEnabled: true,
        id: "", // assigned by the store
      });
      setPending(null);
    } catch (err) {
      if (signal.aborted) return;
      setPending(null);
      setMeasureError(err instanceof Error ? err.message : String(err));
    }
  }, [pending, settings, surveyPointActions]);

  const cancelMeasurement = () => {
    abortRef.current?.abort();
    setPending(null);
  };

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setMeasureError(null);
  }, []);

  /* ---------- interaction ---------- */

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    if (!image) return;
    const pt = toImageCoords(e);
    const hit = hitTest(pt);
    if (hit) {
      setSelectedId((cur) => (cur === hit.id ? null : hit.id));
      return;
    }
    if (selectedPoint) {
      setSelectedId(null); // click away closes the details
      return;
    }
    if (measuring) return; // one at a time
    setMeasureError(null);
    setPending(pt);
    if (!isMobile) setPanelOpen(true);
  };

  const beginMobileScan = () => {
    if (!pending || measuring) return;
    setMeasureError(null);
    setPanelOpen(true);
  };

  const undoLastPoint = () => {
    if (measuring || points.length === 0) return;
    const last = points.reduce((latest, point) =>
      point.timestamp > latest.timestamp ? point : latest,
    );
    surveyPointActions.delete([last]);
    setSelectedId(null);
  };

  const finishScan = () => {
    if (measuring) return;
    window.location.hash = "#heatmaps";
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pointers = [...pointersRef.current.values()];
    if (pointers.length === 1) {
      gestureRef.current = {
        startDistance: 0,
        startZoom: zoom,
        last: pointers[0],
        moved: false,
      };
    } else if (pointers.length === 2) {
      const [first, second] = pointers;
      gestureRef.current = {
        startDistance: Math.hypot(second.x - first.x, second.y - first.y),
        startZoom: zoom,
        last: second,
        moved: true,
      };
      suppressClickRef.current = true;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pointers = [...pointersRef.current.values()];
    const gesture = gestureRef.current;
    if (!gesture) return;

    if (pointers.length >= 2) {
      const [first, second] = pointers;
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      if (gesture.startDistance > 0) {
        changeZoom(gesture.startZoom * (distance / gesture.startDistance));
        gesture.moved = true;
      }
      return;
    }

    if (zoom <= 1) return;
    const current = pointers[0];
    const dx = current.x - gesture.last.x;
    const dy = current.y - gesture.last.y;
    if (Math.abs(dx) + Math.abs(dy) > 2) gesture.moved = true;
    if (gesture.moved) {
      suppressClickRef.current = true;
      setPan((value) => clampPan({ x: value.x + dx, y: value.y + dy }));
    }
    gesture.last = current;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) gestureRef.current = null;
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!image) return;
    setHoveringPoint(!!hitTest(toImageCoords(e)));
  };

  /* ---------- sample data (mock mode only) ---------- */

  const addSamplePoints = () => {
    const W = settings.dimensions.width;
    const H = settings.dimensions.height;
    const router = { x: W * 0.28, y: H * 0.32 };
    const maxD = Math.hypot(W, H) * 0.7;
    const cols = 6;
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = Math.round(W * (0.1 + (0.8 * c) / (cols - 1)));
        const y = Math.round(H * (0.12 + (0.76 * r) / (rows - 1)));
        const d = Math.hypot(x - router.x, y - router.y) / maxD;
        const strength = Math.round(
          Math.max(
            12,
            Math.min(100, 100 - d * 95 + ((r * 7 + c * 13) % 9) - 4),
          ),
        );
        const wifiData = {
          ...getDefaultWifiResults(),
          ssid: "Demo Network",
          bssid: "9e05d696e830",
          signalStrength: strength,
          rssi: percentageToRssi(strength),
          channel: 44,
          band: 5,
        };
        const iperfData = getDefaultIperfResults();
        const q = strength / 100;
        iperfData.tcpDownload = {
          ...iperfData.tcpDownload,
          bitsPerSecond: Math.round(900e6 * q * q),
        };
        iperfData.tcpUpload = {
          ...iperfData.tcpUpload,
          bitsPerSecond: Math.round(700e6 * q * q),
        };
        surveyPointActions.add({
          wifiData,
          iperfData,
          x,
          y,
          timestamp: Date.now(),
          isEnabled: true,
          id: "",
        });
      }
    }
  };

  /* ---------- popup placement ---------- */

  const popupStyle = useMemo((): React.CSSProperties => {
    if (!selectedPoint || !containerRef.current) return {};
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    const px = selectedPoint.x * scale + pan.x;
    const py = selectedPoint.y * scale + pan.y;
    const POPUP_W = 288; // w-72
    const GAP = 14;
    const flipX = px + GAP + POPUP_W > cw;
    const top = Math.min(Math.max(8, py - 40), Math.max(8, ch - 260));
    return {
      left: flipX ? px - GAP - POPUP_W : px + GAP,
      top,
    };
  }, [pan, selectedPoint, scale]);

  /* ---------- render ---------- */

  const points = settings.surveyPoints;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Floor plan</h1>
          <p className="text-sm text-muted-foreground">
            Stand where you want to measure, then click that spot on the plan.
            Click a dot to see its details.
          </p>
        </div>
        {status?.mockMode && (
          <Button
            variant="outline"
            size="sm"
            onClick={addSamplePoints}
            disabled={!image || measuring}
            data-testid="add-sample-points"
            title="Mock mode only: fills the plan with synthetic points"
          >
            <FlaskConical className="h-3.5 w-3.5" />
            Add sample points
          </Button>
        )}
      </div>

      {imageError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {imageError}
        </div>
      )}

      <div className="survey-plate relative rounded-lg border p-3 sm:p-5">
        {points.length === 0 && image && !measuring && (
          <div className="pointer-events-none absolute inset-x-0 top-6 z-10 flex justify-center">
            <div className="flex items-center gap-2 rounded-full border bg-popover/95 px-3.5 py-1.5 text-sm shadow-float">
              <MousePointerClick className="h-4 w-4 text-brand" />
              Click where you are standing to take the first measurement
            </div>
          </div>
        )}

        <div
          ref={containerRef}
          className="relative overflow-hidden rounded-md bg-white touch-none"
          style={
            image
              ? {
                  aspectRatio: `${image.naturalWidth} / ${image.naturalHeight}`,
                }
              : undefined
          }
        >
          {!image && !imageError && (
            <div className="flex aspect-[2/1] items-center justify-center text-sm text-muted-foreground">
              {loading ? "Loading survey" : "Loading floor plan"}
            </div>
          )}
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            onMouseMove={handleMouseMove}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            data-testid="floorplan-canvas"
            className={cn(
              "absolute left-0 top-0 block max-w-none rounded-md bg-white shadow-sm",
              !image && "hidden",
              hoveringPoint
                ? "cursor-pointer"
                : measuring
                  ? "cursor-progress"
                  : "cursor-crosshair",
            )}
            style={
              image
                ? {
                    width: image.naturalWidth * scale,
                    height: image.naturalHeight * scale,
                    left: pan.x,
                    top: pan.y,
                  }
                : undefined
            }
          />

          {image && (
            <div className="absolute right-3 top-3 z-30 flex overflow-hidden rounded-xl border bg-popover/95 shadow-float">
              <button
                type="button"
                aria-label="Zoom in"
                title="Zoom in"
                onClick={() => changeZoom(zoom + 0.5)}
                className="flex h-11 w-11 items-center justify-center text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="h-5 w-5" />
              </button>
              <button
                type="button"
                aria-label="Reset zoom"
                title="Reset zoom"
                onClick={resetView}
                className="flex h-11 w-11 items-center justify-center border-x text-xs font-semibold tabular text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Zoom out"
                title="Zoom out"
                onClick={() => changeZoom(zoom - 0.5)}
                className="flex h-11 w-11 items-center justify-center text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Minus className="h-5 w-5" />
              </button>
              {zoom > 1 && (
                <button
                  type="button"
                  aria-label="Recenter floor plan"
                  title="Recenter floor plan"
                  onClick={resetView}
                  className="flex h-11 w-11 items-center justify-center border-l text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Maximize2 className="h-4 w-4" />
                </button>
              )}
            </div>
          )}

          {pending && (
            <span
              aria-hidden="true"
              className="measuring-dot pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand"
              style={{
                left: pending.x * scale + pan.x,
                top: pending.y * scale + pan.y,
              }}
            />
          )}

          {selectedPoint && (
            <div className="absolute z-20" style={popupStyle}>
              <PopupDetails
                point={selectedPoint}
                settings={settings}
                surveyPointActions={surveyPointActions}
                onClose={() => setSelectedId(null)}
              />
            </div>
          )}
        </div>
      </div>

      {panelOpen && (
        <MeasurementPanel
          onReady={startMeasurement}
          onClose={closePanel}
          onCancel={cancelMeasurement}
          error={measureError}
        />
      )}

      <div className="sticky bottom-20 z-30 -mx-1 flex items-center gap-2 rounded-2xl border bg-surface/95 p-2 shadow-float backdrop-blur sm:hidden">
        <Button
          type="button"
          variant="outline"
          className="h-12 min-w-0 flex-1 rounded-xl px-3"
          onClick={undoLastPoint}
          disabled={measuring || points.length === 0}
          data-testid="mobile-undo-scan"
        >
          <Undo2 className="h-4 w-4" />
          Undo
        </Button>
        <Button
          type="button"
          variant="brand"
          className="h-12 min-w-0 flex-[1.4] rounded-xl px-3"
          onClick={beginMobileScan}
          disabled={!pending || measuring}
          data-testid="mobile-scan"
        >
          <ScanLine className="h-4 w-4" />
          Scan
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-12 min-w-0 flex-1 rounded-xl px-3"
          onClick={finishScan}
          disabled={measuring}
          data-testid="mobile-done-scan"
        >
          <Check className="h-4 w-4" />
          Done
        </Button>
      </div>
    </div>
  );
}
