"use client";

/* ------------------------------------------------------------------ */
/*  Workstation root — the Boali Radiology Suite shell.                */
/*                                                                    */
/*  Two REAL stages only (the old fake demo environment with mock     */
/*  patients / mock 3D viewer was removed at the user's request):      */
/*                                                                    */
/*    launcher — module cards + the PACS login card (8th card)        */
/*    module   — the dedicated per-module environment                 */
/*                                                                    */
/*  A study downloaded through the MedalPACS bridge (from the home    */
/*  drawer or the in-module PACS panel) opens here in its dedicated   */
/*  module room, routed by the modality detected from the actual      */
/*  DICOM headers.                                                    */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";
import { ModuleLauncher, type LauncherModuleId } from "./module-launcher";
import { ModuleWorkspace } from "./module-workspace";
import { PacsLoginDrawer } from "./pacs-login-drawer";
import { SplashScreen, hasSplashBeenSeen } from "./splash-screen";
import type { EngineId, EngineResult } from "@/lib/boali-engine";
import { modalityToModule, usePacsStudy } from "@/lib/pacs-study-store";

type Stage = "launcher" | "module";

export function Workstation() {
  /* ---------------- app shell state ---------------- */
  const [stage, setStage] = useState<Stage>("launcher");
  const [showSplash, setShowSplash] = useState(false);
  const [splashReplay, setSplashReplay] = useState(false);
  /* the dedicated module environment the user entered from a card */
  const [launcherModule, setLauncherModule] = useState<LauncherModuleId | null>(null);
  /* home-screen PACS login drawer */
  const [pacsDrawerOpen, setPacsDrawerOpen] = useState(false);
  /* real engine results collected this session (feeds the AI Report desk) */
  const [engineResults, setEngineResults] = useState<Partial<Record<EngineId, EngineResult>>>({});

  /* -------- splash: play once per browser session on app load --------
   * deferred via timeout(0) so hydration completes before the overlay
   * mounts and no setState runs synchronously inside the effect body. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasSplashBeenSeen()) setShowSplash(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const onLauncherModule = useCallback((m: LauncherModuleId) => {
    setLauncherModule(m);
    setStage("module");
  }, []);

  /* -------- PACS study hand-off: a study downloaded through the
   * MedalPACS bridge opens in its DEDICATED module room --------
   * deferred via timeout(0) so no setState runs synchronously
   * inside the effect body (same pattern as the splash overlay). */
  const pacsPending = usePacsStudy((s) => s.pending);
  const pacsOpenAt = pacsPending?.openAt;
  useEffect(() => {
    if (!pacsOpenAt) return;
    const t = setTimeout(() => {
      if (!pacsPending) return;
      setLauncherModule(modalityToModule(pacsPending.modality));
      setStage("module");
    }, 0);
    return () => clearTimeout(t);
  }, [pacsOpenAt, pacsPending]);

  /* collect real engine outputs for the report desk */
  const onEngineResult = useCallback((engineId: EngineId, result: EngineResult) => {
    setEngineResults((prev) => ({ ...prev, [engineId]: result }));
  }, []);

  /* ---------------- render ---------------- */

  /* -------- launcher stage (home screen with cyber cards) -------- */
  if (stage === "launcher" || !launcherModule) {
    return (
      <>
        <ModuleLauncher
          onEnterModule={onLauncherModule}
          onOpenPacs={() => setPacsDrawerOpen(true)}
          onReplayIntro={() => {
            setSplashReplay(true);
            setShowSplash(true);
          }}
        />
        <PacsLoginDrawer open={pacsDrawerOpen} onClose={() => setPacsDrawerOpen(false)} />
        {showSplash && (
          <SplashScreen
            replay={splashReplay}
            onDone={() => {
              setShowSplash(false);
              setSplashReplay(false);
            }}
          />
        )}
      </>
    );
  }

  /* -------- dedicated module environment stage -------- */
  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B121D]">
      <ModuleWorkspace
        moduleId={launcherModule}
        onBack={() => setStage("launcher")}
        onSwitchModule={(m) => setLauncherModule(m)}
        onResult={onEngineResult}
        results={engineResults}
        pacsStudy={pacsPending}
      />
    </div>
  );
}
