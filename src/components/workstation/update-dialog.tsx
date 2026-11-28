"use client";

/* ------------------------------------------------------------------ */
/*  Update dialog — in-app delta updater UI (user request: "قابلیت   */
/*  آپدیت از داخل برنامه — فقط فایل‌های تغییرکرده دانلود شوند").      */
/*                                                                    */
/*  check → /api/update/check   (manifest-based diff, no big zip)     */
/*  apply → /api/update/apply   (detached tools/boali_update.py)      */
/*  live  → /api/update/status  (phase polling until restart)         */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudDownload, Loader2, RefreshCw, X } from "lucide-react";

interface CheckResult {
  current: string;
  latest: string;
  upToDate: boolean;
  supported?: boolean;
  changed?: number;
  missing?: number;
  changedBytes?: number;
  changedPaths?: string[];
  totalFiles?: number;
  zipSize?: number;
  releaseUrl?: string | null;
  publishedAt?: string | null;
  notesPreview?: string;
  error?: string;
  errorFa?: string;
}

interface UpdateState {
  phase?: string;
  changed?: number;
  done?: number;
  current_file?: string;
  applied?: number;
  error?: string;
  current?: string;
  latest?: string;
}

const PHASE_FA: Record<string, string> = {
  idle: "آماده",
  checking: "در حال بررسی…",
  "fetch-release": "دریافت اطلاعات نسخه…",
  manifest: "دریافت فهرست فایل‌ها…",
  comparing: "مقایسهٔ فایل‌ها…",
  checked: "بررسی شد",
  "indexing-zip": "فهرست‌کردن بستهٔ نسخه…",
  downloading: "دانلود فایل‌های تغییرکرده…",
  applying: "اعمال فایل‌های جدید…",
  restarting: "راه‌اندازی مجدد سرویس‌ها…",
  done: "به‌روزرسانی کامل شد",
  "up-to-date": "به‌روز هستید",
  error: "خطا",
};

function fmtMB(bytes: number): string {
  if (!bytes) return "۰";
  return (bytes / 1048576).toLocaleString("fa-IR", {
    maximumFractionDigits: 1,
  });
}

export function UpdateDialog({ onClose }: { onClose: () => void }) {
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(true);
  const [applying, setApplying] = useState(false);
  const [state, setState] = useState<UpdateState | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const backOffRef = useRef(0);

  const doCheck = useCallback(async () => {
    setChecking(true);
    setCheck(null);
    try {
      const res = await fetch("/api/update/check", { cache: "no-store" });
      const data = (await res.json()) as CheckResult;
      setCheck(data);
    } catch (e) {
      setCheck({
        current: "?",
        latest: "?",
        upToDate: false,
        errorFa: "بررسی نسخه ناموفق بود — اینترنت/دسترسی به گیت‌هاب؟",
        error: e instanceof Error ? e.message : "check failed",
      });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    /* deferred so no setState runs synchronously inside the effect body */
    const t = setTimeout(() => void doCheck(), 0);
    return () => clearTimeout(t);
  }, [doCheck]);

  /* after apply: poll the updater state; when the web server goes down
   * and comes back (restart), reload the page to land on the new build */
  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch("/api/update/status", { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as UpdateState;
          setState(data);
          if (data.phase === "done" || data.phase === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
            if (data.phase === "done") {
              /* give the freshly restarted server a moment, then reload */
              setTimeout(() => window.location.reload(), 2500);
            }
          }
        }
        backOffRef.current = 0;
      } catch {
        /* server is restarting — after it answers again, reload */
        backOffRef.current++;
        if (backOffRef.current > 2) {
          const probe = setInterval(async () => {
            try {
              const r = await fetch("/", { method: "HEAD", cache: "no-store" });
              if (r.ok) {
                clearInterval(probe);
                window.location.reload();
              }
            } catch {
              /* still down */
            }
          }, 2000);
          if (pollRef.current) clearInterval(pollRef.current);
        }
      }
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const doApply = useCallback(async () => {
    setApplying(true);
    setState({ phase: "checking" });
    try {
      const res = await fetch("/api/update/apply", { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { errorFa?: string; error?: string };
        setState({
          phase: "error",
          error: data.errorFa ?? data.error ?? "شروع به‌روزرسانی ناموفق بود.",
        });
        setApplying(false);
        return;
      }
      startPolling();
    } catch (e) {
      setState({
        phase: "error",
        error: e instanceof Error ? e.message : "apply failed",
      });
      setApplying(false);
    }
  }, [startPolling]);

  const phase = state?.phase ?? "idle";
  const phaseFa = PHASE_FA[phase] ?? phase;

  return (
    <div
      className="fixed inset-0 z-[92] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      dir="rtl"
    >
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-[#253548] bg-[#0f1a29] shadow-2xl">
        {/* header */}
        <div className="flex items-center gap-2.5 border-b border-[#1f2d3e] px-5 py-3.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#2dd4bf]/30 bg-[#122e2a] text-[#2dd4bf]">
            <RefreshCw className={`h-4.5 w-4.5 ${checking || applying ? "animate-spin" : ""}`} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="text-[15px] font-bold text-[#e8eef5]">
              به‌روزرسانی برنامه
            </h3>
            <p className="truncate text-[10.5px] text-[#8fa3b8]">
              فقط فایل‌های تغییرکرده دانلود می‌شوند
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={applying && phase !== "error"}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#253548] text-[#8fa3b8] transition-colors hover:text-white disabled:opacity-40"
            aria-label="بستن"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* body */}
        <div className="space-y-4 p-5">
          {checking && (
            <div className="flex items-center gap-2.5 rounded-xl border border-[#253548] bg-[#141e2a] p-3.5 text-[12px] text-[#7dd3fc]">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              در حال مقایسه با آخرین نسخهٔ گیت‌هاب…
            </div>
          )}

          {!checking && check && !applying && (
            <>
              {check.error && !check.upToDate && check.latest === "?" ? (
                <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-3.5 text-[12px] leading-relaxed text-[#fca5a5]">
                  {check.errorFa ?? check.error}
                </div>
              ) : check.supported === false ? (
                <div className="space-y-3">
                  <div className="rounded-xl border border-[#facc15]/30 bg-[#2a2313]/50 p-3.5 text-[12px] leading-relaxed text-[#fde68a]">
                    {check.errorFa}
                  </div>
                  {check.releaseUrl && (
                    <a
                      href={check.releaseUrl}
                      target="_blank"
                      rel="noreferrer"
                      dir="ltr"
                      className="block truncate rounded-lg border border-[#253548] bg-[#141e2a] px-3 py-2 text-center font-mono text-[10.5px] text-[#7dd3fc] transition-colors hover:border-[#3a5a7d]"
                    >
                      {check.releaseUrl}
                    </a>
                  )}
                </div>
              ) : check.upToDate ? (
                <div className="flex items-center gap-2.5 rounded-xl border border-[#22c55e]/25 bg-[#12251c]/60 p-3.5 text-[12.5px] font-semibold text-[#bbf7d0]">
                  <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
                  شما آخرین نسخه ({check.current}) را دارید.
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-[#a78bfa]/25 bg-[#1a1530]/50 p-3.5">
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#8fa3b8]">
                        نسخهٔ فعلی
                      </p>
                      <p className="font-mono text-[14px] font-bold text-[#a9bccd]">
                        {check.current}
                      </p>
                    </div>
                    <RefreshCw className="h-4 w-4 text-[#5a6e82]" aria-hidden="true" />
                    <div>
                      <p className="text-[10px] uppercase tracking-wider text-[#8fa3b8]">
                        نسخهٔ جدید
                      </p>
                      <p className="font-mono text-[14px] font-bold text-[#c4b5fd]">
                        {check.latest}
                      </p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-[#253548] bg-[#141e2a] p-3.5">
                    <p className="text-[12px] font-semibold text-[#e8eef5]">
                      {check.changed ?? 0} فایل تغییر کرده — حدود{" "}
                      {fmtMB(check.changedBytes ?? 0)} مگابایت دانلود
                    </p>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-[#8fa3b8]">
                      بستهٔ کامل {fmtMB(check.zipSize ?? 0)} مگابایت است اما فقط
                      بخش تغییرکرده دریافت می‌شود (دانلود جزئی از طریق Range).
                    </p>
                    {!!check.changedPaths?.length && (
                      <ul className="mt-2 max-h-28 space-y-0.5 overflow-y-auto font-mono text-[9.5px] text-[#5a6e82]">
                        {check.changedPaths.slice(0, 12).map((p) => (
                          <li key={p} dir="ltr" className="truncate">
                            {p}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => void doApply()}
                    className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#2dd4bf] to-[#0ea5e9] text-[13px] font-bold text-[#0b2430] transition-all hover:brightness-110 active:scale-[0.99]"
                  >
                    <CloudDownload className="h-4.5 w-4.5" aria-hidden="true" />
                    شروع به‌روزرسانی
                  </button>
                  {check.error && (
                    <p className="text-[10px] text-[#fca5a5]">
                      {check.errorFa ?? check.error}
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                onClick={() => void doCheck()}
                className="mx-auto flex h-8 items-center gap-1.5 rounded-full border border-[#253548] px-3.5 text-[10.5px] font-medium text-[#8fa3b8] transition-colors hover:text-white"
              >
                <RefreshCw className="h-3 w-3" aria-hidden="true" />
                بررسی دوباره
              </button>
            </>
          )}

          {applying && (
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 rounded-xl border border-[#2dd4bf]/25 bg-[#122e2a]/60 p-3.5">
                <Loader2 className="h-4.5 w-4.5 animate-spin text-[#2dd4bf]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-bold text-[#a7f3d0]">
                    {phaseFa}
                  </p>
                  {phase === "downloading" && state && state.changed ? (
                    <p className="mt-0.5 truncate text-[10.5px] text-[#8fa3b8]">
                      {(state?.done ?? 0) + 1} از {state?.changed ?? 0} —{" "}
                      <span dir="ltr" className="font-mono">
                        {state?.current_file}
                      </span>
                    </p>
                  ) : phase === "applying" ? (
                    <p className="mt-0.5 text-[10.5px] text-[#8fa3b8]">
                      {state?.applied ?? 0} فایل اعمال شد
                    </p>
                  ) : (
                    <p className="mt-0.5 text-[10.5px] text-[#8fa3b8]">
                      لطفاً برنامه را باز نگه دارید…
                    </p>
                  )}
                </div>
              </div>
              {phase === "restarting" || phase === "done" ? (
                <p className="text-center text-[10.5px] leading-relaxed text-[#8fa3b8]">
                  سرویس‌ها راه‌اندازی مجدد می‌شوند — صفحه به‌صورت خودکار بارگذاری
                  مجدد خواهد شد.
                </p>
              ) : null}
              {phase === "error" && (
                <div className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-3.5 text-[11.5px] leading-relaxed text-[#fca5a5]">
                  {state?.error ?? "به‌روزرسانی ناموفق بود."}
                  <button
                    type="button"
                    onClick={() => {
                      setApplying(false);
                      setState(null);
                    }}
                    className="mt-2 block rounded-lg border border-[#f87171]/40 px-3 py-1.5 text-[10.5px] font-semibold text-[#fca5a5] transition-colors hover:bg-[#f87171]/10"
                  >
                    تلاش دوباره / بستن
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-[#1f2d3e] px-5 py-2.5">
          <p className="text-[9.5px] leading-relaxed text-[#5a6e82]">
            به‌روزرسانی از GitHub Releases انجام می‌شود؛ صحت هر فایل با SHA-256
            بررسی و سرویس‌ها به‌صورت خودکار راه‌اندازی مجدد می‌شوند.
          </p>
        </div>
      </div>
    </div>
  );
}
