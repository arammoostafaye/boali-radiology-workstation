"use client";

import { useCallback, useRef, useState } from "react";
import {
  Box,
  Crop,
  Hand,
  Maximize,
  MoreHorizontal,
  MousePointer2,
  RotateCw,
  Ruler,
  Sun,
  ZoomIn,
  ZoomOut,
  Crosshair,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { OrientationCube } from "./orientation-cube";
import type { Patient, SeriesItem } from "./data";

export type ToolId =
  | "cursor"
  | "pan"
  | "rotate"
  | "window"
  | "crop"
  | "measure"
  | "cube"
  | "more";

const TOOLS: { id: ToolId; icon: typeof MousePointer2; label: string }[] = [
  { id: "cursor", icon: MousePointer2, label: "Select" },
  { id: "pan", icon: Hand, label: "Pan" },
  { id: "rotate", icon: RotateCw, label: "Rotate / Orbit" },
  { id: "window", icon: Sun, label: "Brightness / Window" },
  { id: "crop", icon: Crop, label: "Crop" },
  { id: "measure", icon: Ruler, label: "Measure" },
  { id: "cube", icon: Box, label: "3D Controls" },
  { id: "more", icon: MoreHorizontal, label: "More" },
];

interface ViewerProps {
  patient: Patient;
  series: SeriesItem;
  zoom: number;
  activeTool: ToolId;
  onZoom: (z: number) => void;
  onTool: (t: ToolId) => void;
}

export function Viewer({
  patient,
  series,
  zoom,
  activeTool,
  onZoom,
  onTool,
}: ViewerProps) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(
    null
  );
  const [dragging, setDragging] = useState(false);

  const canPan = zoom > 1 || activeTool === "pan" || activeTool === "cursor";

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!canPan) return;
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
      setDragging(true);
    },
    [canPan, pan.x, pan.y]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const dx = e.clientX - drag.current.x;
      const dy = e.clientY - drag.current.y;
      setPan({ x: drag.current.px + dx, y: drag.current.py + dy });
    },
    []
  );

  const onPointerUp = useCallback(() => {
    drag.current = null;
    setDragging(false);
  }, []);

  const resetView = useCallback(() => {
    setPan({ x: 0, y: 0 });
    onZoom(1);
  }, [onZoom]);

  return (
    <section
      aria-label="Image viewer"
      className="flex min-h-0 flex-1 flex-col rounded-2xl border border-[#253548] bg-[#0c1520] p-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.3)]"
    >
      <div
        className={`relative w-full flex-1 overflow-hidden rounded-xl bg-black ${
          canPan ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={resetView}
      >
        {/* medical image */}
        <div className="absolute inset-0 flex items-center justify-center">
          <img
            src={series.image}
            alt={`${series.renderer} reconstruction of ${patient.name}, ${patient.studyFull}`}
            draggable={false}
            className="max-h-full max-w-full select-none object-contain"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transition: dragging ? "none" : "transform 180ms ease-out",
            }}
          />
        </div>

        {/* corner overlays: top-left patient info */}
        <div className="dicom pointer-events-none absolute left-3 top-3 space-y-0.5 text-[11.5px] leading-[1.45] text-white/90">
          <div className="flex gap-3">
            <span className="font-semibold">{patient.name}</span>
            <span>ID {patient.id}</span>
            <span>{patient.sex}</span>
            <span>{patient.age}Y</span>
          </div>
          <p>{patient.studyFull}</p>
          <p>
            {patient.date}&nbsp;&nbsp;{patient.time}
          </p>
        </div>

        {/* top-right scanner info */}
        <div className="dicom pointer-events-none absolute right-3 top-3 space-y-0.5 text-right text-[11.5px] leading-[1.45] text-white/90">
          <p>{patient.scanner}</p>
          <p>
            {patient.kv}&nbsp;&nbsp;{patient.mas}
          </p>
          <p>{patient.thickness}</p>
          <p>{series.renderer}</p>
        </div>

        {/* left floating tool rail */}
        <div
          className="absolute left-2.5 top-1/2 flex -translate-y-1/2 flex-col gap-1 rounded-2xl border border-[#2a3a4d]/70 bg-[#101a26]/90 p-1.5 shadow-[0_4px_16px_rgba(0,0,0,0.45)] backdrop-blur-md"
          role="toolbar"
          aria-label="Viewer tools"
        >
          {TOOLS.map((t) => (
            <button
              key={t.id}
              type="button"
              title={t.label}
              aria-label={t.label}
              aria-pressed={activeTool === t.id}
              onClick={(e) => {
                e.stopPropagation();
                onTool(t.id);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={`flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
                activeTool === t.id
                  ? "bg-[#22354d] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_2px_8px_rgba(0,0,0,0.35)]"
                  : "text-[#8fa3b8] hover:bg-white/10 hover:text-white"
              }`}
            >
              <t.icon className="h-4 w-4" />
            </button>
          ))}
        </div>

        {/* orientation cube */}
        <div className="pointer-events-none absolute bottom-4 left-3">
          <OrientationCube className="h-11 w-11 drop-shadow-[0_2px_6px_rgba(0,0,0,0.6)]" />
        </div>

        {/* bottom-center zoom pill */}
        <div
          className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2.5 rounded-full border border-[#2a3a4d]/70 bg-[#101a26]/90 px-3.5 py-2 shadow-[0_4px_16px_rgba(0,0,0,0.5)] backdrop-blur-md"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            aria-label="Zoom out"
            onClick={() => onZoom(Math.max(0.5, zoom - 0.25))}
            className="rounded-full p-0.5 text-[#8fa3b8] transition-colors hover:text-white"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <Slider
            value={[zoom]}
            min={0.5}
            max={3}
            step={0.05}
            onValueChange={([v]) => onZoom(v)}
            aria-label="Zoom level"
            className="w-28 [&_[data-slot=slider-range]]:bg-[#2dd4bf] [&_[data-slot=slider-thumb]]:border-[#1e3a52] [&_[data-slot=slider-thumb]]:bg-white [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-track]]:bg-[#1d3346]"
          />
          <button
            type="button"
            aria-label="Zoom in"
            onClick={() => onZoom(Math.min(3, zoom + 0.25))}
            className="rounded-full p-0.5 text-[#8fa3b8] transition-colors hover:text-white"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <div className="h-4 w-px bg-[#2a3a4d]" />
          <button
            type="button"
            aria-label="Center crosshair"
            onClick={resetView}
            title="Reset view"
            className="rounded-full p-0.5 text-[#8fa3b8] transition-colors hover:text-white"
          >
            <Crosshair className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Fullscreen"
            className="rounded-full p-0.5 text-[#8fa3b8] transition-colors hover:text-white"
          >
            <Maximize className="h-4 w-4" />
          </button>
          <span className="dicom w-9 text-[10.5px] text-[#8fa3b8]">
            {Math.round(zoom * 100)}%
          </span>
        </div>

        {/* bottom-right window/level */}
        <div className="dicom pointer-events-none absolute bottom-3 right-3 space-y-0.5 text-right text-[11.5px] leading-[1.5] text-white/90">
          <p>W {series.w}</p>
          <p>L {series.l}</p>
        </div>
      </div>
    </section>
  );
}
