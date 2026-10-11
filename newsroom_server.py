#!/usr/bin/env python3
"Local-first Nick's Media intake API and private editorial inbox."""
from __future__ import annotations
import hashlib, hmac, html, json, os, re, secrets, sqlite3, time
from datetime import datetime, timedelta, timezone
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse
ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("NICKS_DB_PATH", ROOT / "data" / "reports.sqlite3"))
PORT = int(os.environ.get("NICKS_PORT", "8000"))
RETENTION_DAYS = max(1, min(int(os.environ.get("NICKS_RETENTION_DAYS", "90")), 3650))
CATEGORIES = {"Breaking", "Reporting", "Culture", "Business", "World", "Video & broadcast"}
RATE = {}

def load_env():
    env = ROOT / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip("\"'"))
load_env()
PASSWORD = os.environ.get("NICKS_ADMIN_PASSWORD", "")
SECRET = os.environ.get("NICKS_SESSION_SECRET", "")
COOKIE_SECURE = os.environ.get("NICKS_COOKIE_SECURE", "false").lower() not in {"0", "false", "no"}

def db_open():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA journal_mode=WAL")
    return db

def init_db():
    with db_open() as db:
        db.execute("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, reporter TEXT NOT NULL, email TEXT NOT NULL, category TEXT NOT NULL, headline TEXT NOT NULL, details TEXT NOT NULL, received_at TEXT NOT NULL, privacy_notice_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_review','closed')))")
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        db.execute("DELETE FROM reports WHERE received_at < ?", (cutoff,))

def b64(data):
    import base64
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

def make_token(payload):
    sig = hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()
    return b64(payload.encode()) + "." + b64(sig)

def get_session(token):
    try:
        import base64
        part, signature = token.split(".", 1)
        payload = base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)).decode()
        data = json.loads(payload)
        expected = make_token(payload).split(".", 1)[1]
        return data if hmac.compare_digest(signature, expected) and data["exp"] > time.time() else None
    except Exception:
        return None
CSS = ":root{font-family:Arial,sans-serif;color:#15233a;background:#f5f6f8}*{box-sizing:border-box}body{margin:0}main{max-width:520px;margin:8vh auto;padding:32px;background:white;border-top:4px solid #c51e2c;box-shadow:0 8px 36px #0b23461a}.wide{max-width:980px}.kicker,.tag{font-size:11px;font-weight:bold;letter-spacing:1.3px;color:#c51e2c}h1{font:600 34px Georgia;color:#0b2346;margin:8px 0}p{line-height:1.6;color:#536070}label{display:block;font-size:13px;font-weight:bold;margin:16px 0 6px}input,select{width:100%;padding:12px;border:1px solid #ccd2da;font-size:15px}button{padding:12px 18px;border:0;background:#0b2346;color:white;font-weight:bold;cursor:pointer;margin-top:14px}button:hover{background:#c51e2c}.error{color:#a10f20}.warning{padding:13px;background:#fff2df;font-size:13px}.top{display:flex;justify-content:space-between;align-items:center}.secondary{background:white;color:#0b2346;border:1px solid #ccd2da}.report{background:white;border:1px solid #e0e3e6;border-left:3px solid #c51e2c;padding:22px;margin:16px 0}.report header{display:flex;justify-content:space-between;gap:15px;font-size:12px;color:#67717f}.report h2{font:600 22px Georgia;color:#0b2346}.details{white-space:pre-wrap}.contact{font-size:14px}a{color:#173f78}.report details{font-size:13px;border-top:1px solid #e0e3e6;padding-top:10px}.report form{display:flex;align-items:end;gap:12px;border-top:1px solid #e0e3e6;margin-top:14px}.report form label{flex:0 0 auto}.report form select{width:auto;min-width:150px}.report form button{margin:0}.small{padding:10px}.empty{padding:25px;background:white}@media(max-width:650px){main{margin:0;padding:24px 17px}.top{align-items:flex-start}.report header{display:block}.report form{display:block}.report form select{width:100%}}"

class App(SimpleHTTPRequestHandler):
    server_version = "NickMedia"
    sys_version = ""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def end_headers(self):
        for k,v in {"X-Content-Type-Options":"nosniff", "X-Frame-Options":"DENY", "Referrer-Policy":"strict-origin-when-cross-origin", "Permissions-Policy":"camera=(), microphone=(), geolocation=()", "Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'"}.items(): self.send_header(k,v)
        super().end_headers()
    def json_response(self, status, obj):
        body=json.dumps(obj).encode(); self.send_response(status); self.send_header("Content-Type","application/json; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def page(self, status, text):
        body=text.encode(); self.send_response(status); self.send_header("Content-Type","text/html; charset=utf-8"); self.send_header("Cache-Control","no-store"); self.send_header("Content-Length",str(len(body))); self.end_headers(); self.wfile.write(body)
    def body(self):
        try: n=int(self.headers.get("Content-Length","0"))
        except ValueError: return None
        return self.rfile.read(n) if 0<n<=16384 else None
    def limited(self, count, window=900):
        ip=self.client_address[0]; now=time.time(); events=[x for x in RATE.get(ip,[]) if x>now-window]
        if len(events)>=count: RATE[ip]=events; return False
        events.append(now); RATE[ip]=events; return True
    def form(self):
        raw=self.body() or b""
        return {k:v[0] for k,v in parse_qs(raw.decode("utf-8","replace"),keep_blank_values=True).items()}
    def session(self):
        c=SimpleCookie()
        try:
            c.load(self.headers.get("Cookie","")); m=c.get("nm_editor")
            return get_session(m.value) if m else None
        except Exception: return None
    def do_GET(self):
        path=urlparse(self.path).path
        if path=="/health": return self.json_response(200,{"ok":True})
        if path=="/editor":
            if not PASSWORD or len(SECRET)<32: return self.send_error(503,"Editor not configured")
            s=self.session()
            return self.inbox(s) if s else self.login_page()
        return super().do_GET()
    def do_POST(self):
        path=urlparse(self.path).path
        if path=="/api/reports": return self.submit()
        if path=="/editor/login": return self.login()
        if path=="/editor/logout" or path.startswith("/editor/reports/"): return self.editor_action(path)
        return self.json_response(404,{"error":"Not found"})
    def submit(self):
        if not PASSWORD or len(SECRET)<32: return self.json_response(503,{"error":"Intake is not configured"})
        if self.headers.get("Content-Type","" ).split(";",1)[0].lower()!="application/json": return self.json_response(415,{"error":"Expected JSON"})
        if not self.limited(8): return self.json_response(429,{"error":"Too many submissions. Try again later."})
        try: data=json.loads(self.body() or b"")
        except (ValueError,UnicodeDecodeError): return self.json_response(400,{"error":"Invalid submission"})
        if not isinstance(data,dict): return self.json_response(400,{"error":"Invalid submission"})
        if str(data.get("website","")).strip(): return self.json_response(200,{"accepted":True})
        f={k:str(data.get(k,"")).strip() for k in ("reporter","email","category","headline","details")}
        reporter,email,category,headline,details=(f[k] for k in ("reporter","email","category","headline","details"))
        valid_email=re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+",email)
        if not(1<=len(reporter)<=70 and 3<=len(email)<=254 and valid_email and category in CATEGORIES and 1<=len(headline)<=120 and 20<=len(details)<=1200 and data.get("consent") is True): return self.json_response(400,{"error":"Please check required fields and privacy consent."})
        privacy=str(data.get("privacy_notice_url","")); p=urlparse(privacy)
        local=self.headers.get("Host","").split(":",1)[0] in {"localhost","127.0.0.1"} and p.scheme=="http" and bool(p.netloc)
        if not((p.scheme=="https" and p.netloc) or local): return self.json_response(400,{"error":"Invalid privacy notice URL."})
        now=datetime.now(timezone.utc).isoformat()
        try:
            with db_open() as db:
                cur=db.execute("INSERT INTO reports(reporter,email,category,headline,details,received_at,privacy_notice_url) VALUES(?,?,?,?,?,?,?)",(reporter,email,category,headline,details,now,privacy)); rid=cur.lastrowid
        except sqlite3.Error: return self.json_response(500,{"error":"Could not store report securely. Try again later."})
        return self.json_response(201,{"accepted":True,"reference":f"NM-{rid:06d}"})
    def login_page(self,message="",status=200):
        msg=f"<p class='error' role='alert'>{html.escape(message)}</p>" if message else ""
        return self.page(status,f"<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Editor sign in — Nick’s Media</title><style>{CSS}</style><main><p class='kicker'>NICK’S MEDIA / PRIVATE</p><h1>Editorial inbox</h1><p>Sign in with the newsroom administrator password.</p>{msg}<form method='post' action='/editor/login'><label for='password'>Administrator password</label><input id='password' name='password' type='password' autocomplete='current-password' required><button>Sign in</button></form><p class='warning'>Submissions contain personal information. Use only a trusted device.</p></main></html>")
    def login(self):
        if not PASSWORD or len(SECRET)<32: return self.send_error(503,"Editor not configured")
        if not self.limited(10): return self.send_error(429,"Too many login attempts")
        if not hmac.compare_digest(self.form().get("password",""),PASSWORD):
            time.sleep(.5); return self.login_page("Login failed. Check the password.",401)
        payload=json.dumps({"exp":time.time()+28800,"csrf":secrets.token_urlsafe(32)},separators=(","," :"))
        token=make_token(payload)
        self.send_response(303); self.send_header("Location","/editor"); self.send_header("Set-Cookie",f"nm_editor={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800"+("; Secure" if COOKIE_SECURE else "")); self.send_header("Cache-Control","no-store"); self.end_headers()
    def inbox(self,s):
        with db_open() as db: rows=db.execute("SELECT * FROM reports ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_review' THEN 1 ELSE 2 END,received_at DESC LIMIT 250").fetchall()
        cards=[]
        for r in rows:
            opts="".join(f"<option value='{v}'{' selected' if r['status']==v else ''}>{label}</option>" for v,label in (("new","New"),("in_review","In review"),("closed","Closed")))
            cards.append(f"<article class='report'><header><span class='tag'>{html.escape(r['category'])} / NM-{r['id']:06d}</span><time>{html.escape(r['received_at'].replace('T',' ')[:19])} UTC</time></header><h2>{html.escape(r['headline'])}</h2><p class='details'>{html.escape(r['details'])}</p><p class='contact'><strong>{html.escape(r['reporter'])}</strong> · <a href='mailto:{html.escape(r['email'],quote=True)}'>{html.escape(r['email'])}</a></p><form method='post' action='/editor/reports/{r['id']}'><input type='hidden' name='csrf' value='{html.escape(s['csrf'],quote=True)}'><label for='status-{r['id']}'>Status</label><select id='status-{r['id']}' name='status'>{opts}</select><button class='small'>Update status</button></form></article>")
        content="".join(cards) if cards else "<p class='empty'>No submissions yet.</p>"
        csrf=html.escape(s['csrf'],quote=True)
        page=f"<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'><title>Editorial inbox — Nick’s Media</title><style>{CSS}</style><main class='wide'><header class='top'><div><p class='kicker'>NICK’S MEDIA / PRIVATE</p><h1>Editorial inbox</h1><p>{len(rows)} recent submissions · retained for {RETENTION_DAYS} days</p></div><form method='post' action='/editor/logout'><input type='hidden' name='csrf' value='{csrf}'><button class='secondary'>Sign out</button></form></header><p class='warning'>Submissions are unverified tips, not publishable updates. Verify claims independently.</p>{content}</main></html>"
        return self.page(200,page)
    def editor_action(self,path):
        s=self.session()
        if not s: return self.send_error(401,"Sign in required")
        f=self.form()
        if not hmac.compare_digest(f.get("csrf",""),s.get("csrf","")): return self.send_error(403,"Invalid request token")
        if path=="/editor/logout":
            self.send_response(303); self.send_header("Location","/editor"); self.send_header("Set-Cookie","nm_editor=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+("; Secure" if COOKIE_SECURE else "")); self.end_headers(); return
        match=re.fullmatch(r"/editor/reports/(\d+)",path)
        if not match or f.get("status") not in {"new","in_review","closed"}: return self.send_error(400,"Invalid update")
        with db_open() as db: db.execute("UPDATE reports SET status=? WHERE id=?",(f["status"],int(match.group(1))))
        self.send_response(303); self.send_header("Location","/editor"); self.send_header("Cache-Control","no-store"); self.end_headers()

def main():
    if len(PASSWORD)<16: raise SystemExit("Set NICKS_ADMIN_PASSWORD in .env (minimum 16 characters); run setup.ps1")
    if len(SECRET)<32: raise SystemExit("Set NICKS_SESSION_SECRET in .env (minimum 32 characters); run setup.ps1")
    init_db(); server=ThreadingHTTPServer(("127.0.0.1",PORT),App)
    print(f"Website and intake API: http://127.0.0.1:{PORT}/")
    print(f"Private editor inbox: http://127.0.0.1:{PORT}/editor")
    print(f"SQLite database: {DB_PATH}")
    print("Public launch requires HTTPS reverse proxy, persistent protected storage, backups, and firewalling port 8000.")
    try: server.serve_forever()
    except KeyboardInterrupt: print("\nStopping.")
    finally: server.server_close()
if __name__=="__main__": main()
