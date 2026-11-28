"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Home, PanelLeft, PanelLeftOpen, PanelRight } from "lucide-react";
import { MenuBar } from "./menu-bar";
import { PatientsPanel, type PatientsTab } from "./patients-panel";
import { BrandingCard } from "./branding-card";
import { Viewer, type ToolId } from "./viewer";
import { Filmstrip } from "./filmstrip";
import { AiPanel, type RightTab } from "./ai-panel";
import { StatusBar } from "./status-bar";
import { ReportDialog } from "./report-dialog";
import {
  aiModules,
  DEFAULT_MODULE_ID,
  DEFAULT_PATIENT_ID,
  morePatients,
  patients as basePatients,
  seriesByPatient,
  type PlaneFilter,
} from "./data";
import { ModuleLauncher, type LauncherModuleId } from "./module-launcher";
import { ModuleWorkspace } from "./module-workspace";
import { SplashScreen, hasSplashBeenSeen } from "./splash-screen";
import type { EngineId, EngineResult } from "@/lib/boali-engine";
import {
  modalityToModule,
  usePacsStudy,
} from "@/lib/pacs-study-store";

type Stage = "launcher" | "module" | "workstation";

/** workstation module id -> real inference engine */
const ENGINE_BY_MODULE: Partial<Record<string, EngineId>> = {
  fracture: "fracture",
  bone: "bone-suppression",
  chest18: "chest18",
  mammo: "mammography",
  studio: "ct3d",
};

export function Workstation() {
  /* ---------------- app shell state ---------------- */
  const [stage, setStage] = useState<Stage>("launcher");
  const [showSplash, setShowSplash] = useState(false);
  const [splashReplay, setSplashReplay] = useState(false);
  /* the dedicated module environment the user entered from a card */
  const [launcherModule, setLauncherModule] = useState<LauncherModuleId | null>(null);
  /* real engine results collected this session (feeds the AI Report desk) */
  const [engineResults, setEngineResults] = useState<Partial<Record<EngineId, EngineResult>>>({});

  /* ---------------- state ---------------- */
  const [patientList, setPatientList] = useState(basePatients);
  const [allLoaded, setAllLoaded] = useState(false);
  const [selectedPatientId, setSelectedPatientId] = useState(DEFAULT_PATIENT_ID);
  const [patientsTab, setPatientsTab] = useState<PatientsTab>("Recent");
  const [search, setSearch] = useState("");

  const [seriesFilter, setSeriesFilter] = useState<PlaneFilter>("All");
  const [selectedSeriesId, setSelectedSeriesId] = useState("s5");

  const [rightTab, setRightTab] = useState<RightTab>("modules");
  const [activeModuleId, setActiveModuleId] = useState(DEFAULT_MODULE_ID);
  const [activeEngineId, setActiveEngineId] = useState<EngineId | undefined>(
    ENGINE_BY_MODULE[DEFAULT_MODULE_ID]
  );
  const [activeTool, setActiveTool] = useState<ToolId>("cursor");
  const [zoom, setZoom] = useState(1);

  const [reportOpen, setReportOpen] = useState(false);
  const [leftVisible, setLeftVisible] = useState(true);
  const [leftDrawer, setLeftDrawer] = useState(false);
  const [rightDrawer, setRightDrawer] = useState(false);

  /* ---------------- derived ---------------- */
  const patient = useMemo(
    () => patientList.find((p) => p.id === selectedPatientId) ?? basePatients[0],
    [patientList, selectedPatientId]
  );

  const patientSeries = seriesByPatient[patient.id] ?? [];
  const selectedSeries = useMemo(
    () =>
      patientSeries.find((s) => s.id === selectedSeriesId) ??
      patientSeries[patientSeries.length - 1] ??
      seriesByPatient[DEFAULT_PATIENT_ID][4],
    [patientSeries, selectedSeriesId]
  );

  const visiblePatients = useMemo(() => {
    let list = patientList;
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.id.includes(q) ||
          p.studyShort.toLowerCase().includes(q)
      );
    }
    if (patientsTab === "Starred") list = list.filter((p) => p.starred);
    if (patientsTab === "Study") {
      list = [...list].sort((a, b) => a.studyShort.localeCompare(b.studyShort));
    }
    return list;
  }, [patientList, search, patientsTab]);

  const activeModule = aiModules.find((m) => m.id === activeModuleId) ?? aiModules[1];

  /* keep engine in sync when the module changes via the module list */
  const onModuleSelect = useCallback(
    (id: string) => {
      setActiveModuleId(id);
      const engine = ENGINE_BY_MODULE[id];
      if (engine) setActiveEngineId(engine);
    },
    []
  );

  /* -------- splash: play once per browser session on app load --------
   * deferred via timeout(0) so hydration completes before the overlay
   * mounts and no setState runs synchronously inside the effect body. */
  useEffect(() => {
    const t = setTimeout(() => {
      if (!hasSplashBeenSeen()) setShowSplash(true);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const enterModule = useCallback(
    (moduleId: string, engineId?: EngineId, openReport = false) => {
      setStage("workstation");
      setActiveModuleId(moduleId);
      setActiveEngineId(engineId);
      setRightTab("modules");
      if (openReport) {
        /* small delay so the workstation mounts before the dialog opens */
        setTimeout(() => setReportOpen(true), 150);
      }
    },
    []
  );

  /* card click → DEDICATED per-module environment (unique room per card) */
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

  /* ---------------- handlers ---------------- */
  const selectPatient = useCallback(
    (id: string) => {
      setSelectedPatientId(id);
      const series = seriesByPatient[id] ?? [];
      const prefer3d = series.find((s) => s.plane === "3D") ?? series[0];
      setSelectedSeriesId(prefer3d ? prefer3d.id : "s5");
      setZoom(1);
      setSeriesFilter("All");
    },
    []
  );

  const selectFilter = useCallback(
    (f: PlaneFilter) => {
      setSeriesFilter(f);
      const inFilter =
        f === "All" ? true : patientSeries.some((s) => s.plane === f && s.id === selectedSeriesId);
      if (!inFilter) {
        const first =
          f === "All"
            ? patientSeries[0]
            : patientSeries.find((s) => s.plane === f);
        if (first) setSelectedSeriesId(first.id);
      }
    },
    [patientSeries, selectedSeriesId]
  );

  const loadMore = useCallback(() => {
    setPatientList((prev) => [...prev, ...morePatients]);
    setAllLoaded(true);
  }, []);

  /* ---------------- render ---------------- */

  /* -------- launcher stage (home screen with cyber cards) -------- */
  if (stage === "launcher") {
    return (
      <>
        <ModuleLauncher
          onEnterModule={onLauncherModule}
          onReplayIntro={() => {
            setSplashReplay(true);
            setShowSplash(true);
          }}
        />
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
  if (stage === "module" && launcherModule) {
    const workstationModule =
      launcherModule === "report" ? "fracture" : launcherModule;
    return (
      <>
        <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B121D]">
          <ModuleWorkspace
            moduleId={launcherModule}
            onBack={() => setStage("launcher")}
            onSwitchModule={(m) => setLauncherModule(m)}
            onOpenWorkstation={() => {
              enterModule(workstationModule, ENGINE_BY_MODULE[workstationModule]);
            }}
            onResult={onEngineResult}
            results={engineResults}
            pacsStudy={pacsPending}
          />
        </div>
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

  /* -------- workstation stage (classic multi-panel demo) -------- */
  const patientsPanel = (
    <PatientsPanel
      patients={visiblePatients}
      selectedId={selectedPatientId}
      tab={patientsTab}
      search={search}
      allLoaded={allLoaded}
      onSearch={setSearch}
      onTab={setPatientsTab}
      onSelect={selectPatient}
      onLoadMore={loadMore}
      onCollapse={() => {
        setLeftVisible(false);
        setLeftDrawer(false);
      }}
    />
  );

  const brandingCard = <BrandingCard />;

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-[#0B121D]">
      <MenuBar onHome={() => setStage("launcher")} />

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* ---------- left sidebar (desktop) ---------- */}
        {leftVisible && (
          <motion.aside
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="hidden w-[290px] shrink-0 flex-col gap-3 min-h-0 lg:flex"
            aria-label="Patients sidebar"
          >
            {patientsPanel}
            {brandingCard}
          </motion.aside>
        )}
        {!leftVisible && (
          <button
            type="button"
            aria-label="Show patients panel"
            onClick={() => setLeftVisible(true)}
            className="hidden h-10 w-10 shrink-0 self-start rounded-xl border border-[#253548] bg-[#141e2a] text-[#8fa3b8] transition-colors hover:text-white lg:flex lg:items-center lg:justify-center"
          >
            <PanelLeftOpen className="h-4.5 w-4.5" />
          </button>
        )}

        {/* ---------- center column ---------- */}
        <motion.main
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.05 }}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
        >
          {/* mobile panel toggles */}
          <div className="flex items-center justify-between gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => setLeftDrawer(true)}
              aria-label="Open patients panel"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#253548] bg-[#141e2a] text-[#8fa3b8] active:scale-95"
            >
              <PanelLeft className="h-4 w-4" />
            </button>
            <p className="truncate text-[12px] font-medium text-[#8fa3b8]">
              {patient.name} · {patient.studyShort}
            </p>
            <button
              type="button"
              onClick={() => setRightDrawer(true)}
              aria-label="Open AI panel"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#253548] bg-[#141e2a] text-[#8fa3b8] active:scale-95"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          </div>

          <Viewer
            key={`${patient.id}-${selectedSeries.id}`}
            patient={patient}
            series={selectedSeries}
            zoom={zoom}
            activeTool={activeTool}
            onZoom={setZoom}
            onTool={setActiveTool}
          />

          <Filmstrip
            series={patientSeries}
            selectedId={selectedSeries.id}
            filter={seriesFilter}
            onFilter={selectFilter}
            onSelect={(id) => {
              setSelectedSeriesId(id);
              setZoom(1);
            }}
          />
        </motion.main>

        {/* ---------- right sidebar (desktop) ---------- */}
        <motion.aside
          initial={{ opacity: 0, x: 14 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.35, ease: "easeOut", delay: 0.1 }}
          className="scroll-dark hidden w-[400px] shrink-0 overflow-y-auto pr-0.5 xl:block"
          aria-label="AI analysis sidebar"
        >
          <AiPanel
            tab={rightTab}
            modules={aiModules}
            activeModuleId={activeModuleId}
            activeEngineId={activeEngineId}
            onEngineChange={setActiveEngineId}
            onTab={setRightTab}
            onModule={onModuleSelect}
            onGenerateReport={() => setReportOpen(true)}
          />
        </motion.aside>
      </div>

      <StatusBar />

      {/* ---------- mobile drawers ---------- */}
      <AnimatePresence>
        {leftDrawer && (
          <>
            <motion.div
              key="left-backdrop"
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLeftDrawer(false)}
            />
            <motion.aside
              key="left-drawer"
              className="fixed left-0 top-0 z-50 flex h-full w-[300px] max-w-[85vw] flex-col gap-3 bg-[#0B121D] p-3"
              initial={{ x: -320 }}
              animate={{ x: 0 }}
              exit={{ x: -320 }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              aria-label="Patients sidebar (mobile)"
            >
              {patientsPanel}
              {brandingCard}
            </motion.aside>
          </>
        )}
        {rightDrawer && (
          <>
            <motion.div
              key="right-backdrop"
              className="fixed inset-0 z-40 bg-black/55 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setRightDrawer(false)}
            />
            <motion.aside
              key="right-drawer"
              className="scroll-dark fixed right-0 top-0 z-50 h-full w-[410px] max-w-[92vw] overflow-y-auto bg-[#0B121D] p-3"
              initial={{ x: 440 }}
              animate={{ x: 0 }}
              exit={{ x: 440 }}
              transition={{ type: "tween", duration: 0.25, ease: "easeOut" }}
              aria-label="AI panel (mobile)"
            >
              <AiPanel
                tab={rightTab}
                modules={aiModules}
                activeModuleId={activeModuleId}
                activeEngineId={activeEngineId}
                onEngineChange={setActiveEngineId}
                onTab={setRightTab}
                onModule={onModuleSelect}
                onGenerateReport={() => {
                  setRightDrawer(false);
                  setReportOpen(true);
                }}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        patient={patient}
        module={activeModule}
      />
    </div>
  );
}
