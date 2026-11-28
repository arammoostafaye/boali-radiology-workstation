"use client";

/* ------------------------------------------------------------------ */
/*  Real Engine Panel — runs REAL inference via the boali-engine       */
/*  FastAPI service (port 3020) for all four engines.                  */
/*  No mock numbers: whatever renders here is computed by the actual   */
/*  models (fracture_ortho.onnx, bone_suppression.ts, ...).            */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bone,
  Boxes,
  CheckCircle2,
  Droplets,
  FileWarning,
  Loader2,
  Play,
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
  type EngineStatusResponse,
  type FractureResult,
  type MammoResult,
} from "@/lib/boali-engine";
import { Ct3dStudioView } from "./ct3d-studio";

const STATE_STYLES: Record<EngineState, { dot: string; text: string; label: string }> = {
  ready: { dot: "bg-[#4ade80]", text: "text-[#4ade80]", label: "ready" },
  weights_missing: { dot: "bg-[#facc15]", text: "text-[#facc15]", label: "weights missing" },
  deps_missing: { dot: "bg-[#f87171]", text: "text-[#f87171]", label: "deps missing" },
};

export function statusRank(s: EngineState) {
  return { ready: 0, weights_missing: 1, deps_missing: 2 }[s];
}

/* ------------------------- engine registry ------------------------- */

interface EngineUi {
  id: EngineId;
  label: string;
  short: string;
  icon: typeof Activity;
  /** samples served from /public */
  samples: { label: string; path: string; dcm?: string }[];
  hasConfSlider: boolean;
}

const ENGINES: EngineUi[] = [
  {
    id: "fracture",
    label: "Fracture Detection — YOLOv8 ONNX",
    short: "Fracture",
    icon: Bone,
    samples: [
      { label: "Sample A", path: "/workstation/sample-cxr-1.png" },
      { label: "Sample B", path: "/workstation/sample-cxr-2.png" },
      { label: "CT DICOM", path: "/samples/ct-chest-1.dcm" },
    ],
    hasConfSlider: true,
  },
  {
    id: "bone-suppression",
    label: "Bone Suppression — Qure TorchScript",
    short: "Bone",
    icon: Activity,
    samples: [
      { label: "Sample A", path: "/workstation/sample-cxr-1.png" },
      { label: "Sample B", path: "/workstation/sample-cxr-2.png" },
    ],
    hasConfSlider: false,
  },
  {
    id: "chest18",
    label: "Lung Screen — DenseNet-18 (18 pathologies)",
    short: "Lung",
    icon: Stethoscope,
    samples: [
      { label: "Sample A", path: "/workstation/sample-cxr-1.png" },
      { label: "Sample B", path: "/workstation/sample-cxr-2.png" },
      { label: "CT DICOM", path: "/samples/ct-chest-1.dcm" },
    ],
    hasConfSlider: false,
  },
  {
    id: "mammography",
    label: "Mammography — ResNet-50 triage",
    short: "Mammo",
    icon: Droplets,
    samples: [
      { label: "Mammo 1", path: "/samples/mammo-1.dcm" },
      { label: "Mammo 2", path: "/samples/mammo-2.dcm" },
      { label: "Mammo 3", path: "/samples/mammo-3.dcm" },
    ],
    hasConfSlider: false,
  },
  {
    id: "ct3d",
    label: "3D CT Studio — MPR + volume rendering",
    short: "3D CT",
    icon: Boxes,
    samples: [{ label: "CT chest series", path: "__ct3d_sample__" }],
    hasConfSlider: false,
  },
];

/* ----------------------------- component ---------------------------- */

interface RealEnginePanelProps {
  /** externally selected engine (synced with active workstation module) */
  activeEngineId?: EngineId;
  onEngineChange?: (id: EngineId) => void;
}

export function RealEnginePanel({ activeEngineId, onEngineChange }: RealEnginePanelProps) {
  const [status, setStatus] = useState<EngineStatusResponse | null>(null);
  const [offline, setOffline] = useState(false);

  const [engineId, setEngineId] = useState<EngineId>(activeEngineId ?? "fracture");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<EngineResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conf, setConf] = useState(0.08);

  const fileInputRef = useRef<HTMLInputElement>(null);

  /* follow external module selection — reset stale results so a result
   * from another engine never renders in the newly selected engine's UI */
  useEffect(() => {
    if (activeEngineId && activeEngineId !== engineId) {
      setEngineId(activeEngineId);
      setResult(null);
      setError(null);
    }
  }, [activeEngineId, engineId]);

  /* reset result when switching engines */
  const selectEngine = useCallback(
    (id: EngineId) => {
      setEngineId(id);
      setResult(null);
      setError(null);
      onEngineChange?.(id);
    },
    [onEngineChange]
  );

  /* -------- poll engine service status (every 10 s) -------- */
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const s = await fetchEngineStatus();
      if (!alive) return;
      if (s) {
        setStatus(s);
        setOffline(false);
      } else {
        setOffline(true);
      }
    };
    void poll();
    const t = setInterval(poll, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const engineUi = ENGINES.find((e) => e.id === engineId) ?? ENGINES[0];
  const engineStatus = status?.engines.find((e) => e.engine === engineId);
  const canRun = engineStatus?.status === "ready" && !running;

  const runAnalysis = useCallback(
    async (file: File | Blob, fileName: string) => {
      if (engineId === "ct3d") return; /* ct3d uses runCt3d (series) */
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        const r =
          engineId === "fracture"
            ? await analyzeFracture(file, fileName, conf)
            : await analyzeEngine(engineId, file, fileName);
        setResult(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    [engineId, conf]
  );

  /* ct3d takes a whole series (multi-file) or the bundled sample */
  const runCt3d = useCallback(
    async (files: File[] | null, preset: Ct3dPreset = "bone") => {
      setRunning(true);
      setError(null);
      setResult(null);
      try {
        const r = await analyzeCt3d(files, preset);
        setResult(r);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    },
    []
  );

  const onFileSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) {
        /* noop */
      } else if (engineId === "ct3d") {
        void runCt3d(Array.from(files));
      } else {
        void runAnalysis(files[0], files[0].name);
      }
      e.target.value = "";
    },
    [runAnalysis, runCt3d, engineId]
  );

  const onSample = useCallback(
    async (path: string) => {
      if (path === "__ct3d_sample__") {
        void runCt3d(null);
        return;
      }
      try {
        const f = await fetchSampleAsFile(path);
        void runAnalysis(f, f.name);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [runAnalysis, runCt3d]
  );

  return (
    <section
      aria-label="Real AI engine status and inference"
      className="rounded-2xl border border-[#2dd4bf]/25 bg-[#141e2a] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
      {/* header */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">
          <span className="text-[#2dd4bf]">Real</span>
          <span className="text-[#e8eef5]"> Engine Inference</span>
        </h2>
        <span
          className={`inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium ${
            offline
              ? "border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]"
              : "border-[#22c55e]/25 bg-[#22c55e]/10 text-[#4ade80]"
          }`}
          role="status"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${offline ? "bg-[#f87171]" : "bg-[#4ade80]"}`}
          />
          {offline ? "service offline :3020" : "boali-engine :3020"}
        </span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-[#8fa3b8]">
        Runs the actual models from{" "}
        <code className="rounded bg-[#0f1823] px-1 py-0.5 text-[10.5px] text-[#7dd3fc]">
          boali-radiology-suite
        </code>{" "}
        via FastAPI. Results below are computed live — never mock data.
      </p>

      {/* engine status list */}
      <div className="scroll-dark mb-3 max-h-44 space-y-1.5 overflow-y-auto pr-1">
        {(status?.engines ?? []).map((e) => {
          const st = STATE_STYLES[e.status as EngineState];
          const sel = e.engine === engineId;
          return (
            <button
              key={e.engine}
              type="button"
              onClick={() => {
                const known = ENGINES.find((x) => x.id === e.engine);
                if (known) selectEngine(known.id);
              }}
              title={e.message}
              aria-pressed={sel}
              className={`flex w-full items-center gap-2.5 rounded-xl p-2.5 text-left transition-colors ${
                sel ? "bg-[#16303c] ring-1 ring-[#2dd4bf]/40" : "bg-[#182430] hover:bg-[#1d2b3b]"
              }`}
            >
              {e.status === "ready" ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-[#4ade80]" aria-hidden="true" />
              ) : e.status === "weights_missing" ? (
                <FileWarning className="h-4 w-4 shrink-0 text-[#facc15]" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0 text-[#f87171]" aria-hidden="true" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-semibold text-[#e8eef5]">
                  {e.name}
                </span>
                <span className="block truncate text-[10.5px] leading-4 text-[#8fa3b8]">
                  {e.framework} · {e.source_ref}
                </span>
              </span>
              <span
                className={`inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-[#253548] bg-[#0f1823] px-2 text-[10px] font-medium ${st.text}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                {st.label}
              </span>
            </button>
          );
        })}
        {offline && (
          <div className="flex items-center gap-2.5 rounded-xl bg-[#182430] p-2.5">
            <AlertCircle className="h-4 w-4 shrink-0 text-[#f87171]" aria-hidden="true" />
            <span className="text-[11.5px] text-[#a9bccd]">
              Engine service unreachable — start it with{" "}
              <code className="text-[10.5px] text-[#7dd3fc]">bun run dev</code> in{" "}
              <code className="text-[10.5px] text-[#7dd3fc]">mini-services/boali-engine</code>.
            </span>
          </div>
        )}
      </div>

      {/* -------- active engine runner -------- */}
      <div className="rounded-xl border border-[#253548] bg-[#0f1823] p-3">
        {/* engine tab strip */}
        <div className="mb-2.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Select engine">
          {ENGINES.map((e) => {
            const Icon = e.icon;
            const st = status?.engines.find((s) => s.engine === e.id);
            const active = e.id === engineId;
            return (
              <button
                key={e.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectEngine(e.id)}
                className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-all ${
                  active
                    ? "border-[#2dd4bf]/50 bg-[#16303c] text-[#7ee7f3]"
                    : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:border-[#3a5a7d] hover:text-[#c3cedb]"
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {e.short}
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    st?.status === "ready" ? "bg-[#4ade80]" : "bg-[#f87171]"
                  }`}
                  aria-hidden="true"
                />
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-[12px] font-semibold text-[#e8eef5]">{engineUi.label}</p>
          {engineUi.hasConfSlider && (
            <label className="flex shrink-0 items-center gap-2 text-[10.5px] text-[#8fa3b8]">
              conf ≥
              <input
                type="number"
                min={0.03}
                max={0.9}
                step={0.01}
                value={conf}
                onChange={(e) => setConf(Number(e.target.value) || 0.08)}
                aria-label="Confidence threshold"
                className="h-6 w-16 rounded-md border border-[#253548] bg-[#141e2a] px-1.5 text-[11px] text-[#e8eef5] focus:border-[#2dd4bf]/60 focus:outline-none"
              />
            </label>
          )}
        </div>

        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canRun}
            onClick={() => fileInputRef.current?.click()}
            className={`flex h-9 items-center gap-2 rounded-xl px-3 text-[12px] font-medium transition-all ${
              canRun
                ? "bg-gradient-to-r from-[#2dd4bf] to-[#14b8a6] text-[#06251f] hover:brightness-110 active:scale-[0.98]"
                : "cursor-not-allowed bg-[#223046] text-[#5a6e82]"
            }`}
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {engineId === "ct3d" ? "Upload CT Series" : "Upload Image / DICOM"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.dcm,.dicom"
            multiple={engineId === "ct3d"}
            className="hidden"
            onChange={onFileSelected}
            aria-label={`Upload ${engineId === "ct3d" ? "a CT DICOM series" : "a study"} for real ${engineUi.short} inference`}
          />
          {engineUi.samples.map((s) => (
            <button
              key={s.path}
              type="button"
              disabled={!canRun}
              onClick={() => void onSample(s.path)}
              className="flex h-9 items-center gap-2 rounded-xl border border-[#253548] bg-[#182430] px-3 text-[12px] font-medium text-[#a9bccd] transition-colors enabled:hover:border-[#3a5a7d] enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
              {s.label}
            </button>
          ))}
        </div>

        {engineStatus && engineStatus.status !== "ready" && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-[#facc15]">{engineStatus.message}</p>
        )}

        {/* running state */}
        {running && (
          <div className="mt-3 flex items-center gap-2 text-[12px] text-[#7dd3fc]" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {engineId === "ct3d"
              ? "Building 3D volume + rendering on boali-engine…"
              : `Running real ${engineUi.short} inference on boali-engine…`}
          </div>
        )}

        {/* error state (honest errors from the backend) */}
        {error && (
          <div className="mt-3 rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-2.5" role="alert">
            <p className="text-[11.5px] font-semibold text-[#f87171]">Engine error (honest failure)</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-[#fca5a5]">{error}</p>
          </div>
        )}

        {/* -------- per-engine real results -------- */}
        {result && !running && (
          <div className="mt-3 space-y-2.5" aria-live="polite">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[#8fa3b8]">
              <span className="rounded-full bg-[#223046] px-2 py-0.5 text-[10.5px] text-[#7dd3fc]">
                {result.model_file}
              </span>
              <span>{result.elapsed_ms} ms</span>
              {engineId === "ct3d" ? (
                <span>
                  {result.source_size[0]}×{result.source_size[1]}×{result.source_size[2]} vox
                </span>
              ) : (
                <span>
                  {result.source_size[0]}×{result.source_size[1]} px
                </span>
              )}
              {"conf_threshold" in result && <span>conf ≥ {result.conf_threshold}</span>}
              {engineId !== "ct3d" && (
                <span
                  className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                    result.findings_count > 0
                      ? "bg-[#ef4444]/15 text-[#f87171]"
                      : "bg-[#22c55e]/15 text-[#4ade80]"
                  }`}
                >
                  {result.findings_count > 0
                    ? `${result.findings_count} positive finding${result.findings_count > 1 ? "s" : ""}`
                    : "no positive findings"}
                </span>
              )}
            </div>

            {/* ---- ct3d studio: interactive MPR + VR ---- */}
            {engineId === "ct3d" && result.engine === "ct3d" && <Ct3dStudioView result={result as Ct3dResult} />}

            {/* ---- fracture: annotated image + boxes ---- */}
            {engineId === "fracture" && result.engine === "fracture" && (
              <>
                <div className="overflow-hidden rounded-xl border border-[#253548] bg-black">
                  <img
                    src={(result as FractureResult).annotated_image}
                    alt="Radiograph with real model detection overlay"
                    className="max-h-72 w-full object-contain"
                  />
                </div>
                {(result as FractureResult).findings.length > 0 && (
                  <div className="scroll-dark max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {(result as FractureResult).findings.map((f, i) => (
                      <div
                        key={`${f.box.join("-")}-${i}`}
                        className="flex items-center gap-2 rounded-xl bg-[#182430] p-2 text-[11.5px]"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ef4444]" aria-hidden="true" />
                        <span className="text-[#a9bccd]">
                          box [{f.box[0]}, {f.box[1]}, {f.box[2]}, {f.box[3]}]
                        </span>
                        <span className="ml-auto font-bold text-[#f87171]">
                          {(f.conf * 100).toFixed(1)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ---- chest18: 18 pathology score bars (bilingual fa/en) ---- */}
            {engineId === "chest18" && result.engine === "chest18" && (
              <div className="scroll-dark max-h-64 space-y-1.5 overflow-y-auto pr-1">
                {(result as Chest18Result).findings.map((f) => (
                  <div key={f.en} className="rounded-xl bg-[#182430] p-2">
                    <div className="flex items-center gap-2 text-[11.5px]">
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          f.is_positive ? "bg-[#ef4444]" : "bg-[#4ade80]"
                        }`}
                        aria-hidden="true"
                      />
                      <span className="text-[#c3cedb]" dir="rtl" lang="fa">
                        {f.fa}
                      </span>
                      <span className="truncate text-[10px] text-[#5a6e82]">{f.en}</span>
                      <span
                        className={`ml-auto font-mono font-bold ${
                          f.is_positive ? "text-[#f87171]" : "text-[#8fa3b8]"
                        }`}
                      >
                        {(f.score * 100).toFixed(1)}%
                      </span>
                    </div>
                    <div className="relative mt-1 h-1.5 overflow-hidden rounded-full bg-[#0f1823]">
                      <div
                        className={`h-full rounded-full ${
                          f.is_positive ? "bg-[#ef4444]" : "bg-[#2dd4bf]/70"
                        }`}
                        style={{ width: `${Math.min(f.score * 100, 100)}%` }}
                      />
                      <div
                        className="absolute top-0 h-full w-px bg-[#facc15]"
                        style={{ left: `${Math.min(f.threshold * 100, 100)}%` }}
                        title={`positive threshold ${(f.threshold * 100).toFixed(0)}%`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ---- bone suppression: 4 decomposition images ---- */}
            {engineId === "bone-suppression" && result.engine === "bone-suppression" && (
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["soft_tissue", "Soft tissue (bone removed)"],
                    ["bone", "Bone-only"],
                    ["lung", "Lung fields"],
                    ["non_lung_soft", "Non-lung soft tissue"],
                  ] as const
                ).map(([key, label]) => (
                  <figure key={key} className="overflow-hidden rounded-xl border border-[#253548] bg-black">
                    <img
                      src={(result as BoneResult).images[key]}
                      alt={`Real model output: ${label}`}
                      className="h-36 w-full object-contain"
                    />
                    <figcaption className="bg-[#182430] px-2 py-1.5 text-[10px] text-[#8fa3b8]">
                      {label}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}

            {/* ---- mammography: probability bars ---- */}
            {engineId === "mammography" && result.engine === "mammography" && (
              <div className="space-y-2">
                {Object.entries((result as MammoResult).probabilities)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, p]) => {
                    const top = Math.max(...Object.values((result as MammoResult).probabilities));
                    const isTop = p === top;
                    return (
                      <div key={label} className="rounded-xl bg-[#182430] p-2.5">
                        <div className="flex items-center gap-2 text-[12px]">
                          <span className="capitalize text-[#c3cedb]">{label}</span>
                          <span
                            className={`ml-auto font-mono text-[14px] font-bold ${
                              isTop
                                ? label.toLowerCase().includes("malignant")
                                  ? "text-[#f87171]"
                                  : "text-[#4ade80]"
                                : "text-[#8fa3b8]"
                            }`}
                          >
                            {(p * 100).toFixed(1)}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[#0f1823]">
                          <div
                            className={`h-full rounded-full ${
                              isTop
                                ? label.toLowerCase().includes("malignant")
                                  ? "bg-[#ef4444]"
                                  : "bg-[#22c55e]"
                                : "bg-[#2dd4bf]/60"
                            }`}
                            style={{ width: `${Math.min(p * 100, 100)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                <p className="text-[10px] leading-relaxed text-[#5a6e82]">
                  Probabilities only — BI-RADS assignment stays with the radiologist (no fabricated
                  classification).
                </p>
              </div>
            )}

            <p className="text-[10px] text-[#5a6e82]">
              Ported verbatim from {result.source_ref} — same preprocessing and thresholds as the
              desktop app.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

/* Small hook so the status bar can show connection state too. */
export function useEngineOnline() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = async () => {
      const s = await fetchEngineStatus();
      if (alive) setOnline(!!s);
    };
    void check();
    const t = setInterval(check, 10000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return online;
}
