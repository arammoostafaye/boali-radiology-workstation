/* ------------------------------------------------------------------ */
/*  boali-engine API client — talks to the FastAPI mini-service        */
/*  (mini-services/boali-engine, port 3020) through the gateway.       */
/*  All requests are relative + XTransformPort (gateway contract).     */
/* ------------------------------------------------------------------ */

"use client";

export const ENGINE_PORT = 3020;

export type EngineState = "ready" | "weights_missing" | "deps_missing";

export interface EngineStatus {
  engine: string;
  name: string;
  status: EngineState;
  framework: string;
  model_file: string | null;
  weight_path: string | null;
  source_ref: string;
  message: string;
}

export interface EngineStatusResponse {
  service: string;
  uptime_sec: number;
  python: string;
  engines: EngineStatus[];
  ready_count: number;
  note: string;
}

export interface FractureFinding {
  box: [number, number, number, number];
  conf: number;
  label: string;
}

export interface FractureResult {
  engine: string;
  model_file: string;
  elapsed_ms: number;
  source_size: [number, number];
  conf_threshold: number;
  findings: FractureFinding[];
  findings_count: number;
  annotated_image: string;
  source_ref: string;
  meta?: Record<string, unknown>;
}

/* -------- chest18 (DenseNet 18 pathologies) -------- */
export interface Chest18Finding {
  /** Persian label (verbatim from the desktop app) */
  fa: string;
  /** English label */
  en: string;
  /** calibrated operating-threshold score (0..1) */
  score: number;
  /** raw sigmoid probability */
  raw_prob: number;
  threshold: number;
  is_positive: boolean;
}
export interface Chest18Result {
  engine: string;
  model_file: string;
  elapsed_ms: number;
  source_size: [number, number];
  findings: Chest18Finding[];
  findings_count: number;
  source_ref: string;
  meta?: Record<string, unknown>;
}

/* -------- bone suppression (4 decompositions) -------- */
export interface BoneResult {
  engine: string;
  model_file: string;
  elapsed_ms: number;
  source_size: [number, number];
  findings: never[];
  findings_count: 0;
  images: {
    soft_tissue: string;
    bone: string;
    lung: string;
    non_lung_soft: string;
  };
  source_ref: string;
  meta?: Record<string, unknown>;
}

/* -------- mammography (benign / malignant / normal) -------- */
export interface MammoResult {
  engine: string;
  model_file: string;
  elapsed_ms: number;
  source_size: [number, number];
  probabilities: Record<string, number>;
  findings: never[];
  findings_count: 0;
  source_ref: string;
  meta?: Record<string, unknown>;
}

export type EngineResult = FractureResult | Chest18Result | BoneResult | MammoResult | Ct3dResult;

/* -------- 3D CT studio (MPR + ray-cast DVR) -------- */
export type Ct3dPlane = "axial" | "coronal" | "sagittal";
export type Ct3dPreset = "bone" | "soft";

export interface Ct3dStats {
  slices: number;
  voxels: number;
  hu_min: number;
  hu_max: number;
  hu_mean: number;
  body_volume_ml: number;
  spacing_mm: number[];
}

export interface Ct3dResult {
  engine: string;
  model_file: string;
  elapsed_ms: number;
  source_size: [number, number, number];
  volume_id: string;
  used_sample: boolean;
  preset: Ct3dPreset;
  meta: Record<string, unknown> & {
    slice_count_acquired?: number;
    slice_count?: number;
    patient_name?: string;
    series_desc?: string;
    spacing_mm?: number[];
  };
  stats: Ct3dStats;
  planes: {
    axial: { count: number; window: string; preview_indices: number[]; previews: string[] };
    coronal: { count: number; window: string; center: string };
    sagittal: { count: number; window: string; center: string };
  };
  vr: { image: string; preset: Ct3dPreset };
  warnings: string[];
  findings: never[];
  findings_count: 0;
  source_ref: string;
}

export interface Ct3dSliceResponse {
  volume_id: string;
  plane: Ct3dPlane;
  index: number;
  count: number;
  window: string;
  image: string;
}

/* Engine ids accepted by POST /api/analyze/{id} */
export const ENGINE_IDS = ["fracture", "bone-suppression", "chest18", "mammography", "ct3d"] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export interface EngineErrorDetail {
  engine: string;
  status: EngineState;
  message: string;
}

/* ----------------------------- status ----------------------------- */

export async function fetchEngineStatus(
  signal?: AbortSignal
): Promise<EngineStatusResponse | null> {
  try {
    const res = await fetch(`/api/status?XTransformPort=${ENGINE_PORT}`, {
      signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as EngineStatusResponse;
  } catch {
    return null;
  }
}

/* ----------------------------- analyze ----------------------------- */

async function analyzeMultipart(
  engineId: string,
  file: File | Blob,
  fileName: string,
  extra?: Record<string, string>
): Promise<EngineResult> {
  const form = new FormData();
  form.append("file", file, fileName);
  for (const [k, v] of Object.entries(extra ?? {})) form.append(k, v);

  const res = await fetch(`/api/analyze/${engineId}?XTransformPort=${ENGINE_PORT}`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      const d = body?.detail;
      detail =
        typeof d === "string"
          ? d
          : `${d?.message ?? `Engine returned ${res.status}`}`;
    } catch {
      detail = `Engine returned ${res.status}`;
    }
    throw new Error(detail);
  }
  return (await res.json()) as EngineResult;
}

export function analyzeFracture(
  file: File | Blob,
  fileName: string,
  confidence = 0.08,
  clahe = true
) {
  return analyzeMultipart("fracture", file, fileName, {
    confidence: String(confidence),
    clahe: String(clahe),
  });
}

export function analyzeEngine(engineId: string, file: File | Blob, fileName: string) {
  return analyzeMultipart(engineId, file, fileName);
}

/* ------------------------- 3D CT studio ------------------------- */

/** Run the 3D engine: with files (uploaded series) or the bundled sample. */
export async function analyzeCt3d(
  files: File[] | null,
  preset: Ct3dPreset = "bone"
): Promise<Ct3dResult> {
  const form = new FormData();
  if (files && files.length > 0) {
    for (const f of files) form.append("files", f, f.name);
  } else {
    form.append("use_sample", "true");
  }
  form.append("preset", preset);

  const res = await fetch(`/api/analyze/ct3d?XTransformPort=${ENGINE_PORT}`, {
    method: "POST",
    body: form,
  });
  if (!res.ok) {
    let detail: string;
    try {
      const body = await res.json();
      const d = body?.detail;
      detail = typeof d === "string" ? d : `${d?.message ?? `Engine returned ${res.status}`}`;
    } catch {
      detail = `Engine returned ${res.status}`;
    }
    throw new Error(detail);
  }
  return (await res.json()) as Ct3dResult;
}

/** Fetch one interactive MPR slice from a cached volume (fast). */
export async function fetchCt3dSlice(
  volumeId: string,
  plane: Ct3dPlane,
  index: number,
  window: string
): Promise<Ct3dSliceResponse | null> {
  try {
    const q = new URLSearchParams({
      volume_id: volumeId,
      plane,
      index: String(index),
      window,
    });
    const res = await fetch(`/api/ct3d/slice?${q.toString()}&XTransformPort=${ENGINE_PORT}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as Ct3dSliceResponse;
  } catch {
    return null;
  }
}

/** Re-render the volume at another preset (bone / soft tissue). */
export async function fetchCt3dVr(
  volumeId: string,
  preset: Ct3dPreset
): Promise<{ image: string; preset: Ct3dPreset } | null> {
  try {
    const q = new URLSearchParams({ volume_id: volumeId, preset });
    const res = await fetch(`/api/ct3d/vr?${q.toString()}&XTransformPort=${ENGINE_PORT}`, {
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as { image: string; preset: Ct3dPreset };
  } catch {
    return null;
  }
}

/* Fetch a public sample image as a File (for one-click real inference). */
export async function fetchSampleAsFile(path: string): Promise<File> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Could not load sample: ${path}`);
  const blob = await res.blob();
  const name = path.split("/").pop() ?? "sample.png";
  return new File([blob], name, { type: blob.type || "image/png" });
}
