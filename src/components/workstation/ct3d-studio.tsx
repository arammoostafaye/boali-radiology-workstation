"use client";

/* ------------------------------------------------------------------ */
/*  3D CT Studio view — interactive MPR slice browser + ray-cast VR    */
/*  over a volume cached in the boali-engine service. Every image is  */
/*  computed from the real DICOM series (no mock renders).            */
/*  v1.4: full-size output lightbox, ZIP export (both VR presets,     */
/*  all MPR windows, montage, stats, report) and the structured       */
/*  bilingual report — the reconstruction OUTPUT is fully visible     */
/*  and downloadable.                                                  */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Boxes, Download, Expand, FileText, Loader2, RotateCw, X } from "lucide-react";
import {
  ct3dExportUrl,
  fetchCt3dSlice,
  fetchCt3dVr,
  type Ct3dPlane,
  type Ct3dPreset,
  type Ct3dResult,
} from "@/lib/boali-engine";
import { EngineReportView } from "./engine-report-view";

const PLANES: { id: Ct3dPlane; label: string }[] = [
  { id: "axial", label: "Axial" },
  { id: "coronal", label: "Coronal" },
  { id: "sagittal", label: "Sagittal" },
];

const WINDOWS: { id: string; label: string }[] = [
  { id: "lung", label: "Lung" },
  { id: "soft", label: "Soft" },
  { id: "bone", label: "Bone" },
];

const PRESETS: { id: Ct3dPreset; label: string }[] = [
  { id: "bone", label: "Bone" },
  { id: "soft", label: "Soft tissue" },
];

export function Ct3dStudioView({
  result,
  accent = "#a78bfa",
}: {
  result: Ct3dResult;
  accent?: string;
}) {
  const [view, setView] = useState<"mpr" | "vr">("mpr");
  const [plane, setPlane] = useState<Ct3dPlane>("axial");
  const [window, setWindow] = useState<string>("lung");
  const [index, setIndex] = useState<number>(Math.floor(result.planes.axial.count / 2));
  const [sliceImg, setSliceImg] = useState<string | null>(null);
  const [sliceLoading, setSliceLoading] = useState(false);
  const [vrImg, setVrImg] = useState<string>(result.vr.image);
  const [vrPreset, setVrPreset] = useState<Ct3dPreset>(result.preset);
  const [vrLoading, setVrLoading] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [showReport, setShowReport] = useState(false);
  const sliceGen = useRef(0);

  const count = result.planes[plane].count;
  /* index clamped during render (plane switches reset it in the handler) */
  const clamped = Math.min(Math.max(index, 1), count);

  const selectPlane = useCallback(
    (p: Ct3dPlane) => {
      setPlane(p);
      setIndex(Math.floor(result.planes[p].count / 2));
    },
    [result.planes]
  );

  /* fetch the interactive slice (debounced, async state only) */
  useEffect(() => {
    const gen = ++sliceGen.current;
    const idx = Math.min(Math.max(index, 1), count);
    const t = setTimeout(async () => {
      setSliceLoading(true);
      const s = await fetchCt3dSlice(result.volume_id, plane, idx, window);
      if (gen !== sliceGen.current) return; /* stale response */
      if (s) setSliceImg(s.image);
      setSliceLoading(false);
    }, 120);
    return () => clearTimeout(t);
  }, [result.volume_id, plane, index, window, count]);

  const switchPreset = useCallback(
    async (p: Ct3dPreset) => {
      if (p === vrPreset || vrLoading) return;
      setVrLoading(true);
      const r = await fetchCt3dVr(result.volume_id, p);
      if (r) {
        setVrImg(r.image);
        setVrPreset(r.preset);
      }
      setVrLoading(false);
    },
    [result.volume_id, vrPreset, vrLoading]
  );

  const st = result.stats;

  const downloadZip = useCallback(() => {
    /* full-resolution bundle: both VR presets @768px, 9 MPR slices
     * @1024px, axial montage, volume-stats.json, bilingual report.txt */
    const a = document.createElement("a");
    a.href = ct3dExportUrl(result.volume_id, vrPreset);
    a.download = `boali-ct3d-${result.volume_id}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [result.volume_id, vrPreset]);

  return (
    <div className="mt-3 space-y-2.5" aria-live="polite">
      {/* volume meta line */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-[#8fa3b8]">
        <span className="rounded-full bg-[#223046] px-2 py-0.5 text-[#7dd3fc]">
          {result.meta.patient_name || "sample series"} · {result.meta.series_desc || "CT"}
        </span>
        <span>
          {st.slices} slices ({result.meta.slice_count_acquired ?? st.slices} acquired)
        </span>
        <span>{st.spacing_mm.join("×")} mm</span>
        <span>{(st.voxels / 1e6).toFixed(1)}M vox</span>
        <span>
          HU {st.hu_min}…{st.hu_max} (μ {st.hu_mean})
        </span>
      </div>

      {/* honest warnings (irregular spacing etc.) */}
      {result.warnings.length > 0 && (
        <div className="rounded-xl border border-[#facc15]/25 bg-[#facc15]/5 p-2">
          {result.warnings.map((w) => (
            <p key={w} className="text-[10px] leading-relaxed text-[#e3c76a]">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}

      {/* view switch + output actions */}
      <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="3D view mode">
        <button
          type="button"
          role="tab"
          aria-selected={view === "mpr"}
          onClick={() => setView("mpr")}
          className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors ${
            view === "mpr"
              ? "border-[#2dd4bf]/50 bg-[#16303c] text-[#7ee7f3]"
              : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
          }`}
        >
          <Box className="h-3.5 w-3.5" aria-hidden="true" />
          MPR planes
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "vr"}
          onClick={() => setView("vr")}
          className={`flex h-7 items-center gap-1.5 rounded-full border px-3 text-[11px] font-medium transition-colors ${
            view === "vr"
              ? "border-[#2dd4bf]/50 bg-[#16303c] text-[#7ee7f3]"
              : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
          }`}
        >
          <Boxes className="h-3.5 w-3.5" aria-hidden="true" />
          Volume render
        </button>

        <span className="ml-auto flex items-center gap-1.5">
          {result.report && (
            <button
              type="button"
              onClick={() => setShowReport((v) => !v)}
              aria-pressed={showReport}
              className={`flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium transition-colors ${
                showReport
                  ? "border-[#facc15]/40 bg-[#3a2a12] text-[#fbbf24]"
                  : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
              }`}
            >
              <FileText className="h-3 w-3" aria-hidden="true" />
              Report · گزارش
            </button>
          )}
          <button
            type="button"
            onClick={downloadZip}
            className="flex h-7 items-center gap-1.5 rounded-full bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] px-3 text-[10.5px] font-bold text-[#170f2b] transition-all hover:brightness-110 active:scale-[0.98]"
            title="Download the full-resolution output bundle: both VR presets (768 px), 9 MPR center slices (1024 px), axial montage, volume-stats.json and a bilingual report"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            Download output (ZIP)
          </button>
        </span>
      </div>

      {/* structured report (toggle) */}
      {showReport && result.report && (
        <EngineReportView report={result.report} accent={accent} />
      )}

      {view === "mpr" ? (
        <div className="rounded-xl border border-[#253548] bg-[#0f1823] p-2">
          {/* plane + window controls */}
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {PLANES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => selectPlane(p.id)}
                aria-pressed={plane === p.id}
                className={`h-7 rounded-lg border px-2.5 text-[11px] font-medium transition-colors ${
                  plane === p.id
                    ? "border-[#22d3ee]/50 bg-[#0e2a3f] text-[#7ee7f3]"
                    : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
                }`}
              >
                {p.label}
              </button>
            ))}
            <span className="ml-auto flex items-center gap-1">
              {WINDOWS.map((wd) => (
                <button
                  key={wd.id}
                  type="button"
                  onClick={() => setWindow(wd.id)}
                  aria-pressed={window === wd.id}
                  className={`h-7 rounded-lg border px-2 text-[10.5px] transition-colors ${
                    window === wd.id
                      ? "border-[#f59e0b]/40 bg-[#3a2a12] text-[#fbbf24]"
                      : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
                  }`}
                  title={`${wd.label} window`}
                >
                  {wd.label}
                </button>
              ))}
            </span>
          </div>

          {/* slice image */}
          <div className="group relative overflow-hidden rounded-lg border border-[#253548] bg-black">
            {sliceImg ? (
              <img
                src={sliceImg}
                alt={`Real ${plane} MPR slice ${clamped} of ${count}, ${window} window`}
                className="max-h-[340px] w-full cursor-zoom-in object-contain"
                onClick={() => setLightbox(sliceImg)}
              />
            ) : (
              <div className="flex h-52 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#2a3a4d]" aria-hidden="true" />
              </div>
            )}
            {sliceLoading && (
              <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 backdrop-blur-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[#7dd3fc]" aria-hidden="true" />
              </span>
            )}
            <button
              type="button"
              onClick={() => sliceImg && setLightbox(sliceImg)}
              aria-label="Open slice full-size"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-[#253548] bg-black/70 text-[#a9bccd] opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
            >
              <Expand className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[#c3cedb] backdrop-blur-sm">
              {plane} {clamped}/{count} · {window} W
            </span>
          </div>

          {/* slice slider */}
          <div className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={count}
              value={clamped}
              onChange={(e) => setIndex(Number(e.target.value))}
              aria-label={`${plane} slice position`}
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[#223046] accent-[#22d3ee]"
            />
            <span className="w-14 text-right font-mono text-[10.5px] text-[#8fa3b8]">
              {clamped}/{count}
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-[#253548] bg-[#0f1823] p-2">
          {/* preset controls */}
          <div className="mb-2 flex items-center gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void switchPreset(p.id)}
                disabled={vrLoading}
                aria-pressed={vrPreset === p.id}
                className={`flex h-7 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors disabled:opacity-60 ${
                  vrPreset === p.id
                    ? "border-[#a78bfa]/50 bg-[#241d3a] text-[#c4b5fd]"
                    : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
                }`}
              >
                {vrLoading && vrPreset !== p.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCw className="h-3 w-3" aria-hidden="true" />
                )}
                {p.label}
              </button>
            ))}
            <span className="ml-auto text-[10px] text-[#5a6e82]">
              ray-cast DVR · {vrPreset === "bone" ? "skeleton TF" : "surface TF"}
            </span>
          </div>

          <div className="group relative overflow-hidden rounded-lg border border-[#253548] bg-black">
            <img
              src={vrImg}
              alt={`Real ray-cast volume rendering, ${vrPreset} preset`}
              className="max-h-[340px] w-full cursor-zoom-in object-contain"
              onClick={() => setLightbox(vrImg)}
            />
            <button
              type="button"
              onClick={() => setLightbox(vrImg)}
              aria-label="Open volume render full-size"
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-[#253548] bg-black/70 text-[#a9bccd] opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
            >
              <Expand className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {vrLoading && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/45 backdrop-blur-[2px]">
                <Loader2 className="h-7 w-7 animate-spin text-[#a78bfa]" aria-hidden="true" />
              </span>
            )}
            <span className="absolute bottom-2 left-2 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-[#c3cedb] backdrop-blur-sm">
              VR · {result.source_size[2]} slices · {st.body_volume_ml} ml tissue
            </span>
          </div>
        </div>
      )}

      <p className="text-[10px] text-[#5a6e82]">
        MPR and volume rendering computed live from the DICOM voxel data (numpy + scipy,
        ported geometry). Gaps in the source series are rendered as air — never fabricated.
        Click any image for full size, or download the complete output bundle as ZIP.
      </p>

      {/* full-size output lightbox */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Full-size 3D output"
          onClick={() => setLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setLightbox(null)}
            aria-label="Close full-size view"
            className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-xl border border-[#253548] bg-[#141e2a]/90 text-[#a9bccd] transition-colors hover:text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          <img
            src={lightbox}
            alt="Full-size 3D CT output"
            className="max-h-[92vh] max-w-[94vw] rounded-xl border border-[#253548] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
