#!/usr/bin/env python3
"""MedalPACS (MedalWeb) simulator — faithful protocol replica for self-tests.

The hospital MedalWeb server (192.168.11.201) is only reachable from the
hospital LAN, so this simulator reproduces its EXACT web protocol so the
workstation's MedalPACS bridge can be tested end-to-end offline:

  * GET  /MedalWeb/Login.aspx          ASP.NET WebForms login page with the
                                       aaaa / bbbb / txtCaptcha controls,
                                       __VIEWSTATE hidden fields, hfkey/hfiv
                                       AES pair and CaptchaImage.axd image
  * POST /MedalWeb/Login.aspx          validates username + password (the
                                       HF1 field carries the AES-128-CBC
                                       encrypted password, decrypted and
                                       checked EXACTLY like the real
                                       server) + the captcha code, then
                                       302-redirects to Default.aspx with
                                       a MedalAuth cookie
  * GET  /MedalWeb/CaptchaImage.axd    session captcha image
  * GET  /MedalWeb/Default.aspx        portal + worklist table
  * GET  /MedalWeb/Process.aspx?SK=..  study page with the
                                       `var Studies = [{ ... }]` block
  * GET  /MedalWeb/Download.aspx       the full DICOM package as a ZIP

The served DICOM bytes are REAL medical studies (the repository sample
archive: 3 mammograms, a 44-slice chest CT series and real chest
radiographs wrapped as DX DICOM at startup).

Credentials come from the environment (NEVER hard-coded):
    MEDAL_MOCK_USER   login username   (default: demo)
    MEDAL_MOCK_PASS   login password   (default: demo123)
    MEDAL_MOCK_CAPTCHA  captcha code   (default: 1234)
    MEDAL_MOCK_PORT   listen port      (default: 3099)

Run:  python3 tools/medal_mock_server.py
"""

from __future__ import annotations

import io
import os
import random
import re
import string
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote_plus, urlparse

import numpy as np
import pydicom
from PIL import Image, ImageDraw, ImageFont
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

try:
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    HAS_CRYPTO = True
except Exception:  # pragma: no cover
    HAS_CRYPTO = False

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENGINE_SAMPLES = os.path.join(ROOT, "mini-services", "boali-engine", "samples")
MOCK_PNGS = os.path.join(ROOT, "public", "mock")

PORT = int(os.environ.get("MEDAL_MOCK_PORT", "3099"))
USER = os.environ.get("MEDAL_MOCK_USER", "demo")
PASSWORD = os.environ.get("MEDAL_MOCK_PASS", "demo123")
CAPTCHA_CODE = os.environ.get("MEDAL_MOCK_CAPTCHA", "1234")

FONT_CANDIDATES = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]

# --------------------------------------------------------------------------
# the studies served through the SK links (real repository DICOM bytes)
# --------------------------------------------------------------------------

STUDIES = {
    # mammography link
    "26Xs7rKCkU8=": {
        "pid": "1234567890",
        "pname": "MARZIEH^AHMADI",
        "modality": "MG",
        "desc": "SCREENING MAMMOGRAPHY BILATERAL",
        "series": [{"key": "1", "count": 3}],
        "files": [
            ("mammo-1.dcm", os.path.join(ENGINE_SAMPLES, "mammo-1.dcm")),
            ("mammo-2.dcm", os.path.join(ENGINE_SAMPLES, "mammo-2.dcm")),
            ("mammo-3.dcm", os.path.join(ENGINE_SAMPLES, "mammo-3.dcm")),
        ],
    },
    # CT link (note the '+' bytes — must be %2B-encoded on the wire)
    "++hRWpgJRbQ=": {
        "pid": "2345678901",
        "pname": "HOSEIN^KARIMI",
        "modality": "CT",
        "desc": "CT THORAX",
        "series": [{"key": "1", "count": 44}],
        "files": None,  # CT-chest series directory (filled at startup)
        "dir": os.path.join(ENGINE_SAMPLES, "CT-chest"),
    },
    # plain radiography link
    "yM1vWc3mvJ0=": {
        "pid": "3456789012",
        "pname": "ALI^REZAEI",
        "modality": "DX",
        "desc": "CHEST PA UPRIGHT",
        "series": [{"key": "1", "count": 3}],
        "files": None,  # generated from real radiograph PNGs at startup
    },
}

# every study also answers to a distinct hash key (like the real server)
HASH_KEYS = {sk: "H" + sk for sk in STUDIES}


def build_dx_dicom(png_path: str, pid: str, pname: str, idx: int) -> bytes:
    """Wrap a REAL radiograph image as a Digital Radiography DICOM."""
    img = Image.open(png_path).convert("L")
    arr = np.asarray(img, dtype=np.uint8)

    ds = Dataset()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"
    ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.1.1"  # DX Image Storage
    ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
    ds.StudyInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.StudyDate = "20261120"
    ds.Modality = "DX"
    ds.PatientID = pid
    ds.PatientName = pname
    ds.StudyDescription = "CHEST PA UPRIGHT"
    ds.ViewPosition = "PA"
    ds.BodyPartExamined = "CHEST"
    ds.SamplesPerPixel = 1
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.Rows = int(arr.shape[0])
    ds.Columns = int(arr.shape[1])
    ds.BitsAllocated = 8
    ds.BitsStored = 8
    ds.HighBit = 7
    ds.PixelRepresentation = 0
    ds.SeriesNumber = 1
    ds.InstanceNumber = idx
    ds.PixelData = arr.tobytes()

    buf = io.BytesIO()
    pydicom.dcmwrite(buf, ds)
    return buf.getvalue()


def prepare_studies() -> None:
    """CT series listing + DX generation from the real radiograph PNGs."""
    ct = STUDIES["++hRWpgJRbQ="]
    names = sorted(
        n for n in os.listdir(ct["dir"]) if n.lower().endswith(".dcm")
    )
    ct["files"] = [(n, os.path.join(ct["dir"], n)) for n in names]
    ct["series"] = [{"key": "1", "count": len(names)}]

    dx = STUDIES["yM1vWc3mvJ0="]
    dx_files = []
    for i, png in enumerate(["cxr.png", "cxr2.png", "cxr3.png"], start=1):
        p = os.path.join(MOCK_PNGS, png)
        if os.path.exists(p):
            dx_files.append((f"dx-chest-{i}.dcm", p, True))
    dx["files"] = dx_files  # (name, path, is_png_to_wrap)


# --------------------------------------------------------------------------
# sessions / captcha
# --------------------------------------------------------------------------

SESSIONS: dict[str, dict] = {}  # asp session id -> state


def new_session(handler) -> str:
    sid = "".join(random.choices(string.ascii_lowercase + string.digits, k=24))
    SESSIONS[sid] = {
        "hfkey": "".join(random.choices(string.digits, k=16)),
        "hfiv": "".join(random.choices(string.digits, k=16)),
        "guid": None,
        "auth": False,
    }
    handler.send_header("Set-Cookie", f"ASP.NET_SessionId={sid}; Path=/; HttpOnly")
    return sid


def get_sid(handler) -> str | None:
    cookie = handler.headers.get("Cookie", "")
    m = re.search(r"ASP\.NET_SessionId=([a-z0-9]+)", cookie)
    return m.group(1) if m else None


def medal_decrypt(hf1_b64: str, key: str, iv: str) -> str | None:
    """Decrypt HF1 exactly like the real Medal server (AES-128-CBC, the
    key/iv are the first 16 UTF-8 bytes zero-padded)."""
    if not HAS_CRYPTO or not hf1_b64:
        return None
    import base64

    def pad16(s: str) -> bytes:
        b = s.encode("utf-8")[:16]
        return b + b"\x00" * (16 - len(b))

    try:
        enc = base64.b64decode(hf1_b64)
        dec = Cipher(
            algorithms.AES(pad16(key)), modes.CBC(pad16(iv))
        ).decryptor()
        raw = dec.update(enc) + dec.finalize()
        pad = raw[-1]
        if 1 <= pad <= 16:
            raw = raw[:-pad]
        return raw.decode("utf-8", "replace")
    except Exception:
        return None


def render_captcha(code: str) -> bytes:
    img = Image.new("RGB", (200, 60), "#f2f2f2")
    d = ImageDraw.Draw(img)
    font = None
    for f in FONT_CANDIDATES:
        if os.path.exists(f):
            font = ImageFont.truetype(f, 36)
            break
    if font is None:
        font = ImageFont.load_default()
    x = 26
    for ch in code:
        d.text((x, 10), ch, fill="#20304a", font=font)
        x += 40
    for _ in range(6):  # noise lines like real captchas
        x1, y1 = random.randint(0, 200), random.randint(0, 60)
        x2, y2 = random.randint(0, 200), random.randint(0, 60)
        d.line([(x1, y1), (x2, y2)], fill="#9db3d1", width=2)
    out = io.BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


LOGIN_PAGE = """<!DOCTYPE html>
<html lang="en">
<head><title>MedalPACS Web Workstation</title><meta charset="UTF-8" /></head>
<body onload="Devicesize()">
  <form name="modified" method="post" action="./Login.aspx" id="modified" class="login100-form validate-form" autocomplete="off">
    <input type="hidden" name="__EVENTTARGET" id="__EVENTTARGET" value="" />
    <input type="hidden" name="__EVENTARGUMENT" id="__EVENTARGUMENT" value="" />
    <input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="{viewstate}" />
    <input type="hidden" name="__VIEWSTATEGENERATOR" id="__VIEWSTATEGENERATOR" value="C2A54B57" />
    <input type="hidden" name="__EVENTVALIDATION" id="__EVENTVALIDATION" value="{eventvalidation}" />
    <input type="hidden" name="hfDeviceSize" id="hfDeviceSize" value="0" />
    <input name="aaaa" type="text" id="aaaa" class="input100" value="   Username" autocomplete="Off" />
    <input name="bbbb" type="text" id="bbbb" class="real-input input100" autocomplete="Off" />
    <div style="width:200px;margin:auto">
      <img src="CaptchaImage.axd?guid={guid}" border="0" alt="Captcha" width="200" height="60" />
      <input name="txtCaptcha" type="text" id="txtCaptcha" class="input100" style="width:200px;" />
    </div>
    <span id="RequiredFieldValidator1" style="color:Red;visibility:hidden;">*Required</span>
    <input type="submit" name="LoginButton" value="Login" id="LoginButton" class="btn login100-form-btn" />
    <input name="HF1" type="hidden" id="HF1" />
    <input type="hidden" name="hfkey" id="hfkey" value="{hfkey}" />
    <input type="hidden" name="hfiv" id="hfiv" value="{hfiv}" />
    {errdiv}
  </form>
</body>
</html>"""


def login_html(sess: dict, err: str | None = None) -> str:
    guid = "%s" % os.urandom(16).hex()
    sess["guid"] = guid
    return LOGIN_PAGE.format(
        viewstate=os.urandom(24).hex(),
        eventvalidation=os.urandom(24).hex(),
        guid=guid,
        hfkey=sess["hfkey"],
        hfiv=sess["hfiv"],
        errdiv=f'<div style="color:Red">{err}</div>' if err else "",
    )


DEFAULT_PAGE = """<!DOCTYPE html>
<html lang="en">
<head><title>MedalPACS - Workstation</title><meta charset="UTF-8" /></head>
<body>
  <div id="lblHT">بیمارستان بوعلی - پورتال تصویربرداری</div>
  <p>خوش آمدید — Welcome to MedalPACS Web Workstation</p>
  <a href="Login.aspx?logout=1">خروج / Logout</a>
  <table border="1">
    <tr><th>Date</th><th>PID</th><th>Patient</th><th>Modality</th><th>Description</th></tr>
    {rows}
  </table>
</body>
</html>"""


def default_html() -> str:
    rows = []
    for sk, s in STUDIES.items():
        rows.append(
            "<tr><td>2026-11-20</td><td>{pid}</td><td>{pname}</td>"
            "<td>{mod}</td><td>{desc}</td></tr>".format(
                pid=s["pid"], pname=s["pname"], mod=s["modality"], desc=s["desc"]
            )
        )
    return DEFAULT_PAGE.format(rows="\n".join(rows))


def study_html(sk: str) -> str:
    s = STUDIES[sk]
    series_js = ", ".join(
        "{{Key:'{k}', imgCount:{c}}}".format(k=x["key"], c=x["count"])
        for x in s["series"]
    )
    return """<!DOCTYPE html>
<html lang="en">
<head><title>MedalPACS - Patient Studies</title><meta charset="UTF-8" /></head>
<body>
  <div id="lblHT">بیمارستان بوعلی</div>
  <span id="lblPID">PID: {pid}</span>
  <div id="cbPatient"></div>
  <script type="text/javascript">
    var Studies = [{{ ID:'{pid}', Name:'{pname}', Key:'{sk}', HashKey:'{hash}',
                     Modality:'{mod}', Description:'{desc}',
                     Series:[{series}] }}];
  </script>
  <div id="SeriesList">SendToRIS</div>
</body>
</html>""".format(
        pid=s["pid"],
        pname=s["pname"],
        sk=sk,
        hash=HASH_KEYS[sk],
        mod=s["modality"],
        desc=s["desc"],
        series=series_js,
    )


def study_zip(sk: str) -> bytes:
    s = STUDIES[sk]
    pid = s["pid"]
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for i, item in enumerate(s["files"], start=1):
            name = item[0]
            path = item[1]
            # nested layout like the real MedalPACS package
            arc = f"{pid}/STUDY/{i:03d}_{name}"
            if len(item) > 2 and item[2]:  # png -> wrap as real DX DICOM
                data = build_dx_dicom(path, pid, s["pname"], i)
                z.writestr(arc, data)
            else:
                z.write(path, arc)
    return out.getvalue()


# --------------------------------------------------------------------------
# HTTP handler
# --------------------------------------------------------------------------

class MedalHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    # -- helpers -----------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra: list[str] = ()) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for h in extra:
            self.send_header(*h)
        self.end_headers()
        self.wfile.write(body)

    def _redirect(self, loc: str, extra: list[str] = ()) -> None:
        self.send_response(302)
        self.send_header("Location", loc)
        self.send_header("Content-Length", "0")
        for h in extra:
            self.send_header(*h)
        self.end_headers()

    def log_message(self, fmt, *args):  # quieter
        pass

    def _sess(self, create: bool = False) -> dict | None:
        sid = get_sid(self)
        if sid and sid in SESSIONS:
            return SESSIONS[sid]
        if create:
            sid = "".join(random.choices(string.ascii_lowercase + string.digits, k=24))
            SESSIONS[sid] = {
                "hfkey": "".join(random.choices(string.digits, k=16)),
                "hfiv": "".join(random.choices(string.digits, k=16)),
                "guid": None,
                "auth": False,
            }
            return SESSIONS[sid]
        return None

    def _authorized(self) -> bool:
        cookie = self.headers.get("Cookie", "")
        sid = get_sid(self)
        sess = SESSIONS.get(sid) if sid else None
        if not sess or not sess.get("auth"):
            return False
        return f"MedalAuth={sid}" in cookie

    # -- GET ---------------------------------------------------------------
    def do_GET(self):  # noqa: N802
        u = urlparse(self.path)
        path = u.path
        low = path.lower()
        q = parse_qs(u.query, keep_blank_values=True)

        # root -> login
        if low in ("/", ""):
            self._redirect("/MedalWeb/Login.aspx?url=Default.aspx")
            return

        # login page (case-insensitive like IIS)
        if low.endswith("/login.aspx"):
            if q.get("logout"):
                self._redirect("/MedalWeb/Login.aspx?url=Default.aspx")
                return
            sess = self._sess(create=True)
            if sess is None:
                self._redirect("/MedalWeb/Login.aspx")
                return
            # issue / refresh the cookie when missing
            sid = get_sid(self)
            extra = []
            if not sid or sid not in SESSIONS:
                new_sid = list(SESSIONS.keys())[-1]
                extra.append(("Set-Cookie", f"ASP.NET_SessionId={new_sid}; Path=/; HttpOnly"))
            html = login_html(sess).encode("utf-8")
            self._send(200, html, "text/html; charset=utf-8", extra)
            return

        # captcha image
        if "captchaimage.axd" in low:
            self._send(200, render_captcha(CAPTCHA_CODE), "image/png")
            return

        # static-ish resources the login page references — 404 quietly
        if low.endswith((".css", ".js", ".ico", ".png", ".jpg")):
            self._send(404, b"", "text/plain")
            return

        # authenticated area
        if not self._authorized():
            self._redirect("/MedalWeb/Login.aspx?url=Default.aspx")
            return

        if low.endswith("/default.aspx"):
            self._send(200, default_html().encode("utf-8"), "text/html; charset=utf-8")
            return

        if low.endswith("/process.aspx"):
            sk_raw = (q.get("SK") or q.get("sk") or [""])[0]
            sk = unquote_plus(sk_raw)
            # tolerate unencoded '+' arriving as spaces
            for cand in (sk, sk.replace(" ", "+")):
                if cand in STUDIES:
                    self._send(
                        200, study_html(cand).encode("utf-8"), "text/html; charset=utf-8"
                    )
                    return
            body = b"<html><body><p>No study found for this link.</p></body></html>"
            self._send(404, body, "text/html; charset=utf-8")
            return

        if low.endswith("/download.aspx"):
            sk_raw = (q.get("SK") or q.get("sk") or [""])[0]
            sk = unquote_plus(sk_raw)
            for cand in (sk, sk.replace(" ", "+")):
                if cand in STUDIES or cand in HASH_KEYS.values():
                    key = cand if cand in STUDIES else next(
                        k for k, v in HASH_KEYS.items() if v == cand
                    )
                    data = study_zip(key)
                    pid = (q.get("PID") or q.get("pid") or [STUDIES[key]["pid"]])[0]
                    self._send(
                        200,
                        data,
                        "application/zip",
                        [
                            (
                                "Content-Disposition",
                                f'attachment; filename="study_{pid}.zip"',
                            )
                        ],
                    )
                    return
            self._send(404, b"not found", "text/plain")
            return

        self._send(404, b"<html><body>404</body></html>", "text/html")
        return

    # -- POST (login) --------------------------------------------------------
    def do_POST(self):  # noqa: N802
        u = urlparse(self.path)
        if not u.path.lower().endswith("/login.aspx"):
            self._send(404, b"not found", "text/plain")
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace") if length else ""
        form = {k: v[0] for k, v in parse_qs(body, keep_blank_values=True).items()}

        sess = self._sess(create=True)
        if sess is None:
            self._redirect("/MedalWeb/Login.aspx")
            return

        username = (form.get("aaaa") or "").strip()
        password = form.get("bbbb") or ""
        captcha = (form.get("txtCaptcha") or "").strip()
        hf1 = form.get("HF1") or ""
        hfkey = form.get("hfkey") or sess["hfkey"]
        hfiv = form.get("hfiv") or sess["hfiv"]

        # the real server decrypts HF1 — do the same when possible
        hf1_pass = medal_decrypt(hf1, hfkey, hfiv)
        checked_pass = hf1_pass if hf1_pass is not None else password

        ok_user = username == USER
        ok_pass = checked_pass == PASSWORD
        ok_cap = captcha == CAPTCHA_CODE

        if ok_user and ok_pass and ok_cap:
            sid = get_sid(self) or list(SESSIONS.keys())[-1]
            SESSIONS[sid]["auth"] = True
            self._redirect(
                "/MedalWeb/Default.aspx",
                [("Set-Cookie", f"MedalAuth={sid}; Path=/")],
            )
            return

        if not ok_cap:
            err = "کد امنیتی نادرست است — Wrong captcha code."
        elif not ok_user:
            err = "نام کاربری نادرست است — Invalid username."
        else:
            err = "رمز عبور نادرست است — Invalid password."
        html = login_html(sess, err).encode("utf-8")
        self._send(200, html, "text/html; charset=utf-8")


def main() -> None:
    prepare_studies()
    for sk, s in STUDIES.items():
        n = len(s["files"]) if s["files"] else 0
        print(f"  study {s['modality']:3s} pid={s['pid']} files={n}  SK={sk}")
    print(f"MedalPACS simulator on http://127.0.0.1:{PORT}/MedalWeb/Login.aspx")
    print(f"  user={USER!r} pass={'***' if PASSWORD else '(empty)'} captcha={CAPTCHA_CODE!r}")
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), MedalHandler)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
