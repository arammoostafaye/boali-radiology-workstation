"use client";

/* ------------------------------------------------------------------ */
/*  PACS panel — two connection modes:                                 */
/*                                                                    */
/*  1. MedalPACS Bridge (default) — connects to the hospital's real   */
/*     MedalPACS Web Workstation exactly the way the radiologist      */
/*     always did it in the desktop app: pick one of the four         */
/*     hospital servers, then username + password + the login         */
/*     captcha. The bridge (in /api/medal/*) replays the ASP.NET      */
/*     postback, encrypts the password with the page's AES key/iv,    */
/*     keeps the authenticated cookie jar server-side for 12 hours    */
/*     (disk-persisted) and can fetch patient studies by link or      */
/*     national ID, download the DICOM package and send it to the     */
/*     local AI engines.                                              */
/*                                                                    */
/*  2. Local Archive — the hardened boali-pacs :3021 DICOM index      */
/*     (studies / series / instances + live audit trail).             */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Bone,
  Brain,
  CloudDownload,
  Database,
  FileDown,
  Hospital,
  Loader2,
  Lock,
  LogIn,
  LogOut,
  MonitorSmartphone,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import {
  MEDAL_SERVERS,
  useMedalBridge,
  type MedalBridgeInfo,
} from "@/lib/medal-bridge";
import {
  analyzeEngine,
  type BoneResult,
  type Chest18Result,
  type EngineResult,
  type FractureResult,
  type MammoResult,
} from "@/lib/boali-engine";

/* ------------------------------------------------------------------ */
/*  shared types                                                       */
/* ------------------------------------------------------------------ */

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

interface PrepareResult {
  sid: string;
  captchaUrl: string | null;
  hasCaptcha: boolean;
  hospitalName: string | null;
  serverName: string | null;
  loginUrl: string;
}

interface WorklistResult {
  kind: "table" | "app";
  title: string | null;
  studies: { cells: string[] }[];
  note: string;
}

/** patient study metadata returned by POST /api/medal/study */
interface MedalStudy {
  ok?: boolean;
  pid: string | null;
  pname: string | null;
  modality: string;
  studyKey: string;
  hashKey: string;
  series: { key: string; count: number }[];
  pageUrl: string;
  base: string;
}

interface MedalFile {
  name: string;
  size: number;
}

type AiEngineId = "fracture" | "bone-suppression" | "chest18" | "mammography";

interface MedalAiFileResult {
  file: string;
  engine: AiEngineId;
  ok: boolean;
  error?: string;
  result?: EngineResult;
  /** bridge session + patient (for the DICOM download link) */
  sid: string;
  pid: string;
}

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

const FA_D = "۰۱۲۳۴۵۶۷۸۹";
const AR_D = "٠١٢٣٤٥٦٧٨٩";

/** Persian / Arabic keyboard digits → ASCII (hospital workstations) */
function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (ch) => {
    const fa = FA_D.indexOf(ch);
    if (fa >= 0) return String(fa);
    const ar = AR_D.indexOf(ch);
    if (ar >= 0) return String(ar);
    return ch;
  });
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ */
/*  MedalPACS bridge login (username + password + captcha)             */
/* ------------------------------------------------------------------ */

function MedalLogin() {
  const { info, connected, connecting, setConnecting, setBridge } = useMedalBridge();

  const [presetId, setPresetId] = useState<string>("lan");
  const [serverUrl, setServerUrl] = useState("");
  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaBust, setCaptchaBust] = useState(0);
  const [error, setError] = useState<{ fa: string; en: string } | null>(null);
  const [busy, setBusy] = useState<"prepare" | "login" | "refresh" | null>(null);
  /* monotonic token — ignore responses from superseded prepare/refresh calls */
  const reqSeqRef = useRef(0);

  /* restore last server + username */
  useEffect(() => {
    let savedUrl = "";
    let savedUser = "";
    let savedPreset = "lan";
    try {
      savedUrl = localStorage.getItem("boali.medalServer") ?? "";
      savedUser = localStorage.getItem("boali.medalUser") ?? "";
      savedPreset = localStorage.getItem("boali.medalPreset") ?? "lan";
    } catch {
      /* ignore */
    }
    setPresetId(savedPreset);
    setUsername(savedUser);
    if (savedUrl) {
      setServerUrl(savedUrl);
      /* auto-prepare like the desktop app (captcha ready immediately) */
      void doPrepare(savedUrl);
    }
  }, []);

  const doPrepare = useCallback(
    async (url: string, keepCreds = false) => {
      const clean = url.trim();
      if (!clean) {
        setError({ fa: "آدرس سرور PACS را وارد کنید.", en: "Enter the PACS server address." });
        return;
      }
      setBusy("prepare");
      setError(null);
      if (!keepCreds) {
        setCaptcha("");
        setPrep(null);
      }
      const mySeq = ++reqSeqRef.current;
      try {
        const res = await fetch(
          `/api/medal/prepare?url=${encodeURIComponent(clean)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as PrepareResult & { error?: string };
        if (reqSeqRef.current !== mySeq) return; /* superseded by a newer probe */
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setPrep(data);
        setCaptchaBust((b) => b + 1);
        try {
          localStorage.setItem("boali.medalServer", clean);
        } catch {
          /* ignore */
        }
      } catch (e) {
        if (reqSeqRef.current !== mySeq) return; /* superseded — newer probe won */
        setError({
          fa: `اتصال به سرور برقرار نشد.${e instanceof Error ? " (" + e.message.slice(0, 90) + ")" : ""}`,
          en: e instanceof Error ? e.message.slice(0, 140) : "Could not reach the PACS server.",
        });
      } finally {
        if (reqSeqRef.current === mySeq) setBusy(null);
      }
    },
    []
  );

  const pickPreset = useCallback(
    (id: string) => {
      setPresetId(id);
      try {
        localStorage.setItem("boali.medalPreset", id);
      } catch {
        /* ignore */
      }
      if (id === "custom") {
        setServerUrl("");
        setPrep(null);
        setError(null);
        return;
      }
      const preset = MEDAL_SERVERS.find((p) => p.id === id);
      if (preset) {
        setServerUrl(preset.url);
        void doPrepare(preset.url);
      }
    },
    [doPrepare]
  );

  const doRefreshCaptcha = useCallback(
    async (keepError = false) => {
      if (!prep) return;
      setBusy("refresh");
      if (!keepError) setError(null);
      setCaptcha("");
      const mySeq = ++reqSeqRef.current;
      try {
        const res = await fetch(
          `/api/medal/refresh?sid=${encodeURIComponent(prep.sid)}`,
          { cache: "no-store" }
        );
        const data = (await res.json()) as PrepareResult & { error?: string };
        if (reqSeqRef.current !== mySeq) return; /* superseded */
        if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
        setPrep(data);
        setCaptchaBust((b) => b + 1);
      } catch (e) {
        if (reqSeqRef.current !== mySeq) return; /* superseded */
        setError({
          fa: "دریافت کپچای جدید ناموفق بود.",
          en:
            e instanceof Error ? e.message.slice(0, 120) : "Could not refresh the captcha.",
        });
      } finally {
        if (reqSeqRef.current === mySeq) setBusy(null);
      }
    },
    [prep]
  );

  const doLogin = useCallback(async () => {
    if (!prep) return;
    setBusy("login");
    setError(null);
    setConnecting(true);
    try {
      const res = await fetch("/api/medal/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid: prep.sid,
          username: normalizeDigits(username).trim(),
          password,
          captcha: normalizeDigits(captcha).trim(),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        errorFa?: string;
        error?: string;
        reason?: string;
      } & Partial<MedalBridgeInfo>;
      if (res.ok && data.ok) {
        try {
          localStorage.setItem("boali.medalUser", username.trim());
        } catch {
          /* ignore */
        }
        setBridge({
          sid: prep.sid,
          serverName: data.serverName ?? prep.serverName ?? null,
          hospitalName: data.hospitalName ?? prep.hospitalName ?? null,
          username: username.trim(),
          appBase: data.appBase ?? "",
          hasCaptcha: !!data.hasCaptcha,
          loginAt: data.loginAt ?? null,
          validHoursRemaining: data.validHoursRemaining ?? 12,
        });
        return;
      }
      setError({
        fa: data.errorFa ?? "ورود ناموفق بود.",
        en: data.error ?? "Sign-in failed.",
      });
      /* wrong captcha → new one automatically (keep the error visible) */
      if (data.reason === "captcha" || data.reason === "rejected") {
        await doRefreshCaptcha(true);
      }
    } catch (e) {
      setError({
        fa: "خطای ارتباط با سرور PACS.",
        en: e instanceof Error ? e.message.slice(0, 120) : "Bridge request failed.",
      });
    } finally {
      setBusy(null);
      setConnecting(false);
    }
  }, [prep, username, password, captcha, doRefreshCaptcha, setBridge, setConnecting]);

  if (connected && info) return <MedalConnected />;

  return (
    <div className="space-y-3">
      {/* hospital badge */}
      {prep?.hospitalName && (
        <div className="flex items-center gap-2 rounded-xl border border-[#2dd4bf]/25 bg-[#122e2a]/60 px-3 py-2">
          <Hospital className="h-4 w-4 shrink-0 text-[#2dd4bf]" aria-hidden="true" />
          <div className="min-w-0">
            <p dir="rtl" className="truncate text-[12.5px] font-semibold text-[#a7f3d0]">
              {prep.hospitalName}
            </p>
            <p className="truncate text-[9.5px] text-[#5eead4]/60">{prep.loginUrl}</p>
          </div>
        </div>
      )}

      {/* server presets — the four hospital servers from the desktop app */}
      <div className="space-y-1.5">
        <p className="flex items-baseline justify-between gap-2">
          <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">انتخاب سرور پکس</span>
          <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">PACS server</span>
        </p>
        <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Hospital PACS servers">
          {MEDAL_SERVERS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => pickPreset(p.id)}
              aria-pressed={presetId === p.id}
              className={`h-auto rounded-lg border px-2 py-1.5 text-right transition-all ${
                presetId === p.id
                  ? "border-[#a78bfa]/60 bg-[#241d3a] text-[#c4b5fd]"
                  : "border-[#253548] bg-[#0f1823] text-[#8fa3b8] hover:border-[#3a4f68] hover:text-[#c3d3e2]"
              }`}
            >
              <span dir="rtl" className="block truncate text-[10.5px] font-semibold leading-4">
                {p.fa}
              </span>
              <span dir="ltr" className="block truncate font-mono text-[8.5px] leading-3 opacity-60">
                {p.url.replace(/^https?:\/\//, "")}
              </span>
            </button>
          ))}
          <button
            type="button"
            onClick={() => pickPreset("custom")}
            aria-pressed={presetId === "custom"}
            className={`col-span-2 h-8 rounded-lg border text-[10.5px] font-medium transition-all ${
              presetId === "custom"
                ? "border-[#a78bfa]/60 bg-[#241d3a] text-[#c4b5fd]"
                : "border-[#253548] bg-[#0f1823] text-[#8fa3b8] hover:text-[#c3d3e2]"
            }`}
          >
            آدرس دلخواه…
          </button>
        </div>
      </div>

      {/* custom server URL */}
      {presetId === "custom" && (
        <form
          className="space-y-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void doPrepare(serverUrl);
          }}
        >
          <label htmlFor="medal-url" className="flex items-baseline justify-between gap-2">
            <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">آدرس سرور PACS</span>
            <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">custom URL</span>
          </label>
          <div className="flex gap-1.5">
            <input
              id="medal-url"
              type="text"
              dir="ltr"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://192.168.1.10/medalweb"
              spellCheck={false}
              autoComplete="off"
              className="h-9 flex-1 rounded-lg border border-[#253548] bg-[#0f1823] px-3 font-mono text-[11px] text-[#e8eef5] placeholder:text-[#5a6e82] focus:border-[#a78bfa]/50 focus:outline-none"
            />
            <button
              type="submit"
              disabled={busy !== null}
              className="h-9 shrink-0 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] px-3 text-[11px] font-semibold text-[#1e1b4b] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
            >
              {busy === "prepare" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : (
                "بررسی"
              )}
            </button>
          </div>
        </form>
      )}

      {/* preparing state */}
      {busy === "prepare" && (
        <div className="flex items-center gap-2 rounded-xl border border-[#253548] bg-[#0f1823] p-2.5 text-[11px] text-[#7dd3fc]">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          <span dir="rtl">در حال اتصال به سرور پکس و دریافت کپچا…</span>
        </div>
      )}

      {/* credentials + captcha */}
      {prep && (
        <form
          className="space-y-2.5 rounded-xl border border-[#253548] bg-[#0f1823] p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void doLogin();
          }}
        >
          <div className="space-y-1.5">
            <label htmlFor="medal-user" className="flex items-baseline justify-between gap-2">
              <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">نام کاربری</span>
              <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">Username</span>
            </label>
            <input
              id="medal-user"
              type="text"
              dir="ltr"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              className="h-9 w-full rounded-lg border border-[#253548] bg-[#141e2a] px-3 text-[12px] text-[#e8eef5] focus:border-[#a78bfa]/50 focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="medal-pass" className="flex items-baseline justify-between gap-2">
              <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">رمز عبور</span>
              <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">Password</span>
            </label>
            <input
              id="medal-pass"
              type="password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="h-9 w-full rounded-lg border border-[#253548] bg-[#141e2a] px-3 text-[12px] text-[#e8eef5] focus:border-[#a78bfa]/50 focus:outline-none"
            />
          </div>

          {prep.captchaUrl && (
            <div className="space-y-1.5">
              <label htmlFor="medal-captcha" className="flex items-baseline justify-between gap-2">
                <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">کد کپچا</span>
                <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">Captcha</span>
              </label>
              <div className="flex items-stretch gap-1.5">
                <img
                  src={`${prep.captchaUrl}&bust=${captchaBust}`}
                  alt="کد کپچای ورود به PACS"
                  width={200}
                  height={60}
                  className="h-11 w-[150px] shrink-0 rounded-lg border border-[#253548] bg-white object-contain p-0.5"
                />
                <button
                  type="button"
                  onClick={() => void doRefreshCaptcha()}
                  disabled={busy !== null}
                  aria-label="کپچای جدید"
                  title="کپچای جدید / new captcha"
                  className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-[#253548] bg-[#141e2a] text-[#8fa3b8] transition-colors hover:text-white disabled:opacity-50"
                >
                  {busy === "refresh" ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RefreshCw className="h-4 w-4" aria-hidden="true" />
                  )}
                </button>
                <input
                  id="medal-captcha"
                  type="text"
                  dir="ltr"
                  value={captcha}
                  onChange={(e) => setCaptcha(e.target.value)}
                  autoComplete="off"
                  placeholder="●●●●"
                  maxLength={12}
                  className="h-11 min-w-0 flex-1 rounded-lg border border-[#253548] bg-[#141e2a] px-3 text-center text-[14px] font-semibold tracking-[0.25em] text-[#e8eef5] focus:border-[#a78bfa]/50 focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={busy !== null || connecting}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2dd4bf] to-[#0ea5e9] text-[12.5px] font-bold text-[#0b2430] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
          >
            {busy === "login" || connecting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>در حال ورود…</span>
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                <span>ورود به PACS</span>
              </>
            )}
          </button>

          <p dir="rtl" className="text-center text-[9.5px] leading-4 text-[#5a6e82]">
            ورود با همان روش همیشگی — پس از ورود، نشست تا ۱۲ ساعت معتبر می‌ماند.
          </p>
        </form>
      )}

      {!prep && busy !== "prepare" && (
        <p className="rounded-lg bg-[#0f1823] px-3 py-2 text-[10px] leading-relaxed text-[#5a6e82]">
          <span dir="rtl" className="block text-[#8fa3b8]">
            دقیقاً همان روش همیشگی شما: سرور را انتخاب کنید و با نام کاربری، رمز عبور و کد کپچای MedalPACS وارد شوید.
          </span>
          Same login as the hospital web workstation — username, password and its captcha.
        </p>
      )}

      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-2.5"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f87171]" aria-hidden="true" />
          <div className="min-w-0">
            <p dir="rtl" className="text-[11.5px] font-medium text-[#fca5a5]">{error.fa}</p>
            {error.en !== error.fa && (
              <p className="mt-0.5 break-words text-[10px] text-[#f87171]/70">{error.en}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AI result rendering (per downloaded DICOM file)                     */
/* ------------------------------------------------------------------ */

function AiResultCard({ r }: { r: MedalAiFileResult }) {
  const [open, setOpen] = useState(false);
  const frac = r.result as FractureResult | undefined;
  const chest = r.result as Chest18Result | undefined;
  const bone = r.result as BoneResult | undefined;
  const mammo = r.result as MammoResult | undefined;

  let thumb: string | null = null;
  if (frac?.annotated_image) thumb = frac.annotated_image;
  else if (bone?.images?.soft_tissue) thumb = bone.images.soft_tissue;

  const positives =
    chest?.findings?.filter((f) => f.is_positive).slice(0, 6) ?? [];
  const mammoEntries = Object.entries(mammo?.probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div className="rounded-xl border border-[#253548] bg-[#0f1823] p-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        {thumb ? (
          <img
            src={`data:image/png;base64,${thumb}`}
            alt={`تحلیل ${r.file}`}
            className="h-12 w-12 shrink-0 rounded-lg border border-[#253548] bg-black object-contain"
          />
        ) : (
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-[#253548] bg-[#141e2a]">
            <Brain className="h-5 w-5 text-[#a78bfa]" aria-hidden="true" />
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span dir="ltr" className="block truncate font-mono text-[10px] text-[#c3d3e2]">
            {r.file}
          </span>
          {r.ok && frac && (
            <span className="block text-[10.5px] text-[#8fa3b8]">
              {frac.findings_count > 0 ? (
                <span className="text-[#fca5a5]">{frac.findings_count} شکستگی مشکوک</span>
              ) : (
                <span className="text-[#4ade80]">بدون شکستگی شناسایی‌شده</span>
              )}
            </span>
          )}
          {r.ok && chest && (
            <span className="block text-[10.5px] text-[#8fa3b8]">
              {positives.length > 0 ? (
                <span className="text-[#fca5a5]">{positives.length} یافته ریوی مثبت</span>
              ) : (
                <span className="text-[#4ade80]">بدون یافته ریوی مثبت</span>
              )}
            </span>
          )}
          {r.ok && bone && (
            <span className="block text-[10.5px] text-[#8fa3b8]">تضعیف استخوان انجام شد</span>
          )}
          {r.ok && mammo && (
            <span className="block text-[10.5px] text-[#8fa3b8]">
              {mammoEntries[0] ? `${mammoEntries[0][0]}: ${(mammoEntries[0][1] * 100).toFixed(0)}٪` : "—"}
            </span>
          )}
          {!r.ok && (
            <span className="block truncate text-[10.5px] text-[#f87171]/80">{r.error}</span>
          )}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 border-t border-[#1c2a3a] pt-2">
          {thumb && (
            <img
              src={`data:image/png;base64,${thumb}`}
              alt={`تصویر تحلیل‌شده ${r.file}`}
              className="max-h-72 w-full rounded-lg border border-[#253548] bg-black object-contain"
            />
          )}
          {bone && (
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  ["soft_tissue", "بافت نرم"],
                  ["bone", "استخوان"],
                  ["lung", "ریه"],
                  ["non_lung_soft", "غیرریوی"],
                ] as const
              ).map(([k, label]) =>
                bone.images?.[k] ? (
                  <figure key={k} className="space-y-0.5">
                    <img
                      src={`data:image/png;base64,${bone.images[k]}`}
                      alt={`تفکیک ${label} — ${r.file}`}
                      className="h-24 w-full rounded-lg border border-[#253548] bg-black object-contain"
                    />
                    <figcaption dir="rtl" className="text-center text-[9px] text-[#8fa3b8]">
                      {label}
                    </figcaption>
                  </figure>
                ) : null
              )}
            </div>
          )}
          {frac && frac.findings.length > 0 && (
            <ul className="space-y-0.5">
              {frac.findings.map((f, i) => (
                <li key={i} className="flex items-center justify-between gap-2 font-mono text-[9.5px] text-[#8fa3b8]">
                  <span>{f.label}</span>
                  <span className={f.conf > 0.5 ? "text-[#fca5a5]" : "text-[#facc15]"}>
                    {(f.conf * 100).toFixed(0)}٪
                  </span>
                </li>
              ))}
            </ul>
          )}
          {chest && positives.length > 0 && (
            <ul className="space-y-0.5">
              {positives.map((f, i) => (
                <li key={i} dir="rtl" className="flex items-center justify-between gap-2 text-[10px] text-[#c3d3e2]">
                  <span>{f.fa}</span>
                  <span className="font-mono text-[#facc15]">{(f.score * 100).toFixed(0)}٪</span>
                </li>
              ))}
            </ul>
          )}
          {mammo && mammoEntries.length > 0 && (
            <ul className="space-y-0.5">
              {mammoEntries.map(([k, v]) => (
                <li key={k} className="flex items-center justify-between gap-2 text-[10px] text-[#c3d3e2]">
                  <span dir="rtl">{k}</span>
                  <span className="font-mono text-[#7dd3fc]">{(v * 100).toFixed(1)}٪</span>
                </li>
              ))}
            </ul>
          )}
          <a
            href={`/api/medal/dicom?sid=${encodeURIComponent(r.sid)}&pid=${encodeURIComponent(r.pid)}&name=${encodeURIComponent(r.file)}`}
            download
            className="inline-flex items-center gap-1.5 rounded-full border border-[#253548] bg-[#141e2a] px-2.5 py-1 text-[9.5px] text-[#8fa3b8] transition-colors hover:text-white"
          >
            <FileDown className="h-3 w-3" aria-hidden="true" />
            دانلود فایل دایکام
          </a>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  MedalPACS connected state — session + patient download + AI         */
/* ------------------------------------------------------------------ */

function MedalConnected() {
  const { info, clearBridge } = useMedalBridge();
  const [worklist, setWorklist] = useState<WorklistResult | null>(null);
  const [wlState, setWlState] = useState<"loading" | "ok" | "error" | "expired">("loading");
  const [wlError, setWlError] = useState("");

  /* patient fetch + download + AI */
  const [patientInput, setPatientInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [fetchError, setFetchError] = useState<{ fa: string; en?: string } | null>(null);
  const [study, setStudy] = useState<MedalStudy | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [files, setFiles] = useState<MedalFile[] | null>(null);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [engine, setEngine] = useState<AiEngineId | null>(null);
  const [aiProgress, setAiProgress] = useState<{ done: number; total: number } | null>(null);
  const [aiResults, setAiResults] = useState<MedalAiFileResult[]>([]);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadWorklist = useCallback(async () => {
    if (!info) return;
    setWlState("loading");
    try {
      const res = await fetch(
        `/api/medal/worklist?sid=${encodeURIComponent(info.sid)}`,
        { cache: "no-store" }
      );
      if (res.status === 401) {
        const d = (await res.json()) as { expired?: boolean };
        if (d.expired) {
          setWlState("expired");
          return;
        }
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setWorklist((await res.json()) as WorklistResult);
      setWlState("ok");
    } catch (e) {
      setWlError(e instanceof Error ? e.message : "worklist failed");
      setWlState("error");
    }
  }, [info]);

  useEffect(() => {
    void loadWorklist();
  }, [loadWorklist]);

  const doLogout = useCallback(async () => {
    if (!info) return;
    try {
      await fetch("/api/medal/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: info.sid }),
      });
    } catch {
      /* ignore */
    }
    clearBridge();
  }, [info, clearBridge]);

  /* fetch patient study metadata (link / national ID / SK token) */
  const doFetchStudy = useCallback(async () => {
    if (!info) return;
    const raw = normalizeDigits(patientInput).trim();
    if (!raw) {
      setFetchError({ fa: "لینک PACS یا کد ملی بیمار را وارد کنید." });
      return;
    }
    setFetching(true);
    setFetchError(null);
    setStudy(null);
    setFiles(null);
    setFileCount(null);
    setAiResults([]);
    setEngine(null);
    try {
      const res = await fetch("/api/medal/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: info.sid, input: raw }),
      });
      const data = (await res.json()) as MedalStudy & {
        errorFa?: string;
        error?: string;
        expired?: boolean;
      };
      if (res.status === 401 && data.expired) {
        clearBridge();
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.errorFa ?? data.error ?? `HTTP ${res.status}`);
      }
      setStudy(data);
    } catch (e) {
      setFetchError({
        fa: e instanceof Error ? e.message.slice(0, 160) : "خطا در دریافت پرونده.",
      });
    } finally {
      setFetching(false);
    }
  }, [info, patientInput, clearBridge]);

  /* download the full DICOM package via Download.aspx */
  const doDownload = useCallback(async () => {
    if (!info || !study?.pid) return;
    setDownloading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/medal/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid: info.sid,
          pid: study.pid,
          studyKey: study.studyKey,
          hashKey: study.hashKey,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        cached?: boolean;
        pid?: string;
        files?: MedalFile[];
        count?: number;
        errorFa?: string;
        error?: string;
        expired?: boolean;
      };
      if (res.status === 401 && data.expired) {
        clearBridge();
        return;
      }
      if (!res.ok || !data.ok) {
        throw new Error(data.errorFa ?? data.error ?? `HTTP ${res.status}`);
      }
      setFiles(data.files ?? []);
      setFileCount(data.count ?? data.files?.length ?? 0);
    } catch (e) {
      setFetchError({
        fa: e instanceof Error ? e.message.slice(0, 160) : "دانلود پکیج دایکام ناموفق بود.",
      });
    } finally {
      setDownloading(false);
    }
  }, [info, study, clearBridge]);

  /* run a local AI engine over the downloaded DICOM files */
  const doAnalyze = useCallback(
    async (engineId: AiEngineId) => {
      if (!info || !study?.pid || !files || files.length === 0) return;
      setEngine(engineId);
      setAiError(null);
      setAiResults([]);
      const subset = files.slice(0, 24);
      setAiProgress({ done: 0, total: subset.length });
      const out: MedalAiFileResult[] = [];
      for (let i = 0; i < subset.length; i++) {
        const f = subset[i];
        try {
          const dres = await fetch(
            `/api/medal/dicom?sid=${encodeURIComponent(info.sid)}&pid=${encodeURIComponent(study.pid)}&name=${encodeURIComponent(f.name)}`,
            { cache: "no-store" }
          );
          if (!dres.ok) throw new Error(`file fetch HTTP ${dres.status}`);
          const blob = await dres.blob();
          const result = await analyzeEngine(engineId, blob, f.name.split("/").pop() ?? f.name);
          out.push({
            file: f.name,
            engine: engineId,
            ok: true,
            result,
            sid: info.sid,
            pid: study.pid,
          });
        } catch (e) {
          out.push({
            file: f.name,
            engine: engineId,
            ok: false,
            error: e instanceof Error ? e.message.slice(0, 120) : "analysis failed",
            sid: info.sid,
            pid: study.pid,
          });
        }
        setAiProgress({ done: i + 1, total: subset.length });
        setAiResults([...out]);
      }
      setAiProgress(null);
    },
    [info, study, files]
  );

  if (!info) return null;

  const AI_ENGINE_LABELS: Record<AiEngineId, string> = {
    fracture: "تشخیص شکستگی",
    "bone-suppression": "تضعیف استخوان",
    chest18: "غربالگری ریوی",
    mammography: "ماموگرافی",
  };

  return (
    <div className="space-y-3">
      {/* session card */}
      <div className="rounded-xl border border-[#22c55e]/25 bg-[#12251c]/60 p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
            </span>
            <p dir="rtl" className="truncate text-[12.5px] font-semibold text-[#bbf7d0]">
              {info.hospitalName ?? info.serverName ?? "MedalPACS"}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#4ade80]">
            متصل
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <p dir="ltr" className="truncate font-mono text-[10px] text-[#86efac]/70">
            {info.username} @ {info.appBase || "medalweb"}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {(info.validHoursRemaining ?? 0) > 0 && (
              <span
                dir="rtl"
                className="rounded-full border border-[#22c55e]/20 bg-[#22c55e]/5 px-2 py-0.5 text-[9px] text-[#86efac]"
                title="نشست پکس طبق روش قبلی تا ۱۲ ساعت معتبر است"
              >
                {info.validHoursRemaining} ساعت اعتبار
              </span>
            )}
            <button
              type="button"
              onClick={() => void doLogout()}
              className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[#f87171]/25 bg-[#f87171]/10 px-2.5 text-[10px] font-medium text-[#fca5a5] transition-colors hover:bg-[#f87171]/20"
            >
              <LogOut className="h-3 w-3" aria-hidden="true" />
              <span dir="rtl">خروج</span>
            </button>
          </div>
        </div>
      </div>

      {/* patient fetch box — the old workflow */}
      <form
        className="space-y-1.5 rounded-xl border border-[#253548] bg-[#0f1823] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void doFetchStudy();
        }}
      >
        <label htmlFor="medal-patient" className="flex items-baseline justify-between gap-2">
          <span dir="rtl" className="text-[11.5px] font-medium text-[#c3d3e2]">
            دریافت پرونده بیمار
          </span>
          <span className="text-[9px] uppercase tracking-wider text-[#5a6e82]">Patient fetch</span>
        </label>
        <div className="flex gap-1.5">
          <input
            id="medal-patient"
            type="text"
            dir="ltr"
            value={patientInput}
            onChange={(e) => setPatientInput(e.target.value)}
            placeholder="کد ملی / لینک SMS / SK"
            spellCheck={false}
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-[#253548] bg-[#141e2a] px-3 font-mono text-[11px] text-[#e8eef5] placeholder:text-[#5a6e82] focus:border-[#a78bfa]/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={fetching || downloading}
            className="h-9 shrink-0 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] px-3 text-[11px] font-semibold text-[#1e1b4b] transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
          >
            {fetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              "دریافت"
            )}
          </button>
        </div>
        <p dir="rtl" className="text-[9.5px] leading-4 text-[#5a6e82]">
          کد ملی بیمار، لینک پیامکی پکس یا توکن SK را وارد کنید — مانند برنامه قبلی.
        </p>
      </form>

      {fetchError && (
        <div role="alert" className="flex items-start gap-2 rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-[#f87171]" aria-hidden="true" />
          <p dir="rtl" className="min-w-0 break-words text-[11px] text-[#fca5a5]">{fetchError.fa}</p>
        </div>
      )}

      {/* study card */}
      {study && (
        <div className="rounded-xl border border-[#a78bfa]/25 bg-[#1a1530]/50 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span
              className={`flex h-9 w-11 shrink-0 items-center justify-center rounded-lg text-[10.5px] font-bold ${
                study.modality === "CT"
                  ? "bg-[#0e2a3f] text-[#7ee7f3]"
                  : study.modality === "MG"
                    ? "bg-[#3a1a2e] text-[#f9a8d4]"
                    : "bg-[#223046] text-[#a9bccd]"
              }`}
            >
              {study.modality || "?"}
            </span>
            <div className="min-w-0 flex-1">
              <p dir="rtl" className="truncate text-[12.5px] font-semibold text-[#e8eef5]">
                {study.pname ?? "بیمار رادیولوژی"}
              </p>
              <p dir="rtl" className="truncate text-[10px] text-[#8fa3b8]">
                شناسه: {study.pid ?? "—"} · {study.series.length} سری
              </p>
            </div>
          </div>

          {!files && (
            <button
              type="button"
              onClick={() => void doDownload()}
              disabled={downloading || !study.pid}
              className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2dd4bf] to-[#0ea5e9] text-[11.5px] font-bold text-[#0b2430] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
            >
              {downloading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>در حال دانلود پکیج دایکام…</span>
                </>
              ) : (
                <>
                  <CloudDownload className="h-4 w-4" aria-hidden="true" />
                  <span>دانلود بسته کامل دایکام</span>
                </>
              )}
            </button>
          )}

          {/* files + AI */}
          {files && (
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p dir="rtl" className="text-[11px] font-semibold text-[#4ade80]">
                  ✓ {fileCount} فایل دایکام دریافت شد
                  {files.length > 0 && ` (${fmtBytes(files.reduce((a, f) => a + f.size, 0))})`}
                </p>
                <span className="font-mono text-[9px] text-[#5a6e82]">
                  {study.pid}
                </span>
              </div>

              {/* engine picker */}
              {!aiProgress && (
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(AI_ENGINE_LABELS) as AiEngineId[]).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => void doAnalyze(id)}
                      aria-pressed={engine === id && aiResults.length > 0}
                      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-medium transition-colors ${
                        engine === id && aiResults.length > 0
                          ? "border-[#a78bfa]/50 bg-[#241d3a] text-[#c4b5fd]"
                          : "border-[#253548] bg-[#141e2a] text-[#8fa3b8] hover:text-white"
                      }`}
                    >
                      {id === "fracture" || id === "bone-suppression" ? (
                        <Bone className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Brain className="h-3 w-3" aria-hidden="true" />
                      )}
                      {AI_ENGINE_LABELS[id]}
                    </button>
                  ))}
                </div>
              )}

              {aiProgress && (
                <div className="flex items-center gap-2 rounded-lg bg-[#141e2a] p-2 text-[10.5px] text-[#7dd3fc]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                  <span dir="rtl">
                    تحلیل با موتور {engine ? AI_ENGINE_LABELS[engine] : ""} — {aiProgress.done}/{aiProgress.total}
                  </span>
                </div>
              )}

              {aiError && (
                <p role="alert" dir="rtl" className="text-[10.5px] text-[#fca5a5]">{aiError}</p>
              )}

              {aiResults.length > 0 && (
                <div className="scroll-dark max-h-80 space-y-1.5 overflow-y-auto pr-1">
                  {aiResults.map((r, i) => (
                    <AiResultCard key={`${r.file}-${i}`} r={r} />
                  ))}
                </div>
              )}

              {/* raw file list */}
              {!aiProgress && aiResults.length === 0 && (
                <div className="scroll-dark max-h-40 space-y-1 overflow-y-auto pr-1">
                  {files.slice(0, 30).map((f) => (
                    <div
                      key={f.name}
                      className="flex items-center justify-between gap-2 rounded-lg bg-[#141e2a] px-2 py-1"
                    >
                      <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-[#8fa3b8]">
                        {f.name}
                      </span>
                      <span className="shrink-0 font-mono text-[9px] text-[#5a6e82]">
                        {fmtBytes(f.size)}
                      </span>
                    </div>
                  ))}
                  {files.length > 30 && (
                    <p className="px-2 text-[9px] text-[#5a6e82]">+{files.length - 30} فایل دیگر</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* worklist */}
      <div className="flex items-center justify-between gap-2 border-t border-[#253548] pt-2.5">
        <h3 className="flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wider text-[#8fa3b8]">
          <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden="true" />
          Worklist
        </h3>
        <button
          type="button"
          onClick={() => void loadWorklist()}
          disabled={wlState === "loading"}
          className="inline-flex h-6 items-center gap-1.5 rounded-full border border-[#253548] bg-[#0f1823] px-2 text-[10px] text-[#8fa3b8] transition-colors hover:text-white disabled:opacity-50"
        >
          {wlState === "loading" ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3 w-3" aria-hidden="true" />
          )}
          بروزرسانی
        </button>
      </div>

      {wlState === "loading" && (
        <div className="flex items-center gap-2 p-2 text-[11px] text-[#7dd3fc]">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          <span dir="rtl">در حال دریافت فهرست مطالعات…</span>
        </div>
      )}

      {wlState === "expired" && (
        <div role="alert" className="rounded-xl border border-[#facc15]/30 bg-[#facc15]/10 p-2.5">
          <p dir="rtl" className="text-[11.5px] text-[#fde047]">
            نشست PACS منقضی شده است — دوباره وارد شوید.
          </p>
        </div>
      )}

      {wlState === "error" && (
        <div role="alert" className="rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-2.5">
          <p dir="rtl" className="text-[11.5px] text-[#fca5a5]">خطا در دریافت فهرست مطالعات.</p>
          <p className="mt-0.5 font-mono text-[9.5px] text-[#f87171]/60">{wlError}</p>
        </div>
      )}

      {wlState === "ok" && worklist && (
        <div className="scroll-dark max-h-72 space-y-1.5 overflow-y-auto pr-1" aria-live="polite">
          {worklist.kind === "table" &&
            worklist.studies.map((s, i) => (
              <div
                key={i}
                className="rounded-xl bg-[#182430] p-2.5 transition-colors hover:bg-[#1d2b3b]"
              >
                <div dir="rtl" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                  {s.cells.slice(0, 8).map((c, j) => (
                    <span
                      key={j}
                      className={
                        j === 0
                          ? "font-semibold text-[#e8eef5]"
                          : "text-[#8fa3b8]"
                      }
                    >
                      {c}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          {worklist.kind === "app" && (
            <div className="rounded-xl border border-[#253548] bg-[#0f1823] p-3">
              <p dir="rtl" className="text-[11.5px] leading-relaxed text-[#8fa3b8]">
                اتصال به <span className="text-[#c4b5fd]">{worklist.title ?? info.serverName}</span> برقرار است.
                فهرست مطالعات این نسخه از MedalPACS با جاوااسکریپت رندر می‌شود — برای دریافت پرونده،
                کد ملی بیمار را در کادر بالا وارد کنید.
              </p>
            </div>
          )}
          {worklist.kind === "table" && worklist.studies.length === 0 && (
            <p className="p-2 text-[11px] text-[#8fa3b8]">No studies found on the main page.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Local archive (boali-pacs :3021) — unchanged functionality          */
/* ------------------------------------------------------------------ */

function LocalArchive() {
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
      const url = q.trim()
        ? `/api/pacs/studies?q=${encodeURIComponent(q.trim())}`
        : "/api/pacs/studies";
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

  const toggleStudy = useCallback(
    async (uid: string) => {
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
        const res = await fetch(`/api/pacs/series/${encodeURIComponent(uid)}`, {
          cache: "no-store",
        });
        if (res.ok) setSeries((await res.json()) as PacsSeries[]);
      } finally {
        setLoadingSeries(false);
      }
    },
    [openStudy]
  );

  const toggleSeries = useCallback(
    async (uid: string) => {
      if (openSeries === uid) {
        setOpenSeries(null);
        setInstances([]);
        return;
      }
      setOpenSeries(uid);
      setInstances([]);
      setLoadingInstances(true);
      try {
        const res = await fetch(`/api/pacs/instances/${encodeURIComponent(uid)}`, {
          cache: "no-store",
        });
        if (res.ok) setInstances((await res.json()) as PacsInstance[]);
      } finally {
        setLoadingInstances(false);
      }
    },
    [openSeries]
  );

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
    <div>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[13px] font-semibold">
          <span className="text-[#a78bfa]">Local</span>
          <span className="text-[#e8eef5]"> DICOM Archive</span>
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

      <form
        className="mb-2.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void loadStudies(query);
        }}
        role="search"
      >
        <div className="relative flex-1">
          <Search
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#5a6e82]"
            aria-hidden="true"
          />
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
                  a.outcome === "ok"
                    ? "bg-[#4ade80]"
                    : a.outcome === "denied"
                      ? "bg-[#f87171]"
                      : "bg-[#facc15]"
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
                              <span
                                className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#7dd3fc]"
                                aria-hidden="true"
                              />
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
                                        <FileDown
                                          className="h-3 w-3 shrink-0 text-[#5a6e82]"
                                          aria-hidden="true"
                                        />
                                        <span className="min-w-0 flex-1 truncate">
                                          {inst.instance_uid.slice(0, 26)}…
                                        </span>
                                        <span className="shrink-0">
                                          {(inst.size_bytes / 1024).toFixed(0)} KB
                                        </span>
                                      </a>
                                    ))}
                                    {instances.length > 12 && (
                                      <p className="px-2 pt-0.5 text-[9px] text-[#5a6e82]">
                                        +{instances.length - 12} more instances
                                      </p>
                                    )}
                                    {instances.length === 0 && (
                                      <p className="p-1 text-[10px] text-[#8fa3b8]">
                                        No instances indexed.
                                      </p>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  panel shell with the two modes                                     */
/* ------------------------------------------------------------------ */

type Mode = "medal" | "local";

export function PacsPanel() {
  const [mode, setMode] = useState<Mode>("medal");
  const { revalidate } = useMedalBridge();

  useEffect(() => {
    void revalidate();
  }, [revalidate]);

  return (
    <section
      aria-label="PACS connection"
      className="rounded-2xl border border-[#a78bfa]/25 bg-[#141e2a] p-3.5 shadow-[0_8px_24px_rgba(0,0,0,0.25)]"
    >
      {/* header */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2 className="text-[16px] font-semibold">
          <span className="text-[#a78bfa]">PACS</span>
          <span className="text-[#e8eef5]"> Connection</span>
        </h2>
        <span className="inline-flex items-center gap-1 rounded-full border border-[#253548] bg-[#0f1823] px-2 py-0.5 text-[9px] text-[#8fa3b8]">
          <UserRound className="h-3 w-3" aria-hidden="true" />
          روش قبلی: یوزر / پسورد / کپچا
        </span>
      </div>

      {/* mode switch */}
      <div
        role="tablist"
        aria-label="PACS connection mode"
        className="mb-3 flex gap-1 rounded-full border border-[#253548] bg-[#0f1823] p-1"
      >
        {(
          [
            ["medal", "MedalPACS Bridge"],
            ["local", "Local Archive"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`h-7 flex-1 rounded-full text-[10.5px] font-medium transition-all ${
              mode === id
                ? "bg-[#241d3a] text-[#c4b5fd] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
                : "text-[#8fa3b8] hover:text-[#c3d3e2]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "medal" ? <MedalLogin /> : <LocalArchive />}
    </section>
  );
}
