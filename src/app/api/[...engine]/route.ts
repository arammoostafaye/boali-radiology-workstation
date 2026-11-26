/* ------------------------------------------------------------------ */
/*  Engine proxy — Windows / standalone portability layer.             */
/*  In the sandbox the Caddy gateway routes /api/*?XTransformPort=N    */
/*  straight to the mini-service. On a plain Windows/macOS/Linux       */
/*  machine there is no gateway — this catch-all picks those requests  */
/*  up inside Next.js itself and forwards them to 127.0.0.1:N, so the  */
/*  exact same frontend code runs with zero changes.                   */
/*                                                                     */
/*  Security: only whitelisted ports (3020 boali-engine, 3021 pacs),   */
/*  the XTransformPort param is never forwarded upstream, and static   */
/*  segments (/api/pacs/*) keep taking precedence via route priority.  */
/* ------------------------------------------------------------------ */

import { NextRequest, NextResponse } from "next/server";

/** mini-services the web app is allowed to reach through this proxy */
const ALLOWED_PORTS = new Set([3020, 3021]);
const UPSTREAM_HOST = process.env.BOALI_UPSTREAM_HOST ?? "127.0.0.1";

function parsePort(req: NextRequest): number | null {
  const raw = req.nextUrl.searchParams.get("XTransformPort");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || !ALLOWED_PORTS.has(n)) return null;
  return n;
}

function stripParam(url: URL, param: string): URL {
  const out = new URL(url.toString());
  out.searchParams.delete(param);
  return out;
}

async function forward(req: NextRequest, port: number): Promise<NextResponse> {
  const incoming = new URL(req.url);
  const upstream = stripParam(incoming, "XTransformPort");
  upstream.protocol = "http:";
  upstream.host = `${UPSTREAM_HOST}:${port}`;
  upstream.pathname = incoming.pathname;

  const headers = new Headers();
  for (const name of ["content-type", "content-disposition", "accept"]) {
    const v = req.headers.get(name);
    if (v) headers.set(name, v);
  }

  const init: RequestInit = {
    method: req.method,
    headers,
    cache: "no-store",
  };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = await req.arrayBuffer();
    init.duplex = "half";
  }

  try {
    const res = await fetch(upstream.toString(), init);
    const body = await res.arrayBuffer();
    const outHeaders = new Headers();
    outHeaders.set("Content-Type", res.headers.get("content-type") ?? "application/json");
    const cd = res.headers.get("content-disposition");
    if (cd) outHeaders.set("Content-Disposition", cd);
    return new NextResponse(body, { status: res.status, headers: outHeaders });
  } catch (e) {
    return NextResponse.json(
      {
        detail: `Upstream service on port ${port} is unreachable. Start it first (see windows/START-BOALI.bat or mini-services/*/package.json).`,
        reason: e instanceof Error ? e.message : String(e),
      },
      { status: 502 }
    );
  }
}

export async function GET(req: NextRequest) {
  const port = parsePort(req);
  if (port === null) {
    return NextResponse.json(
      { detail: "Missing or non-whitelisted XTransformPort (allowed: 3020, 3021)." },
      { status: 400 }
    );
  }
  return forward(req, port);
}

export async function POST(req: NextRequest) {
  const port = parsePort(req);
  if (port === null) {
    return NextResponse.json(
      { detail: "Missing or non-whitelisted XTransformPort (allowed: 3020, 3021)." },
      { status: 400 }
    );
  }
  return forward(req, port);
}
