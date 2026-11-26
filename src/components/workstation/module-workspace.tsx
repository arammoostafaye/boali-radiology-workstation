"use client";

/* ------------------------------------------------------------------ */
/*  Module Workspace — a DEDICATED, visually distinct environment for  */
/*  each of the six launcher cards. Clicking a card no longer drops   */
/*  the user into one generic screen: every module has its own room,  */
/*  its own layout, its own controls — all wired to the REAL engines  */
/*  on boali-engine :3020 (no mock numbers anywhere).                 */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  AlertCircle,
  ArrowLeft,
  Bone,
  Boxes,
  CheckCircle2,
  ClipboardList,
  Droplets,
  FileWarning,
  Grid3x3,
  Loader2,
  Minus,
  Play,
  Plus,
  Printer,
  RotateCcw,
  Stethoscope,
  Upload,
} from "lucide-react";
import {
  analyzeCt3d,
  analyzeEngine,
  analyzeFracture,
  fetchEngineStatus,
  fetchSampleAsFile,
  type BoneResult,
  type Chest18Result,
  type Ct3dPreset,
  type Ct3dResult,
  type EngineId,
  type EngineResult,
  type EngineState,
  type EngineStatus,
  type FractureResult,
  type MammoResult,
} from "@/lib/boali-engine";
import { Ct3dStudioView } from "./ct3d-studio";
import type { LauncherModuleId } from "./module-launcher";

/* ----------------------------- registry ----------------------------- */

export interface ModuleMeta {
  id: LauncherModuleId;
  title: string;
  room: string;
  subtitle: string;
  icon: typeof Bone;
  accent: string;
  accentSoft: string;
  engineId: EngineId | null;
  samples: { label: string; path: string }[];
}

export const MODULES: ModuleMeta[] = [
  {
    id: "fracture",
    title: "Fracture Detection",
    room: "TRAUMA ROOM",
    subtitle: "YOLOv8 ONNX · orthopedic radiographs · live localization",
    icon: Bone,
    accent: "#22d3ee",
    accentSoft: "rgba(34,211,238,0.12)",
    engineId: "fracture",
    samples: [
      { label: "CXR A", path: "/workstation/sample-cxr-1.png" },
      { label: "CXR B", path: "/workstation/sample-cxr-2.png" },
      { label: "CT DICOM", path: "/samples/ct-chest-1.dcm" },
    ],
  },
  {
    id: "bone",
    title: "Bone Suppression",
    room: "DECOMPOSITION LAB",
    subtitle: "Qure TorchScript · 4-tissue decomposition of chest X-rays",
    icon: Activity,
    accent: "#2dd4bf",
    accentSoft: "rgba(45,212,191,0.12)",
    engineId: "bone-suppression",
    samples: [
      { label: "CXR A", path: "/workstation/sample-cxr-1.png" },
      { label: "CXR B", path: "/workstation/sample-cxr-2.png" },
    ],
  },
  {
    id: "chest18",
    title: "Lung Screen",
    room: "SCREENING CONSOLE",
    subtitle: "DenseNet-18 · 18 chest pathologies · calibrated thresholds",
    icon: Stethoscope,
    accent: "#38bdf8",
    accentSoft: "rgba(56,189,248,0.12)",
    engineId: "chest18",
    samples: [
      { label: "CXR A", path: "/workstation/sample-cxr-1.png" },
      { label: "CXR B", path: "/workstation/sample-cxr-2.png" },
      { label: "CT DICOM", path: "/samples/ct-chest-1.dcm" },
    ],
  },
  {
    id: "mammo",
    title: "Mammography AI",
    room: "TRIAGE SUITE",
    subtitle: "ResNet-50 · benign / malignant / normal triage probabilities",
    icon: Droplets,
    accent: "#e879b9",
    accentSoft: "rgba(232,121,185,0.12)",
    engineId: "mammography",
    samples: [
      { label: "Mammo 1", path: "/samples/mammo-1.dcm" },
      { label: "Mammo 2", path: "/samples/mammo-2.dcm" },
      { label: "Mammo 3", path: "/samples/mammo-3.dcm" },
    ],
  },
  {
    id: "studio",
    title: "3D CT Studio",
    room: "VOLUME THEATER",
    subtitle: "MPR planes · ray-cast volume rendering · real DICOM voxels",
    icon: Boxes,
    accent: "#a78bfa",
    accentSoft: "rgba(167,139,250,0.12)",
    engineId: "ct3d",
    samples: [{ label: "Sample CT series", path: "__ct3d_sample__" }],
  },
  {
    id: "report",
    title: "AI Report",
    room: "REPORT DESK",
    subtitle: "Aggregates real engine findings into a structured report",
    icon: ClipboardList,
    accent: "#facc15",
    accentSoft: "rgba(250,204,21,0.10)",
    engineId: null,
    samples: [],
  },
];

/* ------------------------- run logic (hook) ------------------------ */

interface EngineRunState {
  engineStatus: EngineStatus | undefined;
  offline: boolean;
  running: boolean;
  result: EngineResult | null;
  error: string | null;
  inputPreview: string | null;
  inputName: string | null;
  conf: number;
  setConf: (c: number) => void;
  runFile: (file: File) => void;
  runSample: (path: string) => void;
  runCt3d: (files: File[] | null, preset?: Ct3dPreset) => void;
  reset: () => void;
}

function useEngineRun(
  meta: ModuleMeta,
  onResult: (engineId: EngineId, result: EngineResult) => void
): EngineRunState {
  const [engineStatus, setEngineStatus] = useState<EngineStatus | undefined>();
  const [offline, setOffline] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inputPreview, setInputPreview] = useState<string | null>(null);
  const [inputName, setInputName] = useState<string | null>(null);
  const [conf, setConf] = useState(0.08);
  const previewUrl = useRef<string | null>(null);

  /* poll engine status */
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await fetchEngineStatus();
      if (!alive) return;
      setOffline(!s);
      setEngineStatus(s?.engines.find((e) => e.engine === meta.engineId));
    };
    void poll();
    const t = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [meta.engineId]);

  /* release preview object-urls on unmount / replacement */
  useEffect(
    () => () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    },
    []
  );

  const setPreview = useCallback((blob: Blob | null, name: string | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = blob ? URL.createObjectURL(blob) : null;
    setInputPreview(previewUrl.current);
    setInputName(name);
  }, []);

  const run = useCallback(
    async (blob: File | Blob, name: string) => {
      if (!meta.engineId || meta.engineId === "ct3d") return;
      setPreview(blob instanceof File ? blob : null, name);
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        const r =
          meta.engineId === "fracture"
            ? await analyzeFracture(blob, name, conf)
            : await analyzeEngine(meta.engineId, blob, name);
        setResult(r);
        onResult(meta.engineId, r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [meta.engineId, conf, onResult, setPreview]
  );

  const runFile = useCallback(
    (file: File) => {
      void run(file, file.name);
    },
    [run]
  );

  const runSample = useCallback(
    (path: string) => {
      if (path === "__ct3d_sample__") return;
      void (async () => {
        try {
          const f = await fetchSampleAsFile(path);
          void run(f, f.name);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      })();
    },
    [run]
  );

  const runCt3d = useCallback(
    (files: File[] | null, preset: Ct3dPreset = "bone") => {
      setRunning(true);
      setError(null);
      setResult(null);
      void (async () => {
        try {
          const r = await analyzeCt3d(files, preset);
          setResult(r);
          onResult("ct3d", r);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setRunning(false);
        }
      })();
    },
    [onResult]
  );

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
    setPreview(null, null);
  }, [setPreview]);

  return {
    engineStatus,
    offline,
    running,
    result,
    error,
    inputPreview,
    inputName,
    conf,
    setConf,
    runFile,
    runSample,
    runCt3d,
    reset,
  };
}

/* ------------------------------ shell ------------------------------ */

interface ShellProps {
  meta: ModuleMeta;
  run: EngineRunState;
  onBack: () => void;
  onSwitchModule: (id: LauncherModuleId) => void;
  onOpenWorkstation: () => void;
  children: React.ReactNode;
}

function ModuleShell({ meta, run, onBack, onSwitchModule, onOpenWorkstation, children }: ShellProps) {
  const Icon = meta.icon;
  const st = run.engineStatus;
  const ready = st?.status === "ready";
  const fileInput = useRef<HTMLInputElement>(null);
  const isCt = meta.engineId === "ct3d";

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B121D]">
      {/* ---------- module header ---------- */}
      <header
        className="relative z-10 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-[#1f2d3e] bg-[#0d1622] px-3 py-2.5 sm:px-4"
        role="banner"
        style={{ boxShadow: `inset 0 -1px 0 0 ${meta.accent}22` }}
      >
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to module launcher"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#253548] bg-[#141e2a] text-[#8fa3b8] transition-all hover:border-[#3a5a7d] hover:text-white active:scale-95"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        </button>

        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border"
          style={{
            borderColor: `${meta.accent}44`,
            background: meta.accentSoft,
            color: meta.accent,
          }}
          aria-hidden="true"
        >
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0">
          <p
            className="text-[9.5px] font-bold tracking-[0.22em]"
            style={{ color: meta.accent }}
          >
            {meta.room}
          </p>
          <h1 className="truncate text-[16px] font-bold leading-tight text-[#e8eef5]">
            {meta.title}
          </h1>
        </div>

        <p className="hidden min-w-0 max-w-[300px] truncate text-[11px] text-[#8fa3b8] md:block">
          {meta.subtitle}
        </p>

        {/* engine status chip */}
        {meta.engineId && (
          <span
            className={`ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[10.5px] font-semibold ${
              run.offline
                ? "border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]"
                : ready
                  ? "border-[#22c55e]/25 bg-[#22c55e]/10 text-[#4ade80]"
                  : "border-[#facc15]/25 bg-[#facc15]/10 text-[#facc15]"
            }`}
            role="status"
            title={st?.message ?? "boali-engine :3020"}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                run.offline
                  ? "bg-[#f87171]"
                  : ready
                    ? "bg-[#4ade80]"
                    : "bg-[#facc15]"
              }`}
              aria-hidden="true"
            />
            {run.offline
              ? "engine offline"
              : ready
                ? "engine live"
                : (st?.status as EngineState) === "weights_missing"
                  ? "weights missing"
                  : "deps missing"}
          </span>
        )}

        {/* run controls */}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {meta.engineId && (
            <>
              <button
                type="button"
                disabled={!ready || run.running}
                onClick={() => fileInput.current?.click()}
                className="flex h-8 items-center gap-1.5 rounded-xl px-3 text-[11.5px] font-semibold transition-all enabled:hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: ready ? meta.accent : "#223046",
                  color: ready ? "#08131d" : "#5a6e82",
                }}
              >
                <Upload className="h-3.5 w-3.5" aria-hidden="true" />
                {isCt ? "Load series" : "Load study"}
              </button>
              <input
                ref={fileInput}
                type="file"
                accept="image/*,.dcm,.dicom"
                multiple={isCt}
                className="hidden"
                onChange={(e) => {
                  const files = e.target.files;
                  if (files && files.length > 0) {
                    if (isCt) run.runCt3d(Array.from(files));
                    else run.runFile(files[0]);
                  }
                  e.target.value = "";
                }}
                aria-label={`Upload ${isCt ? "a CT series" : "an image or DICOM"} for ${meta.title}`}
              />
              {meta.samples.map((s) => (
                <button
                  key={s.path}
                  type="button"
                  disabled={!ready || run.running}
                  onClick={() =>
                    s.path === "__ct3d_sample__"
                      ? run.runCt3d(null)
                      : run.runSample(s.path)
                  }
                  className="flex h-8 items-center gap-1.5 rounded-xl border border-[#253548] bg-[#182430] px-2.5 text-[11px] font-medium text-[#a9bccd] transition-colors enabled:hover:border-[#3a5a7d] enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <Play className="h-3 w-3" aria-hidden="true" />
                  {s.label}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            onClick={onOpenWorkstation}
            className="hidden h-8 items-center gap-1.5 rounded-xl border border-[#253548] bg-[#182430] px-2.5 text-[11px] font-medium text-[#8fa3b8] transition-colors hover:border-[#3a5a7d] hover:text-white lg:flex"
          >
            <Grid3x3 className="h-3 w-3" aria-hidden="true" />
            Workstation
          </button>
        </div>
      </header>

      {/* ---------- module rail (quick switch) ---------- */}
      <nav
        className="scroll-dark flex shrink-0 items-center gap-1.5 overflow-x-auto border-b border-[#16202d] bg-[#0a111b] px-3 py-1.5"
        aria-label="Switch module"
      >
        {MODULES.map((m) => {
          const MIcon = m.icon;
          const active = m.id === meta.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => onSwitchModule(m.id)}
              aria-current={active ? "page" : undefined}
              className={`flex h-7 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[10.5px] font-semibold transition-all ${
                active ? "text-[#08131d]" : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
              }`}
              style={active ? { background: m.accent, borderColor: m.accent } : undefined}
            >
              <MIcon className="h-3 w-3" aria-hidden="true" />
              {m.title}
            </button>
          );
        })}
      </nav>

      {/* ---------- module body ---------- */}
      <main className="scroll-dark flex min-h-0 flex-1 flex-col overflow-y-auto" role="main">
        {children}
      </main>

      {/* ---------- footer ---------- */}
      <footer className="mt-auto shrink-0 border-t border-[#1f2d3e] bg-[#0d1520] px-4 py-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-[#5a6e82]">
          <span className="font-semibold" style={{ color: meta.accent }}>
            {meta.title}
          </span>
          <span>boali-engine :3020 · real inference · no mock data</span>
          <span className="ml-auto hidden font-mono sm:inline">
            {run.inputName ? `source: ${run.inputName}` : "no study loaded"}
          </span>
        </div>
      </footer>
    </div>
  );
}

/* ---------------------- shared result bits ------------------------- */

function MetaChips({ result }: { result: EngineResult }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10.5px] text-[#8fa3b8]">
      <span className="rounded-full bg-[#223046] px-2 py-0.5 font-mono text-[#7dd3fc]">
        {result.model_file}
      </span>
      <span>{result.elapsed_ms} ms</span>
      <span>
        {result.source_size[0]}×{result.source_size[1]}
        {result.source_size.length > 2 ? `×${result.source_size[2]}` : ""}{" "}
        {result.source_size.length > 2 ? "vox" : "px"}
      </span>
      <span className="rounded-full bg-[#0f1823] px-2 py-0.5 text-[9.5px] text-[#5a6e82]">
        {result.source_ref}
      </span>
    </div>
  );
}

function ErrorBanner({ error }: { error: string }) {
  return (
    <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-3" role="alert">
      <p className="text-[11.5px] font-semibold text-[#f87171]">Engine error (honest failure)</p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-[#fca5a5]">{error}</p>
    </div>
  );
}

function RunningBar({ label, accent }: { label: string; accent: string }) {
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border p-3 text-[12px] font-medium"
      style={{ borderColor: `${accent}33`, background: `${accent}11`, color: accent }}
      role="status"
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      {label}
    </div>
  );
}

function EmptyDrop({
  accent,
  icon: Icon,
  line,
  hint,
}: {
  accent: string;
  icon: typeof Bone;
  line: string;
  hint: string;
}) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-8 text-center"
      style={{ borderColor: `${accent}30`, background: `${accent}08` }}
    >
      <span
        className="flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ background: `${accent}14`, color: accent }}
        aria-hidden="true"
      >
        <Icon className="h-7 w-7" />
      </span>
      <p className="text-[13.5px] font-semibold text-[#c3cedb]">{line}</p>
      <p className="max-w-[380px] text-[11px] leading-relaxed text-[#5a6e82]">{hint}</p>
    </div>
  );
}

/* ================= 1. FRACTURE — trauma room layout ================= */

function FractureRoom({ run }: { run: EngineRunState }) {
  const meta = MODULES[0];
  const [zoom, setZoom] = useState(1);
  const r = run.result as FractureResult | null;
  const res = r && r.engine === "fracture" ? r : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
      {/* left: viewer */}
      <section
        className="flex min-h-0 flex-col gap-2 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 lg:w-[58%]"
        aria-label="Fracture annotated viewer"
      >
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold tracking-widest text-[#22d3ee]">DETECTION OVERLAY</p>
          {res && (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                res.findings_count > 0
                  ? "bg-[#ef4444]/15 text-[#f87171]"
                  : "bg-[#22c55e]/15 text-[#4ade80]"
              }`}
            >
              {res.findings_count > 0
                ? `${res.findings_count} finding${res.findings_count > 1 ? "s" : ""}`
                : "clean"}
            </span>
          )}
          {res && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Zoom out"
                onClick={() => setZoom((z) => Math.max(1, z - 0.25))}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
              >
                <Minus className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Zoom in"
                onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
                className="flex h-6 w-6 items-center justify-center rounded-md border border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
              >
                <Plus className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          )}
        </div>
        <div className="scroll-dark flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-xl border border-[#1f2d3e] bg-black">
          {res ? (
            <motion.img
              key={res.annotated_image.slice(0, 64)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              src={res.annotated_image}
              alt="Radiograph with live YOLO fracture detections drawn as boxes"
              style={{ transform: `scale(${zoom})` }}
              className="max-h-[min(62vh,640px)] w-auto max-w-full object-contain transition-transform duration-200"
            />
          ) : run.running ? (
            <div className="flex h-56 items-center gap-2.5 text-[12px] text-[#7dd3fc]" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Running YOLOv8 inference on boali-engine…
            </div>
          ) : (
            <EmptyDrop
              accent={meta.accent}
              icon={Bone}
              line="Load a radiograph to localize fractures"
              hint="Upload an image/DICOM or run one of the sample studies. Boxes and confidences are computed live by fracture_ortho.onnx — identical to the desktop app."
            />
          )}
        </div>
        {res && <MetaChips result={res} />}
      </section>

      {/* right: findings list + conf control */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 lg:w-[42%]"
        aria-label="Fracture findings"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-bold tracking-widest text-[#22d3ee]">FINDINGS</p>
          <label className="ml-auto flex items-center gap-2 text-[10.5px] text-[#8fa3b8]">
            conf ≥
            <input
              type="number"
              min={0.03}
              max={0.9}
              step={0.01}
              value={run.conf}
              onChange={(e) => run.setConf(Number(e.target.value) || 0.08)}
              aria-label="Confidence threshold"
              className="h-6 w-16 rounded-md border border-[#253548] bg-[#141e2a] px-1.5 text-[11px] text-[#e8eef5] focus:border-[#22d3ee]/60 focus:outline-none"
            />
          </label>
        </div>

        {run.error && <ErrorBanner error={run.error} />}
        {run.running && <RunningBar label="Detecting fractures…" accent={meta.accent} />}

        {res && (
          <div className="scroll-dark min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
            {res.findings.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-[#22c55e]/10 p-3 text-[12px] text-[#4ade80]">
                <CheckCircle2 className="h-4.5 w-4.5 shrink-0" aria-hidden="true" />
                No boxes above conf ≥ {res.conf_threshold} — model found no fracture pattern.
              </div>
            ) : (
              res.findings.map((f, i) => (
                <motion.div
                  key={`${f.box.join("-")}-${i}`}
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.06 * i }}
                  className="rounded-xl border border-[#ef4444]/25 bg-[#ef4444]/8 p-2.5"
                >
                  <div className="flex items-center gap-2 text-[12px]">
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#ef4444]" aria-hidden="true" />
                    <span className="font-mono text-[11px] text-[#a9bccd]">
                      box [{f.box.join(", ")}]
                    </span>
                    <span className="ml-auto font-mono text-[14px] font-bold text-[#f87171]">
                      {(f.conf * 100).toFixed(1)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#0f1823]">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-[#ef4444] to-[#f97316]"
                      style={{ width: `${Math.min(f.conf * 100, 100)}%` }}
                    />
                  </div>
                </motion.div>
              ))
            )}
          </div>
        )}

        {!res && !run.running && !run.error && (
          <EmptyDrop
            accent={meta.accent}
            icon={Activity}
            line="Findings panel"
            hint="Each detection appears here with its box coordinates and model confidence. Nothing is fabricated — an empty list means the model genuinely found nothing."
          />
        )}
      </section>
    </div>
  );
}

/* ================ 2. BONE — decomposition lab layout ================ */

function BoneLab({ run }: { run: EngineRunState }) {
  const meta = MODULES[1];
  const r = run.result as BoneResult | null;
  const res = r && r.engine === "bone-suppression" ? r : null;
  const [spot, setSpot] = useState<keyof BoneResult["images"]>("soft_tissue");

  const PANELS = [
    ["soft_tissue", "Soft tissue · bone removed"],
    ["bone", "Bone-only"],
    ["lung", "Lung fields"],
    ["non_lung_soft", "Non-lung soft tissue"],
  ] as const;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {run.error && <ErrorBanner error={run.error} />}
      {run.running && <RunningBar label="Running Qure TorchScript decomposition…" accent={meta.accent} />}

      {!res ? (
        !run.running &&
        !run.error && (
          <EmptyDrop
            accent={meta.accent}
            icon={Activity}
            line="Load a chest X-ray to decompose into 4 tissue images"
            hint="The Qure TorchScript model separates soft tissue, bone, lung fields and non-lung soft tissue — exactly the four outputs of the desktop BoneSuppression engine."
          />
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row">
          {/* spotlight */}
          <section
            className="flex min-h-0 flex-col gap-2 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 xl:w-[46%]"
            aria-label="Spotlight decomposition"
          >
            <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
              SPOTLIGHT · {PANELS.find(([k]) => k === spot)?.[1].toUpperCase()}
            </p>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[#1f2d3e] bg-black">
              <motion.img
                key={spot + res.images[spot].slice(0, 48)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                src={res.images[spot]}
                alt={`Real model output: ${PANELS.find(([k]) => k === spot)?.[1]}`}
                className="max-h-[min(58vh,600px)] w-auto max-w-full object-contain"
              />
            </div>
            {run.inputPreview && (
              <div className="grid grid-cols-2 gap-2">
                <figure className="overflow-hidden rounded-lg border border-[#253548] bg-black">
                  <img
                    src={run.inputPreview}
                    alt="Original uploaded radiograph"
                    className="h-20 w-full object-contain"
                  />
                  <figcaption className="bg-[#182430] px-1.5 py-0.5 text-[9px] text-[#8fa3b8]">
                    original
                  </figcaption>
                </figure>
                <div className="flex flex-col justify-center px-2 text-[9.5px] leading-relaxed text-[#5a6e82]">
                  TorchScript decomposition runs on the full-resolution image; previews are
                  re-encoded PNG of the actual model outputs.
                </div>
              </div>
            )}
            <MetaChips result={res} />
          </section>

          {/* 2x2 light table */}
          <section
            className="grid min-h-0 flex-1 grid-cols-1 gap-2.5 sm:grid-cols-2"
            aria-label="Decomposition light table"
          >
            {PANELS.map(([key, label], i) => (
              <motion.button
                key={key}
                type="button"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                onClick={() => setSpot(key)}
                aria-pressed={spot === key}
                className={`group relative overflow-hidden rounded-xl border bg-black text-left transition-all ${
                  spot === key ? "border-[#2dd4bf]/70" : "border-[#253548] hover:border-[#3a5a7d]"
                }`}
                style={spot === key ? { boxShadow: `0 0 22px ${meta.accent}30` } : undefined}
              >
                <img
                  src={res.images[key]}
                  alt={`Real model output: ${label}`}
                  className="h-full min-h-[130px] w-full object-contain"
                />
                <figcaption
                  className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/70 px-2 py-1 text-[9.5px] text-[#c3cedb] backdrop-blur-sm"
                >
                  {label}
                  <span
                    className="rounded-full px-1.5 text-[8.5px] font-bold"
                    style={{ background: `${meta.accent}22`, color: meta.accent }}
                  >
                    {spot === key ? "SPOT" : "VIEW"}
                  </span>
                </figcaption>
              </motion.button>
            ))}
          </section>
        </div>
      )}
    </div>
  );
}

/* ================ 3. CHEST18 — screening console layout ============= */

function LungConsole({ run }: { run: EngineRunState }) {
  const meta = MODULES[2];
  const r = run.result as Chest18Result | null;
  const res = r && r.engine === "chest18" ? r : null;

  const [onlyPositive, setOnlyPositive] = useState(false);
  const sorted = useMemo(() => {
    if (!res) return [];
    const list = [...res.findings].sort((a, b) => b.score - a.score);
    return onlyPositive ? list.filter((f) => f.is_positive) : list;
  }, [res, onlyPositive]);

  const positives = res?.findings.filter((f) => f.is_positive).length ?? 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
      {/* left: image column */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 lg:w-[44%]"
        aria-label="Chest X-ray input"
      >
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
            STUDY
          </p>
          {res && (
            <span
              className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold ${
                positives > 0 ? "bg-[#ef4444]/15 text-[#f87171]" : "bg-[#22c55e]/15 text-[#4ade80]"
              }`}
            >
              {positives > 0 ? `${positives} positive` : "all clear"}
            </span>
          )}
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[#1f2d3e] bg-black">
          {run.inputPreview ? (
            <img
              src={run.inputPreview}
              alt="Chest radiograph analysed by DenseNet-18"
              className="max-h-[min(56vh,560px)] w-auto max-w-full object-contain"
            />
          ) : run.running ? (
            <div className="flex h-52 items-center gap-2.5 text-[12px] text-[#7dd3fc]" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Classifying 18 pathologies…
            </div>
          ) : (
            <EmptyDrop
              accent={meta.accent}
              icon={Stethoscope}
              line="Load a chest X-ray"
              hint="DenseNet-18 scores 18 pathologies with the exact calibrated operating thresholds of the desktop app (the yellow tick marks below)."
            />
          )}
        </div>
        {res && <MetaChips result={res} />}
      </section>

      {/* right: pathology bars */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 lg:w-[56%]"
        aria-label="18 pathology scores"
      >
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
            18 PATHOLOGIES
          </p>
          <button
            type="button"
            onClick={() => setOnlyPositive((v) => !v)}
            aria-pressed={onlyPositive}
            className={`ml-auto flex h-6.5 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold transition-colors ${
              onlyPositive
                ? "border-[#ef4444]/40 bg-[#ef4444]/10 text-[#f87171]"
                : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
            }`}
          >
            <AlertCircle className="h-3 w-3" aria-hidden="true" />
            positives only
          </button>
        </div>

        {run.error && <ErrorBanner error={run.error} />}
        {run.running && <RunningBar label="Scoring pathologies…" accent={meta.accent} />}

        {res && (
          <div className="scroll-dark min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
            {sorted.length === 0 && (
              <p className="rounded-xl bg-[#22c55e]/10 p-3 text-[11.5px] text-[#4ade80]">
                No pathology crossed its threshold on this study.
              </p>
            )}
            {sorted.map((f, i) => (
              <motion.div
                key={f.en}
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.03 * i }}
                className={`rounded-xl p-2 ${
                  f.is_positive ? "border border-[#ef4444]/25 bg-[#ef4444]/8" : "bg-[#182430]"
                }`}
              >
                <div className="flex items-center gap-2 text-[11.5px]">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                      f.is_positive ? "bg-[#ef4444]" : "bg-[#4ade80]"
                    }`}
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-[#c3cedb]" dir="rtl" lang="fa">
                    {f.fa}
                  </span>
                  <span className="truncate text-[9.5px] text-[#5a6e82]">{f.en}</span>
                  <span
                    className={`ml-auto font-mono text-[12.5px] font-bold ${
                      f.is_positive ? "text-[#f87171]" : "text-[#8fa3b8]"
                    }`}
                  >
                    {(f.score * 100).toFixed(1)}%
                  </span>
                </div>
                <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-[#0f1823]">
                  <div
                    className={`h-full rounded-full ${
                      f.is_positive ? "bg-[#ef4444]" : "bg-[#38bdf8]/70"
                    }`}
                    style={{ width: `${Math.min(f.score * 100, 100)}%` }}
                  />
                  <div
                    className="absolute top-0 h-full w-px bg-[#facc15]"
                    style={{ left: `${Math.min(f.threshold * 100, 100)}%` }}
                    title={`operating threshold ${(f.threshold * 100).toFixed(0)}%`}
                  />
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/* ================= 4. MAMMO — triage suite layout =================== */

function MammoSuite({ run }: { run: EngineRunState }) {
  const meta = MODULES[3];
  const r = run.result as MammoResult | null;
  const res = r && r.engine === "mammography" ? r : null;

  const probs = useMemo(
    () =>
      res
        ? Object.entries(res.probabilities).sort((a, b) => b[1] - a[1])
        : [],
    [res]
  );
  const top = probs[0];
  const verdictLabel = top
    ? top[0].toLowerCase().includes("malignant")
      ? "SUSPICION — RECALL"
      : top[0].toLowerCase().includes("benign")
        ? "BENIGN PATTERN"
        : "ROUTINE SCREEN"
    : null;
  const verdictColor = top
    ? top[0].toLowerCase().includes("malignant")
      ? "#f87171"
      : top[0].toLowerCase().includes("benign")
        ? "#4ade80"
        : "#7dd3fc"
    : "#8fa3b8";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
      {/* left: mammogram */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-2.5 lg:w-[46%]"
        aria-label="Mammogram input"
      >
        <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
          MAMMOGRAM
        </p>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl border border-[#1f2d3e] bg-black">
          {run.inputPreview ? (
            <img
              src={run.inputPreview}
              alt="Mammogram analysed by ResNet-50"
              className="max-h-[min(54vh,560px)] w-auto max-w-full object-contain"
            />
          ) : run.running ? (
            <div className="flex h-52 items-center gap-2.5 text-[12px] text-[#7dd3fc]" role="status">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
              Classifying benign / malignant / normal…
            </div>
          ) : (
            <EmptyDrop
              accent={meta.accent}
              icon={Droplets}
              line="Load a mammogram (3 sample DICOMs available)"
              hint="ResNet-50 outputs calibrated triage probabilities. BI-RADS assignment stays with the radiologist — the model never fabricates a classification."
            />
          )}
        </div>
        {res && <MetaChips result={res} />}
      </section>

      {/* right: verdict + probabilities */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-3 lg:w-[54%]"
        aria-label="Triage verdict"
      >
        {run.error && <ErrorBanner error={run.error} />}
        {run.running && <RunningBar label="Running ResNet-50…" accent={meta.accent} />}

        {res && top ? (
          <>
            {/* verdict ring */}
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="flex items-center gap-4 rounded-2xl border p-4"
              style={{ borderColor: `${verdictColor}33`, background: `${verdictColor}0d` }}
              aria-live="polite"
            >
              <div
                className="relative flex h-24 w-24 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: `conic-gradient(${verdictColor} ${top[1] * 360}deg, #14202e 0deg)`,
                }}
                role="img"
                aria-label={`Top class ${top[0]} at ${(top[1] * 100).toFixed(1)} percent`}
              >
                <span className="flex h-[76px] w-[76px] flex-col items-center justify-center rounded-full bg-[#0d1622]">
                  <span className="font-mono text-[19px] font-bold" style={{ color: verdictColor }}>
                    {(top[1] * 100).toFixed(1)}%
                  </span>
                  <span className="text-[8.5px] uppercase tracking-wider text-[#8fa3b8]">top</span>
                </span>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-bold tracking-[0.2em] text-[#8fa3b8]">TRIAGE VERDICT</p>
                <p className="truncate text-[20px] font-bold" style={{ color: verdictColor }}>
                  {verdictLabel}
                </p>
                <p className="mt-0.5 text-[11px] text-[#8fa3b8]">
                  ResNet-50 · argmax = <span className="text-[#c3cedb] capitalize">{top[0]}</span>
                </p>
              </div>
            </motion.div>

            {/* probability bars */}
            <div className="space-y-2" aria-label="Class probabilities">
              {probs.map(([label, p]) => {
                const isTop = p === top[1];
                const isMal = label.toLowerCase().includes("malignant");
                return (
                  <div key={label} className="rounded-xl bg-[#182430] p-2.5">
                    <div className="flex items-center gap-2 text-[12px]">
                      <span className="capitalize text-[#c3cedb]">{label}</span>
                      <span
                        className={`ml-auto font-mono text-[15px] font-bold ${
                          isTop ? (isMal ? "text-[#f87171]" : "text-[#4ade80]") : "text-[#8fa3b8]"
                        }`}
                      >
                        {(p * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0f1823]">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(p * 100, 100)}%` }}
                        transition={{ duration: 0.5 }}
                        className={`h-full rounded-full ${
                          isTop ? (isMal ? "bg-[#ef4444]" : "bg-[#22c55e]") : "bg-[#e879b9]/60"
                        }`}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] leading-relaxed text-[#5a6e82]">
              Probabilities only — BI-RADS assignment stays with the radiologist (no fabricated
              classification).
            </p>
          </>
        ) : (
          !run.running &&
          !run.error && (
            <EmptyDrop
              accent={meta.accent}
              icon={Droplets}
              line="Triage verdict appears here"
              hint="Run one of the three bundled mammography DICOM samples (mammo-1/2/3.dcm) or upload your own study to see the live verdict ring."
            />
          )
        )}
      </section>
    </div>
  );
}

/* ================= 5. 3D CT — volume theater layout ================= */

function VolumeTheater({ run }: { run: EngineRunState }) {
  const meta = MODULES[4];
  const r = run.result as Ct3dResult | null;
  const res = r && r.engine === "ct3d" ? r : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {run.error && <ErrorBanner error={run.error} />}
      {run.running && (
        <RunningBar
          label="Building 3D volume from DICOM slices + ray-casting…"
          accent={meta.accent}
        />
      )}

      {!res ? (
        !run.running &&
        !run.error && (
          <EmptyDrop
            accent={meta.accent}
            icon={Boxes}
            line="Load a CT series to enter the volume theater"
            hint="Upload one or more CT DICOM slices (multi-select), or press the bundled sample series. MPR planes and the volume render are computed live from real voxel data."
          />
        )
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex min-h-0 flex-1 flex-col gap-3 xl:flex-row"
        >
          {/* theater main view */}
          <section
            className="scroll-dark min-h-0 flex-1 overflow-y-auto rounded-2xl border border-[#a78bfa]/25 bg-[#0d1220] p-3"
            aria-label="3D CT interactive view"
          >
            <Ct3dStudioView result={res} />
          </section>

          {/* volume stats sidebar */}
          <aside
            className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-3 xl:w-[250px]"
            aria-label="Volume statistics"
          >
            <p className="text-[11px] font-bold tracking-widest text-[#a78bfa]">VOLUME</p>
            <dl className="grid grid-cols-2 gap-2 text-[11px] xl:grid-cols-1">
              {[
                ["Patient", String(res.meta.patient_name ?? "sample series")],
                ["Series", String(res.meta.series_desc ?? "CT")],
                ["Slices", `${res.stats.slices}`],
                ["Voxels", `${(res.stats.voxels / 1e6).toFixed(2)} M`],
                ["Spacing", `${res.stats.spacing_mm.join("×")} mm`],
                ["HU range", `${res.stats.hu_min} … ${res.stats.hu_max}`],
                ["HU mean", `${res.stats.hu_mean}`],
                ["Body volume", `${res.stats.body_volume_ml} ml`],
              ].map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 rounded-lg bg-[#182430] px-2.5 py-1.5">
                  <dt className="text-[9.5px] uppercase tracking-wider text-[#5a6e82]">{k}</dt>
                  <dd className="truncate font-mono text-[11px] text-[#c3cedb]">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-auto space-y-1.5 text-[9.5px] leading-relaxed text-[#5a6e82]">
              <p>
                {res.used_sample
                  ? "Bundled sample CT series (synthetic phantom)."
                  : `Uploaded series · ${res.meta.slice_count_acquired ?? res.stats.slices} slices acquired.`}
              </p>
              <p>
                MPR + ray-cast DVR computed with numpy/scipy on the real voxel grid. Gaps render as
                air — never fabricated.
              </p>
            </div>
          </aside>
        </motion.div>
      )}
    </div>
  );
}

/* ================ 6. REPORT — report desk layout ==================== */

interface ReportDeskProps {
  results: Partial<Record<EngineId, EngineResult>>;
}

function ReportDesk({ results }: ReportDeskProps) {
  const meta = MODULES[5];
  const [patientName, setPatientName] = useState("");
  const [patientId, setPatientId] = useState("");
  const [indication, setIndication] = useState("");
  const [impression, setImpression] = useState("");

  const rows = useMemo(() => {
    const out: { module: string; text: string; accent: string }[] = [];
    const fr = results.fracture as FractureResult | undefined;
    if (fr && fr.engine === "fracture") {
      out.push({
        module: "Fracture Detection",
        accent: MODULES[0].accent,
        text:
          fr.findings_count === 0
            ? `No fracture pattern above conf ≥ ${fr.conf_threshold} (${fr.elapsed_ms} ms).`
            : `${fr.findings_count} suspicious region(s): ${fr.findings
                .map((f) => `[${f.box.join(",")}] ${(f.conf * 100).toFixed(1)}%`)
                .join(" · ")} (${fr.elapsed_ms} ms).`,
      });
    }
    const ch = results.chest18 as Chest18Result | undefined;
    if (ch && ch.engine === "chest18") {
      const pos = ch.findings.filter((f) => f.is_positive);
      out.push({
        module: "Lung Screen (18)",
        accent: MODULES[2].accent,
        text:
          pos.length === 0
            ? `No pathology crossed its calibrated threshold (${ch.elapsed_ms} ms).`
            : `Positive: ${pos.map((f) => `${f.fa} (${(f.score * 100).toFixed(1)}%)`).join(" · ")} (${ch.elapsed_ms} ms).`,
      });
    }
    const mm = results.mammography as MammoResult | undefined;
    if (mm && mm.engine === "mammography") {
      const top = Object.entries(mm.probabilities).sort((a, b) => b[1] - a[1])[0];
      out.push({
        module: "Mammography AI",
        accent: MODULES[3].accent,
        text: `Top class: ${top[0]} at ${(top[1] * 100).toFixed(1)}% (${mm.elapsed_ms} ms). Probabilities only — BI-RADS assigned by radiologist.`,
      });
    }
    const bn = results["bone-suppression"] as BoneResult | undefined;
    if (bn && bn.engine === "bone-suppression") {
      out.push({
        module: "Bone Suppression",
        accent: MODULES[1].accent,
        text: `4-tissue decomposition produced (soft tissue / bone / lung / non-lung soft) in ${bn.elapsed_ms} ms.`,
      });
    }
    const ct = results.ct3d as Ct3dResult | undefined;
    if (ct && ct.engine === "ct3d") {
      out.push({
        module: "3D CT Studio",
        accent: MODULES[4].accent,
        text: `Volume ${ct.stats.slices} slices, ${(ct.stats.voxels / 1e6).toFixed(1)}M voxels, HU ${ct.stats.hu_min}…${ct.stats.hu_max}. MPR + VR rendered.`,
      });
    }
    return out;
  }, [results]);

  const printReport = useCallback(() => {
    const w = window.open("", "_blank", "width=780,height=900");
    if (!w) return;
    const esc = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    w.document.write(`<!doctype html><html><head><meta charset="utf-8">
<title>Boali Radiology Report</title>
<style>
  body{font-family:Georgia,'Times New Roman',serif;max-width:720px;margin:32px auto;color:#111;padding:0 24px}
  h1{font-size:20px;border-bottom:2px solid #111;padding-bottom:8px;letter-spacing:.04em}
  .sub{color:#555;font-size:12px;margin:2px 0 20px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:12px 0}
  td,th{border:1px solid #999;padding:6px 9px;text-align:left;vertical-align:top}
  th{background:#f2f2f2;width:170px}
  .findings td:first-child{font-weight:bold}
  .impression{border:1px solid #999;padding:12px;font-size:13px;white-space:pre-wrap;margin-top:12px}
  .foot{margin-top:26px;color:#777;font-size:10.5px;border-top:1px solid #bbb;padding-top:8px}
</style></head><body>
<h1>BOALI RADIOLOGY SUITE — AI FINDINGS REPORT</h1>
<p class="sub">Research / education use — not a diagnostic device. All values computed live by boali-engine.</p>
<table>
<tr><th>Patient name</th><td>${esc(patientName || "—")}</td></tr>
<tr><th>Patient ID</th><td>${esc(patientId || "—")}</td></tr>
<tr><th>Indication</th><td>${esc(indication || "—")}</td></tr>
<tr><th>Date</th><td>${new Date().toLocaleString()}</td></tr>
</table>
${
  rows.length > 0
    ? `<table class="findings">${rows
        .map(
          (r) =>
            `<tr><td>${esc(r.module)}</td><td>${esc(r.text)}</td></tr>`
        )
        .join("")}</table>`
    : "<p>No engine results recorded in this session yet — run a module first.</p>"
}
${impression.trim() ? `<div class="impression"><b>Impression</b><br/>${esc(impression)}</div>` : ""}
<div class="foot">Generated by Boali Radiology Suite · engines ported verbatim from boali-radiology-suite.</div>
<script>window.print()</script>
</body></html>`);
    w.document.close();
  }, [rows, patientName, patientId, indication, impression]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 lg:flex-row">
      {/* left: patient form */}
      <section
        className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-3 lg:w-[320px]"
        aria-label="Report demographics"
      >
        <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
          DEMOGRAPHICS
        </p>
        {(
          [
            ["Patient name", patientName, setPatientName, "e.g. Sara Ahmadi"],
            ["Patient ID", patientId, setPatientId, "e.g. MRN-10238"],
            ["Indication", indication, setIndication, "e.g. screening"],
          ] as const
        ).map(([label, val, set, ph]) => (
          <label key={label} className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#5a6e82]">
              {label}
            </span>
            <input
              value={val}
              onChange={(e) => set(e.target.value)}
              placeholder={ph}
              aria-label={label}
              className="h-9 w-full rounded-xl border border-[#253548] bg-[#141e2a] px-3 text-[12.5px] text-[#e8eef5] placeholder:text-[#3d4f63] focus:border-[#facc15]/50 focus:outline-none"
            />
          </label>
        ))}
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-[#5a6e82]">
            Impression (radiologist)
          </span>
          <textarea
            value={impression}
            onChange={(e) => setImpression(e.target.value)}
            rows={5}
            aria-label="Impression"
            placeholder="Free-text impression — never auto-generated."
            className="scroll-dark w-full resize-none rounded-xl border border-[#253548] bg-[#141e2a] p-2.5 text-[12px] leading-relaxed text-[#e8eef5] placeholder:text-[#3d4f63] focus:border-[#facc15]/50 focus:outline-none"
          />
        </label>
        <button
          type="button"
          onClick={printReport}
          className="mt-auto flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#facc15] to-[#eab308] text-[12.5px] font-bold text-[#221c03] transition-all hover:brightness-110 active:scale-[0.98]"
        >
          <Printer className="h-4 w-4" aria-hidden="true" />
          Print / Save as PDF
        </button>
      </section>

      {/* right: aggregated engine findings */}
      <section
        className="flex min-h-0 flex-col gap-2.5 rounded-2xl border border-[#253548] bg-[#0d1622] p-3 lg:flex-1"
        aria-label="Aggregated engine findings"
      >
        <p className="text-[11px] font-bold tracking-widest" style={{ color: meta.accent }}>
          ENGINE FINDINGS THIS SESSION
        </p>
        <div className="scroll-dark min-h-0 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
          {rows.length === 0 ? (
            <EmptyDrop
              accent={meta.accent}
              icon={ClipboardList}
              line="No engine results recorded yet"
              hint="Run an analysis in any module (fracture, lung screen, mammography, bone suppression or 3D CT) — its real output is aggregated here automatically, then print the report."
            />
          ) : (
            rows.map((r, i) => (
              <motion.div
                key={r.module}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.05 * i }}
                className="rounded-xl border p-3"
                style={{ borderColor: `${r.accent}30`, background: `${r.accent}0a` }}
              >
                <p className="flex items-center gap-2 text-[12px] font-bold" style={{ color: r.accent }}>
                  {r.module}
                </p>
                <p className="mt-1 text-[11.5px] leading-relaxed text-[#c3cedb]">{r.text}</p>
              </motion.div>
            ))
          )}
        </div>
        <p className="text-[9.5px] leading-relaxed text-[#5a6e82]">
          Only findings actually computed by the engines during this session appear here — the
          report never invents content.
        </p>
      </section>
    </div>
  );
}

/* ===================== public entry component ======================= */

interface ModuleWorkspaceProps {
  moduleId: LauncherModuleId;
  onBack: () => void;
  onSwitchModule: (id: LauncherModuleId) => void;
  onOpenWorkstation: () => void;
  onResult: (engineId: EngineId, result: EngineResult) => void;
  results: Partial<Record<EngineId, EngineResult>>;
}

export function ModuleWorkspace({
  moduleId,
  onBack,
  onSwitchModule,
  onOpenWorkstation,
  onResult,
  results,
}: ModuleWorkspaceProps) {
  const meta = MODULES.find((m) => m.id === moduleId) ?? MODULES[0];
  /* keyed remount per module so each room starts fresh */
  const run = useEngineRun(meta, onResult);

  const body =
    meta.id === "report" ? (
      <ReportDesk results={results} />
    ) : (
      <>
        {meta.id === "fracture" && <FractureRoom run={run} />}
        {meta.id === "bone" && <BoneLab run={run} />}
        {meta.id === "chest18" && <LungConsole run={run} />}
        {meta.id === "mammo" && <MammoSuite run={run} />}
        {meta.id === "studio" && <VolumeTheater run={run} />}
      </>
    );

  return (
    <motion.div
      key={meta.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <ModuleShell
        meta={meta}
        run={run}
        onBack={onBack}
        onSwitchModule={onSwitchModule}
        onOpenWorkstation={onOpenWorkstation}
      >
        {body}
      </ModuleShell>
    </motion.div>
  );
}
