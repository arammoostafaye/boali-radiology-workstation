"""Mammography deep classifier (ResNet-50).

Ported VERBATIM from BoneSuppression_Desktop.py:178-225
(`MammoDeepClassifier`) — same checkpoint contract (class_names /
model_state / normalization stats), same transform. Returns the three raw
softmax probabilities. NOTE: unlike the desktop app, this service does NOT
silently default to p_normal=1.0 when the model is unavailable — it fails
honestly.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from .common import find_weight_file, python_has

ENGINE_ID = "mammography"
ENGINE_NAME = "Mammography ResNet-50 (benign/malignant/normal)"
SOURCE_REF = "BoneSuppression_Desktop.py:178-225"

_lock = threading.Lock()
_model = None
_transform = None
_class_names = ["benign", "malignant", "normal"]
_loaded = False


def _weight() -> str | None:
    return find_weight_file("mammo_resnet50.pt")


def status() -> dict:
    has_torch = python_has("torch")
    has_tv = python_has("torchvision")
    p = _weight()
    if not (has_torch and has_tv):
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "deps_missing",
            "framework": "PyTorch + torchvision",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "torch/torchvision not installed. Install both (CPU wheels) "
            "and place mammo_resnet50.pt in weights/.",
        }
    if not p:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "weights_missing",
            "framework": "PyTorch + torchvision",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "mammo_resnet50.pt not found. Download from "
            "huggingface.co/arammoostafaye/bone-suppression-desktop.",
        }
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready",
        "framework": "PyTorch + torchvision",
        "weight_path": p,
        "source_ref": SOURCE_REF,
        "message": "Real ResNet-50 classification (verbatim port).",
    }


def unload() -> None:
    """Free the ResNet-50 model (memwatch idle guard)."""
    global _model, _transform, _loaded
    with _lock:
        _model = None
        _transform = None
        _loaded = False


def _get_model():
    global _model, _transform, _class_names, _loaded
    import torch
    from PIL import Image
    from torchvision import models
    import torchvision.transforms as T

    p = _weight()
    if p is None:
        raise RuntimeError("mammography weights not found")
    with _lock:
        if _loaded:
            return _model, _transform, _class_names, torch, Image, T
        # Verbatim from BoneSuppression_Desktop.py:206-220
        ckpt = torch.load(p, map_location="cpu", weights_only=False)
        _class_names = ckpt.get("class_names", ["benign", "malignant", "normal"])
        m = models.resnet50()
        m.fc = torch.nn.Linear(m.fc.in_features, len(_class_names))
        m.load_state_dict(ckpt["model_state"])
        m.eval()
        _model = m

        mean = ckpt.get("normalization_mean", [0.485, 0.456, 0.406])
        std = ckpt.get("normalization_std", [0.229, 0.224, 0.225])
        _transform = T.Compose([
            T.Resize((224, 224)),
            T.ToTensor(),
            T.Normalize(mean=mean, std=std),
        ])
        _loaded = True
    return _model, _transform, _class_names, torch, Image, T


def analyze(arr01: np.ndarray) -> dict:
    model, transform, class_names, torch, Image, _T = _get_model()
    t0 = time.time()

    # Verbatim from 5313-5317: full view as RGB, no artificial cropping
    disp = np.clip(arr01, 0.0, 1.0)
    gray_u8 = (disp * 255.0).round().astype(np.uint8)
    rgb_im = Image.fromarray(gray_u8).convert("RGB")
    t_input = transform(rgb_im).unsqueeze(0).to("cpu")

    with torch.no_grad():
        logits = model(t_input)
        sm = torch.softmax(logits, dim=1).squeeze().cpu().numpy()

    probs = {class_names[i]: float(sm[i]) for i in range(len(class_names))}
    dt_ms = (time.time() - t0) * 1000

    # NOTE: no silent BI-RADS fabrication. Probabilities only; BI-RADS
    # assignment stays a radiologist decision (see repo audit, finding #46).
    return {
        "engine": ENGINE_ID,
        "model_file": "mammo_resnet50.pt",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(arr01.shape[1]), int(arr01.shape[0])],
        "probabilities": probs,
        "findings": [],
        "findings_count": 0,
        "source_ref": SOURCE_REF,
    }
