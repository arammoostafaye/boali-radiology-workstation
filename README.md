# Boali Radiology Workstation

**نسخه کامل و واقعی پلتفرم هوش مصنوعی تصویربرداری بیمارستان بوعلی** — رابط ورک‌استیشن مدرن (Next.js 16) + موتورهای استنتاج واقعی (FastAPI + PyTorch/ONNX) + آرشیو PACS امن‌شده. همه وزن‌های مدل‌ها داخل همین ریپو هستند و **هیچ فایل مدلی هنگام اجرا دانلود نمی‌شود**.

> **English:** Full-stack edition of the Boali Hospital radiology AI platform: a Next.js 16 workstation UI talking to real FastAPI inference engines (YOLOv8 ONNX fracture detection, Qure bone suppression, DenseNet-18 lung screen, ResNet-50 mammography, a 3D CT MPR/VR studio) plus a hardened PACS archive. **All model weights ship inside this repository** — nothing is downloaded at runtime. Windows one-click launcher included.

---

## ⚡ اجرای سریع در ویندوز (یک کلیک)

پیش‌نیاز (فقط بار اول): [Python 3.10+](https://www.python.org/downloads/) و [Node.js LTS](https://nodejs.org)

```
git clone https://github.com/arammoostafaye/boali-radiology-workstation.git
cd boali-radiology-workstation
windows\START-BOALI.bat
```

اسکریپت خودش venv می‌سازد، وابستگی‌ها را نصب می‌کند، وزن‌های ۴۱۷ مگابایتی را از قطعات داخل ریپو سرهم می‌کند و سه سرویس را بالا می‌آورد؛ سپس مرورگر را روی `http://localhost:3000` باز می‌کند.

جزئیات کامل: [`windows/README-WINDOWS.md`](windows/README-WINDOWS.md)

---

## معماری

```
┌────────────────────────────────────────────────────────────┐
│  Next.js 16 Workstation UI  ·  :3000                       │
│  splash video · module launcher · per-module workspaces    │
│  viewer · filmstrip · AI panel · PACS panel · AI report     │
└───────────────┬────────────────────────────────────────────┘
                │  /api/*?XTransformPort=N  (same-origin)
                │  (Caddy gateway در سندباکس / پروکسی داخلی Next.js در ویندوز)
        ┌───────┴────────┐
        ▼                ▼
┌────────────────┐  ┌────────────────┐
│ boali-engine   │  │ boali-pacs     │
│ FastAPI :3020  │  │ FastAPI :3021  │
│                │  │                │
│ ۵ موتور واقعی │  │ آرشیو DICOM    │
│ استنتاج        │  │ ۴ فیکس امنیتی │
└────────────────┘  └────────────────┘
```

## ماژول‌ها (هرکدام محیط اختصاصی خودش را دارند)

| ماژول | موتور | مدل |
|---|---|---|
| Fracture Detection | `fracture` | YOLOv8 ONNX (orthopedic radiographs) |
| Bone Suppression | `bone-suppression` | Qure TorchScript — soft-tissue reconstruction |
| Lung Screen | `chest18` | DenseNet-18 — 18 chest pathologies |
| Mammography AI | `mammography` | ResNet-50 — screening triage |
| 3D CT Studio | `ct3d` | volume rendering · MPR / VR presets |
| AI Report | — | structured findings · export |

**اصل طراحی:** هیچ عدد جعلی تولید نمی‌شود. وضعیت واقعی هر موتور (ready / weights_missing / deps_missing / offline) روی چیپ همان کارت نمایش داده می‌شود و در صورت آماده نبودن، موتور صادقانه خطا می‌دهد.

## وزن‌های مدل‌ها — همه داخل ریپو

| فایل | اندازه | نحوه نگهداری |
|---|---|---|
| `fracture_ortho.onnx` | 10 MB | فایل کامل |
| `cxr_densenet18.ts` | 29 MB | فایل کامل |
| `mammo_resnet50.pt` | 94 MB | فایل کامل |
| `bone_suppression.ts` | 417 MB | ۵ قطعه × ~۹۵ MB در `weights/chunks/` |
| `lung_component_suppression.ts` | 417 MB | ۵ قطعه × ~۹۵ MB در `weights/chunks/` |

دو فایل ۴۱۷ مگابایتی به‌خاطر سقف ۱۰۰ مگابایتی گیت‌هاب تکه‌تکه شده‌اند؛ راه‌انداز ویندوز آن‌ها را خودکار سرهم می‌کند و برای هر سیستم‌عاملی `tools/assemble_weights.py` با **صحت‌سنجی SHA-256** (طبق `weights/MANIFEST.txt`) موجود است.

## نمونه‌های آماده تست

- `public/samples/` — ۳ ماموگرافی + CT + MR برای تست مستقیم داخل خود UI
- `mini-services/boali-engine/samples/` — آرشیو دموی PACS + سری کامل CT قفسه سینه برای 3D CT Studio

## ساختار مخزن

```
src/                         ← ورک‌استیشن Next.js 16 (UI + پروکسی داخلی)
mini-services/boali-engine/  ← سرویس استنتاج FastAPI + موتورها + وزن‌ها + نمونه‌ها
mini-services/boali-pacs/    ← سرویس PACS (کلید API، کوئری پارامتری، ضد path-traversal، audit log)
windows/                     ← START-BOALI.bat + راهنمای ویندوز
tools/                       ← assemble_weights.py (سرهم‌کردن قطعات + SHA-256)
```

## اجرا در لینوکس/مک (دستی)

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install fastapi uvicorn numpy opencv-python-headless Pillow pydicom scipy
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
python3 tools/assemble_weights.py
(cd mini-services/boali-engine && ../.venv/bin/python -m uvicorn app:app --port 3020) &
(cd mini-services/boali-pacs   && ../.venv/bin/python -m uvicorn app:app --port 3021) &
bun install && bun run dev
```

## اعتبار و منابع

- منطق موتورها عیناً از مخزن اصلی [`arammoostafaye/boali-radiology-suite`](https://github.com/arammoostafaye/boali-radiology-suite) پورت شده‌اند.
- وزن‌های Bone Suppression / Lung Component از مدل عمومی [Qure AI](https://huggingface.co/qureaiorg/bone-suppression).
- ⚠️ این نرم‌افزار برای **تحقیق و آموزش** است و ابزار تشخیص پزشکی بالینی نیست.
