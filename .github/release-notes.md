# Boali Radiology Workstation — v1.2.0

نسخه کامل و واقعی پلتفرم هوش مصنوعی تصویربرداری بیمارستان بوعلی — رابط ورک‌استیشن (Next.js 16) + موتورهای استنتاج واقعی (FastAPI + PyTorch/ONNX) + آرشیو PACS امن‌شده.

> **English:** Full-stack release of the Boali radiology AI platform. **This version bundles EVERYTHING — the embedded Python 3.12 runtime, the Node.js 22 runtime, all 968 MB of model weights, every Python wheel (incl. torch 2.11 CPU) and a PREBUILT PRODUCTION web app (standalone `next build`). Extract and run: no Python, no Node.js, no internet, no compile step on the target machine.**

## 🆕 جدید در v1.2.0 — اجرای کاملاً آفلاین و مستقل

- **ران‌تایم Python 3.12 داخل بسته** (`runtime/python-3.12.10-embed-amd64.zip`) — دیگر **هیچ وابستگی به پایتون نصب‌شده روی سیستم نیست**؛ هر نسخه‌ای (مثلاً 3.13 یا 3.14) که روی ویندوز نصب باشد بی‌اهمیت است.
- **ران‌تایم Node.js 22 داخل بسته** (`runtime/node-v22.23.5-win-x64.zip`) — نیازی به نصب Node.js هم نیست.
- **وب با بیلد Production داخل بسته** — `next build` (خروجی standalone) از قبل روی سرورهای گیت‌هاب اجرا شده؛ سرور وب **در ~۲ ثانیه** بالا می‌آید (بدون `next dev` و بدون کامپایل ۴۰–۹۰ ثانیه‌ای) و مرورگر **فقط بعد از بالا آمدن واقعی سرور** باز می‌شود (لانچر تا پاسخ‌گویی HTTP صبر می‌کند). نه `npm install` لازم است نه هیچ اینترنتی.
- بستهٔ Portable با **site-packages از پیش نصب‌شده** عرضه می‌شود (torch و همه وابستگی‌ها) — دیگر نه pip، نه bootstrap، هیچ نصبی در اولین اجرا انجام نمی‌شود.
- wheel های `pip` و `python-multipart` (لازم برای آپلود فایل در FastAPI) به مجموعهٔ آفلاین اضافه شدند.
- لانچرِ v1.1.0 در سیستم‌هایی که پایتون 3.12 نداشتند به نصب آنلاین برمی‌گشت و اگر Node هم نصب نبود کلاً متوقف می‌شد — این نسخه **در همهٔ حالات آفلاین و بدون پیش‌نیاز** است.

---

## 🚀 شروع سریع در ویندوز

1. فایل **`Boali-Radiology-Workstation-v1.2.0-Windows-Portable.zip`** را از همین صفحه دانلود کنید (~۱.۴ گیگابایت).
2. آن را در یک **مسیر کوتاه** (مثلاً `C:\Boali`) extract کنید.
3. روی **`Boali\windows\START-BOALI.bat`** دوبار کلیک کنید.
4. مرورگر **خودکار و فقط بعد از بالا آمدن سرور** روی `http://localhost:3000` باز می‌شود (سرور وب production است و در ~۲ ثانیه بالا می‌آید).

> **پیش‌نیاز: هیچ.** نه Python، نه Node.js، نه اینترنت، نه کامپایل. همه‌چیز — ران‌تایم‌ها، وزن‌ها، wheel ها و بیلد آمادهٔ وب — داخل بسته است و در اولین اجرا فقط چند فایل زیپ محلی باز می‌شوند (چند ثانیه).

### اجرا از سورس (Git)

```
git clone https://github.com/arammoostafaye/boali-radiology-workstation.git
cd boali-radiology-workstation
windows\START-BOALI.bat
```

> در حالت clone: وزن‌های بزرگ، wheel تورچ و ران‌تایم‌ها در اولین اجرا از فایل‌های داخل خود ریپو سرهم/استخراج می‌شوند (کاملاً محلی، صحت‌سنجی SHA-256) و وب در حالت dev اجرا می‌شود (فقط `node_modules` در این حالت یک بار با اینترنت نصب می‌شود).

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
- `runtime/MANIFEST.txt` — اندازه و SHA-256 تک‌تک ۳۱ wheel ویندوزی.

## نکات اجرا

| مورد | توضیح |
|---|---|
| مسیر نصب | مسیر کوتاه (مثل `C:\Boali`) توصیه می‌شود — لانچر خودش هم هشدار می‌دهد |
| SmartScreen | More info → **Run anyway** (اسکریپت محلی است، امضا ندارد) |
| توقف | بستن ۳ پنجره سرویس |
| اجرای مجدد | دوباره `START-BOALI.bat` (هیچ نصبی تکرار نمی‌شود) |
| رفع اشکال | `windows/README-WINDOWS.md` |

---

## ⚠️ سلب مسئولیت

این نرم‌افزار برای **تحقیق و آموزش** است و ابزار تشخیص پزشکی بالینی نیست. وزن‌های Bone Suppression از مدل عمومی [Qure AI](https://huggingface.co/qureaiorg/bone-suppression) و منطق موتورها از [`arammoostafaye/boali-radiology-suite`](https://github.com/arammoostafaye/boali-radiology-suite) پورت شده‌اند.
