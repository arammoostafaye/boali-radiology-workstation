"use client";

/* ------------------------------------------------------------------ */
/*  Module Launcher — the app home screen. Six high-resolution cyber  */
/*  cards (from the user's zip upload) act as clickable entries into  */
/*  each module of the workstation. Each card shows the LIVE status   */
/*  of its real inference engine (never a fake "ready").             */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ChevronRight, FileWarning, Loader2, Play, Radio, ShieldCheck } from "lucide-react";
import {
  fetchEngineStatus,
  type EngineState,
  type EngineStatusResponse,
} from "@/lib/boali-engine";

export type LauncherModuleId = "fracture" | "bone" | "chest18" | "mammo" | "studio" | "report" | "qa";

interface LauncherCard {
  moduleId: LauncherModuleId;
  title: string;
  subtitle: string;
  image: string;
  /** engine id in boali-engine :3020 (null = not engine-driven) */
  engineId: string | null;
  accent: string;
}

const CARDS: LauncherCard[] = [
  {
    moduleId: "fracture",
    title: "Fracture Detection",
    subtitle: "YOLOv8 ONNX · orthopedic radiographs",
    image: "/cards/card_cyber_fracture.png",
    engineId: "fracture",
    accent: "#22d3ee",
  },
  {
    moduleId: "bone",
    title: "Bone Suppression",
    subtitle: "Qure TorchScript · soft-tissue reconstruction",
    image: "/cards/card_cyber_bone_suppression.png",
    engineId: "bone-suppression",
    accent: "#2dd4bf",
  },
  {
    moduleId: "chest18",
    title: "Lung Screen",
    subtitle: "DenseNet-18 · 18 chest pathologies",
    image: "/cards/card_cyber_lungs.png",
    engineId: "chest18",
    accent: "#33baf5",
  },
  {
    moduleId: "mammo",
    title: "Mammography AI",
    subtitle: "ResNet-50 · screening triage",
    image: "/cards/card_cyber_mammo.png",
    engineId: "mammography",
    accent: "#e879b9",
  },
  {
    moduleId: "studio",
    title: "3D CT Studio",
    subtitle: "VTK volume rendering · MPR / VR",
    image: "/cards/card_cyber_3d_ct.png",
    engineId: "ct3d",
    accent: "#7c9ff5",
  },
  {
    moduleId: "report",
    title: "AI Report",
    subtitle: "Structured findings · PDF export",
    image: "/cards/card_cyber_report.png",
    engineId: null,
    accent: "#facc15",
  },
  {
    moduleId: "qa",
    title: "Validation · صحت‌سنجی",
    subtitle: "Invariant self-test across all engines",
    image: "/cards/card_cyber_qa_validation.png",
    engineId: "qa",
    accent: "#4ade80",
  },
];

const STATE_CHIP: Record<string, { dot: string; text: string; label: string }> = {
  ready: { dot: "bg-[#4ade80]", text: "text-[#4ade80]", label: "engine live" },
  weights_missing: { dot: "bg-[#facc15]", text: "text-[#facc15]", label: "weights missing" },
  deps_missing: { dot: "bg-[#f87171]", text: "text-[#f87171]", label: "deps missing" },
  offline: { dot: "bg-[#f87171]", text: "text-[#f87171]", label: "service offline" },
  none: { dot: "bg-[#a9bccd]", text: "text-[#a9bccd]", label: "reports" },
  pending: { dot: "bg-[#facc15]", text: "text-[#facc15]", label: "engine wrap pending" },
};

interface ModuleLauncherProps {
  onEnterModule: (moduleId: LauncherModuleId) => void;
  onReplayIntro: () => void;
}

export function ModuleLauncher({ onEnterModule, onReplayIntro }: ModuleLauncherProps) {
  const [status, setStatus] = useState<EngineStatusResponse | null>(null);
  const [offline, setOffline] = useState(false);
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());

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

  const chipFor = useCallback(
    (engineId: string | null): { dot: string; text: string; label: string } => {
      if (!engineId) return STATE_CHIP.none;
      if (offline) return STATE_CHIP.offline;
      const e = status?.engines.find((en) => en.engine === engineId);
      if (!e) return STATE_CHIP.pending;
      return STATE_CHIP[e.status as EngineState] ?? STATE_CHIP.pending;
    },
    [offline, status]
  );

  const readyCount = status?.ready_count ?? 0;
  const totalEngines = status?.engines.length ?? 4;

  const onImgLoad = useCallback((src: string) => {
    setLoadedImages((prev) => (prev.has(src) ? prev : new Set([...prev, src])));
  }, []);

  /* cached images can finish loading before React attaches onLoad —
   * this ref callback checks `complete` synchronously at attach time. */
  const imgRef = useCallback(
    (src: string) => (el: HTMLImageElement | null) => {
      if (el && el.complete && el.naturalWidth > 0) onImgLoad(src);
    },
    [onImgLoad]
  );

  const serviceLine = useMemo(() => {
    if (offline) return "boali-engine :3020 offline";
    if (!status) return "connecting to boali-engine :3020…";
    return `boali-engine :3020 · ${readyCount}/${totalEngines} real engines live`;
  }, [offline, status, readyCount, totalEngines]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B121D]">
      {/* ---------- header ---------- */}
      <header
        className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[#1f2d3e] px-4 py-3 sm:px-6"
        role="banner"
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/30 bg-[#0f2033]">
          <svg viewBox="0 0 24 24" className="h-5.5 w-5.5 text-[#22d3ee]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
            <circle cx="12" cy="12" r="4" />
          </svg>
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-bold leading-tight tracking-wide">
            <span className="text-[#e8eef5]">BOALI </span>
            <span className="text-[#22d3ee]">RADIOLOGY SUITE</span>
          </h1>
          <p className="truncate text-[11px] text-[#8fa3b8]">
            Select a module to enter the diagnostic workstation
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2.5">
          <span
            className={`inline-flex h-7 items-center gap-2 rounded-full border px-3 text-[11px] font-medium ${
              offline
                ? "border-[#f87171]/25 bg-[#f87171]/10 text-[#f87171]"
                : "border-[#22c55e]/25 bg-[#22c55e]/10 text-[#4ade80]"
            }`}
            role="status"
          >
            {offline || !status ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Radio className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {serviceLine}
          </span>
          <button
            type="button"
            onClick={onReplayIntro}
            className="flex h-9 items-center gap-2 rounded-full border border-[#253548] bg-[#141e2a] px-3.5 text-[12px] font-medium text-[#a9bccd] transition-colors hover:border-[#2dd4bf]/40 hover:text-white active:scale-95"
            aria-label="Replay the intro splash video"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Replay Intro</span>
          </button>
        </div>
      </header>

      {/* ---------- cards grid ---------- */}
      <main
        className="scroll-dark flex-1 overflow-y-auto px-4 py-5 sm:px-6"
        role="main"
        aria-label="Module selection"
      >
        <div className="mx-auto grid max-w-[1180px] grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {CARDS.map((card, i) => {
            const chip = chipFor(card.engineId);
            const imgLoaded = loadedImages.has(card.image);
            return (
              <motion.button
                key={card.moduleId}
                type="button"
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.05 * i, ease: "easeOut" }}
                onClick={() => onEnterModule(card.moduleId)}
                aria-label={`Enter ${card.title} module`}
                className="group relative aspect-[16/11] w-full overflow-hidden rounded-2xl border border-[#253548] bg-[#0f1a29] text-left shadow-[0_8px_28px_rgba(0,0,0,0.35)] transition-all duration-300 hover:-translate-y-1 hover:border-[#3a5a7d] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#22d3ee]"
                style={{ willChange: "transform" }}
              >
                {/* full-quality cyber artwork */}
                {!imgLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center bg-[#0f1a29]">
                    <Loader2 className="h-6 w-6 animate-spin text-[#2a3a4d]" aria-hidden="true" />
                  </div>
                )}
                <img
                  ref={imgRef(card.image)}
                  src={card.image}
                  alt={`${card.title} module artwork`}
                  onLoad={() => onImgLoad(card.image)}
                  onError={() => onImgLoad(card.image)}
                  className={`absolute inset-0 h-full w-full object-cover transition-all duration-500 ${
                    imgLoaded ? "opacity-100" : "opacity-0"
                  } group-hover:scale-[1.04] group-hover:brightness-110`}
                  loading={i < 3 ? "eager" : "lazy"}
                  decoding="async"
                />

                {/* readability gradient */}
                <div className="absolute inset-0 bg-gradient-to-t from-[#050b12]/95 via-[#050b12]/25 to-transparent" />
                <div
                  className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ boxShadow: `inset 0 0 0 1.5px ${card.accent}66, 0 0 34px ${card.accent}2e` }}
                />

                {/* live engine status chip */}
                <span
                  className={`absolute right-3 top-3 inline-flex h-6.5 items-center gap-1.5 rounded-full border border-white/10 bg-black/55 px-2.5 text-[10px] font-semibold backdrop-blur-md ${chip.text}`}
                  title={
                    card.engineId
                      ? status?.engines.find((e) => e.engine === card.engineId)?.message ??
                        "Engine status from boali-engine service"
                      : "Report generator module"
                  }
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${chip.dot}`} aria-hidden="true" />
                  {chip.label}
                </span>

                {/* title block */}
                <span className="absolute inset-x-0 bottom-0 flex items-end gap-3 p-4">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[16.5px] font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                      {card.title}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-[#a9bccd]">
                      {card.subtitle}
                    </span>
                    <span className="mt-2 flex h-6 w-fit items-center gap-1.5 rounded-full bg-white/10 px-3 text-[10.5px] font-semibold tracking-wide text-white opacity-0 backdrop-blur-md transition-all duration-300 group-hover:opacity-100">
                      ENTER MODULE
                      <ChevronRight className="h-3 w-3" aria-hidden="true" />
                    </span>
                  </span>
                  {chip.label === "engine live" && (
                    <ShieldCheck
                      className="h-5 w-5 shrink-0 text-[#4ade80] drop-shadow-[0_0_6px_rgba(74,222,128,0.7)]"
                      aria-hidden="true"
                    />
                  )}
                  {chip.label === "weights missing" && (
                    <FileWarning className="h-5 w-5 shrink-0 text-[#facc15]" aria-hidden="true" />
                  )}
                </span>
              </motion.button>
            );
          })}
        </div>

        {/* honest-status footnote */}
        <p className="mx-auto mt-6 flex max-w-[1180px] items-start gap-2 text-[11px] leading-relaxed text-[#5a6e82]">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#2dd4bf]" aria-hidden="true" />
          Engine chips reflect the real state of the boali-engine inference service — a module
          only shows “engine live” when its actual model is loaded and runnable. Demo metrics
          inside the workstation are clearly marked as mock.
        </p>
      </main>

      {/* ---------- sticky footer ---------- */}
      <footer className="mt-auto shrink-0 border-t border-[#1f2d3e] bg-[#0d1520] px-4 py-2.5 sm:px-6">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[#5a6e82]">
          <span>© 2026 Boali Hospital · Radiology AI Workstation</span>
          <span className="hidden sm:inline">Research / education use — not a diagnostic device</span>
          <span className="ml-auto font-mono">v3.7.0-web · engines ported from boali-radiology-suite</span>
        </div>
      </footer>
    </div>
  );
}
