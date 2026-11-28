/* ------------------------------------------------------------------ */
/*  /api/update/apply — start the delta updater as a detached process  */
/*  (tools/boali_update.py). It downloads ONLY the changed files,      */
/*  applies them and restarts the three services. The web client      */
/*  follows progress through /api/update/status.                      */
/* ------------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function root(): string {
  return process.env.BOALI_ROOT ?? process.cwd();
}

function pythonCandidate(): string | null {
  const r = root();
  const candidates =
    process.platform === "win32"
      ? [
          path.join(r, "runtime", "python", "python.exe"),
          "python",
        ]
      : ["python3", "python"];
  return candidates[0];
}

export async function POST() {
  /* the updater rewrites application files — only meaningful on the
   * packaged Windows install (or when explicitly enabled in dev) */
  const allowed =
    process.platform === "win32" || process.env.BOALI_ALLOW_UPDATE === "1";
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "in-app updates are enabled on the packaged Windows install (dev sandbox: set BOALI_ALLOW_UPDATE=1)",
        errorFa:
          "به‌روزرسانی درون‌برنامه‌ای روی نسخهٔ نصب‌شدهٔ ویندوز فعال است.",
      },
      { status: 400 }
    );
  }

  const r = root();
  const updater = path.join(r, "tools", "boali_update.py");
  try {
    await fs.access(updater);
  } catch {
    return NextResponse.json(
{ error: "tools/boali_update.py not found" },
{ status: 404 }
);
  }

  const py =
    process.platform === "win32"
      ? path.join(r, "runtime", "python", "python.exe")
      : "python3";

  try {
    /* make sure the state dir exists so status reads don't 500 */
    await fs.mkdir(path.join(r, ".update"), { recursive: true });
    await fs.writeFile(
      path.join(r, ".update", "state.json"),
      JSON.stringify({ phase: "starting", ts: Date.now() / 1000 }),
      "utf8"
    );

    const logFh = await fs.open(
      path.join(r, ".update", "updater.log"),
      "a"
    );
    const child = spawn(
      py,
      [updater, "--root", r],
      {
        cwd: r,
        detached: true,
        stdio: ["ignore", logFh.fd, logFh.fd],
        ...(process.platform === "win32"
          ? { creationflags: 0x00000008 | 0x00000200 }
          : {}),
      }
    );
    child.unref();
    /* close the fd in the parent after a graceful delay */
    setTimeout(() => void logFh.close(), 4000).unref?.();

    return NextResponse.json({ ok: true, started: true });
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "failed to start updater",
      },
      { status: 500 }
    );
  }
}
