'use strict';
// Remote access guard. Jarvis only listens on 127.0.0.1. A private tunnel (Tailscale Serve) forwards https://<mac>.ts.net to it.
// Requests whose Host is not localhost must (1) be for an allowed host and (2) carry a valid login session.
// Remote management requires reauthentication; passphrase rotation also requires a host-Mac verification code.
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
  const local = req => /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '') && !req.headers['x-forwarded-for'] && ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  const challenges = new Map(), streams = new Map();
  const pruneChallenges = () => { for (const [id,c] of challenges) if(c.expiresAt<Date.now()) challenges.delete(id); };
  const owner = req => local(req) ? 'host' : validSession(req);
  const nameOf = req => { const ua=String(req.headers['user-agent']||''); return /iPad/.test(ua)?'iPad':/iPhone/.test(ua)?'iPhone':/Android/.test(ua)?'Android':/Macintosh|Mac OS/.test(ua)?'Mac':/Windows/.test(ua)?'Windows':'Device'; };
  const revoke = (records,except) => { for(const r of records){elevated.delete(r.h);for(const res of streams.get(r.h)||[])if(res!==except)res.end();streams.delete(r.h);} cfg.sessions=cfg.sessions.filter(s=>!records.includes(s));save(); };
  const touch = (rec,req) => { if(!rec.id)rec.id=crypto.randomUUID();if(!rec.name||rec.name==='Previously signed-in device')rec.name=nameOf(req);if(!rec.lastSeen||Date.now()-rec.lastSeen>60000){rec.lastSeen=Date.now();save();} };
  let migrated=false;for(const rec of cfg.sessions){if(!rec.id){rec.id=crypto.randomUUID();rec.name='Previously signed-in device';migrated=true;}}if(migrated)save();
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
  <script>(async()=>{try{const d=localStorage.getItem('jv-device');if(d){document.getElementById('e').textContent='Signing in…';const r=await fetch('/api/remote/resume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({device:d})});if(r.ok){location.reload();return}localStorage.removeItem('jv-device');document.getElementById('e').textContent=''}}catch{}})();document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const r=await fetch('/api/remote/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passphrase:document.getElementById('p').value,device:true})});if(r.ok){try{const j=await r.json();if(j.device)localStorage.setItem('jv-device',j.device)}catch{}location.reload()}else{const j=await r.json().catch(()=>({}));document.getElementById('e').textContent=j.error||'Wrong passphrase'}}</script></body></html>`;

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
          const token = crypto.randomBytes(32).toString('hex'); cfg.sessions.push({ id: crypto.randomUUID(), name: nameOf(req), createdAt: now, lastSeen: now, h: sha(token), exp: now + 400 * 864e5 }); cfg.sessions = cfg.sessions.slice(-20); save(); fails.delete(key);
          return json(200, { ok: true, ...(b.device ? { device: token } : {}) }, { 'Set-Cookie': `jv=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}` });
        }
        list.push(now); fails.set(key, list); return json(401, { error: 'Wrong passphrase' });
      }
      if (p === '/api/remote/resume' && req.method === 'POST') { // phone/glasses webviews that drop cookies: the device token saved in the page signs the device back in without the passphrase
        const key = clientKey(req); const now = Date.now(); const list = (fails.get(key) || []).filter((t) => now - t < 10 * 60 * 1000);
        if (list.length >= 5) return json(429, { error: 'Too many attempts. Try again in 10 minutes.' });
        let b = {}; try { b = await ctx.readBody(req); } catch {}
        const tok = typeof b.device === 'string' && /^[a-f0-9]{64}$/.test(b.device) ? b.device : ''; const rec = tok && cfg.sessions.find((x) => x.h === sha(tok) && x.exp > now);
        if (rec) { touch(rec,req); rec.exp = now + 400 * 864e5; save(); return json(200, { ok: true }, { 'Set-Cookie': `jv=${tok}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${400 * 86400}` }); }
        list.push(now); fails.set(key, list); return json(401, { error: 'Sign in again' });
      }
      const sess = validSession(req);
      if (!sess) {
        if (p.startsWith('/api/')) return json(401, { error: 'login required', login: true });
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(p.startsWith('/even/') ? LOGIN_HTML.replace('<title>Jarvis — sign in</title>', '<title>Jarvis G2 — connect glasses</title>').replace('<h1>JARVIS</h1>', '<h1>JARVIS G2</h1>').replace("@@NAME@@’s command center", 'Connect your glasses to your private workspace').replace('<button>Unlock</button>', '<button>Connect glasses</button>') : LOGIN_HTML); return true;
      }
      touch(cfg.sessions.find(s=>s.h===sess),req);
      let live=streams.get(sess);if(!live){live=new Set();streams.set(sess,live);}live.add(res);res.once('close',()=>{live.delete(res);if(!live.size)streams.delete(sess);});
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
      const mustStep = (cfg.stepUp && STEPUP.some((r) => r.test(p))) || p === '/api/remote/settings' || /^\/api\/remote\/(setup|revoke|devices\/revoke)/.test(p);
      if (mustStep && !((elevated.get(sess) || 0) > Date.now())) return json(403, { error: 'Type your passphrase again to do this.', stepup: true });
      return false;
    },
    async handle(req, res, url, p) { // management endpoints (remote requests reach these only after login, and after passphrase confirmation for sensitive ones)
      const S = (c, b) => (ctx.send(res, c, b), true);
      if (p === '/api/remote/devices' && req.method === 'GET') {
        res.setHeader('Cache-Control','no-store');const current=validSession(req);
        return S(200,{local:local(req),devices:cfg.sessions.filter(r=>r.exp>Date.now()).map(r=>({id:r.id,name:r.name||'Previously signed-in device',createdAt:r.createdAt||null,lastSeen:r.lastSeen||null,current:r.h===current}))});
      }
      if (p === '/api/remote/devices/revoke' && req.method === 'POST') {
        const b=await ctx.readBody(req),rec=cfg.sessions.find(r=>r.id===b.id);if(!rec)return S(404,{error:'Device not found'});revoke([rec],res);return S(200,{ok:true});
      }
      if(p === '/api/remote/verification' && req.method === 'POST') {
        pruneChallenges();const who=owner(req);if(!who)return S(401,{error:'Sign in again',login:true});
        const b=await ctx.readBody(req),now=Date.now(),attempts=(fails.get('rotation')||[]).filter(t=>now-t<600000);
        if(attempts.length>=5)return S(429,{error:'Too many attempts. Wait 10 minutes.'});
        attempts.push(now);fails.set('rotation',attempts);
        if(!cfg.hash||typeof b.currentPassphrase!=='string'||!crypto.timingSafeEqual(Buffer.from(scrypt(b.currentPassphrase,cfg.salt),'hex'),Buffer.from(cfg.hash,'hex'))){return S(401,{error:'Current passphrase is incorrect'});}
        if(typeof b.newPassphrase!=='string'||b.newPassphrase.length<10||b.newPassphrase.length>1024)return S(400,{error:'Use a new passphrase of 10–1024 characters'});
        for(const [id,c]of challenges)if(c.owner===who)challenges.delete(id);
        if(challenges.size>=10)return S(429,{error:'Too many pending requests'});
        const id=crypto.randomUUID(),code=String(crypto.randomInt(100000,1000000)),salt=crypto.randomBytes(16).toString('hex');
        challenges.set(id,{owner:who,code,salt,hash:scrypt(b.newPassphrase,salt),expiresAt:now+300000,attempts:0,device:local(req)?'Host Mac':nameOf(req)});
        res.setHeader('Cache-Control','no-store');return S(200,{id,expiresAt:now+300000});
      }
      if(p === '/api/remote/verification' && req.method === 'GET') {
        if(!local(req))return S(403,{error:'Verification codes are only available on the host Mac at localhost:4777'});
        pruneChallenges();res.setHeader('Cache-Control','no-store');return S(200,{requests:[...challenges].map(([id,c])=>({id,code:c.code,expiresAt:c.expiresAt,device:c.device}))});
      }
      if(p === '/api/remote/passphrase' && req.method === 'POST') {
        pruneChallenges();const b=await ctx.readBody(req),c=challenges.get(b.id);
        if(!c||c.owner!==owner(req))return S(400,{error:'Verification expired. Start again.'});
        c.attempts++;if(c.attempts>5){challenges.delete(b.id);return S(429,{error:'Too many attempts. Start again.'});}
        if(typeof b.code!=='string'||!/^\d{6}$/.test(b.code)||!crypto.timingSafeEqual(Buffer.from(c.code),Buffer.from(b.code)))return S(400,{error:'Incorrect verification code'});
        cfg.salt=c.salt;cfg.hash=c.hash;challenges.clear();revoke([...cfg.sessions],res);return S(200,{ok:true,signedOut:true});
      }
      if (p === '/api/remote/status') {
        const bin = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', '/opt/homebrew/bin/tailscale', '/usr/local/bin/tailscale'].find((x) => fs.existsSync(x)) || null;
        let dns = null, ts = null; if (bin) { try { const j = JSON.parse(await exec(bin, ['status', '--json'])); dns = j.Self && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, '') : null; ts = j.BackendState || null; } catch {} }
        return S(200, { stepUp: cfg.stepUp, enabled: cfg.enabled, hosts: cfg.hosts, hasPassphrase: !!cfg.hash, sessions: cfg.sessions.filter((s) => s.exp > Date.now()).length, tailscale: { installed: !!bin, state: ts, dnsName: dns } });
      }
      if (p === '/api/remote/setup' && req.method === 'POST') {
        const b = await ctx.readBody(req);
        if (typeof b.passphrase === 'string' && b.passphrase) { if(cfg.hash)return S(409,{error:'Use the verified passphrase-change flow in Device access.'}); if (b.passphrase.length < 10) return S(400, { error: 'Use at least 10 characters' }); cfg.salt = crypto.randomBytes(16).toString('hex'); cfg.hash = scrypt(b.passphrase, cfg.salt); cfg.sessions = []; }
        if (Array.isArray(b.hosts)) cfg.hosts = b.hosts.map((h) => String(h).toLowerCase().replace(/^https?:\/\//, '').replace(/[\/:].*$/, '')).filter((h) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h)).slice(0, 5);
        if (typeof b.enabled === 'boolean') { if (b.enabled && !cfg.hash) return S(400, { error: 'Set a passphrase first' }); if (b.enabled && !cfg.hosts.length) return S(400, { error: 'Add your Tailscale address first' }); cfg.enabled = b.enabled; }
        save(); return S(200, { ok: true, enabled: cfg.enabled, hosts: cfg.hosts });
      }
      if (p === '/api/remote/settings' && req.method === 'POST') { const b = await ctx.readBody(req); if (typeof b.stepUp === 'boolean') cfg.stepUp = b.stepUp; save(); return S(200, { ok: true, stepUp: cfg.stepUp }); }
      if (p === '/api/remote/revoke' && req.method === 'POST') { revoke([...cfg.sessions],res); return S(200, { ok: true }); }
      return false;
    },
  };
};
