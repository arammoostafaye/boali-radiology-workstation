"""3D CT Studio engine — real MPR + ray-cast volume rendering.

A geometric/compute engine (no weights): loads a CT DICOM series, builds the
Hounsfield volume, and produces:
  * axial / coronal / sagittal MPR slices with physical aspect correction
  * an interactive slice endpoint over a cached volume (fast scrolling)
  * a ray-cast direct volume rendering (front-to-back alpha compositing with
    gradient shading) in "bone" or "soft-tissue" presets
  * honest volume statistics (voxel count, HU range, volume in ml)

Status is real: if pydicom/scipy are absent the engine reports deps_missing.
"""

from __future__ import annotations

import glob
import io
import math
import os
import threading
import time
import uuid

import numpy as np

from .common import arr_to_png_b64

ENGINE_ID = "ct3d"
ENGINE_NAME = "3D CT Studio (MPR + volume rendering)"
SOURCE_REF = "new engine — numpy MPR + scipy ray-cast DVR"

SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAMPLE_SERIES_DIR = os.path.join(SERVICE_ROOT, "samples", "CT-chest")

_lock = threading.Lock()

# ------------------------- volume cache (TTL) -------------------------
_CACHE_TTL_SEC = 20 * 60
_cache: dict[str, dict] = {}

# ------------------------- CT windows (WC, WW) -------------------------
WINDOWS = {
    "lung": (-600.0, 1500.0),
    "soft": (40.0, 350.0),
    "bone": (400.0, 1800.0),
}
AXIAL_PREVIEW_WINDOW = "lung"


def _has(mod: str) -> bool:
    try:
        __import__(mod)
        return True
    except Exception:
        return False


def status() -> dict:
    ok = _has("pydicom") and _has("scipy") and _has("cv2")
    if not ok:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "deps_missing",
            "framework": "numpy + scipy + pydicom",
            "model_file": None,
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "pydicom / scipy / opencv missing. Install them to enable "
            "the 3D CT studio.",
        }
    has_sample = bool(glob.glob(os.path.join(SAMPLE_SERIES_DIR, "*.dcm")))
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready",
        "framework": "numpy + scipy (ray-cast DVR)",
        "model_file": "geometric engine — no weights",
        "weight_path": None,
        "source_ref": SOURCE_REF,
        "message": (
            "Real MPR + volume rendering. "
            + ("Bundled sample CT series available." if has_sample
               else "Upload a CT DICOM series to begin.")
        ),
    }


# ------------------------- series loading -------------------------

def _parse_slice(data: bytes, name: str):
    """Parse one DICOM slice -> (z_position, instance, HU array, spacing, meta)
    or None if the bytes are not a CT-ish DICOM slice."""
    import pydicom

    ds = pydicom.dcmread(io.BytesIO(data), force=True)
    if not hasattr(ds, "pixel_array"):
        return None
    arr = ds.pixel_array.astype(np.float32)
    slope = float(getattr(ds, "RescaleSlope", 1.0) or 1.0)
    intercept = float(getattr(ds, "RescaleIntercept", 0.0) or 0.0)
    hu = arr * slope + intercept

    ipp = getattr(ds, "ImagePositionPatient", None)
    z = float(ipp[2]) if ipp is not None else None
    inst = int(getattr(ds, "InstanceNumber", 0) or 0)

    ps = getattr(ds, "PixelSpacing", None)
    spacing_xy = (float(ps[0]), float(ps[1])) if ps is not None else (1.0, 1.0)
    meta = {
        "patient_name": str(getattr(ds, "PatientName", "")).strip(),
        "patient_id": str(getattr(ds, "PatientID", "")).strip(),
        "study_desc": str(getattr(ds, "StudyDescription", "")).strip(),
        "series_desc": str(getattr(ds, "SeriesDescription", "")).strip(),
        "modality": str(getattr(ds, "Modality", "")).strip().upper(),
        "kvp": str(getattr(ds, "KVP", "")).strip(),
        "source_file": os.path.basename(name),
    }
    return z, inst, hu, spacing_xy, meta


def _build_volume(file_entries: list[tuple[bytes, str]]):
    """file_entries: [(bytes, filename)] -> (volume, spacing, meta, warnings)

    Volume is indexed [z, y, x] in Hounsfield units, resampled onto a
    UNIFORM z grid (real series often have irregular slice gaps; stacking
    them raw would distort coronal/sagittal/3D geometry).
    """
    import pydicom  # noqa: F401  (already validated by caller)

    slices = []
    meta: dict = {}
    spacing_xy = (1.0, 1.0)
    for data, name in file_entries:
        try:
            parsed = _parse_slice(data, name)
        except Exception:
            parsed = None
        if parsed is None:
            continue
        z, inst, hu, sp_xy, m = parsed
        slices.append((z, inst, hu, name))
        if not meta:
            meta.update(m)
            spacing_xy = sp_xy
    if len(slices) < 4:
        raise ValueError(
            "Need at least 4 CT DICOM slices to build a volume "
            f"(got {len(slices)} readable of {len(file_entries)})."
        )

    # sort by z when present, otherwise by instance number
    have_z = all(s[0] is not None for s in slices)
    if have_z:
        slices.sort(key=lambda s: s[0])
        zs = np.array([s[0] for s in slices], dtype=np.float64)
    else:
        slices.sort(key=lambda s: s[1])
        zs = np.arange(len(slices), dtype=np.float64)

    src = np.stack([s[2] for s in slices]).astype(np.float32)  # (nz, ny, nx)
    nz_src, ny, nx = src.shape

    # --- uniform z resampling -------------------------------------------
    gaps = np.diff(zs)
    dz_acq = float(np.median(gaps)) if len(gaps) else 1.0
    if dz_acq <= 0:
        dz_acq = 1.0
    span = float(zs[-1] - zs[0])
    n_target = int(round(span / dz_acq)) + 1 if span > 0 else 1
    n_target = max(n_target, min(nz_src, 4))
    n_target = min(n_target, 256)  # memory cap for the resampled stack
    n_target = max(n_target, 4)

    warnings = []
    big_gaps = int((gaps > max(3.0 * dz_acq, 3.0)).sum())
    max_gap = float(gaps.max()) if len(gaps) else 0.0
    irregular = big_gaps > 0

    if irregular or n_target != nz_src:
        z_grid = np.linspace(zs[0], zs[-1], n_target)
        dz = float(z_grid[1] - z_grid[0]) if n_target > 1 else dz_acq
        pos = np.searchsorted(zs, z_grid)
        pos_l = np.clip(pos - 1, 0, nz_src - 1)
        pos_r = np.clip(pos, 0, nz_src - 1)
        z_l, z_r = zs[pos_l], zs[pos_r]
        denom = np.maximum(z_r - z_l, 1e-9)
        t = np.clip((z_grid - z_l) / denom, 0.0, 1.0).astype(np.float32)
        # grid points inside a large acquisition gap get AIR, not fabricated
        # interpolated anatomy (honest empty space). Gaps up to ~12 mm count
        # as contiguous thick-slice acquisition and are interpolated.
        gap = (z_r - z_l) > max(12.0, 5.0 * dz_acq)
        vol = np.empty((n_target, ny, nx), dtype=np.float32)
        CH = 32
        for i0 in range(0, n_target, CH):
            i1 = min(i0 + CH, n_target)
            left = src[pos_l[i0:i1]]
            right = src[pos_r[i0:i1]]
            tt = t[i0:i1][:, None, None]
            out = left + (right - left) * tt
            out[gap[i0:i1]] = -1024.0
            vol[i0:i1] = out
        if irregular:
            warnings.append(
                f"irregular slice spacing — {big_gaps} acquisition gap(s) up "
                f"to {max_gap:.1f} mm filled with air on a uniform "
                f"{dz:.2f} mm z-grid (no data acquired there)"
            )
    else:
        vol = src
        dz = dz_acq

    spacing = (abs(dz), float(spacing_xy[0]), float(spacing_xy[1]))

    # reject obvious non-CT stacks (no HU-like range at all)
    lo, hi = float(vol.min()), float(vol.max())
    if hi - lo < 40:
        raise ValueError("Pixel value range too narrow for CT HU data.")

    if len(slices) < 16:
        warnings.append(f"thin series ({len(slices)} slices) — VR quality limited")

    meta["slice_count_acquired"] = int(nz_src)
    meta["slice_count"] = int(vol.shape[0])
    meta["rows"] = int(ny)
    meta["cols"] = int(nx)
    meta["spacing_mm"] = [round(s, 3) for s in spacing]
    return vol, spacing, meta, warnings


def clear_cache() -> None:
    """Drop cached volumes (memwatch idle guard)."""
    with _lock:
        _cache.clear()


def _load_sample_entries() -> list[tuple[bytes, str]]:
    files = sorted(glob.glob(os.path.join(SAMPLE_SERIES_DIR, "*.dcm")))
    if not files:
        raise ValueError("No bundled sample CT series found.")
    out = []
    for f in files:
        with open(f, "rb") as fh:
            out.append((fh.read(), os.path.basename(f)))
    return out


# ------------------------- cache helpers -------------------------

def _purge_cache() -> None:
    now = time.time()
    stale = [k for k, v in _cache.items() if now - v["last_access"] > _CACHE_TTL_SEC]
    for k in stale:
        _cache.pop(k, None)


def _store_volume(vol, spacing, meta) -> str:
    vid = "ct_" + uuid.uuid4().hex[:10]
    with _lock:
        _purge_cache()
        _cache[vid] = {
            "vol": vol,
            "spacing": spacing,
            "meta": meta,
            "last_access": time.time(),
        }
    return vid


def _get_volume(vid: str):
    with _lock:
        entry = _cache.get(vid)
        if entry is None:
            return None
        entry["last_access"] = time.time()
        return entry


# ------------------------- MPR rendering -------------------------

def _window_u8(arr: np.ndarray, window: str) -> np.ndarray:
    wc, ww = WINDOWS.get(window, WINDOWS["soft"])
    lo, hi = wc - ww / 2.0, wc + ww / 2.0
    w = np.clip(arr, lo, hi)
    w = (w - lo) / (hi - lo + 1e-8)
    return (w * 255.0).round().astype(np.uint8)


def _aspect_resize(img_u8: np.ndarray, sp_row: float, sp_col: float, max_px: int = 512):
    """Resize a 2-D slice so pixels are physically square, filling up to
    max_px on the longer physical axis (upscaling allowed so thin strips
    like sparse coronals still display at a usable size)."""
    import cv2

    h, w = img_u8.shape[:2]
    phys_h, phys_w = h * sp_row, w * sp_col
    if phys_h <= 0 or phys_w <= 0:
        return img_u8
    scale = max_px / max(phys_h, phys_w)
    scale = min(scale, 12.0)  # never blow a tiny image up more than 12x
    out_h = max(1, int(round(phys_h * scale)))
    out_w = max(1, int(round(phys_w * scale)))
    if (out_h, out_w) == (h, w):
        return img_u8
    interp = cv2.INTER_AREA if out_h * out_w < h * w else cv2.INTER_CUBIC
    return cv2.resize(img_u8, (out_w, out_h), interpolation=interp)


def render_slice(vol: np.ndarray, spacing: tuple[float, float, float], plane: str,
                 index: int, window: str, max_px: int = 512) -> str:
    """MPR slice as PNG data URL with physical aspect correction.

    plane: 'axial' | 'coronal' | 'sagittal'; index is 1-based.
    """
    import cv2

    dz, dy, dx = spacing
    nz, ny, nx = vol.shape
    plane = plane.lower()
    if plane == "axial":
        i = min(max(index, 1), nz)
        img = _window_u8(vol[i - 1], window)
        # in-plane pixels are (dy, dx) — square if PixelSpacing is isotropic
        sp_row, sp_col = dy, dx
    elif plane == "coronal":
        i = min(max(index, 1), ny)
        img = _window_u8(vol[:, i - 1, :], window)  # (nz, nx)
        sp_row, sp_col = dz, dx
    elif plane == "sagittal":
        i = min(max(index, 1), nx)
        img = _window_u8(vol[:, :, i - 1], window)  # (nz, ny)
        sp_row, sp_col = dz, dy
    else:
        raise ValueError(f"unknown plane {plane!r}")

    if abs(sp_row - sp_col) > 1e-6:
        img = _aspect_resize(img, sp_row, sp_col, max_px)
    elif max(img.shape) > max_px:
        sc = max_px / max(img.shape)
        img = cv2.resize(
            img, (int(img.shape[1] * sc), int(img.shape[0] * sc)),
            interpolation=cv2.INTER_AREA,
        )
    return arr_to_png_b64(img)


# ------------------------- ray-cast DVR -------------------------

def _transfer_alpha(hu: np.ndarray, preset: str) -> np.ndarray:
    """Alpha transfer function (0..1) on a HU volume."""
    if preset == "soft":
        # skin / soft-tissue surface: steep ramp at the skin-fat boundary so
        # compositing stops at the first surface (surface-render look)
        a = np.zeros_like(hu)
        m1 = (hu > -500) & (hu <= -200)
        a[m1] = 0.30 * (hu[m1] + 500) / 300.0
        m2 = (hu > -200) & (hu <= -50)
        a[m2] = 0.30 + 0.55 * (hu[m2] + 200) / 150.0
        m3 = hu > -50
        a[m3] = 0.85
        return a
    # bone preset: suppress everything below trabecular density
    a = np.zeros_like(hu)
    m1 = (hu > 150) & (hu <= 300)
    a[m1] = 0.45 * (hu[m1] - 150) / 150.0
    m2 = hu > 300
    a[m2] = 0.45 + 0.50 * np.clip((hu[m2] - 300) / 400.0, 0, 1)
    return a


def _transfer_color(hu: np.ndarray, preset: str) -> np.ndarray:
    """RGB color transfer function -> shape (*hu.shape, 3)."""
    if preset == "soft":
        # warm flesh tones, bone tinted
        base = np.zeros(hu.shape + (3,), dtype=np.float32)
        t = np.clip((hu + 300.0) / 800.0, 0, 1)
        base[..., 0] = 0.74 + 0.21 * t
        base[..., 1] = 0.45 + 0.30 * t
        base[..., 2] = 0.41 + 0.38 * t
        return base
    # bone preset: ivory bone, red marrow-ish hint at low density
    base = np.zeros(hu.shape + (3,), dtype=np.float32)
    t = np.clip((hu - 150.0) / 700.0, 0, 1)
    base[..., 0] = 0.84 + 0.15 * t
    base[..., 1] = 0.76 + 0.21 * t
    base[..., 2] = 0.60 + 0.35 * t
    return base


def _render_vr(vol: np.ndarray, spacing: tuple[float, float, float],
               preset: str = "bone", out_px: int = 384) -> str:
    """Front-to-back ray-cast DVR with gradient shading. Returns PNG data URL.

    Camera looks from the patient's FRONT (anterior): rays march along the
    original y axis, with the head at the top of the image.
    """
    import base64

    import cv2
    from scipy.ndimage import rotate, zoom

    dz, dy, dx = spacing
    # 0) crop to the anatomy: largest contiguous data run along z (drops
    #    isolated segments separated by acquisition gaps), then in-plane
    #    bounding box — the render fills the frame with visible structures
    row_has = (vol > -900.0).any(axis=(1, 2))
    runs: list[tuple[int, int]] = []
    i, n = 0, vol.shape[0]
    while i < n:
        if row_has[i]:
            j = i
            while j < n and row_has[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    if runs:
        best = max(runs, key=lambda r: r[1] - r[0])
        z0, z1 = max(best[0] - 2, 0), min(best[1] + 2, n)
        if len(runs) > 1 or (z0, z1) != (0, n):
            vol = vol[z0:z1]
    data_mask = vol > -900.0
    if data_mask.any():
        by = np.where(data_mask.any(axis=(0, 2)))[0]
        bx = np.where(data_mask.any(axis=(0, 1)))[0]
        y0, y1 = max(by[0] - 4, 0), min(by[-1] + 5, vol.shape[1])
        x0, x1 = max(bx[0] - 4, 0), min(bx[-1] + 5, vol.shape[2])
        vol = vol[:, y0:y1, x0:x1]

    # 1) near-isotropic resampling (~2.0 mm target), z oversampled for smooth
    #    compositing across the sparse slice axis
    target = 2.0
    fz = max(1.0, min(3.2, (dz if dz > 0.1 else 1.0) / target))
    fy = dy / target
    fx = dx / target
    small = zoom(vol, (fz, fy, fx), order=1).astype(np.float32)
    cap = 260
    big = max(small.shape)
    if big > cap:
        k = cap / big
        small = zoom(small, (k, k, k), order=1).astype(np.float32)

    # 2) orient for a frontal view:
    #    axis0 = ray (anterior -> posterior), axis1 = row (head -> feet),
    #    axis2 = col (patient right -> left as acquired)
    small = np.transpose(small, (1, 0, 2))  # (y, z, x)
    small = small[:, ::-1, :]  # head at row 0

    # 3) pose: gentle turntable yaw and a slight tilt from above. reshape=True
    #    expands the canvas so nothing is clipped; cval is air.
    small = rotate(small, 24.0, axes=(1, 2), reshape=True, order=1, cval=-1024.0)
    small = rotate(small, 10.0, axes=(0, 1), reshape=True, order=1, cval=-1024.0)

    # 4) transfer functions + gradient shading
    alpha = _transfer_alpha(small, preset)
    color = _transfer_color(small, preset)
    g0, g1, g2 = np.gradient(small)
    norm = np.sqrt(g0 * g0 + g1 * g1 + g2 * g2) + 1e-6
    n0, n1, n2 = g0 / norm, g1 / norm, g2 / norm
    light = np.array([-0.45, -0.62, -0.65])  # from upper-left-front
    light = light / np.linalg.norm(light)
    lambert = np.clip(-(n0 * light[0] + n1 * light[1] + n2 * light[2]), 0.0, 1.0)
    shade = 0.35 + 0.65 * lambert  # ambient + diffuse

    nz, nh, nw = small.shape
    C = np.zeros((nh, nw, 3), dtype=np.float32)
    A = np.zeros((nh, nw), dtype=np.float32)

    for k in range(nz):
        a = np.clip(alpha[k], 0.0, 0.95)
        if not a.any():
            continue
        contrib = (a[..., None] * color[k] * shade[k][..., None]).astype(np.float32)
        C += (1.0 - A)[..., None] * contrib
        A = A + (1.0 - A) * a

    img = np.clip(C, 0.0, 1.0)
    # background: subtle vertical gradient for depth
    yy = np.linspace(0.0, 1.0, nh).astype(np.float32)  # (nh,)
    bg = 0.06 + 0.08 * (1.0 - yy)  # (nh,)
    img = img + (1.0 - A)[..., None] * bg[:, None, None]
    u8 = (np.clip(img, 0, 1) * 255.0).round().astype(np.uint8)
    if max(u8.shape) != out_px:
        sc = out_px / max(u8.shape)
        u8 = cv2.resize(u8, (int(u8.shape[1] * sc), int(u8.shape[0] * sc)),
                        interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".png", cv2.cvtColor(u8, cv2.COLOR_RGB2BGR))
    if not ok:
        raise RuntimeError("VR PNG encode failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


# ------------------------- main entry -------------------------

def analyze(file_entries: list[tuple[bytes, str]] | None,
            preset: str = "bone",
            axial_previews: int = 12) -> dict:
    t0 = time.time()
    used_sample = False
    if not file_entries:
        file_entries = _load_sample_entries()
        used_sample = True

    vol, spacing, meta, warnings = _build_volume(file_entries)
    vid = _store_volume(vol, spacing, meta)
    nz, ny, nx = vol.shape

    # axial previews (lung window, evenly spaced)
    n_prev = min(axial_previews, nz)
    idxs = [int(round((i + 1) * nz / n_prev)) for i in range(n_prev)]
    previews = [render_slice(vol, spacing, "axial", i, AXIAL_PREVIEW_WINDOW, max_px=384)
                for i in idxs]

    # representative coronal / sagittal centers
    coronal = render_slice(vol, spacing, "coronal", ny // 2 + 1, "soft", max_px=512)
    sagittal = render_slice(vol, spacing, "sagittal", nx // 2 + 1, "soft", max_px=512)

    # volume rendering
    vr = _render_vr(vol, spacing, preset=preset)

    body_mask = vol > -300
    vox_ml = (spacing[0] * spacing[1] * spacing[2]) / 1000.0  # mm³ → ml
    dt_ms = (time.time() - t0) * 1000

    return {
        "engine": ENGINE_ID,
        "model_file": "MPR + ray-cast DVR (no weights)",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(nx), int(ny), int(nz)],
        "volume_id": vid,
        "used_sample": used_sample,
        "preset": preset,
        "meta": meta,
        "stats": {
            "slices": int(nz),
            "voxels": int(vol.size),
            "hu_min": round(float(vol.min()), 1),
            "hu_max": round(float(vol.max()), 1),
            "hu_mean": round(float(vol.mean()), 1),
            "body_volume_ml": round(float(body_mask.sum() * vox_ml), 1),
            "spacing_mm": [round(s, 3) for s in spacing],
        },
        "planes": {
            "axial": {
                "count": int(nz),
                "window": AXIAL_PREVIEW_WINDOW,
                "preview_indices": idxs,
                "previews": previews,
            },
            "coronal": {"count": int(ny), "window": "soft", "center": coronal},
            "sagittal": {"count": int(nx), "window": "soft", "center": sagittal},
        },
        "vr": {"image": vr, "preset": preset},
        "warnings": warnings,
        "findings": [],
        "findings_count": 0,
        "source_ref": SOURCE_REF,
    }


def get_slice(volume_id: str, plane: str, index: int, window: str,
              max_px: int = 512) -> dict:
    entry = _get_volume(volume_id)
    if entry is None:
        raise KeyError("volume not found or expired — reload the series")
    vol = entry["vol"]
    spacing = entry["spacing"]
    nz, ny, nx = vol.shape
    plane = plane.lower()
    count = {"axial": nz, "coronal": ny, "sagittal": nx}[plane]
    img = render_slice(vol, spacing, plane, int(index), window, max_px=max_px)
    return {
        "volume_id": volume_id,
        "plane": plane,
        "index": int(index),
        "count": int(count),
        "window": window,
        "image": img,
    }


def render_vr_preset(volume_id: str, preset: str, out_px: int = 384) -> dict:
    entry = _get_volume(volume_id)
    if entry is None:
        raise KeyError("volume not found or expired — reload the series")
    if preset not in ("bone", "soft"):
        preset = "bone"
    img = _render_vr(entry["vol"], entry["spacing"], preset=preset, out_px=out_px)
    return {"volume_id": volume_id, "preset": preset, "image": img}
