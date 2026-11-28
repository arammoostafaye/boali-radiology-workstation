"use client";

/* ------------------------------------------------------------------ */
/*  PACS Login Drawer — the home-screen entry to the MedalPACS         */
/*  bridge (user request: "لاگین پکس در اولین صفحه، کنار ۷ آیتم").     */
/*                                                                    */
/*  Opens as a slide-over from the module launcher. After a           */
/*  successful login the radiologist can paste ANY MedalWeb link      */
/*  (or national ID), fetch the study, download the DICOM package     */
/*  and hand it off to the right module room — the modality is        */
/*  detected from the actual DICOM headers server-side.               */
/* ------------------------------------------------------------------ */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bone,
  Box,
  Brain,
  CloudDownload,
  Hospital,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  MEDAL_SERVERS,
  useMedalBridge,
  type MedalBridgeInfo,
} from "@/lib/medal-bridge";
import {
  modalityToModule,
  moduleLabelFa,
  usePacsStudy,
} from "@/lib/pacs-study-store";

interface PrepareResult {
  sid: string;
  captchaUrl: string | null;
  hasCaptcha: boolean;
  hospitalName: string | null;
  serverName: string | null;
  loginUrl: string;
}

interface MedalStudy {
  pid: string | null;
  pname: string | null;
  modality: string;
  studyKey: string;
  hashKey: string;
}

interface MedalFile {
  name: string;
  size: number;
}

interface Handoff {
  pid: string;
  pname: string | null;
  modality: string | null;
  modalitySource: string | null;
  studyKey: string;
  hashKey: string;
  files: MedalFile[];
}

const HANDOFF_OPTIONS: {
  id: string;
  fa: string;
  desc: string;
  icon: "bone" | "brain" | "box";
}[] = [
  { id: "fracture", fa: "تشخیص شکستگی", desc: "YOLOv8 · گرافی ارتوپدی", icon: "bone" },
  { id: "bone", fa: "تضعیف استخوان", desc: "Qure · بافت نرم قفسه سینه", icon: "bone" },
  { id: "chest18", fa: "غربالگری ریوی", desc: "DenseNet-18 · ۱۸ پاتولوژی", icon: "brain" },
  { id: "mammo", fa: "ماموگرافی", desc: "ResNet-50 · غربالگری", icon: "brain" },
  { id: "studio", fa: "استودیوی سه‌بعدی CT", desc: "MPR + حجم‌سازی", icon: "box" },
];

export function PacsLoginDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { connected, info, connecting, setConnecting, setBridge, clearBridge, revalidate } =
    useMedalBridge();
  const { setPending } = usePacsStudy();

  const [presetId, setPresetId] = useState("lan");
  const [serverUrl, setServerUrl] = useState("");
  const [prep, setPrep] = useState<PrepareResult | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [captcha, setCaptcha] = useState("");
  const [captchaBust, setCaptchaBust] = useState(0);
  const [error, setError] = useState<{ fa: string; en: string } | null>(null);
  const [busy, setBusy] = useState<"prepare" | "login" | "refresh" | null>(null);
  const reqSeqRef = useRef(0);

  const [patientInput, setPatientInput] = useState("");
  const [fetching, setFetching] = useState(false);
  const [study, setStudy] = useState<MedalStudy | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [fileCount, setFileCount] = useState<number | null>(null);
  const [handoff, setHandoff] = useState<Handoff | null>(null);


  const doPrepare = useCallback(async (url: string, keepCreds = false) => {
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
      const res = await fetch(`/api/medal/prepare?url=${encodeURIComponent(clean)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as PrepareResult & { error?: string };
      if (reqSeqRef.current !== mySeq) return;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPrep(data);
      setCaptchaBust((b) => b + 1);
      try {
        localStorage.setItem("boali.medalServer", clean);
      } catch {
        /* ignore */
      }
    } catch (e) {
      if (reqSeqRef.current !== mySeq) return;
      setError({
        fa: `اتصال به سرور برقرار نشد.${e instanceof Error ? " (" + e.message.slice(0, 90) + ")" : ""}`,
        en: e instanceof Error ? e.message.slice(0, 140) : "Could not reach the PACS server.",
      });
    } finally {
      if (reqSeqRef.current === mySeq) setBusy(null);
    }
  }, []);

  /* restore last server + username; revalidate a persisted session —
   * deferred via timeout(0) so no setState runs synchronously inside
   * the effect body (same pattern as the splash overlay). */
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => {
      void revalidate();
      try {
        const savedUrl = localStorage.getItem("boali.medalServer") ?? "";
        const savedUser = localStorage.getItem("boali.medalUser") ?? "";
        const savedPreset = localStorage.getItem("boali.medalPreset") ?? "lan";
        setPresetId(savedPreset);
        setUsername(savedUser);
        if (savedUrl) {
          setServerUrl(savedUrl);
          void doPrepare(savedUrl);
        }
      } catch {
        /* ignore */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open, revalidate, doPrepare]);


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

  const doRefreshCaptcha = useCallback(async () => {
    if (!prep) return;
    setBusy("refresh");
    setError(null);
    setCaptcha("");
    const mySeq = ++reqSeqRef.current;
    try {
      const res = await fetch(`/api/medal/refresh?sid=${encodeURIComponent(prep.sid)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as PrepareResult & { error?: string };
      if (reqSeqRef.current !== mySeq) return;
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setPrep(data);
      setCaptchaBust((b) => b + 1);
    } catch (e) {
      if (reqSeqRef.current !== mySeq) return;
      setError({
        fa: "دریافت کپچای جدید ناموفق بود.",
        en: e instanceof Error ? e.message.slice(0, 120) : "Could not refresh the captcha.",
      });
    } finally {
      if (reqSeqRef.current === mySeq) setBusy(null);
    }
  }, [prep]);

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
          username: username.trim(),
          password,
          captcha: captcha.trim(),
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
        setPassword("");
        setCaptcha("");
        return;
      }
      setError({ fa: data.errorFa ?? "ورود ناموفق بود.", en: data.error ?? "Sign-in failed." });
      if (data.reason === "captcha" || data.reason === "rejected") {
        await doRefreshCaptcha();
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

  const doLogout = useCallback(async () => {
    if (info) {
      try {
        await fetch("/api/medal/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sid: info.sid }),
        });
      } catch {
        /* ignore */
      }
    }
    clearBridge();
    setStudy(null);
    setFileCount(null);
    setPatientInput("");
  }, [info, clearBridge]);

  /* patient study lookup — same flow as the in-module panel */
  const doFetchStudy = useCallback(async () => {
    if (!info) return;
    const raw = patientInput.trim();
    if (!raw) {
      setError({ fa: "لینک PACS یا کد ملی بیمار را وارد کنید.", en: "Enter a link or ID." });
      return;
    }
    setFetching(true);
    setError(null);
    setStudy(null);
    setFileCount(null);
    try {
      const res = await fetch("/api/medal/study", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sid: info.sid, input: raw }),
      });
      const data = (await res.json()) as MedalStudy & {
        ok?: boolean;
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
      setError({
        fa: e instanceof Error ? e.message.slice(0, 160) : "خطا در دریافت پرونده.",
        en: "Study lookup failed.",
      });
    } finally {
      setFetching(false);
    }
  }, [info, patientInput, clearBridge]);

  /* full package download — mode "1" (the working desktop engine) */
  const doDownload = useCallback(async () => {
    if (!info || !study?.pid) return;
    setDownloading(true);
    setError(null);
    try {
      const res = await fetch("/api/medal/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sid: info.sid,
          pid: study.pid,
          studyKey: study.studyKey,
          hashKey: study.hashKey,
          mode: "1",
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        pid?: string;
        pname?: string | null;
        patientName?: string | null;
        files?: MedalFile[];
        count?: number;
        modality?: string | null;
        modalitySource?: string | null;
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
      const dlFiles = data.files ?? [];
      setFileCount(data.count ?? dlFiles.length);
      const realModality = data.modality ?? study.modality ?? "";
      setStudy((prev) =>
        prev
          ? {
              ...prev,
              pid: data.pid ?? prev.pid,
              pname: data.pname ?? data.patientName ?? prev.pname,
              modality: realModality || prev.modality,
            }
          : prev
      );
      if (dlFiles.length > 0) {
        setHandoff({
          pid: data.pid ?? study.pid ?? "",
          pname: data.pname ?? data.patientName ?? study.pname,
          modality: realModality || null,
          modalitySource: data.modalitySource ?? null,
          studyKey: study.studyKey,
          hashKey: study.hashKey,
          files: dlFiles,
        });
      }
    } catch (e) {
      setError({
        fa: e instanceof Error ? e.message.slice(0, 200) : "دانلود پکیج دایکام ناموفق بود.",
        en: "Download failed.",
      });
    } finally {
      setDownloading(false);
    }
  }, [info, study, clearBridge]);

  const openInModule = useCallback(
    (_moduleId: string) => {
      if (!handoff || !info) return;
      setPending({
        sid: info.sid,
        pid: handoff.pid,
        pname: handoff.pname,
        modality: handoff.modality ?? "",
        studyKey: handoff.studyKey,
        hashKey: handoff.hashKey,
        files: handoff.files,
      });
      setHandoff(null);
      onClose();
    },
    [handoff, info, setPending, onClose]
  );

  if (!open) return null;

  const recommended = handoff?.modality ? modalityToModule(handoff.modality) : null;

  return (
    <>
      {/* module hand-off dialog (on top of the drawer) */}
      {handoff && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          dir="rtl"
        >
          <div className="max-h-[86vh] w-full max-w-md overflow-y-auto rounded-2xl border border-[#253548] bg-[#0f1a29] p-5 shadow-2xl">
            <div className="mb-1 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#a78bfa]/15 text-[#a78bfa]">
                <ArrowUpRight className="h-4.5 w-4.5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-[15px] font-bold text-[#e8eef5]">مطالعه دریافت شد</h3>
                <p className="text-[11px] text-[#8fa3b8]">
                  {handoff.pname ?? "بیمار رادیولوژی"} · {handoff.pid}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHandoff(null)}
                className="mr-auto flex h-8 w-8 items-center justify-center rounded-lg border border-[#253548] text-[#8fa3b8] transition-colors hover:text-white"
                aria-label="بستن"
              >
                ✕
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl bg-[#141e2a] p-2.5 text-[11px]">
              <span className="rounded-lg bg-[#223046] px-2.5 py-1 font-mono font-bold text-[#7ee7f3]">
                {handoff.modality ?? "؟"}
              </span>
              <span className="text-[#8fa3b8]">
                {handoff.modalitySource === "dicom"
                  ? "تشخیص از متادیتای فایل‌های دایکام"
                  : handoff.modalitySource === "page"
                    ? "تشخیص از صفحه مطالعه PACS"
                    : "نوع مطالعه"}
              </span>
              <span className="mr-auto text-[#4ade80]">{handoff.files.length} فایل</span>
            </div>

            <p className="mb-2.5 text-[12px] font-semibold text-[#e8eef5]">در کدام ماژول باز شود؟</p>
            <div className="space-y-2">
              {HANDOFF_OPTIONS.map((opt) => {
                const isRec = recommended === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => openInModule(opt.id)}
                    className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right transition-all active:scale-[0.99] ${
                      isRec
                        ? "border-[#a78bfa]/60 bg-[#241d3a] shadow-[0_0_18px_rgba(167,139,250,0.15)]"
                        : "border-[#253548] bg-[#141e2a] hover:border-[#3a5a7d]"
                    }`}
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                        isRec ? "bg-[#a78bfa]/20 text-[#c4b5fd]" : "bg-[#223046] text-[#8fa3b8]"
                      }`}
                    >
                      {opt.icon === "bone" ? (
                        <Bone className="h-4.5 w-4.5" aria-hidden="true" />
                      ) : opt.icon === "box" ? (
                        <Box className="h-4.5 w-4.5" aria-hidden="true" />
                      ) : (
                        <Brain className="h-4.5 w-4.5" aria-hidden="true" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12.5px] font-bold text-[#e8eef5]">
                        {opt.fa}
                        {isRec && (
                          <span className="mr-2 rounded-full bg-[#a78bfa]/20 px-2 py-0.5 text-[9px] font-bold text-[#c4b5fd]">
                            پیشنهاد سیستم
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] text-[#8fa3b8]">{opt.desc}</span>
                    </span>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-[#5a6e82]" aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* the slide-over itself */}
      <div className="fixed inset-0 z-[80]" role="dialog" aria-modal="true">
        <button
          type="button"
          aria-label="بستن پنل PACS"
          onClick={onClose}
          className="absolute inset-0 h-full w-full cursor-default bg-black/60 backdrop-blur-sm"
        />
        <aside className="absolute inset-y-0 left-0 flex w-full max-w-[420px] flex-col border-r border-[#1f2d3e] bg-[#0B121D] shadow-2xl">
          {/* header */}
          <div className="flex shrink-0 items-center gap-2.5 border-b border-[#1f2d3e] px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#a78bfa]/30 bg-[#241d3a] text-[#a78bfa]">
              <Hospital className="h-4.5 w-4.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 dir="rtl" className="truncate text-[14px] font-bold text-[#e8eef5]">
                اتصال به PACS بیمارستان
              </h2>
              <p className="truncate text-[10px] text-[#8fa3b8]">
                MedalPACS Bridge · MedalWeb
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#253548] text-[#8fa3b8] transition-colors hover:text-white"
              aria-label="بستن"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* body */}
          <div className="scroll-dark flex-1 space-y-3 overflow-y-auto p-4" dir="rtl">
            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-[#f87171]/30 bg-[#f87171]/10 p-2.5"
              >
                <span className="mt-0.5 text-[#f87171]">⚠</span>
                <p className="min-w-0 break-words text-[11px] text-[#fca5a5]">{error.fa}</p>
              </div>
            )}

            {/* ---------------- connected: patient fetch ---------------- */}
            {connected && info ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-[#22c55e]/25 bg-[#12251c]/60 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#4ade80] opacity-60" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#4ade80]" />
                      </span>
                      <p className="truncate text-[12.5px] font-semibold text-[#bbf7d0]">
                        {info.hospitalName ?? info.serverName ?? "MedalPACS"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="rounded-full border border-[#22c55e]/30 bg-[#22c55e]/10 px-2 py-0.5 text-[9px] font-bold text-[#4ade80]">
                        متصل
                      </span>
                      <button
                        type="button"
                        onClick={() => void doLogout()}
                        className="rounded-full border border-[#253548] px-2 py-0.5 text-[9px] font-medium text-[#8fa3b8] transition-colors hover:text-[#fca5a5]"
                      >
                        خروج
                      </button>
                    </div>
                  </div>
                  <p className="text-[10px] text-[#8fa3b8]">
                    {info.username} · اعتبار نشست: ~
                    {Math.round(info.validHoursRemaining ?? 12)} ساعت
                  </p>
                </div>

                {/* patient fetch */}
                <form
                  className="space-y-2 rounded-xl border border-[#253548] bg-[#0f1823] p-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void doFetchStudy();
                  }}
                >
                  <label
                    htmlFor="drawer-pacs-input"
                    className="block text-[11.5px] font-medium text-[#c3d3e2]"
                  >
                    لینک MedalWeb یا کد ملی بیمار
                  </label>
                  <textarea
                    id="drawer-pacs-input"
                    dir="ltr"
                    rows={2}
                    value={patientInput}
                    onChange={(e) => setPatientInput(e.target.value)}
                    placeholder="http://192.168.11.201/MedalWeb/Process.aspx?SK=…"
                    spellCheck={false}
                    className="w-full resize-none rounded-lg border border-[#253548] bg-[#141e2a] px-3 py-2 font-mono text-[10.5px] text-[#e8eef5] placeholder:text-[#5a6e82] focus:border-[#a78bfa]/50 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={fetching}
                    className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#2dd4bf] to-[#0ea5e9] text-[11.5px] font-bold text-[#0b2430] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                  >
                    {fetching ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>در حال جستجوی پرونده…</span>
                      </>
                    ) : (
                      <>
                        <Search className="h-4 w-4" aria-hidden="true" />
                        <span>دریافت پرونده</span>
                      </>
                    )}
                  </button>
                </form>

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
                        <p className="truncate text-[12.5px] font-semibold text-[#e8eef5]">
                          {study.pname ?? "بیمار رادیولوژی"}
                        </p>
                        <p className="truncate text-[10px] text-[#8fa3b8]">
                          شناسه: {study.pid ?? "—"}
                        </p>
                      </div>
                    </div>

                    {fileCount == null ? (
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
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          setHandoff({
                            pid: study.pid ?? "",
                            pname: study.pname,
                            modality: study.modality || null,
                            modalitySource: null,
                            studyKey: study.studyKey,
                            hashKey: study.hashKey,
                            files: [],
                          })
                        }
                        className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#7c3aed] text-[11.5px] font-bold text-[#f5f3ff] transition-all hover:brightness-110 active:scale-[0.99]"
                      >
                        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
                        <span>
                          باز کردن در ماژول ({fileCount} فایل · {study.modality || "؟"})
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* ---------------- not connected: login ---------------- */
              <div className="space-y-3">
                {/* server presets */}
                <div className="space-y-1.5">
                  <p className="text-[11.5px] font-medium text-[#c3d3e2]">انتخاب سرور پکس</p>
                  <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="سرورهای PACS">
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
                        <span className="block truncate text-[10.5px] font-semibold leading-4">
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

                {presetId === "custom" && (
                  <form
                    className="flex gap-1.5"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void doPrepare(serverUrl);
                    }}
                  >
                    <input
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
                      className="h-9 shrink-0 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#8b5cf6] px-3 text-[11px] font-semibold text-[#1e1b4b] transition-all hover:brightness-110 disabled:opacity-50"
                    >
                      {busy === "prepare" ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        "بررسی"
                      )}
                    </button>
                  </form>
                )}

                {busy === "prepare" && (
                  <div className="flex items-center gap-2 rounded-xl border border-[#253548] bg-[#0f1823] p-2.5 text-[11px] text-[#7dd3fc]">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>در حال اتصال به سرور پکس و دریافت کپچا…</span>
                  </div>
                )}

                {prep && (
                  <form
                    className="space-y-2.5 rounded-xl border border-[#253548] bg-[#0f1823] p-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void doLogin();
                    }}
                  >
                    <div className="space-y-1.5">
                      <label htmlFor="drawer-user" className="block text-[11.5px] font-medium text-[#c3d3e2]">
                        نام کاربری
                      </label>
                      <input
                        id="drawer-user"
                        type="text"
                        dir="ltr"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        autoComplete="username"
                        className="h-9 w-full rounded-lg border border-[#253548] bg-[#141e2a] px-3 text-[12px] text-[#e8eef5] focus:border-[#a78bfa]/50 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="drawer-pass" className="block text-[11.5px] font-medium text-[#c3d3e2]">
                        رمز عبور
                      </label>
                      <input
                        id="drawer-pass"
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
                        <label htmlFor="drawer-captcha" className="block text-[11.5px] font-medium text-[#c3d3e2]">
                          کد کپچا
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
                            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-lg border border-[#253548] bg-[#141e2a] text-[#8fa3b8] transition-colors hover:text-white disabled:opacity-50"
                          >
                            {busy === "refresh" ? (
                              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            ) : (
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                            )}
                          </button>
                          <input
                            id="drawer-captcha"
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
                      className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-[#a78bfa] to-[#7c3aed] text-[12px] font-bold text-[#f5f3ff] transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                    >
                      {busy === "login" || connecting ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                          <span>در حال ورود…</span>
                        </>
                      ) : (
                        <>
                          <Hospital className="h-4 w-4" aria-hidden="true" />
                          <span>ورود به PACS</span>
                        </>
                      )}
                    </button>
                  </form>
                )}
              </div>
            )}
          </div>

          {/* footer note */}
          <div className="shrink-0 border-t border-[#1f2d3e] px-4 py-2.5">
            <p className="text-[9.5px] leading-relaxed text-[#5a6e82]">
              نشست ۱۲ ساعته روی دیسک ذخیره می‌شود — مثل روش قبلی نرم‌افزار دسکتاپ. نوع
              مطالعه (ماموگرافی / CT / گرافی) از متادیتای خود فایل‌های دایکام تشخیص داده
              می‌شود و مطالعه در ماژول اختصاصی خودش باز خواهد شد.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
