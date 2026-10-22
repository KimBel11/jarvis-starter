'use strict';
// Remote access guard. Jarvis only listens on 127.0.0.1. A private tunnel (Tailscale Serve) forwards https://<mac>.ts.net to it.
// Requests whose Host is not localhost must (1) be for an allowed host and (2) carry a valid login session.
// Sensitive actions are never available remotely.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

// Everything works from the phone. These sensitive actions additionally need the passphrase typed again (valid for 5 minutes).
const STEPUP = [/^\/api\/vault\/(reveal|reveal-file|import|entry|update|set-key|remove-var|delete|scan|audit)/, /^\/api\/remote\/(setup|revoke)/, /^\/api\/sim\//, /^\/api\/imessage\/(handles|enable|test|clear)/, /^\/api\/dev\/(install|restart|settings|reveal-node|open-app|vscode|obsidian)/];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

module.exports = function makeRemote(ctx) {
  const FILE = path.join(ctx.DATA, 'remote.json');
  let cfg = { enabled: false, hosts: [], salt: null, hash: null, sessions: [], stepUp: false };
  try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.mkdirSync(ctx.DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cfg), { mode: 0o600 }); } catch {} };
  const fails = new Map(); // ip -> [timestamps]
  const hostOk = (h) => cfg.enabled && cfg.hosts.includes(h);
  const cookie = (req) => { const m = (req.headers.cookie || '').match(/(?:^|;\s*)jv=([a-f0-9]{64})/); return m ? m[1] : null; };
  const validSession = (req) => { const t = cookie(req); if (!t) return false; const h = sha(t); const now = Date.now(); cfg.sessions = cfg.sessions.filter((s) => s.exp > now); return cfg.sessions.some((s) => s.h === h) ? h : null; };
  const elevated = new Map(); // session hash -> timestamp until which sensitive actions are allowed
  const scrypt = (pass, salt) => crypto.scryptSync(pass, Buffer.from(salt, 'hex'), 64).toString('hex');
  // One global lockout bucket: this is a single-user app, and client-supplied headers (which could be spoofed to get fresh attempts) are never trusted.
  const clientKey = () => 'global';
  const exec = (cmd, args) => new Promise((res) => execFile(cmd, args, { timeout: 6000 }, (e, so) => res(e ? '' : String(so))));

  const LOGIN_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07090d"><title>Jarvis — sign in</title><style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 50% -10%,rgba(45,212,238,.18),transparent 60%),#07090d;color:#e8ecf4;font:16px -apple-system,system-ui,sans-serif}
  form{width:min(360px,88vw);text-align:center}.orb{width:110px;height:110px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d4fbff,#2dd4ee 40%,#0a5566 75%);box-shadow:0 0 60px rgba(45,212,238,.6);animation:p 3.5s ease-in-out infinite}@keyframes p{50%{transform:scale(1.07);box-shadow:0 0 90px rgba(45,212,238,.85)}}
  h1{font-size:15px;letter-spacing:.32em;margin:0 0 4px}p{color:#8793a8;font-size:13px;margin:0 0 22px}input{width:100%;box-sizing:border-box;padding:14px;border-radius:14px;border:1px solid #2a3446;background:#10141c;color:inherit;font-size:16px;outline:none;text-align:center}input:focus{border-color:#2dd4ee}
  button{width:100%;margin-top:12px;padding:14px;border-radius:14px;border:0;background:linear-gradient(135deg,#1fb8d3,#2d7ff0);color:#fff;font-size:16px;font-weight:600}#e{color:#ff5d6c;font-size:13px;min-height:18px;margin-top:10px}</style></head><body>
  <form id="f"><div class="orb"></div><h1>JARVIS</h1><p>@@NAME@@’s command center</p><input id="p" type="password" autocomplete="current-password" placeholder="Passphrase" autofocus><button>Unlock</button><div id="e"></div></form>
  <script>document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const r=await fetch('/api/remote/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase:document.getElementById('p').value})});if(r.ok){location.reload()}else{const j=await r.json().catch(()=>({}));document.getElementById('e').textContent=j.error||'Wrong passphrase'}}</script></body></html>`;

  return {
    hostOk, firstHost: () => (cfg.enabled && cfg.hosts[0]) || null,
    // Called for non-localhost requests. Returns true when the request was fully handled.
    async gate(req, res, url, p) {
      if (/^\/v\/[a-f0-9]{48}/.test(p)) return false; // private file links work without logging in (random token, one file, 48 hours)
      const json = (c, b, h = {}) => { res.writeHead(c, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...h }); res.end(JSON.stringify(b)); return true; };
      if (p === '/api/remote/login' && req.method === 'POST') {
        const key = clientKey(req); const now = Date.now(); const list = (fails.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (list.length >= 5) return json(429, { error: 'Too many attempts. Try again in 10 minutes.' });
        let b = {}; try { b = await ctx.readBody(req); } catch {}
        if (cfg.hash && cfg.salt && typeof b.passphrase === 'string' && crypto.timingSafeEqual(Buffer.from(scrypt(b.passphrase, cfg.salt), 'hex'), Buffer.from(cfg.hash, 'hex'))) {
          const token = crypto.randomBytes(32).toString('hex'); cfg.sessions.push({ h: sha(token), exp: now + 400 * 864e5 }); cfg.sessions = cfg.sessions.slice(-20); save(); fails.delete(key);
          return json(200, { ok: true }, { 'Set-Cookie': `jv=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}` });
        }
        list.push(now); fails.set(key, list); return json(401, { error: 'Wrong passphrase' });
      }
      const sess = validSession(req);
      if (!sess) {
        if (p.startsWith('/api/')) return json(401, { error: 'login required', login: true });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(p.startsWith('/even/') ? LOGIN_HTML.replace('<title>Jarvis — sign in</title>', '<title>Jarvis G2 — connect glasses</title>').replace('<h1>JARVIS</h1>', '<h1>JARVIS G2</h1>').replace("@@NAME@@’s command center", 'Connect your glasses to your private workspace').replace('<button>Unlock</button>', '<button>Connect glasses</button>') : LOGIN_HTML); return true;
      }
      // stay signed in: every visit pushes the session another ~13 months out and renews the cookie, so the passphrase is typed once per device
      try { const tok = cookie(req); const rec = cfg.sessions.find((x) => x.h === sess); if (tok && rec && rec.exp - Date.now() < 390 * 864e5) { rec.exp = Date.now() + 400 * 864e5; save(); res.setHeader('Set-Cookie', `jv=${tok}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}`); } } catch {}
      if (p === '/api/remote/stepup' && req.method === 'POST') {
        const key = clientKey(req); const now = Date.now(); const list = (fails.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (list.length >= 5) return json(429, { error: 'Too many attempts. Try again in 10 minutes.' });
        let b = {}; try { b = await ctx.readBody(req); } catch {}
        if (cfg.hash && typeof b.passphrase === 'string' && crypto.timingSafeEqual(Buffer.from(scrypt(b.passphrase, cfg.salt), 'hex'), Buffer.from(cfg.hash, 'hex'))) { elevated.set(sess, now + 5 * 60 * 1000); fails.delete(key); return json(200, { ok: true, minutes: 5 }); }
        list.push(now); fails.set(key, list); return json(401, { error: 'Wrong passphrase' });
      }
      // the passphrase is asked again for secrets/Mac actions only when @@NAME@@ switched that on (off by default); changing that setting always needs it
      const mustStep = (cfg.stepUp && STEPUP.some((r) => r.test(p))) || p === '/api/remote/settings' || /^\/api\/remote\/(setup|revoke)/.test(p);
      if (mustStep && !((elevated.get(sess) || 0) > Date.now())) return json(403, { error: 'Type your passphrase again to do this.', stepup: true });
      return false;
    },
    async handle(req, res, url, p) { // management endpoints (remote requests reach these only after login, and after passphrase confirmation for sensitive ones)
      const S = (c, b) => (ctx.send(res, c, b), true);
      if (p === '/api/remote/status') {
        const bin = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'].find((x) => fs.existsSync(x)) || null;
        let dns = null, ts = null; if (bin) { try { const j = JSON.parse(await exec(bin, ['status', '--json'])); dns = j.Self && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, '') : null; ts = j.BackendState || null; } catch {} }
        return S(200, { stepUp: cfg.stepUp, enabled: cfg.enabled, hosts: cfg.hosts, hasPassphrase: !!cfg.hash, sessions: cfg.sessions.filter((s) => s.exp > Date.now()).length, tailscale: { installed: !!bin, state: ts, dnsName: dns } });
      }
      if (p === '/api/remote/setup' && req.method === 'POST') {
        const b = await ctx.readBody(req);
        if (typeof b.passphrase === 'string' && b.passphrase) { if (b.passphrase.length < 10) return S(400, { error: 'Use at least 10 characters' }); cfg.salt = crypto.randomBytes(16).toString('hex'); cfg.hash = scrypt(b.passphrase, cfg.salt); cfg.sessions = []; }
        if (Array.isArray(b.hosts)) cfg.hosts = b.hosts.map((h) => String(h).toLowerCase().replace(/^https?:\/\//, '').replace(/[\/:].*$/, '')).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)).slice(0, 5);
        if (typeof b.enabled === 'boolean') { if (b.enabled && !cfg.hash) return S(400, { error: 'Set a passphrase first' }); if (b.enabled && !cfg.hosts.length) return S(400, { error: 'Add your Tailscale address first' }); cfg.enabled = b.enabled; }
        save(); return S(200, { ok: true, enabled: cfg.enabled, hosts: cfg.hosts });
      }
      if (p === '/api/remote/settings' && req.method === 'POST') { const b = await ctx.readBody(req); if (typeof b.stepUp === 'boolean') cfg.stepUp = b.stepUp; save(); return S(200, { ok: true, stepUp: cfg.stepUp }); }
      if (p === '/api/remote/revoke' && req.method === 'POST') { cfg.sessions = []; save(); return S(200, { ok: true }); }
      return false;
    },
  };
};
