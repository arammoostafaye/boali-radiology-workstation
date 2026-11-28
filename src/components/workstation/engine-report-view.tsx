"use client";

/* ------------------------------------------------------------------ */
/*  EngineReportView — renders the detailed bilingual (en/fa)          */
/*  structured report produced by every boali engine.                  */
/*  Language toggle: FA / EN / Both. Nothing here is mocked — the      */
/*  sections come straight from the real inference response.           */
/* ------------------------------------------------------------------ */

import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, Languages } from "lucide-react";
import type { EngineReport } from "@/lib/boali-engine";

type Lang = "fa" | "en" | "both";

interface EngineReportViewProps {
  report: EngineReport;
  accent?: string;
  defaultLang?: Lang;
  /** compact = tighter spacing for side panels */
  compact?: boolean;
}

export function EngineReportView({
  report,
  accent = "#2dd4bf",
  defaultLang = "both",
  compact = false,
}: EngineReportViewProps) {
  const [lang, setLang] = useState<Lang>(defaultLang);

  if (!report || !report.sections || report.sections.length === 0) return null;

  return (
    <div className={compact ? "space-y-2" : "space-y-2.5"} aria-live="polite">
      {/* header + language toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <p
          className="flex items-center gap-1.5 text-[11px] font-bold tracking-widest"
          style={{ color: accent }}
        >
          <FileText className="h-3.5 w-3.5" aria-hidden="true" />
          AI REPORT · گزارش هوش مصنوعی
        </p>
        <div
          className="ml-auto flex items-center gap-0.5 rounded-full border border-[#253548] bg-[#141e2a] p-0.5"
          role="group"
          aria-label="Report language"
        >
          <Languages className="mx-1 h-3 w-3 text-[#5a6e82]" aria-hidden="true" />
          {(["fa", "en", "both"] as Lang[]).map((l) => (
            <button
              key={l}
              type="button"
              onClick={() => setLang(l)}
              aria-pressed={lang === l}
              className={`h-6 rounded-full px-2.5 text-[10px] font-semibold transition-colors ${
                lang === l
                  ? "bg-[#223046] text-[#e8eef5]"
                  : "text-[#8fa3b8] hover:text-white"
              }`}
            >
              {l === "fa" ? "فارسی" : l === "en" ? "EN" : "Both"}
            </button>
          ))}
        </div>
      </div>

      {/* verdict banner (mammo) */}
      {report.verdict_en && (
        <div
          className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border p-2.5"
          style={{
            borderColor: `${report.verdict_color ?? accent}40`,
            background: `${report.verdict_color ?? accent}0f`,
          }}
        >
          <span
            className="text-[13px] font-bold"
            style={{ color: report.verdict_color ?? accent }}
          >
            {lang !== "en" && report.verdict_fa ? report.verdict_fa : report.verdict_en}
          </span>
          {lang === "both" && (
            <span className="text-[10.5px] text-[#8fa3b8]">{report.verdict_en}</span>
          )}
          {report.generated_at && (
            <span className="ml-auto font-mono text-[9.5px] text-[#5a6e82]">
              {report.generated_at}
            </span>
          )}
        </div>
      )}

      {/* sections */}
      <div className={compact ? "scroll-dark max-h-[420px] space-y-1.5 overflow-y-auto pr-1" : "scroll-dark max-h-[540px] space-y-2 overflow-y-auto pr-1"}>
        {report.sections.map((s, i) => (
          <motion.section
            key={s.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: Math.min(i * 0.04, 0.3) }}
            className="rounded-xl border border-[#253548] bg-[#182430] p-2.5"
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-[11.5px] font-bold text-[#e8eef5]">
                {s.title_en}
              </span>
              <span className="text-[11px] font-semibold text-[#8fa3b8]" dir="rtl" lang="fa">
                {s.title_fa}
              </span>
            </p>
            {lang !== "en" && (
              <p
                className="mt-1.5 text-[12px] leading-[1.9] text-[#c3cedb]"
                dir="rtl"
                lang="fa"
              >
                {s.body_fa}
              </p>
            )}
            {lang !== "fa" && (
              <p
                className={`text-[11px] leading-relaxed text-[#8fa3b8] ${
                  lang === "both" ? "mt-1.5 border-t border-[#223046]/70 pt-1.5" : "mt-1.5 text-[#c3cedb]"
                }`}
              >
                {s.body_en}
              </p>
            )}
          </motion.section>
        ))}
      </div>

      {/* disclaimer */}
      {(report.disclaimer_fa || report.disclaimer_en) && (
        <p className="rounded-xl border border-[#eab308]/25 bg-[#eab308]/5 px-2.5 py-1.5 text-[9.5px] leading-relaxed text-[#e3c76a]">
          ⚠ {lang !== "en" && report.disclaimer_fa
            ? report.disclaimer_fa
            : report.disclaimer_en}
        </p>
      )}
    </div>
  );
}
