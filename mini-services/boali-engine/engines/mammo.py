"""Mammography deep classifier (ResNet-50) + honest structured reporting.

Inference is ported VERBATIM from BoneSuppression_Desktop.py:178-225
(`MammoDeepClassifier`) — same checkpoint contract (class_names /
model_state / normalization stats), same transform. Returns the three raw
softmax probabilities.

On top of the classifier this module produces a DETAILED, bilingual
(en/fa) structured report built only from measured facts:
  * image-derived quality metrics (exposure, contrast, sharpness, noise)
  * breast-region segmentation + fibroglandular density estimate (ACR A-D
    style, clearly labeled as a pixel-statistics estimate)
  * view-position estimation (CC vs MLO via pectoral signal / DICOM tag)
  * probability margin analysis and triage recommendation per outcome

No fabricated findings: the ResNet-50 is a whole-image triage classifier —
it does not localize lesions, and the report says so explicitly.
"""

from __future__ import annotations

import datetime
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
        "message": "Real ResNet-50 classification (verbatim port) + detailed "
        "structured reporting (image metrics, density estimate, triage).",
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


# --------------------------------------------------------------------- #
#  Image-derived metrics — everything measured, nothing invented        #
# --------------------------------------------------------------------- #

def _breast_metrics(arr01: np.ndarray, meta: dict) -> dict:
    """Segment the breast region and measure honest quality/density stats.

    After read_medical_image normalization, mammogram background (air +
    collimation) is near 0 and breast tissue is brighter.
    """
    import cv2

    h, w = arr01.shape
    rng = float(arr01.max() - arr01.min())

    # --- breast mask: threshold + morphological cleanup + largest blob ---
    mask = (arr01 > max(0.06 * max(rng, 1e-6), 0.04)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((21, 21), np.uint8))
    breast = mask.astype(bool)
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if n > 1:
        areas = stats[1:, cv2.CC_STAT_AREA]
        i = 1 + int(np.argmax(areas))
        if stats[i, cv2.CC_STAT_AREA] >= 0.02 * arr01.size:
            breast = lab == i

    breast_cov = float(breast.mean())
    area_pct = round(100.0 * breast_cov, 1)
    if breast_cov < 0.05:
        # segmentation failed (unusual input) — report honestly
        return {
            "breast_area_pct": area_pct,
            "segmentation_ok": False,
            "quality_flags": ["breast region could not be segmented — "
                              "metrics unavailable for this input"],
        }

    vals = arr01[breast].astype(np.float32)

    # --- density: Otsu split of the breast histogram (fat vs glandular) ---
    v8 = np.clip(vals * 255.0, 0, 255).astype(np.uint8)
    otsu_thr, _ = cv2.threshold(
        v8.reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )
    dense_frac = float((v8 > otsu_thr).mean())
    if dense_frac < 0.10:
        cat, cat_desc = "A", "almost entirely fatty"
    elif dense_frac <= 0.50:
        cat, cat_desc = "B", "scattered fibroglandular densities"
    elif dense_frac <= 0.75:
        cat, cat_desc = "C", "heterogeneously dense"
    else:
        cat, cat_desc = "D", "extremely dense"

    # --- exposure / contrast / sharpness / noise ---
    exposure = float(vals.mean())
    p10, p90 = (float(v) for v in np.percentile(vals, [10, 90]))
    contrast = p90 - p10

    u8_full = (np.clip(arr01, 0, 1) * 255).astype(np.uint8)
    lap = cv2.Laplacian(u8_full, cv2.CV_32F)
    sharpness = float(lap[breast].var())

    bg = ~breast
    noise = float(arr01[bg].std()) if bg.any() else 0.0
    background_pct = round(100.0 * float(bg.mean()), 1)

    # --- view position: DICOM tag first, else pectoral-wedge estimate ---
    view_tag = str(meta.get("view_position", "")).upper()
    pectoral = False
    # pectoral muscle = dense bright wedge at the upper chest-wall corner
    for side in (slice(0, w // 5), slice(4 * w // 5, w)):
        corner = arr01[0: h // 4, side]
        if corner.size and float(corner.mean()) > exposure + 0.12:
            pectoral = True
    if view_tag in ("CC", "MLO"):
        view, view_basis = view_tag, "DICOM ViewPosition tag"
    elif pectoral:
        view, view_basis = "MLO", "estimated — pectoral signal present"
    else:
        view, view_basis = "CC", "estimated — no pectoral signal"

    # --- honest quality flags ---
    flags: list[str] = []
    if exposure < 0.18:
        flags.append("under-exposed breast region — consider repeating")
    elif exposure > 0.82:
        flags.append("over-exposed breast region — consider repeating")
    else:
        flags.append("exposure adequate")
    if contrast < 0.18:
        flags.append("low subject contrast")
    else:
        flags.append("contrast adequate")
    if sharpness < 80:
        flags.append("low sharpness — possible motion blur")
    else:
        flags.append("sharpness adequate")
    if area_pct < 8.0:
        flags.append("small breast area in frame — check positioning/inclusion")
    if meta.get("auto_inverted"):
        flags.append("input polarity was auto-corrected")

    return {
        "segmentation_ok": True,
        "view_position": view,
        "view_basis": view_basis,
        "breast_area_pct": area_pct,
        "dense_fraction": round(dense_frac, 3),
        "density_category": cat,
        "density_category_desc": cat_desc,
        "density_basis": "Otsu fat/glandular split inside the segmented breast "
                         "(pixel-statistics estimate, not a certified ACR measurement)",
        "otsu_threshold": round(float(otsu_thr) / 255.0, 3),
        "exposure_mean": round(exposure, 3),
        "contrast_p90_p10": round(contrast, 3),
        "sharpness_lap_var": round(sharpness, 1),
        "background_noise_std": round(noise, 4),
        "background_pct": background_pct,
        "quality_flags": flags,
    }


# --------------------------------------------------------------------- #
#  Structured bilingual report                                           #
# --------------------------------------------------------------------- #

_DENSITY_FA = {
    "A": "تقریباً تماماً چربی",
    "B": "تراکم پراکنده بافت غددی-فیبری",
    "C": "ناهمگن و پرتراکم",
    "D": "به‌شدت پرتراکم",
}
_CLASS_FA = {"benign": "خوش‌خیم", "malignant": "بدخیم", "normal": "طبیعی"}


def _build_report(probs: dict, m: dict, meta: dict, dt_ms: float) -> dict:
    """Detailed bilingual report — every number is measured or model output."""
    ordered = sorted(probs.items(), key=lambda kv: kv[1], reverse=True)
    top_label, top_p = ordered[0]
    second_label, second_p = ordered[1] if len(ordered) > 1 else ("n/a", 0.0)
    margin = top_p - second_p
    top_fa = _CLASS_FA.get(top_label, top_label)
    src = str(meta.get("source_file", "upload"))
    view = m.get("view_position", "—")
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")

    # --- triage verdict + recommendation (per outcome, honest margins) ---
    if top_label == "malignant":
        verdict_en = "SUSPICION OF MALIGNANCY — RECALL"
        verdict_fa = "ظن بدخیمی — نیاز به فراخوانی"
        rec_en = (
            f"The classifier assigns its highest probability to 'malignant' "
            f"({top_p*100:.1f}%). Recommend immediate recall for diagnostic "
            f"work-up (supplementary views ± magnification/spot compression ± "
            f"ultrasound) and correlation with physical examination. Final "
            f"BI-RADS category is assigned by the reading radiologist."
        )
        rec_fa = (
            f"طبقه‌بند بیشترین احتمال را برای کلاس «بدخیم» "
            f"({top_p*100:.1f}٪) گزارش کرده است. فراخوانی فوری بیمار برای "
            f"ارزیابی تشخیصی تکمیلی (نماهای اضافی، فشردگی نقطه‌ای و در "
            f"صورت نیاز سونوگرافی) و همبستگی با معاینه بالینی توصیه می‌شود. "
            f"تعیین نهایی رده BI-RADS با رادیولوژیست است."
        )
    elif top_label == "benign":
        if margin >= 0.50:
            verdict_en = "BENIGN PATTERN — HIGH CONFIDENCE"
            verdict_fa = "الگوی خوش‌خیم — اطمینان بالا"
            rec_en = (
                f"Benign pattern with a wide margin over the next class "
                f"({top_p*100:.1f}% vs {second_label} {second_p*100:.1f}%, "
                f"margin {margin*100:.1f} points). Routine screening "
                f"continues per age-appropriate guidelines; correlate with "
                f"prior studies and clinical findings."
            )
            rec_fa = (
                f"الگوی خوش‌خیم با فاصله اطمینان زیاد نسبت به کلاس بعدی "
                f"({top_p*100:.1f}٪ در برابر {second_p*100:.1f}٪ برای "
                f"«{_CLASS_FA.get(second_label, second_label)}»، فاصله "
                f"{margin*100:.1f} واحد). ادامه غربالگری روتین مطابق "
                f"راهنمای گروه سنی و همبستگی با تصاویر و یافته‌های بالینی "
                f"قبلی توصیه می‌شود."
            )
        else:
            verdict_en = "BENIGN PATTERN — MODERATE CONFIDENCE"
            verdict_fa = "الگوی خوش‌خیم — اطمینان متوسط"
            rec_en = (
                f"Benign pattern, but the margin over '{second_label}' is "
                f"narrow ({margin*100:.1f} points). Consider supplementary "
                f"views or short-interval follow-up at the radiologist's "
                f"discretion; correlate with priors."
            )
            rec_fa = (
                f"الگوی خوش‌خیم، اما فاصله با کلاس «{second_label}» اندک است "
                f"({margin*100:.1f} واحد). انجام نماهای تکمیلی یا پیگیری "
                f"کوتاه‌مدت بر اساس صلاحدید رادیولوژیست و همبستگی با "
                f"تصاویر قبلی در نظر گرفته شود."
            )
    else:  # normal
        verdict_en = "NO ABNORMALITY DETECTED — ROUTINE SCREEN"
        verdict_fa = "بدون شواهد غیرطبیعی — غربالگری روتین"
        rec_en = (
            f"Highest probability assigned to 'normal' ({top_p*100:.1f}%). "
            f"Continue routine screening per guidelines. The model is a "
            f"triage aid and does not replace the radiologist's read."
        )
        rec_fa = (
            f"بیشترین احتمال برای کلاس «طبیعی» ({top_p*100:.1f}٪) است. "
            f"ادامه غربالگری روتین مطابق راهنما. این مدل ابزار کمکی "
            f"اولویت‌بندی است و جایگزین نظر رادیولوژیست نیست."
        )

    # --- technique line ---
    dim = f"{meta.get('cols', '')}×{meta.get('rows', '')}".strip("×") or "—"
    tech_en = (
        f"Single mammographic view ({view}) analysed — {src}. "
        f"Classifier: ResNet-50, input resized 224×224 with the checkpoint's "
        f"own normalization (verbatim port of the desktop pipeline). "
        f"Inference time {dt_ms:.0f} ms on CPU."
    )
    tech_fa = (
        f"یک نمای ماموگرافی ({view}) تحلیل شد — {src}. "
        f"طبقه‌بند: ResNet-50 با ورودی ۲۲۴×۲۲۴ و نرمال‌سازی مربوط به خود "
        f"چک‌پوینت (پورت دقیق خط لوله نسخه دسکتاپ). زمان استنتاج "
        f"{dt_ms:.0f} میلی‌ثانیه روی پردازنده."
    )

    # --- quality + density lines (measured) ---
    if m.get("segmentation_ok"):
        q_en = "; ".join(m["quality_flags"])
        q_fa_items = {
            "exposure adequate": "نوردهی مناسب",
            "under-exposed breast region — consider repeating":
                "نوردهی کم — تکرار تصویر توصیه می‌شود",
            "over-exposed breast region — consider repeating":
                "نوردهی زیاد — تکرار تصویر توصیه می‌شود",
            "contrast adequate": "کنتراست مناسب",
            "low subject contrast": "کنتراست پایین",
            "sharpness adequate": "وضوح مناسب",
            "low sharpness — possible motion blur":
                "وضوح کم — احتمال موشن بلور",
            "small breast area in frame — check positioning/inclusion":
                "سطح پستان در کادر کم است — پوزیشن بررسی شود",
            "input polarity was auto-corrected":
                "پلاریته ورودی به‌صورت خودکار اصلاح شد",
        }
        q_fa = "؛ ".join(q_fa_items.get(f, f) for f in m["quality_flags"])

        dens_en = (
            f"Density category {m['density_category']} ({m['dense_fraction']*100:.0f}% "
            f"fibroglandular fraction — {m['density_category_desc']}); "
            f"breast occupies {m['breast_area_pct']}% of the frame. "
            f"{m['density_basis']}."
        )
        dens_fa = (
            f"رده تراکم {m['density_category']} (سهم بافت غددی-فیبری "
            f"{m['dense_fraction']*100:.0f}٪ — {_DENSITY_FA[m['density_category']]})؛ "
            f"پستان {m['breast_area_pct']}٪ سطح تصویر را اشغال کرده است. "
            f"برآورد آماری پیکسلی است، نه اندازه‌گیری رسمی ACR."
        )
        meas = (
            f"exposure {m['exposure_mean']:.2f} · contrast {m['contrast_p90_p10']:.2f} "
            f"· sharpness {m['sharpness_lap_var']:.0f} · background noise "
            f"{m['background_noise_std']:.3f}"
        )
    else:
        q_en = q_fa = m["quality_flags"][0]
        dens_en = "Breast composition could not be estimated for this input."
        dens_fa = "برآورد ترکیب بافت پستان برای این ورودی ممکن نشد."
        meas = "unavailable"

    # --- findings (what the model CAN and CANNOT say) ---
    probs_en = " · ".join(f"{k} {v*100:.1f}%" for k, v in ordered)
    probs_fa = " · ".join(
        f"{_CLASS_FA.get(k, k)} {v*100:.1f}٪" for k, v in ordered
    )
    find_en = (
        f"Whole-image triage probabilities: {probs_en}. "
        f"The dominant class is '{top_label}' with a {margin*100:.1f}-point "
        f"margin over '{second_label}'. This model is a GLOBAL classifier: "
        f"it does not localize or measure lesions, does not detect "
        f"calcification clusters, and does not compare laterality. "
        f"Measured image characteristics: {meas}."
    )
    find_fa = (
        f"احتمالات اولویت‌بندی کل تصویر: {probs_fa}. "
        f"کلاس غالب «{top_fa}» با فاصله {margin*100:.1f} واحد نسبت به "
        f"«{_CLASS_FA.get(second_label, second_label)}» است. این مدل "
        f"طبقه‌بند «کل تصویر» است: ضایعه را مکان‌یابی یا اندازه‌گیری "
        f"نمی‌کند، خوشه‌های میکروکلسیفیکاسیون را جداگانه تشخیص نمی‌دهد و "
        f"مقایسه دوطرفه انجام نمی‌دهد. مشخصات اندازه‌گیری‌شده تصویر: {meas}."
    )

    imp_en = (
        f"AI triage: {top_label} pattern at {top_p*100:.1f}% "
        f"(margin {margin*100:.1f} points). {verdict_en}. "
        f"This is a computer-assisted estimate for prioritization only."
    )
    imp_fa = (
        f"اولویت‌بندی هوش مصنوعی: الگوی {top_fa} با احتمال "
        f"{top_p*100:.1f}٪ (فاصله {margin*100:.1f} واحد). {verdict_fa}. "
        f"این یک برآورد رایانه‌ای صرفاً برای اولویت‌بندی است."
    )

    lim_en = (
        "Single-view analysis; no prior-study comparison; no lesion "
        "localization; density is a pixel-statistics estimate; model "
        "calibration on your population is not guaranteed — the reading "
        "radiologist remains fully responsible for the final assessment."
    )
    lim_fa = (
        "تحلیل تک‌نما؛ بدون مقایسه با مطالعات قبلی؛ بدون مکان‌یابی ضایعه؛ "
        "تراکم برآورد آماری پیکسلی است و کالیبراسیون مدل روی جمعیت شما "
        "تضمین نمی‌شود — مسئولیت نهایی ارزیابی با رادیولوژیست است."
    )

    def sec(i, t_en, t_fa, b_en, b_fa):
        return {"id": i, "title_en": t_en, "title_fa": t_fa,
                "body_en": b_en, "body_fa": b_fa}

    return {
        "generated_at": now,
        "verdict_en": verdict_en,
        "verdict_fa": verdict_fa,
        "verdict_color": ("#f87171" if top_label == "malignant"
                          else "#4ade80" if top_label == "benign"
                          else "#7dd3fc"),
        "sections": [
            sec("indication", "Clinical Indication", "شرح حال",
                "Mammographic screening / diagnostic evaluation "
                "(specify on final report).",
                "غربالگری یا ارزیابی تشخیصی ماموگرافی (در گزارش نهایی "
                "تکمیل شود)."),
            sec("technique", "Technique", "تکنیک", tech_en, tech_fa),
            sec("quality", "Image Quality", "کیفیت تصویر", q_en, q_fa),
            sec("composition", "Breast Composition", "ترکیب بافت پستان",
                dens_en, dens_fa),
            sec("findings", "Findings", "یافته‌ها", find_en, find_fa),
            sec("impression", "Impression", "جمع‌بندی", imp_en, imp_fa),
            sec("recommendation", "Recommendation", "توصیه", rec_en, rec_fa),
            sec("limitations", "Limitations", "محدودیت‌ها", lim_en, lim_fa),
        ],
        "disclaimer_en": (
            "AI-generated draft for research/education. A licensed "
            "radiologist must review, edit and sign before clinical use. "
            "BI-RADS assignment remains a human decision."
        ),
        "disclaimer_fa": (
            "پیش‌نویس تولیدشده توسط هوش مصنوعی برای پژوهش/آموزش. بازبینی، "
            "ویرایش و امضای رادیولوژیست پیش از استفاده بالینی الزامی "
            "است. تعیین رده BI-RADS تصمیم انسانی است."
        ),
    }


# --------------------------------------------------------------------- #
#  Main entry                                                            #
# --------------------------------------------------------------------- #

def analyze(arr01: np.ndarray, meta: dict | None = None) -> dict:
    meta = meta or {}
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

    # measured image metrics + detailed structured report
    metrics = _breast_metrics(arr01, meta)
    report = _build_report(probs, metrics, meta, dt_ms)

    return {
        "engine": ENGINE_ID,
        "model_file": "mammo_resnet50.pt",
        "elapsed_ms": round(dt_ms),
        "source_size": [int(arr01.shape[1]), int(arr01.shape[0])],
        "probabilities": probs,
        "metrics": metrics,
        "report": report,
        "findings": [],
        "findings_count": 0,
        "source_ref": SOURCE_REF,
    }
