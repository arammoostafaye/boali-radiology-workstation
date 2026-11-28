/* ------------------------------------------------------------------ */
/*  /api/update/status — read the updater's state file (written by     */
/*  tools/boali_update.py) so the web UI can follow the progress.      */
/* ------------------------------------------------------------------ */

import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const statePath = path.join(
    process.env.BOALI_ROOT ?? process.cwd(),
    ".update",
    "state.json"
  );
  try {
    const raw = await fs.readFile(statePath, "utf8");
    return NextResponse.json(
      JSON.parse(raw) as Record<string, unknown>,
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    /* no state file — nothing ever ran */
    return NextResponse.json(
      { phase: "idle" },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
