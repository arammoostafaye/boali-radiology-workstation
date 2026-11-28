"use client";

import { useEffect, useState } from "react";
import { BatteryFull, Home, Search, Wifi } from "lucide-react";

const MENU_ITEMS = ["File", "Edit", "View", "AI", "Tools", "Window", "Help"];

function AppleLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 384 512"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M318.7 268.6c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.7-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-92zM255.8 81.5c25.3-30.7 21.3-58.7 20-68.7-20.1 1.2-43.3 13.7-56.5 28.8-14.5 16.3-23 36.5-21.2 59.2 21.8 1.7 41.8-7.6 57.7-19.3z" />
    </svg>
  );
}

function useClock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setNow(new Date()));
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(t);
    };
  }, []);
  if (!now) return { date: "Tue Apr 22", time: "10:24 AM" };
  const date = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const time = now
    .toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    .replace(/\u202f/g, " ");
  return { date, time };
}

interface MenuBarProps {
  /** return to the module launcher (home screen) */
  onHome?: () => void;
}

export function MenuBar({ onHome }: MenuBarProps) {
  const { date, time } = useClock();

  return (
    <header
      className="relative z-30 flex h-8 shrink-0 select-none items-center gap-1 border-b border-[#1f2d3e] bg-[#18212e]/95 px-3 backdrop-blur-md"
      role="banner"
    >
      {/* left: home + app menu */}
      <div className="flex items-center gap-0.5">
        {onHome ? (
          <button
            type="button"
            onClick={onHome}
            aria-label="Back to module launcher"
            title="Back to module launcher"
            className="flex h-6 w-7 items-center justify-center rounded-md text-[#8fa3b8] transition-colors hover:bg-white/10 hover:text-white"
          >
            <Home className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <AppleLogo className="h-[15px] w-[15px] text-[#cdd8e4] transition-colors hover:text-white" />
        )}
        <span className="ml-1 cursor-default rounded px-1.5 py-0.5 text-[13px] font-semibold text-[#22d3ee] transition-colors hover:bg-white/10">
          Boali Hospital
        </span>
        {MENU_ITEMS.map((item) => (
          <button
            key={item}
            type="button"
            className="hidden cursor-default rounded px-1.5 py-0.5 text-[13px] text-[#dde6f0] transition-colors hover:bg-white/10 sm:inline-block"
          >
            {item}
          </button>
        ))}
      </div>

      {/* center: floating pill */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-[#2a3a4d]/70 bg-[#101926]/80 px-3.5 py-1 shadow-[0_2px_10px_rgba(0,0,0,0.35)] backdrop-blur-md md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-[#22d3ee] shadow-[0_0_6px_rgba(34,211,238,0.8)]" />
        <span className="text-[11.5px] font-medium tracking-wide text-[#e8eef5]">
          Boali Hospital Radiology AI Workstation
        </span>
      </div>

      {/* right: status icons, clock, user */}
      <div className="ml-auto flex items-center gap-3">
        <Wifi className="h-4 w-4 text-[#c3cedb]" aria-label="Network status" />
        <Search className="h-4 w-4 text-[#c3cedb]" aria-label="Search" />
        <BatteryFull className="h-4.5 w-4.5 text-[#c3cedb]" aria-label="Battery" />
        <span className="dicom hidden text-[12.5px] text-[#e2e9f1] sm:inline">
          {date}&nbsp;&nbsp;{time}
        </span>
        <div className="hidden items-center gap-2.5 md:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-[#3b82f6] to-[#1e40af] text-[10px] font-bold text-white shadow-[0_2px_8px_rgba(59,130,246,0.4)]">
            DR
          </div>
          <div className="leading-tight">
            <p className="text-[12.5px] font-semibold text-[#e8eef5]">
              Dr. Daniel Park
            </p>
            <p className="text-[10px] text-[#8fa3b8]">Radiologist</p>
          </div>
          <div className="h-7 w-7 overflow-hidden rounded-md ring-1 ring-[#2a3a4d]">
            <img
              src="/workstation/doctor-avatar.png"
              alt="Profile photo of Dr. Daniel Park"
              className="h-full w-full object-cover"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
