#!/usr/bin/env python3
# Nick's Media report intake and private editorial inbox (Python stdlib only).
from __future__ import annotations
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("NICKS_DB_PATH", ROOT / "data" / "reports.sqlite3"))
HOST = os.environ.get("NICKS_HOST", "127.0.0.1")
PORT = int(os.environ.get("NICKS_PORT", "8000"))
RETENTION_DAYS = max(1, min(int(os.environ.get("NICKS_RETENTION_DAYS", "90")), 3650))
MAX_BODY = 16 * 1024
CATEGORIES = {"Breaking", "Reporting", "Culture", "Business", "World", "Video & broadcast"}


def load_env_file() -> None:
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("\"'"))

load_env_file()
ADMIN_PASSWORD = os.environ.get("NICKS_ADMIN_PASSWORD", "")
SESSION_SECRET = os.environ.get("NICKS_SESSION_SECRET", "")
COOKIE_SECURE = os.environ.get("NICKS_COOKIE_SECURE", "true").lower() not in {"0", "false", "no"}


def db_connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA foreign_keys=ON")
    return db

def initialize_db() -> None:
    with db_connect() as db:
        db.execute("""CREATE TABLE IF NOT EXISTS reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter TEXT NOT NULL,
            email TEXT NOT NULL,
            category TEXT NOT NULL,
            headline TEXT NOT NULL,
            details TEXT NOT NULL,
            received_at TEXT NOT NULL,
            consented_at TEXT NOT NULL,
            privacy_notice_url TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_review','closed'))
        )""")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        db.execute("DELETE FROM reports WHERE received_at < ?", (cutoff,))


def b64url(data: bytes) -> str:
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def sign(value: str) -> str:
    digest = hmac.new(SESSION_SECRET.encode(), value.encode(), hashlib.sha256).digest()
    return f"{b64url(value.encode())}.{b64url(digest)}"


def check_session(token: str) -> dict | None:
    try:
        payload_part, signature_part = token.split(".", 1)
        import base64
        payload = base64.urlsafe_b64decode(payload_part + "=" * (-len(payload_part) % 4)).decode()
        expected = sign(payload).split(".", 1)[1]
        if not hmac.compare_digest(signature_part, expected):
            return None
        data = json.loads(payload)
        if data.get("exp", 0) < time.time():
            return None
        return data
    except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError):
        return None
RATE_BUCKETS: dict[str, list[float]] = {}

class Handler(SimpleHTTPRequestHandler):
    server_version = "NickMedia/1.0"
    sys_version = ""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Never log request bodies, query strings, or submitter data.
        super().log_message(fmt, *args)

    def send_json(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def read_body(self) -> bytes | None:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None
        if length < 1 or length > MAX_BODY:
            return None
        return self.rfile.read(length)

    def client_allowed(self, limit: int, window: int = 900) -> bool:
        now = time.time()
        key = self.client_address[0]
        events = [stamp for stamp in RATE_BUCKETS.get(key, []) if stamp > now - window]
        if len(events) >= limit:
            RATE_BUCKETS[key] = events
            return False
        events.append(now)
        RATE_BUCKETS[key] = events
        if len(RATE_BUCKETS) > 5000:
            for stale in [ip for ip, values in RATE_BUCKETS.items() if not values or values[-1] < now - window]:
                RATE_BUCKETS.pop(stale, None)
        return True
    def session(self) -> dict | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            morsel = cookie.get("nm_editor")
            return check_session(morsel.value) if morsel else None
        except Exception:
            return None
    def send_html(self, status: int, page: str):
        body = page.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/health":
            return self.send_json(200, {"ok": True})
        if path == "/editor":
            if not ADMIN_PASSWORD or len(SESSION_SECRET) < 32:
                return self.send_error(503, "Editor login is not configured")
            session = self.session()
            if not session:
                return self.render_login()
            return self.render_inbox(session)
        return super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/reports":
            return self.submit_report()
        if path in {"/editor/login", "/editor/logout"}:
            return self.login() if path == "/editor/login" else self.update_report(path)
        if path.startswith("/editor/reports/"):
            return self.update_report(path)
        self.send_json(404, {"error": "Not found"})

    def submit_report(self):
        if not ADMIN_PASSWORD or len(SESSION_SECRET) < 32:
            return self.send_json(503, {"error": "Intake is not configured"})
        if self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() != "application/json":
            return self.send_json(415, {"error": "Expected JSON"})
        if not self.client_allowed(8):
            return self.send_json(429, {"error": "Too many submissions. Try again later."})
        raw = self.read_body()
        try:
            data = json.loads(raw or b"")
        except (json.JSONDecodeError, UnicodeDecodeError):
            return self.send_json(400, {"error": "Invalid submission"})
        if not isinstance(data, dict):
            return self.send_json(400, {"error": "Invalid submission"})
        # Quietly accept honeypot posts so automated senders do not learn the trap.
        if str(data.get("website", "")).strip():
            return self.send_json(200, {"accepted": True})
        fields = {key: str(data.get(key, "")).strip() for key in ("reporter", "email", "category", "headline", "details")}
        reporter, email, category, headline, details = (fields[key] for key in ("reporter", "email", "category", "headline", "details"))
        if (not 1 <= len(reporter) <= 70 or not 3 <= len(email) <= 254 or
                not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or category not in CATEGORIES or
                not 1 <= len(headline) <= 120 or not 20 <= len(details) <= 1200 or data.get("consent") is not True):
            return self.send_json(400, {"error": "Please check the required fields and consent."})
        privacy_url = str(data.get("privacy_notice_url", ""))
        parsed_privacy = urlparse(privacy_url)
        if parsed_privacy.scheme != "https" or not parsed_privacy.netloc:
            # Local development permits same-origin HTTP privacy URLs; production must use HTTPS.
            host = self.headers.get("Host", "").split(":", 1)[0]
            if not (host in {"localhost", "127.0.0.1"} and parsed_privacy.scheme == "http" and parsed_privacy.netloc):
                return self.send_json(400, {"error": "Privacy notice configuration is invalid."})
        accepted_at = datetime.now(timezone.utc).isoformat()
        try:
            with db_connect() as db:
                cursor = db.execute("""INSERT INTO reports
                    (reporter,email,category,headline,details,received_at,consented_at,privacy_notice_url)
                    VALUES (?,?,?,?,?,?,?,?)""", (
                    reporter, email, category, headline, details,
                    accepted_at, accepted_at, privacy_url))
                report_id = cursor.lastrowid
        except sqlite3.Error:
            return self.send_json(500, {"error": "We could not store this report securely. Please try again later."})
        return self.send_json(201, {"accepted": True, "reference": f"NM-{report_id:06d}"})

    def parse_form(self) -> dict[str, str]:
        raw = self.read_body()
        if raw is None:
            return {}
        parsed = parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True)
        return {key: values[0] for key, values in parsed.items()}

    def login(self):
        if not ADMIN_PASSWORD or len(SESSION_SECRET) < 32:
            return self.send_error(503, "Editor login is not configured")
        if not self.client_allowed(10, 900):
            return self.send_error(429, "Too many login attempts")
        form = self.parse_form()
        if not hmac.compare_digest(form.get("password", ""), ADMIN_PASSWORD):
            time.sleep(0.6)
            return self.render_login("Login failed. Check your password and try again.", 401)
        now = int(time.time())
        csrf = secrets.token_urlsafe(32)
        token = sign(json.dumps({"iat": now, "exp": now + 8 * 60 * 60, "csrf": csrf}, separators=(",", ":")))
        self.send_response(303)
        self.send_header("Location", "/editor")
        self.send_header("Set-Cookie", f"nm_editor={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800" + ("; Secure" if COOKIE_SECURE else ""))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

    def render_login(self, message: str = "", status: int = 200):
        msg = f"<p class='error' role='alert'>{html.escape(message)}</p>" if message else ""
        page = f"<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Editor sign in — Nick’s Media</title><style>{ADMIN_CSS}</style><main><p class='kicker'>NICK’S MEDIA / PRIVATE</p><h1>Editorial inbox</h1><p>Sign in with the newsroom administrator password.</p>{msg}<form method='post' action='/editor/login'><label for='password'>Administrator password</label><input id='password' name='password' type='password' autocomplete='current-password' required><button>Sign in</button></form><p class='notice'>Submissions contain personal information. Use only a trusted device.</p></main></html>"
        return self.send_html(status, page)

    def render_inbox(self, session: dict):
        with db_connect() as db:
            rows = db.execute("SELECT * FROM reports ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END, received_at DESC LIMIT 250").fetchall()
        cards = []
        for row in rows:
            status_options = "".join(f'<option value="{value}"{" selected" if row["status"] == value else ""}>{label}</option>' for value, label in (("new", "New"), ("in_review", "In review"), ("closed", "Closed")))
            cards.append(f'<article class="report"><header><span class="tag">{html.escape(row["category"])} / NM-{row["id"]:06d}</span><time>{html.escape(row["received_at"].replace("T", " ")[:19])} UTC</time></header><h2>{html.escape(row["headline"])}</h2><p class="details">{html.escape(row["details"])}</p><p class="contact"><strong>{html.escape(row["reporter"])}</strong> · <a href="mailto:{html.escape(row["email"], quote=True)}">{html.escape(row["email"])}</a></p><details><summary>Consent &amp; privacy record</summary><p>Consented at: {html.escape(row["consented_at"])}</p><p><a href="{html.escape(row["privacy_notice_url"], quote=True)}" target="_blank" rel="noopener noreferrer">Privacy notice recorded with submission ↗</a></p></details><form method="post" action="/editor/reports/{row["id"]}"><input type="hidden" name="csrf" value="{html.escape(session["csrf"], quote=True)}"><label for="status-{row["id"]}">Editorial status</label><select id="status-{row["id"]}" name="status">{status_options}</select><button class="small">Update status</button></form></article>')
        content = "".join(cards) if cards else '<p class="empty">No submissions yet.</p>'
        csrf = html.escape(session["csrf"], quote=True)
        return self.send_html(200, f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Editorial inbox — Nick’s Media</title><style>{ADMIN_CSS}</style><main class="wide"><header class="top"><div><p class="kicker">NICK’S MEDIA / PRIVATE</p><h1>Editorial inbox</h1><p>{len(rows)} most recent submissions · automatic retention: {RETENTION_DAYS} days</p></div><form method="post" action="/editor/logout"><input type="hidden" name="csrf" value="{csrf}"><button class="secondary">Sign out</button></form></header><p class="warning">Submissions are unverified tips, not publishable updates. Verify claims independently. Do not forward sensitive details unnecessarily.</p>{content}</main></html>')

    def update_report(self, path: str):
        session = self.session()
        if not session:
            return self.send_error(401, "Sign in required")
        form = self.parse_form()
        if not hmac.compare_digest(form.get("csrf", ""), session.get("csrf", "")):
            return self.send_error(403, "Invalid request token")
        if path == "/editor/logout":
            self.send_response(303)
            self.send_header("Location", "/editor")
            self.send_header("Set-Cookie", "nm_editor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0" + ("; Secure" if COOKIE_SECURE else ""))
            self.end_headers()
            return
        match = re.fullmatch(r"/editor/reports/(\d+)", path)
        if not match or form.get("status") not in {"new", "in_review", "closed"}:
            return self.send_error(400, "Invalid update")
        with db_connect() as db:
            db.execute("UPDATE reports SET status=? WHERE id=?", (form["status"], int(match.group(1))))
        self.send_response(303)
        self.send_header("Location", "/editor")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()

ADMIN_CSS = """
:root{font-family:Arial,sans-serif;color:#15233a;background:#f5f6f8}*{box-sizing:border-box}body{margin:0}main{max-width:520px;margin:8vh auto;padding:32px;background:white;border-top:4px solid #c51e2c;box-shadow:0 8px 36px #0b23461a}.wide{max-width:980px}.kicker,.tag{font-size:11px;font-weight:bold;letter-spacing:1.3px;color:#c51e2c}h1{font:600 34px Georgia;color:#0b2346;margin:8px 0}p{line-height:1.6;color:#536070}label{display:block;font-size:13px;font-weight:bold;margin:16px 0 6px}input,select{width:100%;padding:12px;border:1px solid #ccd2da;font-size:15px}button{padding:12px 18px;border:0;background:#0b2346;color:white;font-weight:bold;cursor:pointer;margin-top:14px}button:hover{background:#c51e2c}.error{color:#a10f20}.notice,.warning{padding:13px;background:#fff2df;font-size:13px}.top{display:flex;justify-content:space-between;align-items:center}.secondary{background:white;color:#0b2346;border:1px solid #ccd2da}.report{background:white;border:1px solid #e0e3e6;border-left:3px solid #c51e2c;padding:22px;margin:16px 0}.report header{display:flex;justify-content:space-between;gap:15px;font-size:12px;color:#67717f}.report h2{font:600 22px Georgia;color:#0b2346}.details{white-space:pre-wrap}.contact{font-size:14px}a{color:#173f78}.report details{font-size:13px;border-top:1px solid #e0e3e6;padding-top:10px}.report form{display:flex;align-items:end;gap:12px;border-top:1px solid #e0e3e6;margin-top:14px}.report form label{flex:0 0 auto}.report form select{width:auto;min-width:150px}.report form button{margin:0}.small{padding:10px}.empty{padding:25px;background:white}@media(max-width:650px){main{margin:0;padding:24px 17px}.top{align-items:flex-start}.report header{display:block}.report form{display:block}.report form select{width:100%}}
"""


def main():
    if len(ADMIN_PASSWORD) < 16:
        raise SystemExit("NICKS_ADMIN_PASSWORD must be configured and at least 16 characters. Run setup.ps1.")
    if len(SESSION_SECRET) < 32:
        raise SystemExit("NICKS_SESSION_SECRET must be configured and at least 32 characters. Run setup.ps1.")
    initialize_db()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Nick's Media site and report intake: http://{HOST}:{PORT}/")
    print(f"Private editorial inbox: http://{HOST}:{PORT}/editor")
    print(f"SQLite database: {DB_PATH}")
    if HOST not in {"127.0.0.1", "localhost"}:
        print("WARNING: Put this server behind HTTPS/TLS reverse proxy and firewall the app port before public exposure.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
    finally:
        httpd.server_close()

if __name__ == "__main__":
    main()
