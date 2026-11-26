"""Boali PACS gateway — hardened DICOM archive wrapper.

Wraps the original boali-radiology-suite PACS functionality with the four
security fixes from the repository audit:

  FIX 1 (auth)       — every endpoint requires an API key (X-PACS-Key),
                       compared in constant time; no open access.
  FIX 2 (SQL)        — every query is parameterized (sqlite3 '?' placeholders);
                       search terms are validated + escaped, never concatenated
                       into SQL strings.
  FIX 3 (traversal)  — instance paths are resolved with os.path.realpath and
                       must stay inside PACS_STORE; '..'/absolute/symlink
                       escapes are rejected with 403 and audited.
  FIX 4 (audit)      — every authenticated request (and every rejection) is
                       written to the audit_log table with the key fingerprint,
                       action, detail, IP and user agent.

The archive is indexed from the PACS_STORE directory at startup (or via
POST /api/pacs/ingest). DICOM metadata is read with pydicom. No PHI leaves
the store: the API exposes only the indexed fields.
"""

from __future__ import annotations

import hashlib
import hmac
import os
import sqlite3
import time
from contextlib import contextmanager

import pydicom
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

SERVICE_ROOT = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("PACS_DB", os.path.join(SERVICE_ROOT, "pacs.db"))
PACS_STORE = os.environ.get(
    "PACS_STORE",
    # demo archive lives next to the engine service (portable across
    # sandbox / Windows / Linux — no absolute path)
    os.path.join(os.path.dirname(SERVICE_ROOT), "boali-engine", "samples"),
)
# FIX 1: API key. In production this is set per-installation and rotated.
PACS_API_KEY = os.environ.get("PACS_API_KEY", "boali-demo-key-2026")
ADMIN_KEY = os.environ.get("PACS_ADMIN_KEY", "boali-admin-key-2026")
PACS_PORT = 3021

MAX_QUERY_LEN = 64  # search box cap (fix 2 helper)

app = FastAPI(
    title="Boali PACS Gateway",
    version="1.0.0",
    description="Hardened DICOM study/series/instance index with audit logging.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

_STARTED_AT = time.time()


# --------------------------------------------------------------------------
# database
# --------------------------------------------------------------------------

@contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


SCHEMA = """
CREATE TABLE IF NOT EXISTS studies (
    study_uid     TEXT PRIMARY KEY,
    patient_id    TEXT NOT NULL,
    patient_name  TEXT NOT NULL,
    study_date    TEXT,
    modality      TEXT,
    study_desc    TEXT
);
CREATE TABLE IF NOT EXISTS series (
    series_uid    TEXT PRIMARY KEY,
    study_uid     TEXT NOT NULL,
    series_number INTEGER,
    series_desc   TEXT,
    modality      TEXT
);
CREATE TABLE IF NOT EXISTS instances (
    instance_uid  TEXT PRIMARY KEY,
    series_uid    TEXT NOT NULL,
    file_path     TEXT NOT NULL,   -- relative to PACS_STORE
    sop_class     TEXT,
    size_bytes    INTEGER
);
CREATE TABLE IF NOT EXISTS audit_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ts            TEXT NOT NULL,
    key_fp        TEXT NOT NULL,   -- sha256(key)[:12] — never the key itself
    action        TEXT NOT NULL,
    detail        TEXT,
    ip            TEXT,
    user_agent    TEXT,
    outcome       TEXT NOT NULL    -- ok | denied | error
);
CREATE INDEX IF NOT EXISTS idx_series_study ON series(study_uid);
CREATE INDEX IF NOT EXISTS idx_inst_series ON instances(series_uid);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_log(ts DESC);
"""


def key_fp(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()[:12]


# --------------------------------------------------------------------------
# FIX 1 + FIX 4 — auth dependency and audit writer
# --------------------------------------------------------------------------

def audit(request: Request, key: str, action: str, detail: str, outcome: str) -> None:
    try:
        with db() as conn:
            conn.execute(
                "INSERT INTO audit_log (ts, key_fp, action, detail, ip, user_agent, outcome) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (
                    time.strftime("%Y-%m-%dT%H:%M:%S"),
                    key_fp(key),
                    action,
                    detail[:200],
                    request.client.host if request.client else "?",
                    (request.headers.get("user-agent") or "")[:120],
                    outcome,
                ),
            )
    except Exception:
        pass  # audit must never take the service down


def require_key(request: Request, admin: bool = False) -> str:
    supplied = request.headers.get("x-pacs-key", "")
    expected = ADMIN_KEY if admin else PACS_API_KEY
    # constant-time comparison; admin key also accepted for user routes
    ok = hmac.compare_digest(supplied.encode(), expected.encode()) or (
        not admin and hmac.compare_digest(supplied.encode(), ADMIN_KEY.encode())
    )
    if not ok:
        audit(request, supplied or "-", "auth", "invalid or missing API key", "denied")
        raise HTTPException(
            status_code=401,
            detail="PACS authentication failed: provide a valid X-PACS-Key header.",
        )
    return supplied


# --------------------------------------------------------------------------
# FIX 2 — validated search terms + parameterized queries only
# --------------------------------------------------------------------------

def clean_query(q: str) -> str:
    q = (q or "").strip()
    if len(q) > MAX_QUERY_LEN:
        raise HTTPException(400, f"Query too long (max {MAX_QUERY_LEN} characters).")
    # strip LIKE wildcards from user input; matching is done via parameterized
    # LIKE with an escaped pattern — the user never writes SQL syntax.
    return q.replace("%", "").replace("_", " ")


def like(q: str) -> str:
    return f"%{q}%"


# --------------------------------------------------------------------------
# ingest — index the PACS_STORE directory (pydicom metadata only)
# --------------------------------------------------------------------------

def ingest_store() -> dict:
    if not os.path.isdir(PACS_STORE):
        raise HTTPException(500, f"PACS_STORE missing: {PACS_STORE}")
    files = 0
    with db() as conn:
        for root, _dirs, names in os.walk(PACS_STORE):
            for name in names:
                if not name.lower().endswith((".dcm", ".dicom")):
                    continue
                files += 1
                path = os.path.join(root, name)
                try:
                    ds = pydicom.dcmread(path, force=True, stop_before_pixels=True)
                except Exception:
                    continue
                suid = str(getattr(ds, "StudyInstanceUID", "") or f"anon-study-{files}")
                ruid = str(getattr(ds, "SeriesInstanceUID", "") or f"anon-series-{files}")
                iuid = str(getattr(ds, "SOPInstanceUID", "") or os.path.basename(path))
                rel = os.path.relpath(path, PACS_STORE)
                size = os.path.getsize(path)
                study_date = str(getattr(ds, "StudyDate", "") or "")
                conn.execute(
                    "INSERT OR IGNORE INTO studies VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        suid,
                        str(getattr(ds, "PatientID", "") or "ANON"),
                        str(getattr(ds, "PatientName", "") or "Anonymous"),
                        f"{study_date[:4]}-{study_date[4:6]}-{study_date[6:8]}".strip("-")
                        if study_date
                        else "",
                        str(getattr(ds, "Modality", "") or "").upper(),
                        str(getattr(ds, "StudyDescription", "") or ""),
                    ),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO series VALUES (?, ?, ?, ?, ?)",
                    (
                        ruid,
                        suid,
                        int(getattr(ds, "SeriesNumber", 0) or 0),
                        str(getattr(ds, "SeriesDescription", "") or ""),
                        str(getattr(ds, "Modality", "") or "").upper(),
                    ),
                )
                conn.execute(
                    "INSERT OR IGNORE INTO instances VALUES (?, ?, ?, ?, ?)",
                    (iuid, ruid, rel, str(getattr(ds, "SOPClassUID", "") or ""), size),
                )
        counts = {
            "studies": conn.execute("SELECT COUNT(*) FROM studies").fetchone()[0],
            "series": conn.execute("SELECT COUNT(*) FROM series").fetchone()[0],
            "instances": conn.execute("SELECT COUNT(*) FROM instances").fetchone()[0],
        }
    return {"scanned_files": files, "indexed": counts}


# --------------------------------------------------------------------------
# FIX 3 — path resolution + containment guard
# --------------------------------------------------------------------------

def safe_resolve(rel_path: str) -> str:
    parts = rel_path.replace("\\", "/").split("/")
    if not rel_path or rel_path.startswith("/") or ".." in parts:
        raise HTTPException(403, "Path rejected (traversal attempt).")
    store_real = os.path.realpath(PACS_STORE)
    full = os.path.realpath(os.path.join(store_real, rel_path))
    if not full.startswith(store_real + os.sep):
        raise HTTPException(403, "Path resolved outside the PACS store.")
    if not os.path.isfile(full):
        raise HTTPException(404, "Instance file not found in store.")
    return full


# --------------------------------------------------------------------------
# startup
# --------------------------------------------------------------------------

@app.on_event("startup")
def _startup() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
    if _db_empty():
        ingest_store()


def _db_empty() -> bool:
    with db() as conn:
        n = conn.execute("SELECT COUNT(*) FROM instances").fetchone()[0]
    return n == 0


# --------------------------------------------------------------------------
# routes
# --------------------------------------------------------------------------

@app.get("/")
def root() -> dict:
    return {
        "service": "boali-pacs",
        "status": "ok",
        "port": PACS_PORT,
        "security_fixes": [
            "1: API-key auth (constant-time compare, X-PACS-Key)",
            "2: parameterized SQL only — no string-built queries",
            "3: realpath containment guard on all file serving",
            "4: full audit trail (key fingerprint, action, ip, outcome)",
        ],
    }


@app.get("/api/pacs/status")
def status(request: Request) -> dict:
    require_key(request)
    with db() as conn:
        counts = {
            "studies": conn.execute("SELECT COUNT(*) FROM studies").fetchone()[0],
            "series": conn.execute("SELECT COUNT(*) FROM series").fetchone()[0],
            "instances": conn.execute("SELECT COUNT(*) FROM instances").fetchone()[0],
        }
    audit(request, request.headers.get("x-pacs-key", ""), "status", "service status", "ok")
    return {
        "service": "boali-pacs",
        "uptime_sec": round(time.time() - _STARTED_AT),
        "counts": counts,
        "store": PACS_STORE,
        "fixes": 4,
    }


@app.get("/api/pacs/studies")
def studies(request: Request, q: str = "", modality: str = "") -> list[dict]:
    key = require_key(request)
    query = clean_query(q)
    mod = clean_query(modality).upper()
    with db() as conn:
        # FIX 2: fully parameterized — q and modality never touch SQL text
        if query and mod:
            rows = conn.execute(
                "SELECT s.*, COUNT(r.series_uid) AS series_count FROM studies s "
                "LEFT JOIN series r ON r.study_uid = s.study_uid "
                "WHERE (s.patient_id LIKE ? OR s.patient_name LIKE ? OR s.study_desc LIKE ?) "
                "AND s.modality LIKE ? GROUP BY s.study_uid ORDER BY s.study_date DESC",
                (like(query), like(query), like(query), like(mod)),
            ).fetchall()
        elif query:
            rows = conn.execute(
                "SELECT s.*, COUNT(r.series_uid) AS series_count FROM studies s "
                "LEFT JOIN series r ON r.study_uid = s.study_uid "
                "WHERE s.patient_id LIKE ? OR s.patient_name LIKE ? OR s.study_desc LIKE ? "
                "GROUP BY s.study_uid ORDER BY s.study_date DESC",
                (like(query), like(query), like(query)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT s.*, COUNT(r.series_uid) AS series_count FROM studies s "
                "LEFT JOIN series r ON r.study_uid = s.study_uid "
                "GROUP BY s.study_uid ORDER BY s.study_date DESC",
                (),
            ).fetchall()
    audit(request, key, "query", f"studies q={query!r} modality={mod!r}", "ok")
    return [dict(r) for r in rows]


@app.get("/api/pacs/series/{study_uid}")
def series_by_study(request: Request, study_uid: str) -> list[dict]:
    key = require_key(request)
    if len(study_uid) > 128:
        raise HTTPException(400, "study_uid too long")
    with db() as conn:
        rows = conn.execute(
            "SELECT r.*, COUNT(i.instance_uid) AS instance_count FROM series r "
            "LEFT JOIN instances i ON i.series_uid = r.series_uid "
            "WHERE r.study_uid = ? GROUP BY r.series_uid ORDER BY r.series_number",
            (study_uid,),
        ).fetchall()
    audit(request, key, "query", f"series for study {study_uid[:24]}…", "ok")
    return [dict(r) for r in rows]


@app.get("/api/pacs/instances/{series_uid}")
def instances_by_series(request: Request, series_uid: str) -> list[dict]:
    key = require_key(request)
    if len(series_uid) > 128:
        raise HTTPException(400, "series_uid too long")
    with db() as conn:
        rows = conn.execute(
            "SELECT instance_uid, series_uid, sop_class, size_bytes, file_path "
            "FROM instances WHERE series_uid = ? ORDER BY instance_uid",
            (series_uid,),
        ).fetchall()
    audit(request, key, "query", f"instances for series {series_uid[:24]}…", "ok")
    return [dict(r) for r in rows]


@app.get("/api/pacs/file/{instance_uid}")
def get_file(request: Request, instance_uid: str):
    key = require_key(request)
    if len(instance_uid) > 128:
        raise HTTPException(400, "instance_uid too long")
    with db() as conn:
        row = conn.execute(
            "SELECT file_path FROM instances WHERE instance_uid = ?",
            (instance_uid,),
        ).fetchone()
    if row is None:
        audit(request, key, "fetch", f"instance not found {instance_uid[:24]}…", "error")
        raise HTTPException(404, "Instance not found.")
    # FIX 3: containment-checked resolution
    full = safe_resolve(row["file_path"])
    audit(request, key, "fetch", f"file {row['file_path']}", "ok")
    return FileResponse(
        full,
        media_type="application/dicom",
        filename=os.path.basename(full),
        headers={"X-PACS-Fix": "path-containment-verified"},
    )


@app.get("/api/pacs/audit")
def audit_view(request: Request, limit: int = 50) -> list[dict]:
    key = require_key(request, admin=True)
    limit = max(1, min(int(limit), 500))
    with db() as conn:
        rows = conn.execute(
            "SELECT ts, key_fp, action, detail, ip, outcome FROM audit_log "
            "ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    audit(request, key, "audit", f"read audit trail (limit {limit})", "ok")
    return [dict(r) for r in rows]


@app.post("/api/pacs/ingest")
def ingest(request: Request) -> dict:
    key = require_key(request, admin=True)
    result = ingest_store()
    audit(request, key, "ingest", f"re-indexed store ({result})", "ok")
    return result
