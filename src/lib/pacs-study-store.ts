"use client";

/* ------------------------------------------------------------------ */
/*  PACS study hand-off store — passes a study downloaded through the  */
/*  MedalPACS bridge (right panel) into its DEDICATED module room,     */
/*  exactly like the radiologist's workflow:                           */
/*                                                                    */
/*    MG (mاموگرافی)  → Mammography AI module (ResNet-50 verdict)     */
/*    CT             → 3D CT Studio (MPR + volume rendering)          */
/*    DX / CR        → Fracture Detection (YOLO ONNX) — and freely    */
/*                     switchable to Bone Suppression / Lung Screen   */
/*                                                                    */
/*  The DICOM bytes stay in the bridge cache; the module fetches      */
/*  them through /api/medal/dicom (sid + pid + file name).            */
/* ------------------------------------------------------------------ */

import { create } from "zustand";
import type { LauncherModuleId } from "@/components/workstation/module-launcher";

export interface PacsStudyFile {
  name: string;
  size: number;
}

export interface PacsPendingStudy {
  sid: string;
  pid: string;
  pname: string | null;
  modality: string;
  studyKey: string;
  hashKey: string;
  files: PacsStudyFile[];
  /** monotonic trigger — opening the same study again re-fires it */
  openAt: number;
}

interface PacsStudyState {
  pending: PacsPendingStudy | null;
  setPending: (s: Omit<PacsPendingStudy, "openAt">) => void;
  clear: () => void;
}

export const usePacsStudy = create<PacsStudyState>((set) => ({
  pending: null,
  setPending: (s) => set({ pending: { ...s, openAt: Date.now() } }),
  clear: () => set({ pending: null }),
}));

/** PACS modality → the dedicated module room for that study */
export function modalityToModule(modality: string): LauncherModuleId {
  switch ((modality || "").toUpperCase()) {
    case "MG":
      return "mammo";
    case "CT":
    case "MR":
      return "studio";
    /* DX / CR / XR and anything else → the radiography room */
    default:
      return "fracture";
  }
}

export function moduleLabelFa(id: LauncherModuleId): string {
  switch (id) {
    case "mammo":
      return "ماژول ماموگرافی";
    case "studio":
      return "استودیوی سه‌بعدی CT";
    case "bone":
      return "ماژول تضعیف استخوان";
    case "chest18":
      return "ماژول غربالگری ریوی";
    default:
      return "ماژول تشخیص شکستگی";
  }
}

/** Fetch one cached DICOM from the bridge as a File object. */
export async function fetchPacsDicomFile(
  sid: string,
  pid: string,
  name: string
): Promise<File | null> {
  try {
    const res = await fetch(
      `/api/medal/dicom?sid=${encodeURIComponent(sid)}&pid=${encodeURIComponent(pid)}&name=${encodeURIComponent(name)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return null;
    const blob = await res.blob();
    const base = name.split("/").pop() ?? name;
    return new File([blob], base, { type: "application/dicom" });
  } catch {
    return null;
  }
}
