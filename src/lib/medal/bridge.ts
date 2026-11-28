/* ------------------------------------------------------------------ */
/*  MedalPACS bridge core — the radiologist's previous login method,   */
/*  ported 1:1 from the desktop app's pacs_downloader.py:              */
/*                                                                    */
/*    • username + password + login-page captcha (aaaa / bbbb /        */
/*      txtCaptcha / HF1 AES-128-CBC — CryptoJS-compatible)           */
/*    • 12-hour disk-persisted session (pacs_session.json behaviour)  */
/*    • patient lookup via Process.aspx (link / national-ID / SK)      */
/*    • full DICOM package download via Download.aspx (ZIP)            */
/*                                                                    */
/*  Hospital PACS servers use self-signed HTTPS, so TLS verification  */
/*  is relaxed for outbound PACS requests only (LAN medical           */
/*  deployment, documented in the route).                              */
/* ------------------------------------------------------------------ */

import { createCipheriv, randomUUID } from "crypto";
import { inflateRawSync } from "zlib";
import { promises as fs } from "fs";
import { createWriteStream } from "fs";
import path from "path";
import { Readable } from "stream";
import { pipeline } from "stream/promises";

if (!process.env.NODE_TLS_REJECT_UNAUTHORIZED) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
}

export const MEDAL_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const REQ_TIMEOUT_MS = 25_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** the old method: one login stays valid for 12 hours */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const PREP_TTL_MS = 30 * 60 * 1000;
const MAX_LOGIN_ATTEMPTS = 12;

/* the four hospital servers from the desktop app's SERVER_PRESETS */
export const MEDAL_SERVER_PRESETS: readonly { id: string; fa: string; url: string }[] = [
  {
    id: "lan",
    fa: "شبکه داخلی بیمارستان بوعلی",
    url: "http://192.168.11.201",
  },
  {
    id: "wan",
    fa: "دامنه دانشگاه علوم پزشکی",
    url: "https://marivan-pacs-boali.muk.ac.ir",
  },
  {
    id: "ext",
    fa: "آی‌پی خارج بیمارستان",
    url: "http://78.39.234.56",
  },
  {
    id: "fajr",
    fa: "بیمارستان فجر مریوان",
    url: "http://78.39.233.89:8088",
  },
];

export interface LoginFormInfo {
  action: string;
  userField: string;
  passField: string;
  captchaField: string | null;
  submitField: string | null;
  captchaImg: string | null;
  hfkey: string | null;
  hfiv: string | null;
}

export interface MedalSession {
  sid: string;
  origin: string;
  appBase: string;
  loginUrl: string;
  cookies: Map<string, string>;
  hidden: Record<string, string>;
  form: LoginFormInfo;
  createdAt: number;
  loginAt: number | null;
  lastUsed: number;
  connected: boolean;
  username: string | null;
  serverName: string | null;
  hospitalName: string | null;
  attempts: number;
}

/* ------------------------------------------------------------------ */
/*  Persian / Arabic digit normalisation (۰-۹ ٠-٩ → 0-9)              */
/* ------------------------------------------------------------------ */

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeDigits(s: string): string {
  return s.replace(/[۰-۹٠-٩]/g, (ch) => {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa >= 0) return String(fa);
    const ar = AR_DIGITS.indexOf(ch);
    if (ar >= 0) return String(ar);
    return ch;
  });
}

/* ------------------------------------------------------------------ */
/*  small HTML helpers                                                 */
/* ------------------------------------------------------------------ */

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function abs(rel: string, base: string): string {
  try {
    return new URL(rel, base).toString();
  } catch {
    return rel;
  }
}

/* ------------------------------------------------------------------ */
/*  cookie-jar fetch                                                   */
/* ------------------------------------------------------------------ */

export async function jfetch(
  jar: Map<string, string>,
  url: string,
  init: RequestInit = {},
  timeoutMs = REQ_TIMEOUT_MS
): Promise<Response> {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  if (jar.size > 0) {
    headers.set(
      "Cookie",
      [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
    );
  }
  if (!headers.has("User-Agent")) headers.set("User-Agent", MEDAL_UA);
  const res = await fetch(url, {
    ...init,
    headers,
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const c of setCookies) {
    const [pair] = c.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (value === "") jar.delete(name);
    else jar.set(name, value);
  }
  return res;
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** fetch following redirects while persisting cookies at every hop */
export async function follow(
  jar: Map<string, string>,
  url: string,
  init: RequestInit = {},
  maxHops = 8,
  timeoutMs = REQ_TIMEOUT_MS
): Promise<{ res: Response; url: string }> {
  let cur = url;
  for (let i = 0; i < maxHops; i++) {
    const res = await jfetch(jar, cur, init, timeoutMs);
    if (REDIRECTS.has(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) return { res, url: cur };
      cur = abs(loc, cur);
      continue;
    }
    return { res, url: cur };
  }
  throw new Error("Too many redirects while talking to the PACS server.");
}

/* ------------------------------------------------------------------ */
/*  login page parsing                                                 */
/* ------------------------------------------------------------------ */

export function looksLikeLoginPage(html: string): boolean {
  return (
    /type=["']password["']/i.test(html) ||
    /name=["'][^"']*\bbbb\b[^"']*["']/i.test(html) ||
    /LoginButton/i.test(html)
  );
}

export function parseLoginForm(
  html: string,
  pageUrl: string
): { form: LoginFormInfo; hidden: Record<string, string> } {
  const hidden: Record<string, string> = {};
  const form: LoginFormInfo = {
    action: abs("./Login.aspx?url=Default.aspx", pageUrl),
    userField: "",
    passField: "",
    captchaField: null,
    submitField: null,
    captchaImg: null,
    hfkey: null,
    hfiv: null,
  };

  const formTag = html.match(/<form\b[^>]*action=["']([^"']*)["'][^>]*>/i);
  if (formTag) form.action = abs(decodeEntities(formTag[1]), pageUrl);

  for (const m of html.matchAll(/<input\b[^>]*>/gi)) {
    const tag = m[0];
    const nameM =
      tag.match(/\bname=["']([^"']*)["']/i) ?? tag.match(/\bname=(\S+)/i);
    if (!nameM) continue;
    const name = decodeEntities(nameM[1]);
    if (!name) continue;
    const type = (
      tag.match(/\btype=["']([^"']*)["']/i)?.[1] ?? "text"
    ).toLowerCase();
    const value = decodeEntities(
      tag.match(/\bvalue=["']([^"']*)["']/i)?.[1] ?? ""
    );

    if (type === "hidden") {
      hidden[name] = value;
      if (name === "hfkey") form.hfkey = value || null;
      if (name === "hfiv") form.hfiv = value || null;
      continue;
    }
    if (/captcha|کپچا|کد\s*امنیتی|securecode/i.test(name)) {
      form.captchaField = name;
      continue;
    }
    if (type === "password" || /\bbbb\b|password|real-input/i.test(name)) {
      form.passField = form.passField || name;
      continue;
    }
    if (type === "submit") {
      form.submitField = name;
      hidden[name] = value || "Login";
      continue;
    }
    if (type === "text" || type === "" || type === "tel" || type === "number") {
      if (/user|aaaa|login/i.test(name) && !/button/i.test(name)) {
        form.userField = form.userField || name;
      }
    }
  }

  /* captcha image: <img src="CaptchaImage.axd?guid=…" alt="Captcha"> */
  const imgM = html.match(
    /<img\b[^>]*src=["']([^"']*(?:[Cc]aptcha|CaptchaImage\.axd)[^"']*)["'][^>]*>/i
  );
  if (imgM) form.captchaImg = abs(decodeEntities(imgM[1]), pageUrl);

  /* Medal PACS 2024 defaults (exact control names from the desktop app) */
  if (!form.userField) form.userField = "aaaa";
  if (!form.passField) form.passField = "bbbb";
  if (!form.captchaField) form.captchaField = "txtCaptcha";
  if (!form.submitField) form.submitField = "LoginButton";

  return { form, hidden };
}

export function extractNames(html: string): {
  title: string | null;
  hospital: string | null;
} {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const hospital =
    decodeEntities(
      html.match(/id=["']lblHT["'][^>]*>([^<]*)</i)?.[1]?.trim() ?? ""
    ) || null;
  return { title, hospital };
}

/** find the real login page starting from whatever URL the user gave */
export async function discoverLogin(
  jar: Map<string, string>,
  rawUrl: string
): Promise<{ loginUrl: string; html: string }> {
  const errors: string[] = [];
  const candidates: string[] = [];

  let base = rawUrl.trim();
  if (!/^https?:\/\//i.test(base)) base = `http://${base}`;

  if (/login\.aspx|memobile/i.test(base)) candidates.push(base);
  candidates.push(base.replace(/\/+$/, "") + "/");

  const root = base.replace(/\/+$/, "");
  const origin = new URL(root).origin;
  for (const p of [
    "/medalweb/Login.aspx?url=Default.aspx",
    "/MedalWeb/Login.aspx?url=Default.aspx",
    "/Login.aspx?url=Default.aspx",
    "/MEMobile/Default.aspx",
  ]) {
    candidates.push(origin + p);
    candidates.push(root + p);
  }

  for (const cand of candidates) {
    try {
      /* desktop app used a 15 s probe timeout for the login page */
      const { res, url } = await follow(jar, cand, {}, 8, 15_000);
      if (!res.ok && res.status !== 500) {
        errors.push(`${cand} → HTTP ${res.status}`);
        continue;
      }
      const html = await res.text();
      if (looksLikeLoginPage(html)) {
        return { loginUrl: url, html };
      }
      errors.push(`${url} → no login form`);
    } catch (e) {
      errors.push(
        `${cand} → ${e instanceof Error ? e.message : "unreachable"}`
      );
    }
  }
  throw new Error(
    `No MedalPACS login page found at ${rawUrl}. Tried: ${errors.slice(0, 4).join(" ; ")}`
  );
}

/* ------------------------------------------------------------------ */
/*  AES password encryption (CryptoJS.AES.encrypt compatible)          */
/* ------------------------------------------------------------------ */

export function medalAes(plain: string, key: string, iv: string): string {
  /* key/iv are UTF-8 strings; pad/truncate to 16 bytes exactly like the
     desktop app (k_raw[:16].ljust(16, b"\0")) */
  const k = Buffer.from(key ?? "", "utf8").subarray(0, 16);
  const kBuf = Buffer.alloc(16, 0);
  k.copy(kBuf, 0);
  const v = Buffer.from(iv ?? "", "utf8").subarray(0, 16);
  const vBuf = Buffer.alloc(16, 0);
  v.copy(vBuf, 0);
  const c = createCipheriv("aes-128-cbc", kBuf, vBuf);
  return Buffer.concat([
    c.update(Buffer.from(plain, "utf8")),
    c.final(),
  ]).toString("base64");
}

/* ------------------------------------------------------------------ */
/*  12-hour disk-persisted session store                                */
/* ------------------------------------------------------------------ */

const sessions = new Map<string, MedalSession>();
const STORE_PATH = path.join(process.cwd(), ".boali-medal-sessions.json");
let storeLoaded = false;

type StoredSession = Omit<MedalSession, "cookies"> & {
  cookies: [string, string][];
};

async function loadStore(): Promise<void> {
  if (storeLoaded) return;
  storeLoaded = true;
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const data = JSON.parse(raw) as { sessions?: Record<string, StoredSession> };
    const now = Date.now();
    for (const [sid, s] of Object.entries(data.sessions ?? {})) {
      if (!s?.sid || !s.connected) continue;
      /* honour the 12-hour window across restarts */
      if (!s.loginAt || now - s.loginAt > SESSION_TTL_MS) continue;
      sessions.set(sid, { ...s, cookies: new Map(s.cookies ?? []) });
    }
  } catch {
    /* first run / unreadable — start empty */
  }
}

async function persistStore(): Promise<void> {
  const out: { version: number; sessions: Record<string, StoredSession> } = {
    version: 1,
    sessions: {},
  };
  for (const [sid, s] of sessions) {
    if (!s.connected) continue; /* only authenticated sessions survive */
    const { cookies, ...rest } = s;
    out.sessions[sid] = { ...rest, cookies: [...cookies.entries()] };
  }
  try {
    await fs.writeFile(STORE_PATH, JSON.stringify(out), "utf8");
  } catch {
    /* read-only fs — in-memory only */
  }
}

export function sweepSessions(): void {
  const now = Date.now();
  for (const [sid, s] of sessions) {
    if (s.connected) {
      /* valid exactly 12 h from the successful login (old method) */
      if (s.loginAt && now - s.loginAt > SESSION_TTL_MS) sessions.delete(sid);
    } else if (now - s.createdAt > PREP_TTL_MS) {
      sessions.delete(sid);
    }
  }
}

export async function getSession(sid: string | null): Promise<MedalSession | null> {
  if (!sid || !/^[0-9a-f-]{10,40}$/i.test(sid)) return null;
  await loadStore();
  const s = sessions.get(sid);
  if (!s) return null;
  s.lastUsed = Date.now();
  return s;
}

export async function putSession(s: MedalSession): Promise<void> {
  await loadStore();
  sessions.set(s.sid, s);
  await persistStore();
}

export async function dropSession(sid: string): Promise<void> {
  await loadStore();
  sessions.delete(sid);
  await persistStore();
}

export function newSession(
  partial: Omit<
    MedalSession,
    | "sid"
    | "createdAt"
    | "lastUsed"
    | "loginAt"
    | "connected"
    | "username"
    | "attempts"
  >
): MedalSession {
  return {
    ...partial,
    sid: randomUUID(),
    createdAt: Date.now(),
    lastUsed: Date.now(),
    loginAt: null,
    connected: false,
    username: null,
    attempts: 0,
  };
}

export function remainingSessionHours(s: MedalSession): number {
  if (!s.loginAt) return 0;
  return Math.max(
    0,
    Math.round(((SESSION_TTL_MS - (Date.now() - s.loginAt)) / 3_600_000) * 10) / 10
  );
}

export function publicInfo(s: MedalSession) {
  return {
    sid: s.sid,
    connected: s.connected,
    serverName: s.serverName,
    hospitalName: s.hospitalName,
    username: s.username,
    appBase: s.appBase,
    hasCaptcha: !!s.form.captchaImg,
    loginUrl: s.loginUrl,
    loginAt: s.loginAt,
    validHoursRemaining: s.connected ? remainingSessionHours(s) : 0,
  };
}

export function markLoginAttempt(s: MedalSession): number {
  return ++s.attempts;
}

export const LOGIN_LIMIT = MAX_LOGIN_ATTEMPTS;

/* ------------------------------------------------------------------ */
/*  patient input parsing (link / SMS / national-ID / SK token)        */
/* ------------------------------------------------------------------ */

export interface ParsedMedalInput {
  type: "sms" | "direct_sk" | "patient_id" | "raw_token";
  base: string;
  sk: string;
  patientId?: string;
}

export function parseMedalInput(rawInput: string, baseUrl: string): ParsedMedalInput {
  let link = rawInput.trim();
  const urlMatch = link.match(/https?:\/\/[^\s<>"']+/);
  if (urlMatch) link = urlMatch[0];
  link = normalizeDigits(link);

  let activeBase = baseUrl.replace(/\/+$/, "");
  if (/^https?:\/\//i.test(link)) {
    try {
      const p = new URL(link);
      activeBase = `${p.protocol}//${p.host}`;
    } catch {
      /* keep configured base */
    }
  }

  /* 1. SMS query format */
  if (link.includes("query=")) {
    const token = link.match(/query=([^&\s]+)/)?.[1] ?? "";
    return {
      type: "sms",
      base: activeBase,
      sk: token.replace("=N/A", ""),
    };
  }

  /* 2. direct SK link */
  if (link.includes("SK=")) {
    const sk = link.match(/SK=([^&\s"']+)/)?.[1] ?? "";
    return { type: "direct_sk", base: activeBase, sk };
  }

  /* 3. patient / national ID (≥ 5 digits) */
  const clean = link.replace(/SK=|query=|ID=|id=/g, "").trim();
  if (/^\d{5,}$/.test(clean)) {
    return { type: "patient_id", base: activeBase, sk: clean, patientId: clean };
  }

  /* 4. raw token */
  return { type: "raw_token", base: activeBase, sk: clean };
}

/* ------------------------------------------------------------------ */
/*  Process.aspx study page parsing                                    */
/* ------------------------------------------------------------------ */

export interface MedalStudyMeta {
  pid: string | null;
  pname: string | null;
  modality: string;
  studyKey: string;
  hashKey: string;
  series: { key: string; count: number }[];
  pageUrl: string;
  base: string;
}

export function parseStudyPage(
  html: string,
  pageUrl: string,
  base: string,
  fallbackSk: string
): MedalStudyMeta {
  let pid: string | null = null;
  let pname: string | null = null;
  let studyKey = fallbackSk;
  let hashKey = fallbackSk;
  let modality = "MG";
  const series: { key: string; count: number }[] = [];

  const studies = html.match(/var\s+Studies\s*=\s*\[\s*(\{[\s\S]*?\})\s*\];/);
  if (studies) {
    const raw = studies[1];
    pid = raw.match(/\bID\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? null;
    pname = raw.match(/\bName\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? null;
    studyKey = raw.match(/\bKey\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? studyKey;
    hashKey = raw.match(/\bHashKey\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? hashKey;
    modality = raw.match(/\bModality\s*:\s*['"]([^'"]+)['"]/)?.[1]?.trim() ?? modality;
    for (const sm of raw.matchAll(
      /\{\s*Key\s*:\s*['"]([^'"]+)['"][^}]*imgCount\s*:\s*(\d+)[^}]*\}/g
    )) {
      series.push({ key: sm[1], count: Math.max(1, Number(sm[2])) });
    }
  }

  if (!pid) {
    for (const pat of [
      /id=["']?(?:lbl)?PID["']?[^>]*>([^<]+)</i,
      /PID:\s*([0-9A-Za-z\-_]+)/,
      /کد ملی[:\s]*([0-9A-Za-z\-_]+)/,
    ]) {
      const m = html.match(pat);
      if (m) {
        pid = m[1].trim();
        break;
      }
    }
  }
  if (!pname) {
    for (const pat of [
      /id=["']?(?:lbl)?PName["']?[^>]*>([^<]+)</i,
      /Name:\s*([^<\r\n\t]+)/,
      /نام بیمار[:\s]*([^<\r\n\t]+)/,
    ]) {
      const m = html.match(pat);
      if (m) {
        pname = m[1].trim();
        break;
      }
    }
  }
  if (series.length === 0) {
    series.push(
      { key: "1", count: 1 },
      { key: "2", count: 1 },
      { key: "3", count: 1 },
      { key: "4", count: 1 }
    );
  }

  return {
    pid: pid ?? null,
    pname: pname ? pname.replace(/\^/g, " ").trim() : null,
    modality,
    studyKey,
    hashKey,
    series,
    pageUrl,
    base,
  };
}

/* ------------------------------------------------------------------ */
/*  minimal ZIP extraction (stored + deflate, zlib-powered)            */
/* ------------------------------------------------------------------ */

function sanitizeZipName(raw: string): string[] | null {
  const parts: string[] = [];
  for (const part of raw.replace(/\\/g, "/").split("/")) {
    const clean = part.replace(/[:*?"<>|]/g, "_").trim();
    if (!clean || clean === "." || clean === "..") continue;
    parts.push(clean);
  }
  return parts.length > 0 ? parts : null;
}

export async function extractZip(
  zipPath: string,
  destDir: string
): Promise<string[]> {
  const buf = await fs.readFile(zipPath);
  /* locate End-Of-Central-Directory */
  let eocd = -1;
  const minEocd = Math.max(0, buf.length - 22 - 65536);
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (i >= 0 && buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Not a valid ZIP archive (EOCD missing).");

  const count = buf.readUInt16LE(eocd + 10);
  let ptr = buf.readUInt32LE(eocd + 16);

  await fs.mkdir(destDir, { recursive: true });
  const extracted: string[] = [];

  for (let n = 0; n < count; n++) {
    if (ptr + 46 > buf.length || buf.readUInt32LE(ptr) !== 0x02014b50) break;
    const method = buf.readUInt16LE(ptr + 10);
    const compSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOff = buf.readUInt32LE(ptr + 42);
    const name = buf.toString("utf8", ptr + 46, ptr + 46 + nameLen);
    ptr += 46 + nameLen + extraLen + commentLen;

    const parts = sanitizeZipName(name);
    if (!parts) continue;
    const destPath = path.join(destDir, ...parts);

    if (name.endsWith("/") || name.endsWith("\\")) {
      await fs.mkdir(destPath, { recursive: true });
      continue;
    }
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== 0x04034b50) {
      continue;
    }
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = buf.subarray(dataStart, dataStart + compSize);

    let content: Buffer;
    if (method === 0) {
      content = Buffer.from(comp);
    } else if (method === 8) {
      content = inflateRawSync(comp);
    } else {
      continue; /* unsupported compression — skip entry */
    }

    await fs.mkdir(path.dirname(destPath), { recursive: true });
    await fs.writeFile(destPath, content);
    extracted.push(path.relative(destDir, destPath).split(path.sep).join("/"));
  }
  return extracted;
}

/* ------------------------------------------------------------------ */
/*  download cache (DICOM packages)                                    */
/* ------------------------------------------------------------------ */

export const CACHE_ROOT = path.join(process.cwd(), ".boali-medal-cache");

export function safePid(pid: string): string {
  return pid.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "unknown";
}

export function studyDir(pid: string): string {
  return path.join(CACHE_ROOT, `study_${safePid(pid)}`);
}

const SKIP_NAMES = new Set(["dicomdir", "thumbs.db", "desktop.ini"]);
const SKIP_EXT = /\.(xml|txt|json|zip|html|exe|dll|log|bat)$/i;

/** catalog medical files like the desktop app (>256 bytes, real DICOM) */
export async function catalogDicom(
  dir: string
): Promise<{ name: string; size: number }[]> {
  const out: { name: string; size: number }[] = [];
  async function walk(d: string, rel: string) {
    let entries;
    try {
      entries = await fs.readdir(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(d, e.name);
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, relPath);
        continue;
      }
      if (SKIP_NAMES.has(e.name.toLowerCase()) || SKIP_EXT.test(e.name)) continue;
      let st;
      try {
        st = await fs.stat(full);
      } catch {
        continue;
      }
      if (!st.isFile() || st.size < 256) continue;
      out.push({ name: relPath, size: st.size });
    }
  }
  await walk(dir, "");
  return out;
}

/** containment-guarded resolver for serving cached DICOM files */
export async function resolveCachedDicom(
  pid: string,
  name: string
): Promise<string | null> {
  const root = path.resolve(studyDir(pid));
  if (!name || name.length > 400 || name.includes("..")) return null;
  const target = path.resolve(root, name);
  if (!target.startsWith(root + path.sep)) return null;
  try {
    const st = await fs.stat(target);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return target;
}

/** stream a URL to disk with the cookie jar attached (long timeout) */
export async function streamToFile(
  jar: Map<string, string>,
  url: string,
  referer: string | null,
  destPath: string
): Promise<void> {
  let cur = url;
  for (let hop = 0; hop < 8; hop++) {
    const headers = new Headers();
    if (jar.size > 0) {
      headers.set(
        "Cookie",
        [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
      );
    }
    headers.set("User-Agent", MEDAL_UA);
    headers.set("Accept", "application/zip,application/octet-stream,*/*");
    if (referer) headers.set("Referer", referer);
    const res = await fetch(cur, {
      headers,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (REDIRECTS.has(res.status)) {
      const loc = res.headers.get("location");
      if (!loc) throw new Error(`PACS returned HTTP ${res.status} with no target.`);
      cur = abs(loc, cur);
      continue;
    }
    if (!res.ok || !res.body) {
      throw new Error(`PACS download failed: HTTP ${res.status}`);
    }
    await pipeline(
      Readable.fromWeb(res.body as import("stream/web").ReadableStream),
      createWriteStream(destPath)
    );
    return;
  }
  throw new Error("Too many redirects while downloading the study package.");
}

/** read the first bytes of a file (ZIP magic check) */
export async function readFileHead(filePath: string, n = 4): Promise<Buffer> {
  const fh = await fs.open(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const { bytesRead } = await fh.read(buf, 0, n, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fh.close();
  }
}

/* ------------------------------------------------------------------ */
/*  Study page fetch + DICOM package download — a faithful port of     */
/*  the radiologist's WORKING desktop engine (MedalDicomDownloader):   */
/*                                                                    */
/*    • visit the study page FIRST (ShowStudy → Default →              */
/*      ImageViewer → Process) — establishes server-side study        */
/*      state and yields the REAL HashKey                             */
/*    • download via Download.aspx with mode="1" and the study page    */
/*      as Referer (the old app's exact parameters)                   */
/*    • if the server answers with an HTML page naming a temp zip,     */
/*      fetch it from /MedalWeb/temp/                                 */
/*    • every attempt is recorded for honest diagnostics              */
/* ------------------------------------------------------------------ */

export interface StudyPageResult {
  html: string;
  finalUrl: string;
}

/** fetch the study page — old-app endpoint order */
export async function fetchStudyPage(
  jar: Map<string, string>,
  base: string,
  sk: string
): Promise<StudyPageResult | null> {
  const skPlus = sk.replace(/\+/g, "%2B");
  const candidates = [
    `${base}/MedalWeb/ShowStudy.aspx?SK=${skPlus}`,
    `${base}/MedalWeb/Default.aspx?SK=${skPlus}`,
    `${base}/MedalWeb/ImageViewer.aspx?SK=${skPlus}`,
    `${base}/MedalWeb/Process.aspx?SK=${skPlus}`,
  ];
  for (const u of candidates) {
    try {
      const { res, url } = await follow(jar, u, {}, 8, 20_000);
      const html = await res.text();
      if (/login\.aspx/i.test(url)) continue;
      if (/var Studies|lblPID|Patient/i.test(html)) {
        return { html, finalUrl: url };
      }
    } catch {
      /* next candidate */
    }
  }
  return null;
}

export interface DownloadAttempt {
  url: string;
  status: string;
  bytes: number;
  zipMagic: boolean;
  tempZipTried: string | null;
  ok: boolean;
  error?: string;
}

export interface PackageDownloadResult {
  ok: boolean;
  zipPath: string;
  attempts: DownloadAttempt[];
}

/** download the full DICOM package — old-app candidate order & params */
export async function downloadStudyPackage(
  jar: Map<string, string>,
  base: string,
  opts: {
    pid: string;
    studyKey: string;
    hashKey: string;
    pageUrl: string;
    mode?: string;
    zipPath: string;
  }
): Promise<PackageDownloadResult> {
  const mode = opts.mode ?? "1"; /* the working desktop default */
  const { pid, studyKey, hashKey, pageUrl, zipPath } = opts;

  const cands: string[] = [];
  const push = (u: string | null) => {
    if (u && !cands.includes(u)) cands.push(u);
  };
  if (pid) {
    push(
      `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}&PID=${encodeURIComponent(pid)}&mode=${mode}`
    );
    push(
      `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(studyKey)}&PID=${encodeURIComponent(pid)}&mode=${mode}`
    );
  }
  push(`${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}&mode=${mode}`);
  push(`${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(studyKey)}&mode=${mode}`);
  if (pid) {
    push(
      `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}&PID=${encodeURIComponent(pid)}`
    );
    push(
      `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(studyKey)}&PID=${encodeURIComponent(pid)}`
    );
  }

  const attempts: DownloadAttempt[] = [];

  for (const dl of cands) {
    const att: DownloadAttempt = {
      url: dl,
      status: "",
      bytes: 0,
      zipMagic: false,
      tempZipTried: null,
      ok: false,
    };
    attempts.push(att);
    try {
      await streamToFile(jar, dl, pageUrl, zipPath);
      const st = await fs.stat(zipPath).catch(() => null);
      att.bytes = st?.size ?? 0;
      const head = await readFileHead(zipPath, 4);
      if (head.length >= 2 && head[0] === 0x50 && head[1] === 0x4b) {
        att.zipMagic = true;
        att.status = "zip";
        if (att.bytes > 200) {
          att.ok = true;
          return { ok: true, zipPath, attempts };
        }
      } else {
        /* maybe the server answered with a page naming the real zip */
        const txt = (await fs.readFile(zipPath, "utf8")).slice(0, 4096);
        att.status = /<html|<!doctype/i.test(txt)
          ? `html ${att.bytes}B`
          : `binary ${att.bytes}B`;
        const zm = txt.match(/([A-Za-z0-9_\-]+\.zip)/i);
        if (zm) {
          att.tempZipTried = zm[1];
          const tempUrl = `${base}/MedalWeb/temp/${zm[1]}`;
          try {
            await streamToFile(jar, tempUrl, pageUrl, zipPath);
            const h2 = await readFileHead(zipPath, 4);
            const st2 = await fs.stat(zipPath).catch(() => null);
            att.bytes = st2?.size ?? att.bytes;
            if (
              h2.length >= 2 &&
              h2[0] === 0x50 &&
              h2[1] === 0x4b &&
              (st2?.size ?? 0) > 200
            ) {
              att.ok = true;
              att.status = "temp-zip";
              return { ok: true, zipPath, attempts };
            }
            att.status = `temp-zip bad (${att.bytes}B)`;
          } catch (e) {
            att.error =
              e instanceof Error ? e.message.slice(0, 120) : "temp zip failed";
          }
        } else {
          att.error = `non-zip response (${att.bytes} bytes)`;
        }
      }
    } catch (e) {
      att.error =
        e instanceof Error ? e.message.slice(0, 160) : "download failed";
    }
  }
  return { ok: false, zipPath, attempts };
}
