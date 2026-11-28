"""Shared helpers for the Boali engine service.

Inference logic is ported VERBATIM from the author's desktop application
(boali-radiology-suite / BoneSuppression_Desktop.py) so the models behave
identically. Source lines are cited at each function.

No fabricated results: when a dependency or a weight file is missing the
engines report an honest error instead of a placeholder.
"""

from __future__ import annotations

import base64
import os

import cv2
import numpy as np

# ---------------------------------------------------------------------------
# Weight discovery
# Ported (simplified & hardened) from BoneSuppression_Desktop.py:125-153
# `find_weight_file`. Search order:
#   1. $BOALI_WEIGHTS_DIR (explicit override, hospital deployment)
#   2. <service root>/weights            (this service's weights folder)
#   3. <service root>/../weights         (repo-style layout)
#   4. $CWD/weights
# ---------------------------------------------------------------------------
SERVICE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PARENT_DIR = os.path.dirname(SERVICE_ROOT)

_WEIGHT_DIRS = [
    os.environ.get("BOALI_WEIGHTS_DIR", ""),
    os.path.join(SERVICE_ROOT, "weights"),
    os.path.join(PARENT_DIR, "weights"),
    os.path.join(os.getcwd(), "weights"),
]


def weight_dirs() -> list[str]:
    return [d for d in _WEIGHT_DIRS if d]


def find_weight_file(filename: str) -> str | None:
    """Return the first existing weight path (>500 bytes) or None.

    Verbatim size guard from BoneSuppression_Desktop.py:150.
    Unlike the desktop version this does NOT crawl arbitrary parent
    directories, to avoid silently binding stale/foreign weights.
    """
    for d in weight_dirs():
        c = os.path.join(d, filename)
        if os.path.isfile(c) and os.path.getsize(c) > 500:
            return c
    return None


def python_has(module: str) -> bool:
    """Check importability WITHOUT executing the module (find_spec only) —
    keeps /api/status cheap: torch (~600 MB) loads only on real inference."""
    import importlib.util

    try:
        return importlib.util.find_spec(module) is not None
    except Exception:
        return False


# ---------------------------------------------------------------------------
# looks_inverted
# Ported verbatim from the author's Qure-space port (app.py:101-117).
# True when the mediastinum column is clearly DARKER than the lung fields
# (bone-dark input).
# ---------------------------------------------------------------------------
def looks_inverted(arr: np.ndarray) -> bool:
    h, w = arr.shape
    y0, y1 = int(0.40 * h), int(0.62 * h)
    central = arr[y0:y1, int(0.46 * w):int(0.54 * w)]
    left = arr[y0:y1, int(0.20 * w):int(0.32 * w)]
    right = arr[y0:y1, int(0.68 * w):int(0.80 * w)]
    if min(central.size, left.size, right.size) == 0:
        return False
    rng = float(arr.max() - arr.min()) + 1e-10
    ref = float((np.median(left) + np.median(right)) / 2.0)
    return (ref - float(np.median(central))) / rng > 0.04


# ---------------------------------------------------------------------------
# read_medical_image
# Ported from BoneSuppression_Desktop.py:4135-4201 (load path). DICOM first
# (pydicom, rescale slope/intercept + HU windowing + MONOCHROME1 + MG corner
# polarity), then PNG/JPG via OpenCV, then Pillow. Returns float32 [0,1]
# plus a metadata dict.
# ---------------------------------------------------------------------------
def read_medical_image(path: str, auto_invert: bool = True):
    meta: dict = {"source_file": os.path.basename(path)}

    # --- DICOM branch (verbatim logic, pydicom optional) ---
    try:
        import pydicom  # type: ignore

        ds = pydicom.dcmread(path, force=True)
        if hasattr(ds, "pixel_array"):
            meta["patient_id"] = str(getattr(ds, "PatientID", "")).strip()
            meta["patient_name"] = str(getattr(ds, "PatientName", "")).strip()
            meta["modality"] = str(getattr(ds, "Modality", "")).strip().upper()
            meta["view_position"] = str(getattr(ds, "ViewPosition", "")).strip()

            arr = ds.pixel_array.astype(np.float32)
            # Rescale Slope / Intercept (standard for CT Hounsfield Units)
            if hasattr(ds, "RescaleSlope") and hasattr(ds, "RescaleIntercept"):
                arr = arr * float(ds.RescaleSlope) + float(ds.RescaleIntercept)
                wc = getattr(ds, "WindowCenter", 40)
                ww = getattr(ds, "WindowWidth", 400)
                if isinstance(wc, (list, tuple)):
                    wc = float(wc[0])
                else:
                    try:
                        wc = float(wc)
                    except Exception:
                        wc = 40.0
                if isinstance(ww, (list, tuple)):
                    ww = float(ww[0])
                else:
                    try:
                        ww = float(ww)
                    except Exception:
                        ww = 400.0
                if ww <= 0:
                    ww = 400.0
                lo = wc - 0.5 - (ww - 1.0) / 2.0
                hi = wc - 0.5 + (ww - 1.0) / 2.0
                arr = np.clip(arr, lo, hi)
                arr = (arr - lo) / (hi - lo + 1e-8)
            else:
                photo = str(getattr(ds, "PhotometricInterpretation", "")).strip().upper()
                if photo == "MONOCHROME1":
                    arr = arr.max() - arr
                modality = meta.get("modality", "")
                arr = (arr - arr.min()) / (arr.max() - arr.min() + 1e-8)
                if modality == "MG" or "CC" in meta.get("view_position", "") or "MLO" in meta.get("view_position", ""):
                    # Mammography background is air -> must be dark (near 0)
                    corners = [arr[0, 0], arr[0, -1], arr[-1, 0], arr[-1, -1]]
                    if np.mean(corners) > 0.5:
                        arr = 1.0 - arr
            return arr, meta
    except ImportError:
        pass
    except Exception as e:
        # pydicom installed but this file is not DICOM -> fall through,
        # but keep the reason for diagnostics (never silently swallow).
        meta["dicom_error"] = str(e)

    # --- PNG/JPG via OpenCV (verbatim: 2800px cap + auto-invert) ---
    bgr = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
    if bgr is not None:
        h, w = bgr.shape
        if max(h, w) > 2800:
            sc = 2800.0 / float(max(h, w))
            bgr = cv2.resize(bgr, (int(w * sc), int(h * sc)), interpolation=cv2.INTER_AREA)
        arr = bgr.astype(np.float32) / 255.0
        if auto_invert and looks_inverted(arr):
            arr = 1.0 - arr
            meta["auto_inverted"] = True
        return arr, meta

    # --- Pillow fallback (verbatim) ---
    from PIL import Image  # type: ignore

    p = Image.open(path).convert("L")
    w, h = p.size
    if max(h, w) > 2800:
        sc = 2800.0 / float(max(h, w))
        p = p.resize((int(w * sc), int(h * sc)), Image.Resampling.BILINEAR)
    arr = np.array(p, dtype=np.float32) / 255.0
    if auto_invert and looks_inverted(arr):
        arr = 1.0 - arr
        meta["auto_inverted"] = True
    return arr, meta


# ---------------------------------------------------------------------------
# to_u8 — display encoding
# Ported from the author's app.py:120-135 (robust 0.5-99.5 percentile clip).
# ---------------------------------------------------------------------------
def to_u8(x, shape=None, stretch=False):
    y = np.asarray(x, dtype=np.float32)
    if stretch:
        lo, hi = (float(v) for v in np.percentile(y, [0.5, 99.5]))
        if hi - lo > 1e-6:
            y = (y - lo) / (hi - lo)
    y = (np.clip(y, 0.0, 1.0) * 255.0).round().astype(np.uint8)
    if shape is not None and y.shape != tuple(shape):
        y = cv2.resize(y, (shape[1], shape[0]), interpolation=cv2.INTER_CUBIC)
    return y


def arr_to_png_b64(gray_u8: np.ndarray, original_shape=None) -> str:
    """Encode a 2-D uint8 (or float [0,1]) image as a base64 PNG data URL."""
    if gray_u8.dtype != np.uint8:
        gray_u8 = to_u8(gray_u8, original_shape, stretch=True)
    ok, buf = cv2.imencode(".png", gray_u8)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")


def annotated_png(arr01: np.ndarray, boxes: list[dict]) -> str:
    """Render detection boxes over the image (display only; same overlay
    semantics as the desktop renderer)."""
    disp = to_u8(arr01, arr01.shape, stretch=True)
    bgr = cv2.cvtColor(disp, cv2.COLOR_GRAY2BGR)
    for f in boxes:
        x1, y1, x2, y2 = [int(v) for v in f["box"]]
        conf = float(f.get("conf", 0.0))
        color = (56, 88, 239)  # BGR red-ish, consistent with desktop overlay
        cv2.rectangle(bgr, (x1, y1), (x2, y2), color, 2)
        label = f"{conf * 100:.0f}%"
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 1)
        cv2.rectangle(bgr, (x1, max(0, y1 - th - 6)), (x1 + tw + 6, y1), color, -1)
        cv2.putText(
            bgr, label, (x1 + 3, max(12, y1 - 4)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA,
        )
    ok, buf = cv2.imencode(".png", bgr)
    if not ok:
        raise RuntimeError("PNG encoding failed")
    return "data:image/png;base64," + base64.b64encode(buf.tobytes()).decode("ascii")
