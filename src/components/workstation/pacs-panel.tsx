"use client";

/* ------------------------------------------------------------------ */
/*  PACS panel — study/series browser over the hardened boali-pacs    */
/*  service. Goes through the Next.js server proxy so the PACS API    */
/*  key never touches the browser. Shows the live audit trail so the  */
/*  four security fixes are visible in the UI itself.                 */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  Database,
  FileDown,
  Loader2,
  Lock,
  Search,
  ShieldCheck,
} from "lucide-react";

interface PacsStudy {
  study_uid: string;
  patient_id: string;
  patient_name: string;
  study_date: string;
  modality: string;
  study_desc: string;
  series_count: number;
}

interface PacsSeries {
  series_uid: string;
  series_number: number;
  series_desc: string;
  modality: string;
  instance_count: number;
}

interface PacsInstance {
  instance_uid: string;
  series_uid: string;
  sop_class: string;
  size_bytes: number;
  file_path: string;
}

interface PacsAuditEntry {
  ts: string;
  key_fp: string;
  action: string;
  detail: string | null;
  ip: string | null;
  outcome: string;
}

export function PacsPanel() {
  const [status, setStatus] = useState<{ counts: Record<string, number>; fixes: number } | null>(null);
  const [offline, setOffline] = useState(false);
  const [studies, setStudies] = useState<PacsStudy[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [openStudy, setOpenStudy] = useState<string | null>(null);
  const [series, setSeries] = useState<PacsSeries[]>([]);
  const [openSeries, setOpenSeries] = useState<string | null>(null);
  const [instances, setInstances] = useState<PacsInstance[]>([]);
  const [audit, setAudit] = useState<PacsAuditEntry[]>([]);
  const [showAudit, setShowAudit] = useState(false);
  const [loadingSeries, setLoadingSeries] = useState(false);
  const [loadingInstances, setLoadingInstances] = useState(false);

  const loadStudies = useCallback(async (q: string) => {
    setSearching(true);
    try {
      const url = q.trim() ? `/api/pacs/studies?q=${encodeURIComponent(q.trim())}` : "/api/pacs/studies";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`status ${res.status}`);
      setStudies((await res.json()) as PacsStudy[]);
      setOffline(false);
    } catch {
      setOffline(true);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/pacs/status", { cache: "no-store" });
        if (!res.ok) throw new Error();
        setStatus(await res.json());
      } catch {
        setOffline(true);
      }
    })();
    void loadStudies("");
  }, [loadStudies]);

  const toggleStudy = useCallback(async (uid: string) => {
    if (openStudy === uid) {
      setOpenStudy(null);
      setSeries([]);
      setOpenSeries(null);
      setInstances([]);
      return;
    }
    setOpenStudy(uid);
    setSeries([]);
    setOpenSeries(null);
    setInstances([]);
    setLoadingSeries(true);
    try {
      const res = await fetch(`/api/pacs/series/${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (res.ok) setSeries((await res.json()) as PacsSeries[]);
    } finally {
      setLoadingSeries(false);
    }
  }, [openStudy]);

  const toggleSeries = useCallback(async (uid: string) => {
    if (openSeries === uid) {
      setOpenSeries(null);
      setInstances([]);
      return;
    }
    setOpenSeries(uid);
    setInstances([]);
    setLoadingInstances(true);
    try {
      const res = await fetch(`/api/pacs/instances/${encodeURIComponent(uid)}`, { cache: "no-store" });
      if (res.ok) setInstances((await res.json()) as PacsInstance[]);
    } finally {
      setLoadingInstances(false);
    }
  }, [openSeries]);

  const loadAudit = useCallback(async () => {
    if (showAudit) {
      setShowAudit(false);
      return;
    }
    setShowAudit(true);
    try {
      const res = await fetch("/api/pacs/audit?limit=12", { cache: "no-store" });
      if (res.ok) setAudit((await res.json()) as PacsAuditEntry[]);
    } catch {
      /* leave old entries */
    }
  }, [showAudit]);

  return (
    <section
      aria-label="PACS archive browser"
      className="rounded-2xl border border-[#a78bfa]/25 bg-[#141e2a] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
      {/* header */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">
          <span className="text-[#a78bfa]">PACS</span>
          <span className="text-[#e8eef5]"> Archive</span>
        </h2>
        <button
          type="button"
          onClick={() => void loadAudit()}
          className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10.5px] font-medium transition-colors ${
            showAudit
              ? "border-[#a78bfa]/40 bg-[#241d3a] text-[#c4b5fd]"
              : "border-[#253548] bg-[#0f1823] text-[#8fa3b8] hover:text-white"
          }`}
          aria-pressed={showAudit}
          aria-label="Toggle PACS audit trail view"
        >
          <Activity className="h-3 w-3" aria-hidden="true" />
          Audit trail
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-[#8fa3b8]">
        Queries the hardened <code className="rounded bg-[#0f1823] px-1 text-[10.5px] text-[#c4b5fd]">boali-pacs :3021</code> service
        through a server-side key proxy. API-key auth · parameterized SQL · path guard · audit log.
      </p>

      {/* status line */}
      <div className="mb-2.5 flex flex-wrap items-center gap-2 text-[10.5px]">
        {offline ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[#f87171]/25 bg-[#f87171]/10 px-2.5 py-1 text-[#f87171]">
            <Lock className="h-3 w-3" aria-hidden="true" /> service offline :3021
          </span>
        ) : status ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#22c55e]/25 bg-[#22c55e]/10 px-2.5 py-1 text-[#4ade80]">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {status.fixes}/4 fixes live
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[#253548] bg-[#0f1823] px-2.5 py-1 text-[#8fa3b8]">
              <Database className="h-3 w-3" aria-hidden="true" />
              {status.counts.studies} studies · {status.counts.instances} instances
            </span>
          </>
        ) : (
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[#a78bfa]" aria-hidden="true" />
        )}
      </div>

      {/* search box */}
      <form
        className="mb-2.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void loadStudies(query);
        }}
        role="search"
      >
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5a6e82]" aria-hidden="true" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="patient id / name / description…"
            maxLength={64}
            aria-label="PACS study search"
            className="h-8 w-full rounded-lg border border-[#253548] bg-[#0f1823] pl-8 pr-2 text-[11.5px] text-[#e8eef5] placeholder:text-[#5a6e82] focus:border-[#a78bfa]/50 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="h-8 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] px-3 text-[11.5px] font-semibold text-[#1e1b4b] transition-all hover:brightness-110 active:scale-[0.98]"
        >
          Query
        </button>
      </form>

      {/* audit trail (security fix #4, live) */}
      {showAudit && (
        <div className="scroll-dark mb-2.5 max-h-44 overflow-y-auto rounded-xl border border-[#253548] bg-[#0f1823] p-1.5">
          {audit.length === 0 && (
            <p className="p-2 text-[10.5px] text-[#5a6e82]">No audit entries yet.</p>
          )}
          {audit.map((a, i) => (
            <div
              key={`${a.ts}-${i}`}
              className="flex items-center gap-2 rounded-lg px-2 py-1 font-mono text-[9.5px] leading-4 text-[#8fa3b8]"
            >
              <span
                className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                  a.outcome === "ok" ? "bg-[#4ade80]" : a.outcome === "denied" ? "bg-[#f87171]" : "bg-[#facc15]"
                }`}
                aria-hidden="true"
              />
              <span className="shrink-0 text-[#5a6e82]">{a.ts.slice(11)}</span>
              <span className="shrink-0 text-[#c4b5fd]">{a.key_fp}</span>
              <span className="truncate">{a.action}</span>
              <span className="ml-auto shrink-0">{a.outcome}</span>
            </div>
          ))}
        </div>
      )}

      {/* studies list */}
      <div className="scroll-dark max-h-96 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
        {searching && (
          <div className="flex items-center gap-2 p-2 text-[11px] text-[#7dd3fc]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> querying PACS…
          </div>
        )}
        {!searching && studies.length === 0 && !offline && (
          <p className="p-2 text-[11px] text-[#8fa3b8]">No studies matched the query.</p>
        )}
        {studies.map((s) => {
          const open = openStudy === s.study_uid;
          return (
            <div key={s.study_uid} className="rounded-xl bg-[#182430]">
              <button
                type="button"
                onClick={() => void toggleStudy(s.study_uid)}
                aria-expanded={open}
                className="flex w-full items-center gap-2.5 p-2.5 text-left transition-colors hover:bg-[#1d2b3b]"
              >
                <span
                  className={`flex h-8 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
                    s.modality === "CT"
                      ? "bg-[#0e2a3f] text-[#7ee7f3]"
                      : s.modality === "MG"
                        ? "bg-[#3a1a2e] text-[#f9a8d4]"
                        : "bg-[#223046] text-[#a9bccd]"
                  }`}
                >
                  {s.modality || "?"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold text-[#e8eef5]">
                    {s.patient_name}
                  </span>
                  <span className="block truncate text-[10.5px] text-[#8fa3b8]">
                    {s.study_date || "—"} · {s.series_count} series
                    {s.study_desc ? ` · ${s.study_desc}` : ""}
                  </span>
                </span>
              </button>

              {open && (
                <div className="border-t border-[#253548] p-2">
                  {loadingSeries ? (
                    <div className="flex items-center gap-2 p-1.5 text-[10.5px] text-[#7dd3fc]">
                      <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> loading series…
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      {series.map((r) => {
                        const openS = openSeries === r.series_uid;
                        return (
                          <div key={r.series_uid} className="rounded-lg bg-[#0f1823]">
                            <button
                              type="button"
                              onClick={() => void toggleSeries(r.series_uid)}
                              aria-expanded={openS}
                              className="flex w-full items-center gap-2 p-2 text-left text-[11px] text-[#a9bccd] transition-colors hover:text-white"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7dd3fc]" aria-hidden="true" />
                              <span className="min-w-0 flex-1 truncate">
                                Series {r.series_number} · {r.instance_count} inst ·{" "}
                                {r.series_desc || r.modality}
                              </span>
                            </button>
                            {openS && (
                              <div className="border-t border-[#1c2a3a] p-1.5">
                                {loadingInstances ? (
                                  <div className="flex items-center gap-2 p-1 text-[10px] text-[#7dd3fc]">
                                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> instances…
                                  </div>
                                ) : (
                                  <div className="scroll-dark max-h-32 space-y-1 overflow-y-auto pr-0.5">
                                    {instances.slice(0, 12).map((inst) => (
                                      <a
                                        key={inst.instance_uid}
                                        href={`/api/pacs/file/${encodeURIComponent(inst.instance_uid)}`}
                                        download
                                        className="flex items-center gap-2 rounded-md bg-[#141e2a] px-2 py-1 font-mono text-[9.5px] text-[#8fa3b8] transition-colors hover:text-white hover:underline"
                                        title={`Download ${inst.file_path} (${(inst.size_bytes / 1024).toFixed(0)} KB) — served through the path-guarded endpoint`}
                                      >
                                        <FileDown className="h-3 w-3 shrink-0 text-[#5a6e82]" aria-hidden="true" />
                                        <span className="min-w-0 flex-1 truncate">
                                          {inst.instance_uid.slice(0, 26)}…
                                        </span>
                                        <span className="shrink-0">{(inst.size_bytes / 1024).toFixed(0)} KB</span>
                                      </a>
                                    ))}
                                    {instances.length > 12 && (
                                      <p className="px-2 pt-0.5 text-[9px] text-[#5a6e82]">
                                        +{instances.length - 12} more instances
                                      </p>
                                    )}
                                    {instances.length === 0 && (
                                      <p className="p-1 text-[10px] text-[#8fa3b8]">No instances indexed.</p>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                      {series.length === 0 && (
                        <p className="p-1.5 text-[10.5px] text-[#8fa3b8]">
                          No series indexed for this study.
                        </p>
                      )}
                      <p className="px-1 pt-0.5 text-[9.5px] leading-4 text-[#5a6e82]">
                        DICOM files are served per SOP UID through the guarded endpoint (realpath
                        containment verified server-side).
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
