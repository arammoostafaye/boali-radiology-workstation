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
        "annotated_image": annotated_png(arr01, findings),
        "source_ref": SOURCE_REF,
    }
