/* ------------------------------------------------------------------ */
/*  MedalPACS Bridge — real hospital PACS connection.                  */
/*                                                                    */
/*  Exactly the radiologist's previous method (desktop                 */
/*  pacs_downloader.py), inside the modern workstation:                */
/*                                                                    */
/*    1. pick one of the four hospital servers (or a custom URL)       */
/*    2. discover Login.aspx (follow redirects / probe common paths)   */
/*    3. parse the ASP.NET WebForms postback fields, the               */
/*       aaaa / bbbb / txtCaptcha control names and the hfkey/hfiv     */
/*       AES pair used to encrypt the password client-side             */
/*       (CryptoJS AES-128-CBC / PKCS7 → HF1)                          */
/*    4. proxy the session-bound captcha image (CaptchaImage.axd)      */
/*    5. POST the credentials + captcha and detect success/failure     */
/*    6. keep the authenticated cookie jar server-side for 12 hours    */
/*       (disk-persisted — survives restarts like pacs_session.json)   */
/*    7. patient lookup (link / national-ID / SK) via Process.aspx     */
/*       and full DICOM package download via Download.aspx (ZIP)       */
/*                                                                    */
/*  Hospital PACS servers frequently use self-signed HTTPS, so TLS     */
/*  verification is relaxed for outbound PACS requests only            */
/*  (documented, LAN-only medical deployment).                         */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import {
  CACHE_ROOT,
  LOGIN_LIMIT,
  MEDAL_SERVER_PRESETS,
  catalogDicom,
  discoverLogin,
  dropSession,
  extractNames,
  extractZip,
  follow,
  getSession,
  jfetch,
  looksLikeLoginPage,
  markLoginAttempt,
  medalAes,
  newSession,
  normalizeDigits,
  parseLoginForm,
  parseMedalInput,
  parseStudyPage,
  putSession,
  publicInfo,
  readFileHead,
  resolveCachedDicom,
  safePid,
  streamToFile,
  stripTags,
  studyDir,
  sweepSessions,
} from "@/lib/medal/bridge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/*  helpers                                                            */
/* ------------------------------------------------------------------ */

function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data as Record<string, unknown>, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function errJson(e: unknown, fallback: string, status = 502): NextResponse {
  return json(
    { error: e instanceof Error ? e.message : fallback },
    status
  );
}

/** old-method login success detection (redirect / auth cookie / portal) */
function medalLoginSucceeded(
  finalUrl: string,
  html: string,
  cookieNames: string[]
): boolean {
  const isRedirected = !/login\.aspx/i.test(finalUrl);

  const hasRealAuth = cookieNames.some(
    (c) =>
      !["asp.net_sessionid", "sessionid"].includes(c) &&
      /auth|token|medal|user/i.test(c)
  );

  const stillHasLoginForm =
    (/name="aaaa"|id="aaaa"/i.test(html) &&
      /id="loginbutton"|name="loginbutton"/i.test(html)) ||
    looksLikeLoginPage(html);

  const hasPortalIndicators = [
    "خوش آمدید",
    "logout",
    "خروج",
    "serieslist",
    "process.aspx",
    "viewer.aspx",
    "breportpacs",
    "cbpatient",
    "default.aspx",
    "mpmain.aspx",
  ].some((w) => html.toLowerCase().includes(w));

  return (isRedirected || hasRealAuth || hasPortalIndicators) && !stillHasLoginForm;
}

/** old-method error extraction (red div → message labels → keywords) */
function extractLoginError(html: string): string | null {
  const redDiv = html.match(
    /<div[^>]*color:\s*Red[^>]*>([\s\S]*?)<\/div>/i
  )?.[1];
  if (redDiv) {
    const clean = stripTags(redDiv);
    if (clean) return clean;
  }
  for (const m of html.matchAll(
    /<(?:span|div|label|p|td|font)\b[^>]*(?:id|class)=["']([^"']*(?:error|msg|alert|warn|info|result|lbl)[^"']*)["'][^>]*>([\s\S]*?)<\/(?:span|div|label|p|td|font)>/gi
  )) {
    const clean = stripTags(m[2]);
    if (
      clean &&
      clean.length < 150 &&
      !/copyright|powered|medal|2024|claro|بیمارستان بوعلی/i.test(clean)
    ) {
      return clean;
    }
  }
  const kw = html.match(
    /(?:کد امنیتی|رمز عبور|نام کاربری|اشتباه|نامعتبر|تایید نشد|منقضی|Invalid|Incorrect|Failed|Access Denied)[^<\n]{0,90}/i
  );
  return kw ? kw[0].trim() : null;
}

/** worklist parsing (tolerant of layout changes) */
function parseWorklist(html: string): {
  kind: "table" | "app";
  title: string | null;
  studies: { cells: string[] }[];
  note: string;
} {
  const title = html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? null;
  const DATE =
    /\b(1[234]\d{2}[/\-.]\d{1,2}[/\-.]\d{1,2}|20\d{2}[-/.]\d{1,2}[-/.]\d{1,2})\b/;
  const MODALITY = /\b(CR|CT|MR|US|MG|DX|XA|PT|NM|RF|OT)\b/;

  const best: { cells: string[] }[] = [];
  for (const tm of html.matchAll(/<table\b[^>]*>([\s\S]*?)<\/table>/gi)) {
    const rows: { cells: string[] }[] = [];
    for (const rm of tm[1].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = [...rm[1].matchAll(/<t[hd]\b[^>]*>([\s\S]*?)<\/t[hd]>/gi)].map(
        (c) => stripTags(c[1])
      );
      const joined = cells.join(" ");
      if (cells.length >= 3 && (DATE.test(joined) || MODALITY.test(joined))) {
        rows.push({ cells: cells.filter((c) => c.length > 0) });
      }
    }
    if (rows.length > best.length) best.splice(0, best.length, ...rows);
  }

  if (best.length > 0) {
    return { kind: "table", title, studies: best.slice(0, 120), note: "" };
  }
  return {
    kind: "app",
    title,
    studies: [],
    note:
      "The workstation page loaded, but its study list is rendered by client-side JavaScript. " +
      "The bridge session is active — use the patient box below to fetch a study by link / national ID.",
  };
}

/* ------------------------------------------------------------------ */
/*  GET handlers                                                       */
/* ------------------------------------------------------------------ */

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ action: string[] }> }
) {
  const { action } = await ctx.params;
  const segs = (action ?? []).map((s) => decodeURIComponent(s));
  const [head] = segs;
  sweepSessions();

  try {
    /* ---------------- presets (the four hospital servers) ------------ */
    if (head === "presets") {
      return json({ presets: MEDAL_SERVER_PRESETS });
    }

    /* ---------------- prepare: discover + parse the login page ------- */
    if (head === "prepare") {
      const raw = req.nextUrl.searchParams.get("url")?.trim() ?? "";
      if (!raw || raw.length > 300 || /\s/.test(raw)) {
        return json(
          { error: "Provide the PACS server URL (?url=…)." },
          400
        );
      }
      const jar = new Map<string, string>();
      const { loginUrl, html } = await discoverLogin(jar, raw);
      const u = new URL(loginUrl);
      const appBase = `${u.origin}${u.pathname.replace(/[^/]*$/, "")}`.replace(
        /\/+$/,
        ""
      );
      const parsed = parseLoginForm(html, loginUrl);
      const names = extractNames(html);

      /* captcha fallback candidates (desktop app order) */
      if (!parsed.form.captchaImg) {
        for (const ep of [
          "CaptchaImage.axd",
          "Captcha.aspx",
          "captcha.aspx",
          "Turing.aspx",
          "turing.aspx",
        ]) {
          const cand = new URL(ep, loginUrl).toString();
          try {
            const res = await jfetch(jar, cand, {
              headers: {
                Referer: loginUrl,
                Accept: "image/webp,image/apng,image/*,*/*",
              },
            });
            if (res.ok) {
              const buf = await res.arrayBuffer();
              if (buf.byteLength > 100) {
                parsed.form.captchaImg = cand;
                break;
              }
            }
          } catch {
            /* try next */
          }
        }
      }

      const sess = newSession({
        origin: u.origin,
        appBase,
        loginUrl,
        cookies: jar,
        hidden: parsed.hidden,
        form: parsed.form,
        serverName: names.title ?? u.host,
        hospitalName: names.hospital,
      });
      await putSession(sess);
      return json({
        ...publicInfo(sess),
        captchaUrl: sess.form.captchaImg
          ? `/api/medal/captcha?sid=${sess.sid}`
          : null,
      });
    }

    /* ---------------- captcha image proxy ---------------------------- */
    if (head === "captcha") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      if (!s.form.captchaImg)
        return json({ error: "This PACS has no captcha." }, 400);
      const res = await jfetch(s.cookies, s.form.captchaImg);
      const buf = await res.arrayBuffer();
      const h = new Headers();
      h.set("Content-Type", res.headers.get("content-type") ?? "image/jpeg");
      h.set("Cache-Control", "no-store, max-age=0");
      return new NextResponse(buf, { status: res.status, headers: h });
    }

    /* ---------------- refresh: reload login page (new captcha) ------- */
    if (head === "refresh") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      const { res, url } = await follow(s.cookies, s.loginUrl);
      const html = await res.text();
      if (!looksLikeLoginPage(html)) {
        return json({ error: "Could not reload the login page." }, 502);
      }
      const parsed = parseLoginForm(html, url);
      s.hidden = parsed.hidden;
      s.form = parsed.form;
      s.loginUrl = url;
      s.connected = false;
      const names = extractNames(html);
      if (names.hospital) s.hospitalName = names.hospital;
      await putSession(s);
      return json({
        ...publicInfo(s),
        captchaUrl: s.form.captchaImg
          ? `/api/medal/captcha?sid=${s.sid}`
          : null,
      });
    }

    /* ---------------- status ----------------------------------------- */
    if (head === "status") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ connected: false }, 200);
      /* 12-hour window expired? (old method) */
      if (s.connected && s.loginAt && Date.now() - s.loginAt > 12 * 3_600_000) {
        await dropSession(s.sid);
        return json({ connected: false, expired: true }, 200);
      }
      return json(publicInfo(s));
    }

    /* ---------------- worklist (post-login) -------------------------- */
    if (head === "worklist") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      if (!s.connected)
        return json({ error: "Not connected — sign in first." }, 401);
      const { res, url } = await follow(s.cookies, `${s.appBase}/Default.aspx`);
      if (/login\.aspx/i.test(url)) {
        s.connected = false;
        await putSession(s);
        return json(
          { expired: true, error: "PACS session expired — sign in again." },
          401
        );
      }
      const html = await res.text();
      return json(parseWorklist(html));
    }

    /* ---------------- cached DICOM file serving ---------------------- */
    if (head === "dicom") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      const pid = req.nextUrl.searchParams.get("pid") ?? "";
      const name = req.nextUrl.searchParams.get("name") ?? "";
      if (!pid || !name) return json({ error: "Missing pid / name." }, 400);
      const target = await resolveCachedDicom(pid, name);
      if (!target)
        return json({ error: "DICOM file not found in the study cache." }, 404);
      const buf = await fs.readFile(target);
      const h = new Headers();
      h.set("Content-Type", "application/dicom");
      h.set(
        "Content-Disposition",
        `inline; filename="${path.basename(target).replace(/["\\]/g, "_")}"`
      );
      h.set("Cache-Control", "no-store");
      return new NextResponse(buf, { status: 200, headers: h });
    }

    /* ---------------- list cached (downloaded) studies --------------- */
    if (head === "cached") {
      const studies: { pid: string; files: number; totalBytes: number }[] = [];
      let entries;
      try {
        entries = await fs.readdir(CACHE_ROOT, { withFileTypes: true });
      } catch {
        return json({ studies });
      }
      for (const e of entries) {
        if (!e.isDirectory() || !e.name.startsWith("study_")) continue;
        const pid = e.name.slice("study_".length);
        const files = await catalogDicom(path.join(CACHE_ROOT, e.name));
        if (files.length > 0) {
          studies.push({
            pid,
            files: files.length,
            totalBytes: files.reduce((a, f) => a + f.size, 0),
          });
        }
      }
      return json({ studies });
    }

    /* ---------------- authenticated page/file proxy ------------------ */
    if (head === "page" || head === "file") {
      const s = await getSession(req.nextUrl.searchParams.get("sid"));
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      const p = req.nextUrl.searchParams.get("path") ?? "";
      if (
        p.length > 512 ||
        p.includes("..") ||
        /^[a-z][a-z0-9+.-]*:\/\//i.test(p)
      ) {
        return json({ error: "Invalid path." }, 400);
      }
      const target = new URL(p, `${s.appBase}/`).toString();
      const tu = new URL(target);
      if (tu.origin !== s.origin) {
        return json({ error: "Path escapes the PACS origin." }, 403);
      }
      const { res } = await follow(s.cookies, target);
      const buf = await res.arrayBuffer();
      const h = new Headers();
      h.set(
        "Content-Type",
        res.headers.get("content-type") ?? "application/octet-stream"
      );
      const cd = res.headers.get("content-disposition");
      if (cd) h.set("Content-Disposition", cd);
      h.set("Cache-Control", "no-store");
      return new NextResponse(buf, { status: res.status, headers: h });
    }

    return json(
      { error: `Unknown medal bridge action: ${segs.join("/")}` },
      404
    );
  } catch (e) {
    return errJson(e, "MedalPACS bridge failure.");
  }
}

/* ------------------------------------------------------------------ */
/*  POST handlers                                                      */
/* ------------------------------------------------------------------ */

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ action: string[] }> }
) {
  const { action } = await ctx.params;
  const [head] = (action ?? []).map((s) => decodeURIComponent(s));
  sweepSessions();

  try {
    /* ---------------- login (username + password + captcha) ---------- */
    if (head === "login") {
      const body = (await req.json().catch(() => ({}))) as {
        sid?: string;
        username?: string;
        password?: string;
        captcha?: string;
      };
      const s = await getSession(body.sid ?? null);
      if (!s)
        return json({ error: "Unknown or expired bridge session." }, 404);

      /* Persian/Arabic digits from hospital keyboards (old method) */
      const username = normalizeDigits(body.username ?? "")
        .trim()
        .slice(0, 64);
      const password = (body.password ?? "").slice(0, 128);
      const captcha = normalizeDigits(body.captcha ?? "")
        .trim()
        .slice(0, 12);

      if (!username) {
        return json(
          {
            reason: "input",
            errorFa: "نام کاربری را وارد کنید.",
            error: "Enter the username.",
          },
          400
        );
      }
      if (!password) {
        return json(
          {
            reason: "input",
            errorFa: "رمز عبور را وارد کنید.",
            error: "Enter the password.",
          },
          400
        );
      }
      if (s.form.captchaField && !captcha) {
        return json(
          {
            reason: "captcha",
            errorFa: "کد کپچا را وارد کنید.",
            error: "Enter the captcha code.",
          },
          400
        );
      }
      if (markLoginAttempt(s) > LOGIN_LIMIT) {
        await dropSession(s.sid);
        return json(
          {
            reason: "limit",
            errorFa: "تعداد تلاش زیاد است. دوباره سرور را معرفی کنید.",
            error: "Too many attempts — reconnect.",
          },
          429
        );
      }

      /* build the exact form the hospital browser posts */
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(s.hidden)) form.set(k, v);
      if (!form.has("__EVENTTARGET")) form.set("__EVENTTARGET", "");
      if (!form.has("__EVENTARGUMENT")) form.set("__EVENTARGUMENT", "");
      form.set("hfDeviceSize", "0");
      form.set(s.form.userField || "aaaa", username);
      form.set(s.form.passField || "bbbb", password);
      if (s.form.captchaField) form.set(s.form.captchaField, captcha);
      form.set(s.form.submitField || "LoginButton", "Login");
      if (s.form.hfkey && s.form.hfiv) {
        /* HF1 carries the AES-encrypted password (CryptoJS-compatible) */
        form.set("HF1", medalAes(password, s.form.hfkey, s.form.hfiv));
        form.set("hfkey", s.form.hfkey);
        form.set("hfiv", s.form.hfiv);
      }

      const { res, url: postUrl } = await follow(s.cookies, s.form.action, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Origin: s.origin,
          Referer: s.loginUrl,
        },
        body: form.toString(),
      });
      let html = await res.text();
      let finalUrl = postUrl;

      /* follow JavaScript redirects (window.location = "Default.aspx") */
      const js = html.match(
        /(?:window\.location|location\.href|location\.replace)\s*(?:=|\()\s*["']([^"']+)["']/i
      );
      if (js && !/login\.aspx/i.test(js[1])) {
        try {
          const dest = new URL(js[1], finalUrl).toString();
          const r2 = await follow(s.cookies, dest, {
            headers: { Referer: finalUrl },
          });
          html = await r2.res.text();
          finalUrl = r2.url;
        } catch {
          /* optional hop */
        }
      }

      const cookieNames = [...s.cookies.keys()].map((k) => k.toLowerCase());
      if (medalLoginSucceeded(finalUrl, html, cookieNames)) {
        s.connected = true;
        s.username = username;
        s.loginAt = Date.now();
        const names = extractNames(html);
        if (names.title && !/login/i.test(names.title)) s.serverName = names.title;
        if (names.hospital) s.hospitalName = names.hospital;
        await putSession(s); /* → 12-hour disk-persisted session */
        return json({ ...publicInfo(s), ok: true });
      }

      /* failed — classify and tell the UI why (old-method extraction) */
      s.connected = false;
      const errText = extractLoginError(html) ?? "";
      let reason = "rejected";
      let errorFa = "کد امنیتی یا نام کاربری / کلمه عبور توسط سرور پکس تایید نشد.";
      let error = "Sign-in rejected — check the captcha / credentials.";
      if (
        /captcha|کپچا|کد\s*امنیتی|security\s*code/i.test(html) &&
        /wrong|incorrect|invalid|نادرست|غلط|صحیح/i.test(html)
      ) {
        reason = "captcha";
        errorFa = "کد کپچا نادرست است — کد جدید را وارد کنید.";
        error = "Wrong captcha code — try the new one.";
      } else if (
        /password|username|رمز|کاربر/i.test(html) &&
        /wrong|incorrect|invalid|نادرست|غلط/i.test(html)
      ) {
        reason = "credentials";
        errorFa = "نام کاربری یا رمز عبور نادرست است.";
        error = "Wrong username or password.";
      }
      return json(
        {
          ok: false,
          reason,
          errorFa,
          error,
          detail: errText.slice(0, 140) || undefined,
        },
        401
      );
    }

    /* ---------------- logout ----------------------------------------- */
    if (head === "logout") {
      const body = (await req.json().catch(() => ({}))) as { sid?: string };
      const s = await getSession(body.sid ?? null);
      if (s) await dropSession(s.sid);
      return json({ ok: true });
    }

    /* ---------------- patient study lookup --------------------------- */
    if (head === "study") {
      const body = (await req.json().catch(() => ({}))) as {
        sid?: string;
        input?: string;
      };
      const s = await getSession(body.sid ?? null);
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      if (!s.connected)
        return json({ error: "Not connected — sign in first." }, 401);

      const raw = (body.input ?? "").trim().slice(0, 500);
      if (!raw) {
        return json(
          {
            errorFa: "لینک PACS یا کد ملی بیمار را وارد کنید.",
            error: "Enter the PACS link or the patient ID.",
          },
          400
        );
      }

      const parsed = parseMedalInput(raw, s.appBase);
      const base = parsed.base;
      const sk = parsed.sk;
      /* '+' in query strings must be %2B so ASP.NET does not eat it */
      const skPlus = sk.replace(/\+/g, "%2B");
      const skQuoted = encodeURIComponent(sk);

      const targets: string[] = [];
      const push = (u: string) => {
        if (!targets.includes(u)) targets.push(u);
      };

      if (parsed.patientId) {
        push(`${base}/MedalWeb/Process.aspx?ID=${parsed.patientId}`);
        push(`${base}/MedalWeb/viewer.aspx?ID=${parsed.patientId}&Ser=1`);
        push(`${base}/MedalWeb/serieslist.aspx?ID=${parsed.patientId}`);
        push(`${base}/MedalWeb/sharepatient.aspx?ID=${parsed.patientId}`);
        push(`${base}/?query=${parsed.patientId}`);
        push(`${base}/MedalWeb/Process.aspx?SK=${parsed.patientId}`);
      }
      if (parsed.type === "sms") {
        push(`${base}/MedalWeb/Process.aspx?SK=${skPlus}`);
      }
      for (const v of [skPlus, skQuoted, sk]) {
        push(`${base}/MedalWeb/Process.aspx?SK=${v}`);
        push(`${base}/MedalWeb/viewer.aspx?SK=${v}&Ser=1`);
        push(`${base}/MedalWeb/sharepatient.aspx?SK=${v}`);
      }

      let html = "";
      let finalUrl = "";
      let loginRequired = false;
      let lastError: unknown = null;

      for (const u of targets.slice(0, 10)) {
        try {
          const { res, url } = await follow(s.cookies, u);
          const curHtml = await res.text();

          if (
            /login\.aspx/i.test(url) ||
            /name="aaaa"|id="aaaa"/i.test(curHtml)
          ) {
            loginRequired = true;
            continue;
          }
          if (curHtml.includes("var Studies")) {
            html = curHtml;
            finalUrl = url;
            break;
          }
          /* meta-refresh redirect */
          const meta = curHtml.match(
            /<meta\s+http-equiv=["']refresh["'][^>]*content=["']\d+;\s*url=([^"']+)["']/i
          );
          if (meta) {
            const next = new URL(meta[1].trim(), url).toString();
            const r2 = await follow(s.cookies, next);
            const h2 = await r2.res.text();
            if (
              !/login\.aspx/i.test(r2.url) &&
              !/name="aaaa"|id="aaaa"/i.test(h2)
            ) {
              html = h2;
              finalUrl = r2.url;
              break;
            }
            loginRequired = loginRequired || /login\.aspx/i.test(r2.url);
            continue;
          }
          if (/PID|Series|SendToRIS/.test(curHtml)) {
            html = curHtml;
            finalUrl = url;
            break;
          }
        } catch (e) {
          lastError = e;
          continue;
        }
      }

      if (!html) {
        if (loginRequired) {
          s.connected = false;
          await putSession(s);
          return json(
            {
              expired: true,
              errorFa:
                "سرور پکس نیاز به ورود پرسنلی دارد — دوباره وارد شوید.",
              error: "The PACS server requires a fresh staff sign-in.",
            },
            401
          );
        }
        return json(
          {
            errorFa: `پرونده‌ای در سرور پکس (${base}) یافت نشد.${
              lastError instanceof Error ? " (" + lastError.message.slice(0, 90) + ")" : ""
            }`,
            error:
              lastError instanceof Error
                ? lastError.message
                : `No study found at ${base} for this patient.`,
          },
          404
        );
      }

      const meta = parseStudyPage(html, finalUrl, base, sk);
      return json({ ok: true, ...meta });
    }

    /* ---------------- DICOM package download ------------------------- */
    if (head === "download") {
      const body = (await req.json().catch(() => ({}))) as {
        sid?: string;
        pid?: string;
        studyKey?: string;
        hashKey?: string;
        pname?: string;
        mode?: number;
      };
      const s = await getSession(body.sid ?? null);
      if (!s) return json({ error: "Unknown or expired bridge session." }, 404);
      if (!s.connected)
        return json({ error: "Not connected — sign in first." }, 401);

      const pid = (body.pid ?? "").trim().slice(0, 64);
      const studyKey = (body.studyKey ?? "").trim().slice(0, 200);
      const hashKey = (body.hashKey ?? studyKey).trim().slice(0, 200);
      const mode = Number.isFinite(body.mode) ? Number(body.mode) : 0;
      if (!pid || !studyKey) {
        return json(
          {
            errorFa: "شناسه بیمار یا کلید مطالعه نامعتبر است.",
            error: "Missing patient id / study key.",
          },
          400
        );
      }

      const dir = studyDir(pid);

      /* fast path — already downloaded (desktop app behaviour) */
      const existing = await catalogDicom(dir);
      if (existing.length > 0) {
        return json({
          ok: true,
          cached: true,
          pid,
          files: existing,
          count: existing.length,
        });
      }

      const base = s.appBase;
      const candidates = [
        `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}&PID=${encodeURIComponent(pid)}&mode=${mode}`,
        `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(studyKey)}&PID=${encodeURIComponent(pid)}&mode=${mode}`,
        `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}&mode=${mode}`,
        `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(studyKey)}&mode=${mode}`,
        `${base}/MedalWeb/Download.aspx?SK=${encodeURIComponent(hashKey)}`,
      ];

      await fs.mkdir(CACHE_ROOT, { recursive: true });
      const zipPath = path.join(CACHE_ROOT, `study_${safePid(pid)}.zip`);
      let downloaded = false;

      for (const dl of candidates) {
        try {
          await streamToFile(s.cookies, dl, `${base}/MedalWeb/Process.aspx`, zipPath);
          const head = await readFileHead(zipPath, 4);
          if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b) {
            downloaded = true;
            break;
          }
          /* server answered with a page naming the real zip */
          const txt = (await fs.readFile(zipPath, "utf8")).slice(0, 4096);
          const zm = txt.match(/([A-Za-z0-9_\-]+\.zip)/i);
          if (zm) {
            const tempUrl = `${base}/MedalWeb/temp/${zm[1]}`;
            await streamToFile(
              s.cookies,
              tempUrl,
              `${base}/MedalWeb/Process.aspx`,
              zipPath
            );
            const h2 = await readFileHead(zipPath, 4);
            if (h2.length >= 4 && h2[0] === 0x50 && h2[1] === 0x4b) {
              downloaded = true;
              break;
            }
          }
        } catch {
          continue;
        }
      }

      if (!downloaded) {
        return json(
          {
            errorFa: "پکیج دایکام بیمار از سرور پکس دریافت نشد.",
            error: "The DICOM package could not be downloaded from the PACS.",
          },
          502
        );
      }

      await extractZip(zipPath, dir);
      const files = await catalogDicom(dir);
      if (files.length === 0) {
        return json(
          {
            errorFa: "پکیج دریافتی فایل دایکام معتبری نداشت.",
            error: "The downloaded package contained no valid DICOM files.",
          },
          502
        );
      }
      return json({ ok: true, pid, files, count: files.length });
    }

    return json({ error: `Unknown medal bridge action: ${head}` }, 404);
  } catch (e) {
    return errJson(e, "MedalPACS bridge failure.");
  }
}
