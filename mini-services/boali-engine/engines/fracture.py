"""Multi-Anatomy Bone Fracture Detection (YOLO ONNX).

Ported VERBATIM from BoneSuppression_Desktop.py:3760-3860
(`run_fracture_inference`) — same model candidates, same 640x640 blob
(swapRB, 1/255), same NMS 0.40, same box scaling. The Tkinter/UI parts
were removed; the numeric pipeline is unchanged.
"""

from __future__ import annotations

import threading
import time

import cv2
import numpy as np

from .common import annotated_png, find_weight_file
from .reporting import RESEARCH_DISCLAIMER, now_str, sec

# Verbatim from BoneSuppression_Desktop.py:3768-3770 (ortho/auto choice)
MODEL_CANDIDATES = ["fracture_ortho.onnx", "fracture_yolo11.onnx", "fracture_yolov8.onnx"]

_lock = threading.Lock()
_net = None
_loaded_path: str | None = None

ENGINE_ID = "fracture"
ENGINE_NAME = "Fracture Detection (YOLO ONNX)"
SOURCE_REF = "BoneSuppression_Desktop.py:3760-3860"


def locate_model() -> str | None:
    for c in MODEL_CANDIDATES:
        p = find_weight_file(c)
        if p:
            return p
    return None


def status() -> dict:
    path = locate_model()
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready" if path else "weights_missing",
        "framework": "OpenCV DNN (ONNX)",
        "model_file": path.split("/")[-1] if path else None,
        "weight_path": path,
        "source_ref": SOURCE_REF,
        "message": (
            "Real YOLO ONNX inference (verbatim port)."
            if path
            else "No fracture ONNX weights found. Place fracture_ortho.onnx in "
            "mini-services/boali-engine/weights/ (download from "
            "huggingface.co/arammoostafaye/bone-suppression-desktop)."
        ),
    }


def _get_net():
    global _net, _loaded_path
    path = locate_model()
    if path is None:
        raise RuntimeError("fracture weights not found")
    with _lock:
        if _loaded_path != path or _net is None:
            # Verbatim from BoneSuppression_Desktop.py:3785
            _net = cv2.dnn.readNetFromONNX(path)
            _loaded_path = path
    return _net


def analyze(arr01: np.ndarray, conf_thresh: float = 0.08, use_clahe: bool = True) -> dict:
    """arr01: float32 [0,1] grayscale. Returns findings + elapsed + annotated PNG.

    Default conf 0.08 and NMS 0.40 are the desktop defaults
    (BoneSuppression_Desktop.py:2806, 3838).
    """
    net = _get_net()
    t0 = time.time()

    # Verbatim from 3797-3810: display image -> gray -> optional CLAHE -> BGR
    disp = np.clip(arr01, 0.0, 1.0)
    gray = (disp * 255.0).round().astype(np.uint8)
    if gray.ndim == 3:
        gray = cv2.cvtColor(gray, cv2.COLOR_RGB2GRAY)
    h, w = gray.shape[:2]

    if use_clahe:
        # Verbatim from 3805-3806: CLAHE clipLimit 2.5, tile 8x8
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        enhanced_gray = clahe.apply(gray)
    else:
        enhanced_gray = gray

    enhanced_bgr = cv2.cvtColor(enhanced_gray, cv2.COLOR_GRAY2BGR)

    # Verbatim from 3813-3815: direct 640x640 blob, swapRB=True, 1/255
    blob = cv2.dnn.blobFromImage(enhanced_bgr, 1.0 / 255.0, (640, 640), swapRB=True, crop=False)
    net.setInput(blob)
    pred = net.forward()[0].T  # (8400, 5)

    boxes: list[list[int]] = []
    confidences: list[float] = []
    x_scale = w / 640.0
    y_scale = h / 640.0

    # Verbatim from 3822-3836
    for row in pred:
        conf = float(row[4])
        if conf >= conf_thresh:
            cx, cy, bw, bh = row[:4]
            x1 = int(round((cx - 0.5 * bw) * x_scale))
            y1 = int(round((cy - 0.5 * bh) * y_scale))
            box_w = int(round(bw * x_scale))
            box_h = int(round(bh * y_scale))
            x1 = max(0, min(w - 1, x1))
            y1 = max(0, min(h - 1, y1))
            box_w = min(w - x1, box_w)
            box_h = min(h - y1, box_h)
            if box_w > 5 and box_h > 5:
                boxes.append([x1, y1, box_w, box_h])
                confidences.append(conf)

    # Verbatim from 3838
    indices = cv2.dnn.NMSBoxes(boxes, confidences, conf_thresh, 0.40)
    findings: list[dict] = []
    if len(indices) > 0:
        for idx in indices:
            i = idx if isinstance(idx, (int, np.integer)) else idx[0]
            bx, by, bw, bh = boxes[i]
            # Verbatim finding shape from 3844-3849
            findings.append(
                {
                    "box": (bx, by, bx + bw, by + bh),
                    "conf": float(confidences[i]),
                    "label": "Bone fracture (ortho)",
                }
            )

    findings.sort(key=lambda x: x["conf"], reverse=True)
    dt_ms = (time.time() - t0) * 1000

    report = _build_report(findings, conf_thresh, dt_ms, w, h)

    return {
        "engine": ENGINE_ID,
        "model_file": _loaded_path.split("/")[-1],
        "elapsed_ms": round(dt_ms),
        "source_size": [int(w), int(h)],
        "conf_threshold": conf_thresh,
        "nms_threshold": 0.40,
        "clahe": use_clahe,
        "findings": findings,
        "findings_count": len(findings),
        "report": report,
        "annotated_image": annotated_png(arr01, findings),
        "source_ref": SOURCE_REF,
    }


_REGIONS = {
    # (English, Persian) anatomical image-region descriptors — positional,
    # honestly derived from the box centre; NOT anatomic name identification.
    "upper third": ("upper third of the image", "یک‌سوم بالایی تصویر"),
    "middle third": ("middle third of the image", "یک‌سوم میانی تصویر"),
    "lower third": ("lower third of the image", "یک‌سوم پایینی تصویر"),
    "left": ("left side of the image", "سمت چپ تصویر"),
    "centre": ("central zone", "ناحیه مرکزی"),
    "right": ("right side of the image", "سمت راست تصویر"),
}


def _region_of(box: list[int], w: int, h: int) -> tuple[str, str]:
    x1, y1, x2, y2 = box
    cx, cy = (x1 + x2) / 2.0 / w, (y1 + y2) / 2.0 / h
    vert = ("upper third" if cy < 1 / 3 else
            "middle third" if cy < 2 / 3 else "lower third")
    horiz = ("left" if cx < 0.40 else "centre" if cx < 0.60 else "right")
    return _REGIONS[vert], _REGIONS[horiz]


def _build_report(findings: list[dict], conf_thresh: float,
                  dt_ms: float, w: int, h: int) -> dict:
    """Detailed bilingual report — boxes, confidences and measured regions."""
    if findings:
        lines_en, lines_fa = [], []
        for i, f in enumerate(findings, 1):
            (ve, vf), (he, hf) = _region_of(f["box"], w, h)
            x1, y1, x2, y2 = f["box"]
            size_mm = "unknown (no pixel-spacing metadata)"
            lines_en.append(
                f"Region {i}: bounding box [{x1}, {y1}, {x2}, {y2}] px, "
                f"{ve} / {he}, model confidence {f['conf'] * 100:.1f}% "
                f"(absolute pixel size {size_mm})."
            )
            lines_fa.append(
                f"ناحیه {i}: کادر [{x1}، {y1}، {x2}، {y2}] پیکسل، {vf} / {hf}، "
                f"اطمینان مدل {f['conf'] * 100:.1f}٪."
            )
        find_en = (
            f"{len(findings)} suspicious region(s) above the confidence "
            f"threshold {conf_thresh:.2f} (NMS 0.40). " + " ".join(lines_en)
        )
        find_fa = (
            f"{len(findings)} ناحیه مشکوک بالاتر از آستانه اطمینان "
            f"{conf_thresh:.2f} (NMS ۰٫۴۰). " + " ".join(lines_fa)
        )
        imp_en = (f"Positive fracture-pattern detection(s): {len(findings)}. "
                  f"Correlate with clinical examination and dedicated views; "
                  f"CT is advised when management depends on fragment "
                  f"displacement.")
        imp_fa = (f"تشخیص الگوی شکستگی مثبت: {len(findings)} مورد. "
                  f"همبستگی با معاینه بالینی و نماهای اختصاصی؛ در صورت "
                  f"وابستگی درمان به جابجایی قطعات، CT توصیه می‌شود.")
    else:
        find_en = (
            f"No region crossed the detection threshold (conf ≥ "
            f"{conf_thresh:.2f}, NMS 0.40) on this radiograph. The model "
            f"cannot exclude subtle non-displaced fractures — correlate "
            f"clinically."
        )
        find_fa = (
            f"هیچ ناحیه‌ای آستانه تشخیص (اطمینان ≥ {conf_thresh:.2f}) را "
            f"رد نکرد. مدل نمی‌تواند شکستگی‌های ظریف بدون جابجایی را "
            f"قطعاً رد کند — همبستگی بالینی لازم است."
        )
        imp_en = ("No fracture pattern detected by the model at the "
                  "configured threshold.")
        imp_fa = ("الگوی شکستگی توسط مدل در آستانه تنظیم‌شده تشخیص "
                  "داده نشد.")

    return {
        "generated_at": now_str(),
        "sections": [
            sec("technique", "Technique", "تکنیک",
                f"Multi-anatomy fracture detection (YOLO ONNX, 640×640 blob, "
                f"CLAHE 2.5/8×8 preprocessing, NMS 0.40, conf ≥ "
                f"{conf_thresh:.2f}) on a {w}×{h} px radiograph. Inference "
                f"{dt_ms:.0f} ms on CPU.",
                f"تشخیص شکستگی چندآناتومیک (YOLO ONNX، بلاب ۶۴۰×۶۴۰، "
                f"پیش‌پردازش CLAHE، NMS ۰٫۴۰، آستانه {conf_thresh:.2f}) روی "
                f"رادیوگرافی {w}×{h} پیکسل. استنتاج {dt_ms:.0f} "
                f"میلی‌ثانیه."),
            sec("findings", "Findings", "یافته‌ها", find_en, find_fa),
            sec("impression", "Impression", "جمع‌بندی", imp_en, imp_fa),
            sec("limitations", "Limitations", "محدودیت‌ها",
                "Region descriptions are image-positional (image left/right), "
                "not laterality-verified anatomy. Without pixel-spacing "
                "metadata, box sizes are in pixels only. The annotated image "
                "shows every detection — verify each visually before "
                "accepting.",
                "توصیف نواحی بر اساس موقعیت تصویری است (چپ/راست تصویر)، نه "
                "طرفیت آناتومیک تأییدشده. بدون متادیتای فاصله پیکسلی، "
                "اندازه کادرها فقط به پیکسل است. تصویر annotat شده همه "
                "تشخیص‌ها را نشان می‌دهد — پیش از پذیرش، هر مورد را "
                "بصری تأیید کنید."),
        ],
        **RESEARCH_DISCLAIMER,
    }
