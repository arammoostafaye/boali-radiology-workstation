"use client";

import { Search, ChevronDown, PanelLeftClose, Users } from "lucide-react";
import type { Patient } from "./data";

export type PatientsTab = "Recent" | "Study" | "Starred";

interface PatientsPanelProps {
  patients: Patient[];
  selectedId: string;
  tab: PatientsTab;
  search: string;
  allLoaded: boolean;
  onSearch: (v: string) => void;
  onTab: (t: PatientsTab) => void;
  onSelect: (id: string) => void;
  onLoadMore: () => void;
  onCollapse?: () => void;
}

export function PatientsPanel({
  patients,
  selectedId,
  tab,
  search,
  allLoaded,
  onSearch,
  onTab,
  onSelect,
  onLoadMore,
  onCollapse,
}: PatientsPanelProps) {
  return (
    <section
      aria-label="Patients"
      className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#253548] bg-[#141e2a] shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
      {/* header */}
      <div className="flex items-center gap-2.5 px-3.5 pb-2 pt-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1c2c3f]">
          <Users className="h-4 w-4 text-[#60a5fa]" aria-hidden="true" />
        </div>
        <h2 className="text-[15px] font-semibold text-[#e8eef5]">Patients</h2>
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse patients panel"
          className="ml-auto rounded-md p-1 text-[#8fa3b8] transition-colors hover:bg-white/5 hover:text-white"
        >
          <PanelLeftClose className="h-4 w-4" />
        </button>
      </div>

      {/* search */}
      <div className="px-3.5 pb-2">
        <div className="flex h-9 items-center gap-2 rounded-full border border-[#253548] bg-[#0f1823] px-3 focus-within:border-[#2dd4bf]/50">
          <Search className="h-4 w-4 shrink-0 text-[#22d3ee]" aria-hidden="true" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search patients..."
            aria-label="Search patients"
            className="w-full bg-transparent text-[13px] text-[#e8eef5] placeholder-[#5a6e82] outline-none"
          />
        </div>
      </div>

      {/* segmented tabs */}
      <div className="flex gap-1.5 px-3.5 pb-2" role="tablist" aria-label="Patient lists">
        {(["Recent", "Study", "Starred"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => onTab(t)}
            className={`h-7 flex-1 rounded-full text-[11.5px] font-medium transition-all ${
              tab === t
                ? "border border-[#3a5a7d] bg-[#22354d] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-[#8fa3b8] hover:bg-white/5 hover:text-[#c3cedb]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* patient list */}
      <div className="scroll-dark min-h-0 flex-1 space-y-1.5 overflow-y-auto px-2.5 pb-2">
        {patients.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-[#5a6e82]">
            No patients found
          </p>
        )}
        {patients.map((p) => {
          const selected = p.id === selectedId;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              aria-pressed={selected}
              className={`group flex w-full items-center gap-3 rounded-xl border p-2 text-left transition-all duration-200 ${
                selected
                  ? "border-[#3a6a8f] bg-gradient-to-r from-[#1e3a52] to-[#24455f] shadow-[0_0_0_1px_rgba(58,106,143,0.4),0_4px_14px_rgba(0,0,0,0.35)]"
                  : "border-transparent bg-[#182430] hover:border-[#2a3a4d] hover:bg-[#1d2b3b]"
              }`}
            >
              <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-black ring-1 ring-[#2a3a4d]/70">
                <img
                  src={p.thumb}
                  alt={`${p.name} — ${p.studyShort} thumbnail`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-[#e8eef5]">
                  {p.name}
                </p>
                <p className="dicom mt-0.5 text-[11px] leading-4 text-[#8fa3b8]">
                  ID {p.id}
                </p>
                <p className="mt-0.5 truncate text-[11px] leading-4 text-[#8fa3b8]">
                  {p.studyShort}
                </p>
                <p className="mt-0.5 text-[10.5px] leading-4 text-[#5a6e82]">
                  {p.date}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* load more */}
      <div className="px-3.5 pb-3 pt-1">
        <button
          type="button"
          onClick={onLoadMore}
          disabled={allLoaded}
          className={`flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium transition-all ${
            allLoaded
              ? "cursor-default border border-[#253548] bg-[#141e2a] text-[#5a6e82]"
              : "bg-gradient-to-r from-[#5470c6] to-[#3b6fa0] text-white shadow-[0_4px_14px_rgba(60,100,160,0.35)] hover:brightness-110 active:scale-[0.99]"
          }`}
        >
          {allLoaded ? "All patients loaded" : "Load More"}
          {!allLoaded && <ChevronDown className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </section>
  );
}
