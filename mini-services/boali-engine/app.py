"""Boali engine service — FastAPI wrapper.

Task: expose the author's real radiology AI engines over HTTP so the new
web workstation UI can call them. This is the "wrap, don't rewrite" path:
the numeric inference pipelines are ported verbatim (source lines cited in
each engine module), and every engine reports an HONEST status — no
placeholder results, no fabricated confidences.

Endpoints:
    GET  /api/status                     -> registry of engines + real statuses
    POST /api/analyze/fracture           -> real YOLO ONNX inference (works now)
    POST /api/analyze/bone-suppression   -> requires torch + Qure traces
    POST /api/analyze/chest18            -> requires torch + densenet18 trace
    POST /api/analyze/mammography        -> requires torch/torchvision + resnet ckpt
    POST /api/analyze/ct3d               -> 3D CT studio (MPR + ray-cast DVR)
    GET  /api/ct3d/slice                 -> interactive MPR slice from cached volume
    GET  /api/ct3d/vr                    -> re-render volume at another preset
"""

from __future__ import annotations

import os
import tempfile
import time

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware

from engines import bone, chest18, ct3d, fracture, mammo, qa
from engines import memwatch
from engines.common import read_medical_image

app = FastAPI(
    title="Boali Engine Service",
    version="1.0.0",
    description="Real inference wrapper around boali-radiology-suite engines.",
)

# idle memory guard: unload torch models + 3D volumes after 3 min inactivity
# (the host also runs the Next.js dev server on 3.9 GB RAM)
memwatch.start(
    [bone.unload, chest18.unload, mammo.unload, ct3d.clear_cache],
    idle_sec=180,
)

# The gateway proxies same-origin, but allow direct local dev too.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_STARTED_AT = time.time()

MAX_UPLOAD_BYTES = 80 * 1024 * 1024  # 80 MB


@app.middleware("http")
async def _track_activity(request, call_next):
    memwatch.touch()
    return await call_next(request)


@app.get("/")
def root() -> dict:
    return {
        "service": "boali-engine",
        "status": "ok",
        "port": 3020,
        "uptime_sec": round(time.time() - _STARTED_AT),
    }


@app.get("/api/status")
def engine_status() -> dict:
    engines = [fracture.status(), bone.status(), chest18.status(), mammo.status(), ct3d.status(), qa.status()]
    return {
        "service": "boali-engine",
        "uptime_sec": round(time.time() - _STARTED_AT),
        "python": os.sys.version.split(" ")[0],
        "engines": engines,
        "ready_count": sum(1 for e in engines if e["status"] == "ready"),
        "note": (
            "Statuses are real: 'deps_missing' = python package absent, "
            "'weights_missing' = model file absent. Engines never fabricate output."
        ),
    }


async def _load_image(upload: UploadFile, auto_invert: bool) -> tuple:
    data = await upload.read()
    if not data:
        raise HTTPException(400, "Empty upload.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (limit 80 MB).")
    suffix = os.path.splitext(upload.filename or "")[1] or ".img"
    tmp = tempfile.NamedTemporaryFile(prefix="boali_", suffix=suffix, delete=False)
    try:
        tmp.write(data)
        tmp.close()
        try:
            return read_medical_image(tmp.name, auto_invert=auto_invert)
        except Exception as e:
            raise HTTPException(400, f"Could not read image: {e}")
    finally:
        try:
            os.unlink(tmp.name)
        except OSError:
            pass


def _engine_error(engine_status: dict) -> HTTPException:
    return HTTPException(
        status_code=503,
        detail={
            "engine": engine_status["engine"],
            "status": engine_status["status"],
            "message": engine_status["message"],
        },
    )


@app.post("/api/analyze/fracture")
async def analyze_fracture(
    file: UploadFile = File(...),
    confidence: float = Form(0.08),
    clahe: bool = Form(True),
    auto_invert: bool = Form(True),
):
    st = fracture.status()
    if st["status"] != "ready":
        raise _engine_error(st)
    arr, meta = await _load_image(file, auto_invert)
    try:
        result = await run_in_threadpool(
            fracture.analyze, arr, conf_thresh=float(confidence), use_clahe=bool(clahe)
        )
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {e}")
    result["meta"] = meta
    return result


@app.post("/api/analyze/bone-suppression")
async def analyze_bone(
    file: UploadFile = File(...),
    auto_invert: bool = Form(True),
):
    st = bone.status()
    if st["status"] != "ready":
        raise _engine_error(st)
    arr, meta = await _load_image(file, auto_invert)
    try:
        result = await run_in_threadpool(bone.analyze, arr)
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {e}")
    result["meta"] = meta
    return result


@app.post("/api/analyze/chest18")
async def analyze_chest18(
    file: UploadFile = File(...),
    auto_invert: bool = Form(True),
):
    st = chest18.status()
    if st["status"] != "ready":
        raise _engine_error(st)
    arr, meta = await _load_image(file, auto_invert)
    try:
        result = await run_in_threadpool(chest18.analyze, arr)
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {e}")
    result["meta"] = meta
    return result


@app.post("/api/analyze/mammography")
async def analyze_mammo(
    file: UploadFile = File(...),
    auto_invert: bool = Form(True),
):
    st = mammo.status()
    if st["status"] != "ready":
        raise _engine_error(st)
    arr, meta = await _load_image(file, auto_invert)
    try:
        result = await run_in_threadpool(mammo.analyze, arr, meta)
    except Exception as e:
        raise HTTPException(500, f"Inference failed: {e}")
    result["meta"] = meta
    return result


# ---------------------------- 3D CT studio ----------------------------


@app.post("/api/analyze/ct3d")
async def analyze_ct3d(
    files: list[UploadFile] | None = File(None),
    use_sample: bool = Form(False),
    preset: str = Form("bone"),
):
    """Build a 3D volume from an uploaded CT DICOM series (or the bundled
    sample series when `use_sample` is true) and render MPR + VR views."""
    st = ct3d.status()
    if st["status"] != "ready":
        raise _engine_error(st)

    entries: list[tuple[bytes, str]] = []
    total = 0
    if files:
        for f in files:
            data = await f.read()
            if not data:
                continue
            total += len(data)
            if total > MAX_UPLOAD_BYTES * 4:  # series can be larger: 320 MB cap
                raise HTTPException(413, "Series too large (limit 320 MB).")
            entries.append((data, f.filename or "slice.dcm"))
    if not entries and not use_sample:
        # allow bare POST with no files -> same as use_sample for convenience
        use_sample = True

    try:
        p = preset if preset in ("bone", "soft") else "bone"
        if use_sample and not entries:
            result = await run_in_threadpool(ct3d.analyze, None, p)
        else:
            result = await run_in_threadpool(ct3d.analyze, entries, p)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except KeyError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"3D rendering failed: {e}")
    return result


@app.get("/api/ct3d/slice")
async def ct3d_slice(
    volume_id: str,
    plane: str = "axial",
    index: int = 1,
    window: str = "lung",
    max_px: int = 512,
):
    memwatch.touch()  # keep the volume cached while the user scrolls
    try:
        return await run_in_threadpool(
            ct3d.get_slice, volume_id, plane, index, window, min(int(max_px), 1024)
        )
    except KeyError as e:
        raise HTTPException(404, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.get("/api/ct3d/vr")
async def ct3d_vr(
    volume_id: str,
    preset: str = "bone",
    out_px: int = 384,
):
    try:
        return await run_in_threadpool(
            ct3d.render_vr_preset, volume_id, preset, min(int(out_px), 768)
        )
    except KeyError as e:
        raise HTTPException(404, str(e))


@app.get("/api/ct3d/export")
async def ct3d_export(volume_id: str, preset: str = "bone"):
    """Full-resolution output bundle (ZIP): both VR presets at 768 px,
    MPR center slices in all windows at 1024 px, axial montage,
    volume-stats.json and a bilingual text report."""
    memwatch.touch()
    try:
        zip_bytes = await run_in_threadpool(ct3d.export_zip, volume_id, preset)
    except KeyError as e:
        raise HTTPException(404, str(e))
    except Exception as e:
        raise HTTPException(500, f"Export failed: {e}")
    from fastapi.responses import Response

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="boali-ct3d-{volume_id}.zip"',
            "Content-Length": str(len(zip_bytes)),
        },
    )


# ---------------------------- QA / validation ----------------------------


@app.post("/api/qa/selftest")
async def qa_selftest(include_bone: bool = Form(True)):
    """Run the invariant-check suite over every ready engine (صحت‌سنجی).
    Sequential and RAM-aware; can take 1-3 minutes with torch engines."""
    memwatch.touch()
    try:
        return await run_in_threadpool(qa.run_selftest, bool(include_bone))
    except Exception as e:
        raise HTTPException(500, f"QA suite failed: {e}")
