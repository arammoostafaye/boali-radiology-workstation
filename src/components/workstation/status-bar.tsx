"use client";

import { useEngineOnline } from "./real-engine-panel";
import { useMedalBridge } from "@/lib/medal-bridge";

export function StatusBar() {
  const online = useEngineOnline();
  const { connected, info, connecting } = useMedalBridge();

  const medalLabel = connecting
    ? "PACS · MEDAL Bridge — connecting…"
    : connected
      ? `PACS · MEDAL Bridge${info?.hospitalName ? ` · ${info.hospitalName}` : ""} — ● Connected`
      : "PACS · MEDAL Bridge — ○ Disconnected";

  return (
    <footer
      role="contentinfo"
      className="relative flex h-9 shrink-0 items-center justify-between border-t border-[#1f2d3e] bg-[#101a26]/90 px-4 backdrop-blur-md"
    >
      <span
        role="status"
        aria-label="MedalPACS bridge status"
        className="hidden max-w-[280px] truncate text-[11px] text-[#6b7f93] lg:block"
      >
        {connecting ? (
          <span className="text-[#facc15]">{medalLabel}</span>
        ) : connected ? (
          <>
            PACS · MEDAL Bridge — <span className="text-[#4ade80]">●</span> Connected
          </>
        ) : (
          <>
            PACS · MEDAL Bridge — <span className="text-[#f87171]">○</span> Disconnected
          </>
        )}
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
