"use client";

import {
  Activity,
  Bone,
  Box,
  ChevronRight,
  Contrast,
  Droplets,
  FileText,
  Grid3x3,
  Move3d,
  Play,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
  Stethoscope,
} from "lucide-react";
import type { AiModule } from "./data";
import { reportSections, toolItems } from "./data";
import { RealEnginePanel } from "./real-engine-panel";
import { PacsPanel } from "./pacs-panel";
import type { EngineId } from "@/lib/boali-engine";

export type RightTab = "modules" | "tools" | "pacs" | "report";

const MODULE_ICONS = {
  lungs: Activity,
  bone: Bone,
  droplets: Droplets,
  cube: Box,
  stethoscope: Stethoscope,
} as const;

const TOOL_ICONS = {
  sliders: SlidersHorizontal,
  ruler: Ruler,
  move3d: Move3d,
  contrast: Contrast,
  grid: Grid3x3,
  play: Play,
} as const;

function Sparkline() {
  return (
    <svg viewBox="0 0 56 20" className="h-5 w-14" aria-hidden="true">
      <polyline
        points="1,17 9,15 17,16 25,11 33,12 41,7 49,8 55,3"
        fill="none"
        stroke="#2dd4bf"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.85"
      />
      <circle cx="55" cy="3" r="2" fill="#2dd4bf" />
    </svg>
  );
}

interface AiPanelProps {
  tab: RightTab;
  modules: AiModule[];
  activeModuleId: string;
  /** real engine to preselect in the inference panel (module-mapped) */
  activeEngineId?: EngineId;
  onEngineChange?: (id: EngineId) => void;
  onTab: (t: RightTab) => void;
  onModule: (id: string) => void;
  onGenerateReport: () => void;
}

export function AiPanel({
  tab,
  modules,
  activeModuleId,
  activeEngineId,
  onEngineChange,
  onTab,
  onModule,
  onGenerateReport,
}: AiPanelProps) {
  const activeModule =
    modules.find((m) => m.id === activeModuleId) ?? modules[1];
  const r = activeModule.result;

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* -------- real engine (FastAPI boali-engine :3020) -------- */}
      <RealEnginePanel activeEngineId={activeEngineId} onEngineChange={onEngineChange} />

      {/* -------- right panel tab bar (always visible) -------- */}
      <div
        className="flex shrink-0 rounded-full border border-[#253548] bg-[#0f1823] p-1"
        role="tablist"
        aria-label="Right panel views"
      >
        {(
          [
            ["modules", "AI Modules"],
            ["tools", "Tools"],
            ["pacs", "PACS"],
            ["report", "Report"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onTab(id)}
            className={`h-7 flex-1 rounded-full text-[11.5px] font-medium transition-all ${
              tab === id
                ? "bg-[#22354d] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-[#8fa3b8] hover:text-[#c3cedb]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "pacs" ? (
        /* PACS archive (hardened boali-pacs :3021) */
        <PacsPanel />
      ) : (
      <>
      <section
        aria-label="AI modules"
        className="rounded-2xl border border-[#253548] bg-[#141e2a] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      >
        {tab === "modules" && (
          <div className="space-y-1.5">
            {modules.map((m) => {
              const Icon = MODULE_ICONS[m.icon];
              const active = m.id === activeModuleId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onModule(m.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-all duration-200 ${
                    active
                      ? "border-[#2dd4bf]/50 bg-[#16303c] shadow-[0_0_16px_rgba(45,212,191,0.12)]"
                      : "border-transparent bg-[#182430] hover:border-[#2a3a4d] hover:bg-[#1d2b3b]"
                  }`}
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${m.iconClass}`}
                  >
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#e8eef5]">
                      {m.name}
                    </span>
                    <span className="block truncate text-[11px] leading-4 text-[#8fa3b8]">
                      {m.desc}
                    </span>
                  </span>
                  <ChevronRight
                    className={`h-4 w-4 shrink-0 transition-colors ${
                      active ? "text-[#2dd4bf]" : "text-[#5a6e82]"
                    }`}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
        )}

        {tab === "tools" && (
          <div className="space-y-1.5">
            {toolItems.map((t) => {
              const Icon = TOOL_ICONS[t.icon];
              return (
                <button
                  key={t.name}
                  type="button"
                  className="flex w-full items-center gap-3 rounded-xl bg-[#182430] p-2.5 text-left transition-colors hover:bg-[#1d2b3b]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#223046] text-[#a9bccd]">
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-semibold text-[#e8eef5]">
                      {t.name}
                    </span>
                    <span className="block truncate text-[11px] text-[#8fa3b8]">
                      {t.value}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 text-[#5a6e82]" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}

        {tab === "report" && (
          <div className="scroll-dark max-h-64 space-y-2.5 overflow-y-auto pr-1">
            {reportSections.map((s) => (
              <div key={s.title} className="rounded-xl bg-[#182430] p-3">
                <p className="mb-1 text-[12px] font-semibold text-[#7dd3fc]">
                  {s.title}
                </p>
                {s.lines.map((line, i) => (
                  <p key={i} className="text-[11.5px] leading-relaxed text-[#a9bccd]">
                    {line}
                  </p>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* -------- AI analysis results -------- */}
      <section
        aria-label="AI analysis results"
        className="rounded-2xl border border-[#253548] bg-[#141e2a] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
      >
        <div className="mb-1 flex items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold">
            <span className="text-[#22d3ee]">AI</span>
            <span className="text-[#e8eef5]"> Analysis Results</span>
          </h2>
          <span
            className="inline-flex h-6 items-center rounded-full border border-[#eab308]/30 bg-[#eab308]/10 px-2 text-[10px] font-semibold tracking-wide text-[#facc15]"
            title="These numbers are demo placeholders. Run the Real Engine panel above for live model output."
          >
            MOCK
          </span>
        </div>

        {/* module + confidence row */}
        <div className="mt-2.5 flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 shrink-0 text-[#8fa3b8]" aria-hidden="true" />
          <span className="truncate text-[12.5px] text-[#8fa3b8]">
            {r.analysisName}
          </span>
          <span
            className={`ml-auto inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium ${
              r.confidenceBadge.startsWith("High")
                ? "border-[#22c55e]/25 bg-[#22c55e]/10 text-[#4ade80]"
                : "border-[#eab308]/25 bg-[#eab308]/10 text-[#facc15]"
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                r.confidenceBadge.startsWith("High") ? "bg-[#4ade80]" : "bg-[#facc15]"
              }`}
            />
            {r.confidenceBadge}
          </span>
        </div>

        {/* finding card */}
        <button
          type="button"
          className="mt-2.5 flex w-full items-center gap-3 rounded-xl border border-[#253548] bg-[#182430] p-2.5 text-left transition-colors hover:border-[#3a5a7d]"
        >
          <span className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-[#2a3a4d]/70">
            <img
              src={r.findingThumb}
              alt={`${r.findingTitle} evidence image`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            {activeModule.id === "fracture" && (
              <svg
                viewBox="0 0 64 64"
                className="absolute inset-0 h-full w-full"
                aria-hidden="true"
              >
                <ellipse
                  cx="26"
                  cy="38"
                  rx="13"
                  ry="8.5"
                  fill="none"
                  stroke="#ef4444"
                  strokeWidth="2.4"
                />
              </svg>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13.5px] font-semibold text-[#7dd3fc]">
              {r.findingTitle}
            </span>
            <span className="block truncate text-[11px] leading-4 text-[#8fa3b8]">
              {r.findingLocation}
            </span>
            <span className="mt-0.5 block text-[11.5px] text-[#8fa3b8]">
              Confidence{" "}
              <span className="font-bold text-[#4ade80]">{r.findingConfidence}</span>
            </span>
          </span>
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#223046]">
            <ChevronRight className="h-3.5 w-3.5 text-[#8fa3b8]" aria-hidden="true" />
          </span>
        </button>

        {/* key metrics */}
        <h3 className="mt-3 text-[13px] font-semibold text-[#e8eef5]">
          Key Metrics
        </h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {r.metrics.map((m) => (
            <div
              key={m.label}
              className="relative overflow-hidden rounded-xl border border-[#253548] bg-[#182430] p-3"
            >
              <p className="flex items-center gap-1 text-[10.5px] text-[#8fa3b8]">
                <span className="truncate">{m.label}</span>
                <ChevronRight className="h-3 w-3 shrink-0 opacity-60" aria-hidden="true" />
              </p>
              <p className="mt-1 flex items-baseline gap-1.5">
                {m.valuePrefixDot && (
                  <span
                    className={`mb-1 h-2 w-2 shrink-0 self-center rounded-full ${
                      m.valuePrefixDot === "green" ? "bg-[#22c55e]" : "bg-[#ef4444]"
                    }`}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`text-[22px] font-bold leading-7 tracking-tight ${
                    m.tone === "green"
                      ? "text-[#4ade80]"
                      : m.tone === "teal"
                        ? "text-[#e8eef5]"
                        : "text-[#e8eef5]"
                  }`}
                >
                  {m.value}
                </span>
                {m.unit && (
                  <span className="text-[11px] text-[#8fa3b8]">{m.unit}</span>
                )}
              </p>
              <p className="mt-0.5 text-[10px] leading-3.5 text-[#5a6e82]">
                {m.note}
              </p>
              {m.note2 && (
                <p className="text-[10px] leading-3.5 text-[#5a6e82]">{m.note2}</p>
              )}
              {m.spark && (
                <span className="absolute bottom-2.5 right-2.5">
                  <Sparkline />
                </span>
              )}
            </div>
          ))}
        </div>

        {/* generate report */}
        <button
          type="button"
          onClick={onGenerateReport}
          className="mt-3 flex h-10 w-full items-center justify-between rounded-xl bg-gradient-to-r from-[#5470c6] to-[#3b6fa0] px-4 text-[13.5px] font-medium text-white shadow-[0_4px_14px_rgba(60,100,160,0.35)] transition-all hover:brightness-110 active:scale-[0.99]"
        >
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4" aria-hidden="true" />
            Generate AI Report
          </span>
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </section>
      </>
      )}
    </div>
  );
}
