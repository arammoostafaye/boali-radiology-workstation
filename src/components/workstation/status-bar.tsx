"use client";

import { useEngineOnline } from "./real-engine-panel";

export function StatusBar() {
  const online = useEngineOnline();

  return (
    <footer
      role="contentinfo"
      className="relative flex h-9 shrink-0 items-center justify-between border-t border-[#1f2d3e] bg-[#101a26]/90 px-4 backdrop-blur-md"
    >
      <span className="hidden w-56 text-[11px] text-[#6b7f93] lg:block">
        PACS · MEDAL Bridge — <span className="text-[#4ade80]">●</span> Connected
      </span>

      <p className="pointer-events-none absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[11.5px] tracking-[0.12em] text-[#6b7f93]">
        Precision Imaging&nbsp;&nbsp;·&nbsp;&nbsp;Smarter Diagnosis&nbsp;&nbsp;·&nbsp;&nbsp;Healthier Tomorrows
      </p>

      <p className="ml-auto flex items-center gap-2 whitespace-nowrap text-right text-[11px] text-[#6b7f93]">
        <span role="status" aria-label="Engine service status">
          boali-engine :3020 —{" "}
          {online === null ? (
            <span className="text-[#facc15]">checking…</span>
          ) : online ? (
            <span className="text-[#4ade80]">● live</span>
          ) : (
            <span className="text-[#f87171]">● offline</span>
          )}
        </span>
        <span className="hidden sm:inline">
          Boali Hospital&nbsp; | &nbsp;Radiology AI Workstation v2.6.0
        </span>
      </p>
    </footer>
  );
}
