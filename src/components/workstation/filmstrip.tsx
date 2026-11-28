"use client";

import type { PlaneFilter, SeriesItem } from "./data";
import { seriesChips } from "./data";

interface FilmstripProps {
  series: SeriesItem[];
  selectedId: string;
  filter: PlaneFilter;
  onFilter: (f: PlaneFilter) => void;
  onSelect: (id: string) => void;
}

export function Filmstrip({
  series,
  selectedId,
  filter,
  onFilter,
  onSelect,
}: FilmstripProps) {
  const filtered =
    filter === "All" ? series : series.filter((s) => s.plane === filter);

  return (
    <section
      aria-label="Series thumbnails"
      className="shrink-0 rounded-2xl border border-[#253548] bg-[#141e2a] p-3 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
      {/* filter chips */}
      <div className="mb-2.5 flex flex-wrap gap-1.5" role="tablist" aria-label="Series filters">
        {seriesChips.map((c) => {
          const active = filter === c.label;
          return (
            <button
              key={c.label}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onFilter(c.label)}
              className={`h-7 rounded-full px-3 text-[11.5px] font-medium transition-all ${
                active
                  ? "border border-[#3a5a7d] bg-[#22354d] text-white"
                  : "text-[#8fa3b8] hover:bg-white/5 hover:text-[#c3cedb]"
              }`}
            >
              {c.label}{" "}
              <span className={active ? "text-[#7dd3fc]" : "text-[#5a6e82]"}>
                ({c.count})
              </span>
            </button>
          );
        })}
      </div>

      {/* thumbnails */}
      <div className="scroll-dark-x flex gap-2.5 overflow-x-auto pb-1">
        {filtered.map((s) => {
          const active = s.id === selectedId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-pressed={active}
              aria-label={`Series ${s.number} ${s.label}, ${s.resolution}`}
              className={`group shrink-0 rounded-[10px] p-[3px] text-left transition-all duration-200 ${
                active
                  ? "bg-[#0e2b33] shadow-[0_0_0_1.5px_#2dd4bf,0_0_14px_rgba(45,212,191,0.3)]"
                  : "hover:bg-[#1a2939]"
              }`}
            >
              <div
                className={`overflow-hidden rounded-lg bg-black ring-1 ${
                  active ? "ring-[#2dd4bf]/60" : "ring-[#2a3a4d]/60 group-hover:ring-[#3a5a7d]"
                } ${active ? "h-[88px] w-[126px]" : "h-[80px] w-[114px]"} transition-all duration-200`}
              >
                <img
                  src={s.image}
                  alt={`${s.plane} ${s.label} preview`}
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="mt-1.5 px-1 pb-0.5">
                <p className="text-[11px] leading-4">
                  <span className="font-semibold text-[#e8eef5]">{s.number}</span>
                  <span className="ml-1.5 text-[#8fa3b8]">{s.label}</span>
                </p>
                <p className="text-[10px] leading-3.5 text-[#5a6e82]">
                  {s.resolution}
                </p>
              </div>
            </button>
          );
        })}
        {filtered.length === 0 && (
          <p className="py-6 text-xs text-[#5a6e82]">
            No {filter} series for this patient.
          </p>
        )}
      </div>
    </section>
  );
}
