/* ------------------------------------------------------------------ */
/*  PACS proxy — forwards browser requests to the boali-pacs service  */
/*  (port 3021) with the API key injected SERVER-SIDE, so the key     */
/*  never reaches the browser (security fix #1 architecture).         */
/*  Only the documented read endpoints are proxied — no arbitrary     */
/*  path pass-through.                                                */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from "next/server";

const PACS_URL = process.env.PACS_URL ?? "http://127.0.0.1:3021";
const PACS_KEY = process.env.PACS_API_KEY ?? "boali-demo-key-2026";
const PACS_ADMIN_KEY = process.env.PACS_ADMIN_KEY ?? "boali-admin-key-2026";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ action: string[] }> }
) {
  const { action } = await ctx.params;
  const segs = (action ?? []).map((s) => decodeURIComponent(s));
  const [head, ...rest] = segs;

  /* whitelist: flat endpoints + parameterized nested endpoints */
  const flatOk = head === "status" || head === "studies" || head === "audit";
  const nestedOk =
    (head === "series" || head === "instances" || head === "file") && rest.length === 1;

  if (!flatOk && !nestedOk) {
    return NextResponse.json(
      { error: `Endpoint /api/pacs/${segs.join("/")} is not proxied.` },
      { status: 403 }
    );
  }
  if (nestedOk && rest[0].length > 128) {
    return NextResponse.json({ error: "Identifier too long." }, { status: 400 });
  }

  const upstream = new URL(`${PACS_URL}/api/pacs/${segs.map(encodeURIComponent).join("/")}`);
  /* forward only known-safe query params */
  for (const p of ["q", "modality", "limit"]) {
    const v = req.nextUrl.searchParams.get(p);
    if (v !== null) upstream.searchParams.set(p, v.slice(0, 64));
  }

  /* audit reads require the admin key — injected here, server-side */
  const key = head === "audit" ? PACS_ADMIN_KEY : PACS_KEY;

  try {
    const res = await fetch(upstream.toString(), {
      headers: { "X-PACS-Key": key, "User-Agent": "boali-webstation-proxy" },
      cache: "no-store",
    });
    const body = await res.arrayBuffer();
    const headers = new Headers();
    headers.set("Content-Type", res.headers.get("content-type") ?? "application/json");
    const cd = res.headers.get("content-disposition");
    if (cd) headers.set("Content-Disposition", cd);
    return new NextResponse(body, { status: res.status, headers });
  } catch (e) {
    return NextResponse.json(
      { error: `PACS service unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
