"""Qure.ai TorchScript bone & lung-component suppression.

Ported VERBATIM from BoneSuppression_Desktop.py:3706-3758
(`run_suppression_inference`) — same 1024x1024 INTER_AREA resize, same
additive identities (soft = input - bone, nonlung = soft - lung), same
cubic upscale back. Requires torch + the two TorchScript traces.
"""

from __future__ import annotations

import threading
import time

import numpy as np

from .common import find_weight_file, python_has, to_u8

SIZE = 1024  # verbatim from BoneSuppression_Desktop.py:175

ENGINE_ID = "bone-suppression"
ENGINE_NAME = "Bone & Lung Suppression (Qure TorchScript)"
SOURCE_REF = "BoneSuppression_Desktop.py:3706-3758"

_lock = threading.Lock()
_bone_model = None
_lung_model = None
_loaded = False


def _weights() -> tuple[str | None, str | None]:
    return find_weight_file("bone_suppression.ts"), find_weight_file("lung_component_suppression.ts")


def status() -> dict:
    has_torch = python_has("torch")
    bone_p, lung_p = _weights()
    if not has_torch:
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "deps_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": None,
            "source_ref": SOURCE_REF,
            "message": "PyTorch is not installed on this machine. "
            "Install with: pip install torch --index-url https://download.pytorch.org/whl/cpu "
            "then place bone_suppression.ts and lung_component_suppression.ts in weights/.",
        }
    if not (bone_p and lung_p):
        return {
            "engine": ENGINE_ID,
            "name": ENGINE_NAME,
            "status": "weights_missing",
            "framework": "PyTorch TorchScript",
            "weight_path": bone_p or lung_p,
            "source_ref": SOURCE_REF,
            "message": "TorchScript traces not found (bone_suppression.ts / "
            "lung_component_suppression.ts). Download from "
            "huggingface.co/qureaiorg/bone-suppression (CC BY-NC-SA: research-only).",
        }
    return {
        "engine": ENGINE_ID,
        "name": ENGINE_NAME,
        "status": "ready",
        "framework": "PyTorch TorchScript",
        "weight_path": bone_p,
        "source_ref": SOURCE_REF,
        "message": "Real Qure TorchScript inference (verbatim port).",
    }


def unload() -> None:
    """Free both TorchScript models (memwatch idle guard)."""
    global _bone_model, _lung_model, _loaded
    with _lock:
        _bone_model = None
        _lung_model = None
        _loaded = False


def _get_models():
    global _bone_model, _lung_model, _loaded
    import torch  # lazy

    with _lock:
        if _loaded:
            return _bone_model, _lung_model, torch
        bone_p, lung_p = _weights()
        if not (bone_p and lung_p):
            raise RuntimeError("bone suppression weights not found")
        # Verbatim load from BoneSuppression_Desktop.py:4050-4060
        _bone_model = torch.jit.load(bone_p, map_location="cpu").eval()
        _lung_model = torch.jit.load(lung_p, map_location="cpu").eval()
        _loaded = True
    return _bone_model, _lung_model, torch


def _load_one(which: str):
    """Load a single trace (two-phase mode for memory-constrained hosts).

    The two Qure traces are ~420 MB each; on the 3.9 GB sandbox host they
    cannot both stay resident alongside torch + the web server. This loads
    one trace at a time and drops it after use — numerics are identical to
    the desktop pipeline, only the model lifecycle differs.
    """
    global _bone_model, _lung_model, _loaded
    import torch  # lazy

    with _lock:
        bone_p, lung_p = _weights()
        if not (bone_p and lung_p):
            raise RuntimeError("bone suppression weights not found")
        if which == "bone":
            if _bone_model is None:
                _bone_model = torch.jit.load(bone_p, map_location="cpu").eval()
            return _bone_model, torch
        if _lung_model is None:
            _lung_model = torch.jit.load(lung_p, map_location="cpu").eval()
        return _lung_model, torch


def _drop_one(which: str) -> None:
    global _bone_model, _lung_model, _loaded
    with _lock:
        if which == "bone":
            _bone_model = None
        else:
            _lung_model = None
        _loaded = False


def analyze(arr01: np.ndarray) -> dict:
    t0 = time.time()
    import cv2
    import torch

    both = _loaded and _bone_model is not None and _lung_model is not None

    # Verbatim from 3722-3727: 1024x1024 INTER_AREA resize
    resized = cv2.resize(arr01, (SIZE, SIZE), interpolation=cv2.INTER_AREA)

    # Verbatim from 3729: tensor 1x1x1024x1024
    t_in = torch.from_numpy(resized).unsqueeze(0).unsqueeze(0).float().to("cpu")

    with torch.no_grad():
        # phase 1 — bone trace (verbatim from 3732-3734)
        if both:
            bone_model = _bone_model
        else:
            bone_model, torch = _load_one("bone")
        bone_out = bone_model(t_in)
        bone_tensor = bone_out[0] if isinstance(bone_out, (list, tuple)) else bone_out
        soft_tensor = t_in - bone_tensor
        if not both:
            _drop_one("bone")  # free ~420 MB before the lung phase

        # phase 2 — lung trace (verbatim from 3735-3737)
        if both:
            lung_model = _lung_model
        else:
            lung_model, torch = _load_one("lung")
        lung_out = lung_model(soft_tensor)
        lung_tensor = lung_out[0] if isinstance(lung_out, (list, tuple)) else lung_out
        nonlung_tensor = soft_tensor - lung_tensor
        if not both:
            _drop_one("lung")

    def to_full_res(t):
        # Verbatim from 3739-3744
        a = t.squeeze().cpu().numpy()
        return cv2.resize(a, (arr01.shape[1], arr01.shape[0]), interpolation=cv2.INTER_CUBIC)

    soft_np = to_full_res(soft_tensor)
    bone_np = to_full_res(bone_tensor)
    lung_np = to_full_res(lung_tensor)
    nonlung_np = to_full_res(nonlung_tensor)

    from .common import arr_to_png_b64

    dt_ms = (time.time() - t0) * 1000
    return {
        "engine": ENGINE_ID,
        "model_file": "bone_suppression.ts + lung_component_suppression.ts",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(arr01.shape[1]), int(arr01.shape[0])],
        "findings": [],
        "findings_count": 0,
        "images": {
            "soft_tissue": arr_to_png_b64(to_u8(soft_np, arr01.shape, stretch=True)),
            "bone": arr_to_png_b64(to_u8(bone_np, arr01.shape, stretch=True)),
            "lung": arr_to_png_b64(to_u8(lung_np, arr01.shape, stretch=True)),
            "non_lung_soft": arr_to_png_b64(to_u8(nonlung_np, arr01.shape, stretch=True)),
        },
        "source_ref": SOURCE_REF,
    }
