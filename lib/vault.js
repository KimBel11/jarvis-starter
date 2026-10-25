'use strict';
// Encrypted vault for API keys / .env files / key files.
// AES-256-GCM. Master key lives in the macOS Keychain (service "jarvis-vault"), NOT on the drive.
// Fallback: ~/Library/Application Support/Jarvis/vault.key (0600, internal disk).
// Values never leave the server except through POST /api/vault/reveal.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const SERVICES = [
  { id: 'canvas', name: 'Canvas LMS', cat: 'Study', color: '#e56b6f', glyph: 'C', url: '', re: /^CANVAS_/i, desc: 'Read course materials, assignments and calendars through the Study connector' },
  { id: 'elevenlabs', name: 'ElevenLabs', cat: 'Voice', color: '#a78bfa', glyph: 'XI', url: 'https://elevenlabs.io/app', re: /ELEVEN|^XI_/i, desc: 'Human-sounding voice for Jarvis, dubbing and narration' },
  { id: 'higgsfield', name: 'Higgsfield', cat: 'Video AI', color: '#ff4d8d', glyph: 'HF', url: 'https://higgsfield.ai', re: /HIGGSFIELD|^HF_/i, desc: 'AI video and image generation' },
  { id: 'kie', name: 'Kie AI', cat: 'Video AI', color: '#35d49a', glyph: 'K', url: 'https://kie.ai', re: /^KIE|KIE_AI|KIE_KEY/i, desc: 'Video, image and audio model API' },
  { id: 'arcads', name: 'Arcads', cat: 'Video AI', color: '#ff6a3d', glyph: 'A', url: 'https://arcads.ai', re: /ARCADS/i, desc: 'AI UGC ad videos' },
  { id: 'shopify', name: 'Shopify', cat: 'Commerce', color: '#95bf47', glyph: 'S', url: 'https://admin.shopify.com', re: /SHOPIFY|^SHPAT|STOREFRONT/i, desc: 'Stores, themes, products, orders' },
  { id: 'cloudflare', name: 'Cloudflare', cat: 'Infrastructure', color: '#f6821f', glyph: 'CF', url: 'https://dash.cloudflare.com', re: /CLOUDFLARE|^CF_|WRANGLER|R2_/i, desc: 'Workers, R2 storage, DNS' },
  { id: 'apple', name: 'App Store Connect', cat: 'Apps', color: '#5b8cff', glyph: '', url: 'https://appstoreconnect.apple.com', re: /APPLE|APP_?STORE|^ASC_|ISSUER|AUTHKEY|TESTFLIGHT/i, desc: 'iOS builds, TestFlight, App Store' },
  { id: 'expo', name: 'Expo / EAS', cat: 'Apps', color: '#c8d3ff', glyph: 'E', url: 'https://expo.dev', re: /EXPO|^EAS_/i, desc: 'Android and iOS cloud builds' },
  { id: 'gemini', name: 'Google Gemini', cat: 'AI', color: '#8ab4f8', glyph: 'Gm', url: 'https://aistudio.google.com/apikey', re: /GEMINI|GOOGLE_?(GENERATIVE_?)?AI/i, desc: 'Gemini models for your Studys project and agents' },
  { id: 'google', name: 'Google', cat: 'Platforms', color: '#4285f4', glyph: 'G', url: 'https://console.cloud.google.com', re: /GOOGLE_(?!GENERATIVE|AI)|GCP|PLAY_/i, desc: 'Google Play, Cloud' },
  { id: 'youtube', name: 'YouTube', cat: 'Social', color: '#ff2d3b', glyph: '▶', url: 'https://studio.youtube.com', re: /YOUTUBE|YT_/i, desc: 'Shorts and long-form' },
  { id: 'meta', name: 'Meta · Instagram', cat: 'Social', color: '#3b82f6', glyph: 'M', url: 'https://business.facebook.com', re: /META_|FACEBOOK|^FB_|INSTAGRAM|^IG_|GRAPH_/i, desc: 'Instagram and Facebook posting and ads' },
  { id: 'tiktok', name: 'TikTok', cat: 'Social', color: '#25f4ee', glyph: 'T', url: 'https://www.tiktok.com/creator-center', re: /TIKTOK/i, desc: 'Short video posting' },
  { id: 'snapchat', name: 'Snapchat', cat: 'Social', color: '#fffc00', glyph: 'SC', url: 'https://ads.snapchat.com', re: /SNAP/i, desc: 'Spotlight and ads' },
  { id: 'x', name: 'X', cat: 'Social', color: '#e7e9ea', glyph: 'X', url: 'https://x.com', re: /TWITTER|^X_(API|BEARER|TOKEN|CLIENT)/i, desc: 'Posts and analytics' },
  { id: 'pinterest', name: 'Pinterest', cat: 'Social', color: '#e60023', glyph: 'P', url: 'https://business.pinterest.com', re: /PINTEREST/i, desc: 'Pins and analytics' },
  { id: 'openai', name: 'OpenAI · Codex', cat: 'AI', color: '#10a37f', glyph: 'O', url: 'https://platform.openai.com', re: /OPENAI/i, desc: 'Codex and GPT models' },
  { id: 'anthropic', name: 'Anthropic · Claude', cat: 'AI', color: '#ff8a5c', glyph: 'C', url: 'https://console.anthropic.com', re: /ANTHROPIC|CLAUDE/i, desc: 'Claude models and Claude Code' },
  { id: 'mirofish', name: 'MiroFish', cat: 'AI', color: '#2dd4ee', glyph: 'MF', url: 'https://github.com', re: /MIROFISH|^ZEP_|^LLM_/i, desc: 'Audience simulation for my project' },
  { id: 'stripe', name: 'Stripe', cat: 'Commerce', color: '#635bff', glyph: '$', url: 'https://dashboard.stripe.com', re: /STRIPE/i, desc: 'Payments' },
  { id: 'supabase', name: 'Supabase', cat: 'Infrastructure', color: '#3ecf8e', glyph: 'SB', url: 'https://supabase.com/dashboard', re: /SUPABASE/i, desc: 'Database and auth' },
  { id: 'other', name: 'Other', cat: 'Other', color: '#8793a8', glyph: '·', url: '', re: /$^/, desc: 'Anything else' },
];

// Default variable name per service: @@NAME@@ only pastes the key, Jarvis files it under the name each connector already looks for.
const DEFAULT_VAR = { canvas: 'CANVAS_ACCESS_TOKEN', elevenlabs: 'ELEVENLABS_API_KEY', higgsfield: 'HIGGSFIELD_API_KEY', kie: 'KIE_API_KEY', arcads: 'ARCADS_API_KEY', shopify: 'SHOPIFY_ACCESS_TOKEN', cloudflare: 'CLOUDFLARE_API_TOKEN', apple: 'APP_STORE_CONNECT_ISSUER_ID', expo: 'EXPO_TOKEN', gemini: 'GEMINI_API_KEY', google: 'GOOGLE_API_KEY', youtube: 'YOUTUBE_API_KEY', meta: 'META_ACCESS_TOKEN', tiktok: 'TIKTOK_ACCESS_TOKEN', snapchat: 'SNAPCHAT_ACCESS_TOKEN', x: 'X_BEARER_TOKEN', pinterest: 'PINTEREST_ACCESS_TOKEN', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', mirofish: 'MIROFISH_API_KEY', stripe: 'STRIPE_SECRET_KEY', supabase: 'SUPABASE_KEY', other: 'API_KEY' };
// Guess the service from how the key looks (only when it is unambiguous).
const guessService = (v) => (/^AIza[0-9A-Za-z_-]{20,}/.test(v) ? 'gemini' : /^sk-ant-/.test(v) ? 'anthropic' : /^sk_[0-9a-f]{20,}/.test(v) ? 'elevenlabs' : /^sk-(proj-)?[A-Za-z0-9_-]{20,}/.test(v) ? 'openai' : /^shp(at|ca|ss)_/.test(v) ? 'shopify' : /^sk_(live|test)_|^rk_(live|test)_/.test(v) ? 'stripe' : null);
const SKIP = new Set(['node_modules', '.git', 'Pods', 'build', 'DerivedData', 'dev-caches', '.gradle', '.next', 'dist', '.expo', '__pycache__', '.venv', 'venv', '.cache', 'Library', '.Trash', '.fseventsd', '.Spotlight-V100', '.Trashes', '.DocumentRevisions-V100', '.TemporaryItems']);

module.exports = function makeVault(ctx) {
  const FILE = path.join(ctx.DATA, 'vault.enc');
  const AUDIT = path.join(ctx.DATA, 'vault-audit.log');
  const ACCOUNT = os.userInfo().username;
  const FALLBACK_KEY = path.join(ctx.HOME, 'Library', 'Application Support', 'Jarvis', 'vault.key');
  let keyBuf = null, keyWhere = null, cache = null, scanCache = null;

  function masterKey() {
    if (keyBuf) return keyBuf;
    try {
      const hex = execFileSync('security', ['find-generic-password', '-s', 'jarvis-vault', '-a', ACCOUNT, '-w'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }).toString().trim();
      if (/^[0-9a-f]{64}$/.test(hex)) { keyWhere = 'keychain'; return (keyBuf = Buffer.from(hex, 'hex')); }
    } catch {}
    try { const hex = fs.readFileSync(FALLBACK_KEY, 'utf8').trim(); if (/^[0-9a-f]{64}$/.test(hex)) { keyWhere = 'keyfile'; return (keyBuf = Buffer.from(hex, 'hex')); } } catch {}
    const hex = crypto.randomBytes(32).toString('hex');
    try { execFileSync('security', ['add-generic-password', '-s', 'jarvis-vault', '-a', ACCOUNT, '-w', hex, '-U'], { stdio: 'ignore', timeout: 8000 }); keyWhere = 'keychain'; }
    catch { fs.mkdirSync(path.dirname(FALLBACK_KEY), { recursive: true }); fs.writeFileSync(FALLBACK_KEY, hex, { mode: 0o600 }); keyWhere = 'keyfile'; }
    return (keyBuf = Buffer.from(hex, 'hex'));
  }
  function load() {
    if (cache) return cache;
    if (!fs.existsSync(FILE)) return (cache = { entries: [] });
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const d = crypto.createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(j.iv, 'base64')); d.setAuthTag(Buffer.from(j.tag, 'base64'));
    cache = JSON.parse(Buffer.concat([d.update(Buffer.from(j.ct, 'base64')), d.final()]).toString('utf8'));
    return cache;
  }
  function save() {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
    const ct = Buffer.concat([c.update(JSON.stringify(cache), 'utf8'), c.final()]);
    const out = JSON.stringify({ v: 1, alg: 'aes-256-gcm', iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') });
    fs.mkdirSync(ctx.DATA, { recursive: true }); const tmp = FILE + '.tmp'; fs.writeFileSync(tmp, out, { mode: 0o600 }); fs.renameSync(tmp, FILE);
  }
  function audit(action, entry, key) { try { fs.appendFileSync(AUDIT, JSON.stringify({ t: new Date().toISOString(), action, entry: entry && entry.name, key: key || undefined }) + '\n', { mode: 0o600 }); } catch {} }

  // iCloud-evicted or briefly locked files can fail with EAGAIN (-11): retry, then explain.
  function readSafe(f, enc) {
    for (let i = 0; i < 6; i++) {
      try { return fs.readFileSync(f, enc); }
      catch (e) { if (e.code !== 'EAGAIN' && e.errno !== -11) throw e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400 * (i + 1)); }
    }
    throw new Error('not readable right now (likely an iCloud file that is not downloaded; open it once in Finder, then retry)');
  }
  function parseDotenv(text) {
    const out = []; const lines = String(text).replace(/^﻿/, '').split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/); if (!m) continue;
      let v = m[2]; const q = v[0];
      if ((q === '"' || q === "'") ) {
        let body = v.slice(1);
        while (!body.includes(q) && i + 1 < lines.length) body += '\n' + lines[++i];
        const end = body.indexOf(q); v = end >= 0 ? body.slice(0, end) : body; if (q === '"') v = v.replace(/\\n/g, '\n');
      } else v = v.replace(/\s+#.*$/, '').trim();
      out.push({ k: m[1], v });
    }
    return out;
  }
  function detect(vars, source) {
    let best = SERVICES[SERVICES.length - 1], bestScore = 0;
    for (const s of SERVICES) { if (s.id === 'other') continue; let sc = vars.filter((x) => s.re.test(x.k || x)).length; if (!sc && source && s.re.test(path.basename(path.dirname(source)) + '/' + path.basename(source))) sc = 0.5; if (sc > bestScore) { best = s; bestScore = sc; } }
    return best.id;
  }
  const hint = (v) => (v.length >= 16 ? v.slice(0, 2) + '••••••' + v.slice(-2) : '••••••');
  function mask(e) { return { id: e.id, name: e.name, service: e.service, kind: e.kind, source: e.source || null, project: e.project || null, note: e.note || '', addedAt: e.addedAt, updatedAt: e.updatedAt, vars: (e.vars || []).map((x) => ({ k: x.k, len: x.v.length, hint: hint(x.v), empty: !x.v })), file: e.file ? { name: e.file.name, size: e.file.size } : null }; }

  const CAND = (n) => (/^\.env(\..+)?$/.test(n) && !/\.(example|sample|template|dist)$/i.test(n) && !/^\.xcode\.env/.test(n)) || /\.env$/i.test(n) && !/^\.xcode/.test(n) || n === '.dev.vars' || /^AuthKey_.+\.p8$/.test(n);
  function scanRoots() {
    const roots = new Set([ctx.DRIVE, ...ctx.state.projects.map((p) => p.path), path.join(ctx.HOME, 'Documents'), path.join(ctx.HOME, '.codex', 'skills')]);
    return [...roots].filter((r) => fs.existsSync(r));
  }
  function underRoots(p) { const r = path.resolve(p); return scanRoots().some((x) => ctx.inside(r, x)); }
  async function scan(force) {
    if (!force && scanCache && Date.now() - scanCache.at < 60000) return scanCache.list;
    const seen = new Set(); const found = [];
    const walk = async (dir, depth) => {
      if (depth > 7) return; let ents; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      const subs = [];
      for (const e of ents) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.has(e.name) && !(e.name.startsWith('.') && !['.config'].includes(e.name) && depth > 0)) subs.push(f); }
        else if (e.isFile() && CAND(e.name)) found.push(f);
      }
      for (let i = 0; i < subs.length; i += 8) await Promise.all(subs.slice(i, i + 8).map((s) => walk(s, depth + 1)));
    };
    for (const r of scanRoots()) await walk(r, 0);
    const v = load(); const list = [];
    for (const f of found) {
      let real; try { real = fs.realpathSync(f); } catch { continue; } if (seen.has(real)) continue; seen.add(real);
      const st = fs.statSync(f); const base = path.basename(f); const isKey = base.endsWith('.p8');
      let names = [], unreadable = null; if (!isKey) { try { names = parseDotenv(readSafe(f, 'utf8')).map((x) => x.k); } catch (e) { unreadable = e.message; } if (!names.length && !unreadable) continue; }
      const exist = v.entries.find((e) => e.source === f);
      list.push({ path: f, base, kind: isKey ? 'file' : 'env', project: ctx.projectFor(f), vars: names, service: isKey ? 'apple' : detect(names, f), size: st.size, mtime: st.mtimeMs, imported: !!exist, entryId: exist ? exist.id : null, unreadable });
    }
    list.sort((a, b) => Number(a.imported) - Number(b.imported) || a.path.localeCompare(b.path));
    scanCache = { at: Date.now(), list }; return list;
  }
  function defaultName(service, f, project) { const s = SERVICES.find((x) => x.id === service); const pr = project && (ctx.state.projects.find((p) => p.id === project) || {}).name; return `${s && s.id !== 'other' ? s.name : path.basename(f)}${pr ? ' · ' + pr : ''}`; }
  async function importFiles(items) {
    const v = load(); const done = []; const skipped = [];
    for (const it of items.slice(0, 60)) {
      const f = path.resolve(String(it.path || '')); const base = path.basename(f);
      if (!CAND(base) || !underRoots(f) || !fs.existsSync(f)) continue;
      try {
      const project = ctx.projectFor(f); const now = new Date().toISOString();
      let entry = v.entries.find((e) => e.source === f);
      if (base.endsWith('.p8')) {
        const buf = readSafe(f); const service = it.service || 'apple';
        if (entry) { entry.file = { name: base, size: buf.length, b64: buf.toString('base64') }; entry.updatedAt = now; }
        else v.entries.push((entry = { id: crypto.randomUUID(), name: String(it.name || defaultName(service, f, project)).slice(0, 80), service, kind: 'file', source: f, project, file: { name: base, size: buf.length, b64: buf.toString('base64') }, vars: [], addedAt: now, updatedAt: now }));
      } else {
        const vars = parseDotenv(readSafe(f, 'utf8')); if (!vars.length) continue; const service = it.service || detect(vars, f);
        if (entry) { entry.vars = vars; entry.updatedAt = now; if (it.name) entry.name = String(it.name).slice(0, 80); if (it.service) entry.service = it.service; }
        else v.entries.push((entry = { id: crypto.randomUUID(), name: String(it.name || defaultName(service, f, project)).slice(0, 80), service, kind: 'env', source: f, project, vars, addedAt: now, updatedAt: now }));
      }
      audit('import', entry); done.push(entry.id);
      } catch (e) { skipped.push({ path: f, error: String(e.message || e) }); }
    }
    if (done.length) save(); scanCache = null; return { done, skipped };
  }
  const api = {
    SERVICES,
    status() { let n = 0; try { n = load().entries.length; } catch (e) { return { ok: false, error: 'Vault could not be opened: ' + e.message }; } return { ok: true, count: n, store: keyWhere || (masterKey() && keyWhere), alg: 'AES-256-GCM' }; },
    list() { return load().entries.map(mask); },
    get(id) { return load().entries.find((e) => e.id === id); },
    find(re) { for (const e of load().entries) for (const x of e.vars || []) if (re.test(x.k) && x.v) return x.v; return null; },
    findInService(service, re) { for (const e of load().entries) if (e.service === service) for (const x of e.vars || []) if ((!re || re.test(x.k)) && x.v) return x.v; return null; },
    hasService(id) { return load().entries.some((e) => e.service === id && ((e.vars || []).length || e.file)); },
    scan, importFiles, parseDotenv,
    addManual({ name, service, text, note }) {
      const vars = parseDotenv(text || ''); if (!vars.length) throw new Error('Paste KEY=VALUE lines');
      const v = load(); const now = new Date().toISOString(); const s = service && SERVICES.some((x) => x.id === service) ? service : detect(vars, '');
      const e = { id: crypto.randomUUID(), name: String(name || 'New key').slice(0, 80), service: s, kind: 'env', source: null, project: null, note: String(note || '').slice(0, 200), vars, addedAt: now, updatedAt: now };
      v.entries.push(e); save(); audit('add', e); return mask(e);
    },
    update({ id, name, service, note }) { const e = load().entries.find((x) => x.id === id); if (!e) throw new Error('not found'); if (name) e.name = String(name).slice(0, 80); if (service && SERVICES.some((x) => x.id === service)) e.service = service; if (typeof note === 'string') e.note = note.slice(0, 200); e.updatedAt = new Date().toISOString(); save(); audit('update', e); return mask(e); },
    // Paste only the key. With no id it files it under the service's default name (replacing the old value if there is one);
    // with id (+ optional key name) it replaces that variable's value. Pasted KEY=VALUE lines are understood too.
    setKey({ id, service, key, value, name }) {
      let raw = String(value || '').trim(); if (!raw) throw new Error('Paste the key first');
      const v = load(); const now = new Date().toISOString();
      let vars = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_.-]*\s*=/.test(raw) ? parseDotenv(raw) : null;
      if (!vars || !vars.length) { raw = raw.replace(/^["']|["']$/g, '').trim(); if (/\s/.test(raw)) throw new Error('A key has no spaces. Paste only the key itself.'); vars = [{ k: null, v: raw }]; }
      let e = id ? v.entries.find((x) => x.id === id) : null; if (id && !e) throw new Error('not found');
      const svc = e ? e.service : (service && SERVICES.some((x) => x.id === service) ? service : guessService(vars[0].v) || detect(vars.filter((x) => x.k), '') || 'other');
      if (!e) e = v.entries.find((x) => x.service === svc && (x.vars || []).some((y) => y.k === DEFAULT_VAR[svc])) || null;
      if (!e) { e = { id: crypto.randomUUID(), name: String(name || (SERVICES.find((x) => x.id === svc) || {}).name || 'New key').slice(0, 80), service: svc, kind: 'env', source: null, project: null, note: '', vars: [], addedAt: now, updatedAt: now }; v.entries.push(e); }
      e.vars = e.vars || [];
      for (const x of vars) { const k = x.k || String(key || '').trim() || DEFAULT_VAR[svc] || 'API_KEY'; if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(k)) throw new Error('Bad variable name'); const cur = e.vars.find((y) => y.k === k); if (cur) cur.v = x.v; else e.vars.push({ k, v: x.v }); }
      e.updatedAt = now; save(); audit('set-key', e); return mask(e);
    },
    removeVar({ id, key }) { const e = load().entries.find((x) => x.id === id); if (!e) throw new Error('not found'); const i = (e.vars || []).findIndex((x) => x.k === key); if (i < 0) throw new Error('no such variable'); e.vars.splice(i, 1); e.updatedAt = new Date().toISOString(); save(); audit('remove-var', e, key); return mask(e); },
    defaults() { return { vars: DEFAULT_VAR }; },
    remove(id) { const v = load(); const i = v.entries.findIndex((x) => x.id === id); if (i < 0) throw new Error('not found'); audit('delete', v.entries[i]); v.entries.splice(i, 1); save(); scanCache = null; },
    reveal(id, key) { const e = load().entries.find((x) => x.id === id); if (!e) throw new Error('not found'); audit('reveal', e, key || '*'); if (key) { const x = e.vars.find((y) => y.k === key); if (!x) throw new Error('no such variable'); return { value: x.v }; } return { env: e.vars.map((x) => `${x.k}=${/[\s#"']/.test(x.v) ? JSON.stringify(x.v) : x.v}`).join('\n') }; },
    revealFile(id) { const e = load().entries.find((x) => x.id === id); if (!e || !e.file) throw new Error('not found'); audit('reveal-file', e); return { name: e.file.name, b64: e.file.b64 }; },
    auditLog(n = 60) { try { return fs.readFileSync(AUDIT, 'utf8').trim().split('\n').slice(-n).reverse().map((l) => JSON.parse(l)); } catch { return []; } },
    listRaw() { return load().entries; }, // internal use only (never exposed over HTTP)
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true);
      if (!p.startsWith('/api/vault')) return false;
      try {
        if (p === '/api/vault' && req.method === 'GET') return S(200, { status: api.status(), services: SERVICES.map(({ re, ...s }) => ({ ...s, envName: DEFAULT_VAR[s.id] })), entries: api.list() });
        if (p === '/api/vault/scan') return S(200, { files: await scan(url.searchParams.get('force') === '1') });
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/vault/import' && req.method === 'POST') { const r = await importFiles(Array.isArray(b.items) ? b.items : []); return S(200, { imported: r.done.length, skipped: r.skipped, entries: api.list() }); }
        if (p === '/api/vault/entry' && req.method === 'POST') return S(200, { entry: api.addManual(b), entries: api.list() });
        if (p === '/api/vault/update' && req.method === 'POST') return S(200, { entry: api.update(b) });
        if (p === '/api/vault/set-key' && req.method === 'POST') return S(200, { entry: api.setKey(b), entries: api.list() });
        if (p === '/api/vault/remove-var' && req.method === 'POST') return S(200, { entry: api.removeVar(b), entries: api.list() });
        if (p === '/api/vault/delete' && req.method === 'POST') { api.remove(b.id); return S(200, { entries: api.list() }); }
        if (p === '/api/vault/reveal' && req.method === 'POST') return S(200, api.reveal(b.id, b.key));
        if (p === '/api/vault/reveal-file' && req.method === 'POST') return S(200, api.revealFile(b.id));
        if (p === '/api/vault/audit') return S(200, { log: api.auditLog() });
      } catch (e) { return S(e.status || 400, { error: String(e.message || e) }); }
      return false;
    },
    _test: { parseDotenv, detect },
  };
  return api;
};
