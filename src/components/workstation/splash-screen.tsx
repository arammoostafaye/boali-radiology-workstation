"use client";

/* ------------------------------------------------------------------ */
/*  Splash Screen — plays the official Boali intro video (from the    */
/*  user's zip upload) full-screen while the app boots.               */
/*  - muted autoplay (browser policy), unmute toggle available        */
/*  - skippable: button, click anywhere, or Escape                    */
/*  - plays once per browser session (sessionStorage gate)           */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Volume2, VolumeX } from "lucide-react";

const SPLASH_SRC = "/splash/boali-splash.mp4";
const SEEN_KEY = "boali_splash_seen_v1";

export function markSplashSeen() {
  try {
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* storage unavailable — ignore */
  }
}

export function hasSplashBeenSeen(): boolean {
  try {
    return sessionStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

interface SplashScreenProps {
  /** force replay (ignores the once-per-session gate) */
  replay?: boolean;
  onDone: () => void;
}

export function SplashScreen({ replay = false, onDone }: SplashScreenProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [progress, setProgress] = useState(0);
  const [leaving, setLeaving] = useState(false);

  /* fade-out then notify parent */
  const finish = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    markSplashSeen();
    setTimeout(() => onDone(), 480);
  }, [leaving, onDone]);

  /* keyboard: Escape / Space skips */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  /* safety: if the video cannot load/play, auto-dismiss after 6 s */
  useEffect(() => {
    const t = setTimeout(() => {
      const v = videoRef.current;
      if (!v || v.readyState < 2) finish();
    }, 6000);
    return () => clearTimeout(t);
  }, [finish]);

  return (
    <AnimatePresence>
      <motion.div
        key="splash"
        className="fixed inset-0 z-[100] bg-black"
        initial={{ opacity: 1 }}
        animate={{ opacity: leaving ? 0 : 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.45, ease: "easeInOut" }}
        onClick={finish}
        role="dialog"
        aria-label="Boali intro splash video — click to skip"
      >
        {/* video (fills screen, keeps 16:9) */}
        <video
          ref={videoRef}
          src={SPLASH_SRC}
          autoPlay
          muted={muted}
          playsInline
          preload="auto"
          onTimeUpdate={(e) => {
            const v = e.currentTarget;
            if (v.duration) setProgress(v.currentTime / v.duration);
          }}
          onEnded={finish}
          onError={finish}
          className="absolute inset-0 h-full w-full object-cover"
        >
          <track kind="captions" />
        </video>

        {/* subtle vignette so controls stay readable */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.55) 100%)",
          }}
        />

        {/* top-left brand */}
        <div className="absolute left-4 top-4 flex items-center gap-2.5 sm:left-6 sm:top-6">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/30 bg-[#0b1929]/70 backdrop-blur-md">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#22d3ee]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" strokeLinecap="round" />
              <circle cx="12" cy="12" r="4" />
            </svg>
          </span>
          <div className="leading-tight">
            <p className="text-[15px] font-bold tracking-wide text-white">
              BOALI <span className="text-[#22d3ee]">RADIOLOGY SUITE</span>
            </p>
            <p className="text-[10.5px] text-[#8fa3b8]">
              Diagnostic imaging platform · loading modules
            </p>
          </div>
        </div>

        {/* skip + sound controls */}
        <div className="absolute right-4 top-4 flex items-center gap-2 sm:right-6 sm:top-6">
          <button
            type="button"
            aria-label={muted ? "Unmute intro video" : "Mute intro video"}
            onClick={(e) => {
              e.stopPropagation();
              setMuted((m) => !m);
            }}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white/85 backdrop-blur-md transition-colors hover:bg-black/65"
          >
            {muted ? (
              <VolumeX className="h-4.5 w-4.5" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4.5 w-4.5" aria-hidden="true" />
            )}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              finish();
            }}
            className="flex h-10 items-center gap-2 rounded-full border border-cyan-400/25 bg-[#0b1929]/70 px-4 text-[12.5px] font-semibold text-[#7ee7f3] backdrop-blur-md transition-all hover:border-cyan-400/50 hover:bg-[#0e2a3f]/80 active:scale-95"
          >
            Skip Intro
            <span className="hidden text-[10px] text-[#5a86a0] sm:inline">Esc</span>
          </button>
        </div>

        {/* bottom progress bar */}
        <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/10">
          <div
            className="h-full bg-gradient-to-r from-[#22d3ee] to-[#2dd4bf] transition-[width] duration-200 ease-linear"
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
        <p className="absolute bottom-4 left-1/2 -translate-x-1/2 text-[10.5px] tracking-[0.2em] text-white/40 uppercase">
          {replay ? "intro replay" : "initializing workstation"} · click anywhere to skip
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
