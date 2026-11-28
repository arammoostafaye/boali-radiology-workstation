"use client";

import { FileDown, Printer, ShieldCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { AiModule, Patient } from "./data";
import { EngineReportView } from "./engine-report-view";
import type { EngineId, EngineResult } from "@/lib/boali-engine";

interface ReportDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  patient: Patient;
  module: AiModule;
  /** real engine results collected this session (overrides demo content) */
  results?: Partial<Record<EngineId, EngineResult>>;
  /** engine id matching the active module, when known */
  engineId?: EngineId;
}

export function ReportDialog({
  open,
  onOpenChange,
  patient,
  module,
  results,
  engineId,
}: ReportDialogProps) {
  const real = engineId ? results?.[engineId] : undefined;
  const report = real && "report" in real ? real.report : undefined;
  const accent = "#2dd4bf";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="scroll-dark max-h-[85vh] max-w-lg overflow-y-auto border-[#253548] bg-[#141e2a] text-[#e8eef5]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="text-[#22d3ee]">AI</span> Radiology Report — Draft
          </DialogTitle>
          <DialogDescription className="text-[#8fa3b8]">
            {patient.name} · ID {patient.id} · {patient.studyFull} · {patient.date}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl border border-[#253548] bg-[#182430] p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#7dd3fc]">
              Engine: {module.name}
            </p>
            <p className="mt-1 text-[12px] text-[#a9bccd]">
              {real
                ? `${real.model_file} · ${real.elapsed_ms} ms · computed live this session`
                : `${module.result.analysisName} · Confidence ${module.result.findingConfidence} (demo content — run the engine for a real report)`}
            </p>
          </div>

          {report ? (
            <EngineReportView report={report} accent={accent} compact />
          ) : (
            <div className="rounded-xl border border-[#facc15]/30 bg-[#facc15]/5 p-3">
              <p className="flex items-start gap-2 text-[11.5px] leading-relaxed text-[#e3c76a]">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                No real engine result recorded for this module yet. Open the module room
                (launcher card), run an analysis on a sample or your own study — the detailed
                bilingual report (findings, impression, recommendation, limitations) is then
                generated from the actual model output.
              </p>
            </div>
          )}

          <div className="rounded-xl border border-[#eab308]/30 bg-[#eab308]/5 p-3">
            <p className="text-[11px] leading-relaxed text-[#eab308]">
              ⚠ AI-generated draft. A licensed radiologist must review, edit and
              sign this report before it is released to the patient record.
            </p>
          </div>

          <div className="flex items-center justify-between border-t border-[#253548] pt-3">
            <div>
              <p className="text-[12px] font-semibold text-[#e8eef5]">
                Dr. Daniel Park — Radiologist
              </p>
              <p className="text-[10.5px] text-[#5a6e82]">
                Boali Hospital, Department of Radiology
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-[#223046] px-3 text-[12px] text-[#c3cedb] transition-colors hover:bg-[#2a3a52]"
              >
                <Printer className="h-3.5 w-3.5" aria-hidden="true" />
                Print
              </button>
              <button
                type="button"
                className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#5470c6] to-[#3b6fa0] px-3 text-[12px] font-medium text-white transition-all hover:brightness-110"
              >
                <FileDown className="h-3.5 w-3.5" aria-hidden="true" />
                Export PDF
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
