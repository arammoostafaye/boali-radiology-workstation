# Boali Radiology Workstation — v1.1.0

نسخه کامل و واقعی پلتفرم هوش مصنوعی تصویربرداری بیمارستان بوعلی — رابط ورک‌استیشن (Next.js 16) + موتورهای استنتاج واقعی (FastAPI + PyTorch/ONNX) + آرشیو PACS امن‌شده.

> **English:** Full-stack release of the Boali radiology AI platform: workstation UI, real inference engines, hardened PACS archive. **All 968 MB of model weights AND every Windows Python wheel (incl. torch 2.11 CPU) ship inside the package — no model or torch download at runtime.**

## 🆕 جدید در v1.1.0

- **torch ویندوزی + تمام وابستگی‌های پایتون داخل بسته** (`runtime/wheels/` — شامل torch 2.11.0+cpu، torchvision، numpy، scipy، opencv، fastapi و ۲۹ wheel دیگر)
- نصب پایتون در ویندوز **کاملاً آفلاین و خودکار** — با پایتون **3.12 (64bit)** لانچر بدون اینترنت همه‌چیز را از فایل‌های داخلی نصب می‌کند؛ نسخه‌های دیگر پایتون به‌صورت خودکار به نصب آنلاین برمی‌گردند

---

## 🚀 شروع سریع در ویندوز — دو روش

### روش ۱: بسته آماده Portable (پیشنهادی — بدون نیاز به Git)

1. فایل **`Boali-Radiology-Workstation-v1.1.0-Windows-Portable.zip`** را از همین صفحه دانلود کنید (~۱.۱ گیگابایت).
2. آن را extract کنید.
3. روی **`windows\START-BOALI.bat`** دوبار کلیک کنید.
4. مرورگر خودکار روی `http://localhost:3000` باز می‌شود.

> در این بسته وزن‌های مدل و wheel تورچ **از قبل سرهم شده‌اند** — هیچ مرحله اضافی وجود ندارد.

### روش ۲: Git

```
git clone https://github.com/arammoostafaye/boali-radiology-workstation.git
cd boali-radiology-workstation
windows\START-BOALI.bat
```

لانچر در اولین اجرا وزن‌های بزرگ و wheel تورچ را از تکه‌های داخل خود ریپو سرهم می‌کند (کاملاً محلی، صحت‌سنجی SHA-256).

---

## پیش‌نیازها

| نرم‌افزار | نسخه | توضیح |
|---|---|---|
| Python | **3.12 (64bit)** — پیشنهادی | با این نسخه نصب پایتون **کاملاً آفلاین** است؛ نسخه‌های دیگر هم کار می‌کنند ولی آنلاین نصب می‌کنند |
| Node.js | LTS 18+ | یا Bun — فقط بار اول برای `node_modules` اینترنت لازم است |

> ⚠️ **هیچ فایل مدلی و نه torch از اینترنت دانلود نمی‌شود** — همه داخل بسته هستند.

---

## ماژول‌ها (هرکدام محیط اختصاصی خودش)

| ماژول | موتور | مدل |
|---|---|---|
| Fracture Detection | `fracture` | YOLOv8 ONNX — رادیوگرافی ارتوپدی |
| Bone Suppression | `bone-suppression` | Qure TorchScript — بازسازی بافت نرم |
| Lung Screen | `chest18` | DenseNet-18 — ۱۸ پاتولوژی قفسه سینه |
| Mammography AI | `mammography` | ResNet-50 — غربالگری |
| 3D CT Studio | `ct3d` | Volume rendering — MPR / VR |
| AI Report | — | گزارش ساختاریافته · خروجی |

**اصل طراحی:** هیچ عدد جعلی تولید نمی‌شود — وضعیت واقعی هر موتور روی چیپ همان کارت نمایش داده می‌شود.

## نمونه‌های آماده تست

داخل خود برنامه: ۳ ماموگرافی DICOM + CT + MR در `public/samples/` و آرشیو دموی PACS + سری کامل CT قفسه سینه برای 3D CT Studio.

## صحت‌سنجی

- `SHA256SUMS.txt` (پیوست همین Release) — هش بسته portable.
- `mini-services/boali-engine/weights/MANIFEST.txt` — اندازه و SHA-256 تک‌تک وزن‌های مدل.
- `runtime/MANIFEST.txt` — اندازه و SHA-256 تک‌تک ۲۹ wheel ویندوزی.

## نکات اجرا

| مورد | توضیح |
|---|---|
| SmartScreen | More info → **Run anyway** (اسکریپت محلی است، امضا ندارد) |
| توقف | بستن ۳ پنجره سرویس |
| اجرای مجدد | دوباره `START-BOALI.bat` (نصب‌ها تکرار نمی‌شوند) |
| رفع اشکال | `windows/README-WINDOWS.md` |

---

## ⚠️ سلب مسئولیت

این نرم‌افزار برای **تحقیق و آموزش** است و ابزار تشخیص پزشکی بالینی نیست. وزن‌های Bone Suppression از مدل عمومی [Qure AI](https://huggingface.co/qureaiorg/bone-suppression) و منطق موتورها از [`arammoostafaye/boali-radiology-suite`](https://github.com/arammoostafaye/boali-radiology-suite) پورت شده‌اند.
