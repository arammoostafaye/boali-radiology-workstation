/* ------------------------------------------------------------------ */
/*  /api/update/check — compare the local install against the latest   */
/*  GitHub release using the small manifest.json asset (never the      */
/*  1.2 GB zip). Reports exactly how many files/bytes changed.        */
/* ------------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { createHash } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const REPO =
  process.env.BOALI_UPDATE_REPO ?? "arammoostafaye/boali-radiology-workstation";
const API = `https://api.github.com/repos/${REPO}/releases/latest`;

interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

function root(): string {
  return process.env.BOALI_ROOT ?? process.cwd();
}

async function readVersion(): Promise<string> {
  try {
    const v = await fs.readFile(path.join(root(), "VERSION"), "utf8");
    return v.trim() || "unknown";
  } catch {
    return "unknown";
  }
}

function ghHeaders(): HeadersInit {
  const h: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "boali-workstation",
  };
  const token =
    process.env.GITHUB_TOKEN ?? process.env.BOALI_GH_TOKEN ?? undefined;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function sanitizeRel(p: string): string | null {
  const clean = p.replace(/\\/g, "/").trim();
  if (!clean || clean.startsWith("/") || clean.split("/").includes("..")) {
    return null;
  }
  return clean;
}

export async function GET() {
  try {
    const current = await readVersion();

    const relRes = await fetch(API, {
      headers: ghHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    if (!relRes.ok) {
      return NextResponse.json(
        {
          error: `GitHub API HTTP ${relRes.status}`,
          errorFa: "دسترسی به گیت‌هاب برقرار نشد.",
          current,
        },
        { status: 502 }
      );
    }
    const rel = (await relRes.json()) as {
      tag_name?: string;
      html_url?: string;
      body?: string;
      published_at?: string;
      assets?: { name: string; browser_download_url: string; size: number }[];
    };
    const latest = (rel.tag_name ?? "").trim();
    if (!latest) {
      return NextResponse.json(
{ error: "latest release has no tag", current },
{ status: 502 }
);
    }

    const assets = rel.assets ?? [];
    const manifestAsset = assets.find((a) => a.name === "manifest.json");
    const zipAsset = assets.find((a) => a.name.endsWith(".zip"));
    if (!manifestAsset || !zipAsset) {
      /* releases before v1.5.0 have no manifest asset — in-app updates
       * start from v1.5.0; tell the user honestly instead of failing */
      return NextResponse.json(
        {
          current,
          latest,
          upToDate: latest === current,
          supported: false,
          releaseUrl: rel.html_url ?? null,
          zipSize: zipAsset?.size ?? null,
          errorFa:
            "این نسخهٔ منتشرشده از به‌روزرسانی درون‌برنامه‌ای پشتیبانی نمی‌کند — یک بار دستی از صفحهٔ Releases دانلود و جایگزین کنید؛ از آن به بعد به‌روزرسانی از داخل برنامه انجام می‌شود.",
        },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    /* compare every manifest entry against the local install */
    const manRes = await fetch(manifestAsset.browser_download_url, {
      headers: ghHeaders(),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!manRes.ok) {
      return NextResponse.json(
{ error: `manifest HTTP ${manRes.status}`, current, latest },
{ status: 502 }
);
    }
    const manifest = (await manRes.json()) as { files?: ManifestEntry[] };
    const files = manifest.files ?? [];

    let changed = 0;
    let changedBytes = 0;
    let missing = 0;
    const changedPaths: string[] = [];

    for (const f of files) {
      const relPath = sanitizeRel(f.path);
      if (!relPath || !f.sha256) continue;
      const local = path.join(root(), relPath);
      let same = false;
      try {
        const buf = await fs.readFile(local);
        same = createHash("sha256").update(buf).digest("hex") === f.sha256;
      } catch {
        missing++;
      }
      if (!same) {
        changed++;
        changedBytes += f.size ?? 0;
        if (changedPaths.length < 40) changedPaths.push(relPath);
      }
    }

    const upToDate = latest === current && changed === 0;

    return NextResponse.json(
      {
        current,
        latest,
        upToDate,
        changed,
        missing,
        changedBytes,
        changedPaths,
        totalFiles: files.length,
        zipSize: zipAsset.size,
        releaseUrl: rel.html_url ?? null,
        publishedAt: rel.published_at ?? null,
        notesPreview: (rel.body ?? "").slice(0, 600),
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "update check failed",
        errorFa: "بررسی نسخه جدید ناموفق بود.",
      },
      { status: 502 }
    );
  }
}
