'use strict';
// Quotas are account observations, never inferred from Jarvis token totals.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const BUILTINS = {
  gemini: { name: 'Gemini', dashboardUrl: 'https://aistudio.google.com/usage', note: 'API quotas vary by project, tier and model. Add confirmed limits from AI Studio; local token totals do not measure remaining quota.' },
  notebooklm: { name: 'NotebookLM', dashboardUrl: 'https://notebooklm.google.com', note: 'Personal Google account connector. Limits depend on plan and operation; no verified remaining-quota feed is configured.' },
  kie: { name: 'KIE AI', dashboardUrl: 'https://kie.ai/api-key', note: 'Credits are shared across account models. Observations through several keys may show the same balance; do not sum them.' },
  higgsfield: { name: 'Higgsfield', dashboardUrl: 'https://higgsfield.ai', note: 'API prepaid dollar balance and website/MCP plan credits can differ. No verified automatic balance feed is configured.' },
};
const clean = (v, n = 160) => String(v || '').replace(/[\x00-\x1f]/g, ' ').slice(0, n);
const finite = v => typeof v === 'number' && Number.isFinite(v);
function iso(v) {
  if (v == null || v === '') return null;
  const d = new Date(typeof v === 'number' && v < 1e12 ? v * 1000 : v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
const read = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
function freshness(at, reset) {
  if (!at) return 'unavailable';
  return Date.now() - new Date(at).getTime() > 15 * 60e3 || (reset && new Date(reset).getTime() <= Date.now()) ? 'stale' : 'current';
}
function windowOf(w, at, source) {
  const pct = finite(w.usedPercent) ? Math.max(0, Math.min(100, w.usedPercent)) : finite(w.limit) && w.limit > 0 && finite(w.used) ? Math.max(0, Math.min(100, 100 * w.used / w.limit)) : null;
  const reset = iso(w.resetsAt || w.resets_at);
  return { id: clean(w.id, 60), label: clean(w.label || w.id, 80), usedPercent: pct, remainingPercent: pct == null ? null : 100 - pct, limit: finite(w.limit) ? w.limit : null, used: finite(w.used) ? w.used : null, unit: clean(w.unit || '%', 24), windowMinutes: finite(w.windowMinutes) ? w.windowMinutes : null, resetsAt: reset, status: pct == null ? 'unavailable' : freshness(at, reset), source, at: iso(at) };
}
const unknown = (id, label, windowMinutes = null) => windowOf({ id, label, windowMinutes }, null, 'Not exposed by this connection');
function atomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
  let fd;
  try { fd = fs.openSync(tmp, 'wx', 0o600); fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); fs.closeSync(fd); fd = null; fs.renameSync(tmp, file); }
  finally { if (fd != null) fs.closeSync(fd); try { fs.unlinkSync(tmp); } catch {} }
}
function classify(entry) {
  const text = [entry.service, entry.name, ...(entry.vars || []).map(v => v.k)].join(' ').toLowerCase();
  if (/notebooklm/.test(text)) return 'notebooklm';
  if (/higgsfield|hf_api/.test(text)) return 'higgsfield';
  if (/\bkie\b|kie_api|kie.ai/.test(text)) return 'kie';
  if (/gemini|google_generative|google_api_key/.test(text)) return 'gemini';
  return clean(entry.service || 'other', 60);
}
module.exports = function makeUsageOverview(ctx, deps = {}) {
  const FILE = path.join(ctx.DATA, 'usage-overview.json');
  const HISTORY = path.join(ctx.DATA, 'usage-overview-history');
  const vault = deps.vault;
  const providers = deps.providers || ctx.providers;
  let db = { version: 1, manual: {}, snapshots: {}, balances: {}, ...read(FILE, {}) };
  let refreshing = null;
  function persist(next) {
    if (fs.existsSync(FILE)) { fs.mkdirSync(HISTORY, { recursive: true }); fs.copyFileSync(FILE, path.join(HISTORY, Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json')); }
    atomic(FILE, next); db = next;
  }
  function scanModels() {
    const found = { claude: [], codex: [], gemini: [] };
    function add(engine, id, name) { if (typeof id !== 'string' || !id) return; const list = found[engine] ||= []; if (!list.some(x => x.id === id)) list.push({ id: clean(id), name: clean(name || id) }); }
    function walk(v, depth = 0) { if (!v || typeof v !== 'object' || depth > 6) return; if (v.models && typeof v.models === 'object') for (const [engine, model] of Object.entries(v.models)) add(engine, model); for (const [key, value] of Object.entries(v)) if (key !== 'models') walk(value, depth + 1); }
    walk(read(path.join(ctx.DATA, 'agents.json'), {})); walk(read(path.join(ctx.DATA, 'custom-agents.json'), []));
    add('gemini', read(path.join(ctx.DATA, 'gemini.json'), {}).model);
    const models = read(path.join(ctx.HOME || require('os').homedir(), '.codex/models_cache.json'), {}).models || [];
    for (const m of models) if (m.visibility === 'list') add('codex', m.slug, m.display_name);
    for (const [engine, list] of Object.entries(db.catalog || {})) for (const m of list) add(engine, m.id, m.name);
    return found;
  }
  function inventory(modelLists = scanModels()) {
    const map = new Map(Object.entries(BUILTINS).map(([id, item]) => [id, { id, ...item, kind: id, configured: false, keys: [], models: modelLists[id] || [], windows: [], balance: null, localUsage: null, source: 'Connection inventory', at: null }]));
    let keys = [], ps = [];
    try { keys = vault ? vault.list() : []; } catch {}
    try { ps = providers ? providers.list() : []; } catch {}
    for (const p of ps) {
      const id = 'provider:' + clean(p.id, 100);
      map.set(id, { id, name: clean(p.name), kind: clean(p.kind), configured: !!p.hasKey, keys: [], models: [...(p.model ? [{ id: clean(p.model), name: clean(p.model) }] : []), ...(modelLists['api:' + p.id] || []).filter(m => m.id !== p.model)], windows: [], balance: p.balance ? { text: clean(p.balance.text), at: iso(p.balance.at), source: 'Provider balance snapshot', status: freshness(iso(p.balance.at)) } : null, localUsage: p.usage || null, source: 'Jarvis provider inventory', at: iso(p.last), dashboardUrl: '', note: 'Local calls/tokens cover Jarvis only. API billing and subscription allowances are separate.' });
    }
    // Never copy key hints, secret values, file data, notes or credential paths.
    for (const entry of keys) {
      const kind = classify(entry);
      let id = kind;
      const linked = ps.find(p => { try { return providers.get(p.id)?.vaultId === entry.id; } catch { return false; } });
      if (linked) id = 'provider:' + linked.id;
      else if (!BUILTINS[id]) id = 'vault:' + entry.id;
      if (!map.has(id)) map.set(id, { id, name: clean(entry.name || entry.service), kind, configured: false, keys: [], models: [], windows: [], balance: null, localUsage: null, source: 'Vault metadata', at: null, dashboardUrl: '', note: 'No verified quota feed is configured. Add confirmed limits manually; several keys may share an account allowance.' });
      const s = map.get(id), configured = (entry.vars || []).some(v => v.empty === false || v.len > 0);
      s.keys.push({ id: clean(entry.id, 100), name: clean(entry.name), service: clean(entry.service), variables: (entry.vars || []).map(v => clean(v.k, 100)), configured });
      s.configured ||= configured;
    }
    if (fs.existsSync(path.join(ctx.ROOT, 'tools/notebooklm/bin/notebooklm'))) map.get('notebooklm').configured = true;
    return [...map.values()];
  }
  function account(id, name, usage, modelLists) {
    const models = [...(modelLists[id] || [])];
    for (const [model, m] of Object.entries(usage.models || {})) if (m.agent === id && !models.some(x => x.id === model)) models.push({ id: model, name: model });
    const out = { id, name, scope: 'Shared account allowance; not a separate quota for each model', models, windows: [], note: 'Remaining allowance is unknown until an authoritative observation is available.' };
    let snap = db.snapshots[id];
    const local = usage.codexLimits;
    if (id === 'codex' && local && (!snap || new Date(local.at) > new Date(snap.at))) {
      const windows = Object.entries(local).filter(([, w]) => w && typeof w === 'object' && finite(w.used_percent)).map(([key, w]) => ({ id: w.window_minutes === 300 ? 'five-hour' : w.window_minutes === 10080 ? 'weekly' : key, label: w.window_minutes === 300 ? '5-hour window' : w.window_minutes === 10080 ? 'Weekly window' : key, usedPercent: w.used_percent, windowMinutes: w.window_minutes, resetsAt: w.resets_at }));
      if (windows.length) snap = { at: local.at, windows, source: 'Codex local session rate-limit event' };
    }
    if (snap) { out.windows = snap.windows.map(w => windowOf(w, snap.at, snap.source)); out.note = 'Shared account observations from the displayed source. Stale readings remain visible and never reset to zero automatically.'; }
    if (!out.windows.some(w => w.windowMinutes === 300)) out.windows.unshift(unknown('five-hour', '5-hour window', 300));
    if (!out.windows.some(w => w.windowMinutes === 10080)) out.windows.push(unknown('weekly', 'Weekly window', 10080));
    return out;
  }
  function applyManual(item) {
    const manual = db.manual[item.id];
    if (manual) { const windows = manual.windows.map(w => windowOf(w, manual.at, 'Manual account observation')); item.windows = [...item.windows.filter(w => !windows.some(x => x.id === w.id)), ...windows]; item.manual = { at: manual.at, note: manual.note }; }
    return item;
  }
  function overview() {
    let usage = {}; try { usage = ctx.usage ? ctx.usage() : {}; } catch {}
    const modelLists = scanModels();
    const accounts = [account('claude', 'Claude', usage, modelLists), account('codex', 'Codex', usage, modelLists)].map(applyManual);
    const services = inventory(modelLists).map(s => {
      const cached = db.balances[s.id];
      if (cached) { if (cached.balance) s.balance = { ...cached.balance, status: cached.error ? 'stale' : freshness(cached.balance.at) }; s.at = cached.at; s.refreshError = cached.error || null; if (cached.keyBalances) s.keyBalances = cached.keyBalances.map(k => ({ ...k, status: k.error ? 'stale' : freshness(k.at) })); }
      if (!s.windows.length) s.windows = [unknown('quota', 'Provider quota')];
      return applyManual(s);
    });
    return { at: new Date().toISOString(), accounts, services, summary: { accounts: accounts.length, services: services.length, keys: services.reduce((n, s) => n + s.keys.length, 0) }, refresh: { at: db.refreshedAt || null, running: !!refreshing, error: db.quotaError || null }, notes: ['Several keys and models can share an account balance. Never add their remaining allowances together.', 'Unknown means no verified remaining limit is exposed; it does not mean unlimited.'] };
  }
  async function codexLimits() {
    if (deps.codexLimits) return deps.codexLimits();
    const bin = ctx.which && ctx.which('codex');
    if (!bin) throw Error('CLI unavailable');
    return new Promise((resolve, reject) => {
      let child, buffer = '', settled = false;
      const finish = (error, result) => {
        if (settled) return; settled = true; clearTimeout(timer);
        try { child.stdin.end(); child.kill('SIGTERM'); const killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 1000); killer.unref(); child.once('exit', () => clearTimeout(killer)); } catch {}
        error ? reject(Error('Quota unavailable')) : resolve(result);
      };
      const timer = setTimeout(() => finish(true), 20000);
      try {
        child = spawn(bin, ['app-server'], { cwd: ctx.ROOT, env: process.env, stdio: ['pipe', 'pipe', 'ignore'] });
        child.on('error', () => finish(true)); child.on('exit', () => finish(true)); child.stdin.on('error', () => finish(true));
        child.stdout.on('data', chunk => {
          buffer += chunk.toString(); if (buffer.length > 1024 * 1024) return finish(true);
          let index;
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); let reply;
            try { reply = JSON.parse(line); } catch { continue; }
            if (reply.id === 1) {
              if (reply.error) return finish(true);
              child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n');
              child.stdin.write(JSON.stringify({ id: 2, method: 'account/rateLimits/read', params: {} }) + '\n');
            } else if (reply.id === 2) return finish(!!reply.error, reply.result);
          }
        });
        child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'jarvis_usage', version: '1.0.0' } } }) + '\n');
      } catch { finish(true); }
    });
  }
  function normalizeCodex(result) {
    const entries = result.rateLimitsByLimitId ? Object.entries(result.rateLimitsByLimitId) : [['codex', result.rateLimits]];
    const windows = [];
    for (const [bucket, item] of entries) {
      if (!item) continue;
      for (const [slot, w] of [['primary', item.primary], ['secondary', item.secondary]]) {
        if (!w || !finite(w.usedPercent)) continue;
        const minutes = w.windowDurationMins, standard = minutes === 300 ? 'five-hour' : minutes === 10080 ? 'weekly' : slot;
        windows.push({ id: entries.length === 1 ? standard : clean(bucket, 35) + '-' + standard, label: (entries.length > 1 ? clean(item.limitName || bucket, 60) + ' · ' : '') + (minutes === 300 ? '5-hour window' : minutes === 10080 ? 'Weekly window' : slot), usedPercent: w.usedPercent, windowMinutes: minutes, resetsAt: w.resetsAt });
      }
    }
    return windows;
  }
  async function getJSON(url, key) {
    const response = await (deps.fetch || fetch)(url, { headers: { Authorization: 'Bearer ' + key }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('Provider unavailable');
    const text = await response.text(); if (text.length > 256000) throw Error('Response too large'); return JSON.parse(text);
  }
  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const snapshots = {}, balances = {}; let quotaError = null; let catalog = db.catalog || {};
      try { if (deps.models?.catalog) { const c = await deps.models.catalog(); catalog = Object.fromEntries(['claude', 'codex', 'gemini'].map(k => [k, (c[k]?.models || []).filter(m => m.id).slice(0, 300).map(m => ({ id: clean(m.id), name: clean(m.name || m.id) }))])); } } catch {}
      try { const c = db.snapshots.claude; if (deps.claudeProbe && (!c || Date.now() - new Date(c.at).getTime() > 600000)) await deps.claudeProbe(); } catch {}
      if (!db.snapshots.codex || Date.now() - new Date(db.snapshots.codex.at).getTime() > 300000) {
        try { const windows = normalizeCodex(await codexLimits()); if (windows.length) snapshots.codex = { at: new Date().toISOString(), source: 'Codex app-server account rate limits', windows }; else quotaError = 'No account quota returned'; }
        catch { quotaError = 'Codex limits could not be refreshed; previous observation retained'; }
      }
      for (const service of inventory()) { // ElevenLabs: characters used this period (read-only subscription endpoint)
        if (service.kind !== 'elevenlabs' || !service.keys.length) continue;
        try {
          const entry = vault.get(service.keys[0].id); const variable = (entry?.vars || []).find(v => /ELEVENLABS.*KEY/i.test(v.k) && v.v); if (!variable) continue;
          const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': variable.v }, signal: AbortSignal.timeout(12000) }); const j = await r.json().catch(() => ({})); if (!r.ok || !finite(j.character_limit)) throw Error('unavailable');
          const left = Math.max(0, j.character_limit - (j.character_count || 0)); const reset = finite(j.next_character_count_reset_unix) ? new Date(j.next_character_count_reset_unix * 1000).toISOString() : null;
          balances[service.id] = { at: new Date().toISOString(), balance: { text: left.toLocaleString('en') + ' of ' + j.character_limit.toLocaleString('en') + ' characters left' + (j.tier ? ' · ' + j.tier : ''), value: left, unit: 'characters', at: new Date().toISOString(), source: 'ElevenLabs subscription API', resetsAt: reset }, keyBalances: [], error: null };
        } catch { /* keep the previous observation */ }
      }
      for (const service of inventory()) {
        if (service.kind !== 'kie') continue;
        const results = [];
        for (const key of service.keys.slice(0, 20)) {
          try {
            const entry = vault.get(key.id); const variable = (entry?.vars || []).find(v => /KIE.*(?:KEY|TOKEN)/i.test(v.k) && v.v); if (!variable) continue;
            const reply = await getJSON('https://api.kie.ai/api/v1/chat/credit', variable.v);
            if (reply.code !== 200 || !finite(reply.data)) throw Error('Balance unavailable');
            results.push({ id: key.id, name: key.name, value: reply.data, unit: 'credits', at: new Date().toISOString(), source: 'KIE account credit API' });
          } catch {
            const old = db.balances[service.id]?.keyBalances?.find(k => k.id === key.id);
            results.push({ ...(old || {}), id: key.id, name: key.name, value: old?.value ?? null, at: old?.at || null, error: 'Balance could not be verified; check the provider dashboard.', source: 'KIE account credit API' });
          }
        }
        const good = results.find(r => finite(r.value) && !r.error);
        balances[service.id] = { at: new Date().toISOString(), balance: good ? { text: good.value + ' credits', value: good.value, unit: 'credits', at: good.at, source: 'KIE account credit API (shared account; do not sum keys)' } : db.balances[service.id]?.balance || null, keyBalances: results, error: !good && results.length ? 'Balance refresh failed; last observation retained' : null };
      }
      // Merge observations into latest state after awaits, retaining simultaneous manual edits/snapshots.
      const merged = { ...db.snapshots };
      for (const [id, value] of Object.entries(snapshots)) if (!merged[id] || new Date(value.at) >= new Date(merged[id].at)) merged[id] = value;
      persist({ ...db, catalog, balances: { ...db.balances, ...balances }, snapshots: merged, quotaError, refreshedAt: new Date().toISOString() });
      return overview();
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  function setManual(body) {
    if (![...overview().accounts, ...overview().services].some(x => x.id === body.id)) throw Error('Unknown account');
    if (!Array.isArray(body.windows) || body.windows.length > 12) throw Error('Invalid quota windows');
    const windows = body.windows.map((w, index) => {
      if (!finite(w.limit) || w.limit <= 0 || !finite(w.used) || w.used < 0) throw Error('Invalid quota values');
      if (w.resetsAt && !iso(w.resetsAt)) throw Error('Invalid reset date');
      return { id: clean(w.id || 'manual-' + index, 60), label: clean(w.label || 'Manual quota', 80), limit: w.limit, used: w.used, unit: clean(w.unit || 'requests', 24), resetsAt: iso(w.resetsAt), windowMinutes: finite(w.windowMinutes) ? w.windowMinutes : null };
    });
    const manual = { ...db.manual };
    if (!windows.length) delete manual[body.id]; else manual[body.id] = { at: new Date().toISOString(), note: clean(body.note, 300), windows };
    persist({ ...db, manual }); return overview();
  }
  function setSnapshot(body) {
    if (!Array.isArray(body.accounts) || body.accounts.length > 2) throw Error('Invalid snapshots');
    const snapshots = { ...db.snapshots };
    for (const account of body.accounts) {
      if (!['claude', 'codex'].includes(account.id) || !iso(account.at) || !Array.isArray(account.windows) || account.windows.length > 12) throw Error('Invalid snapshot');
      const value = { at: iso(account.at), source: 'Desktop account snapshot', windows: account.windows.map(w => { if (!finite(w.usedPercent) || w.usedPercent < 0 || w.usedPercent > 100) throw Error('Invalid percentage'); return { id: clean(w.id, 60), label: clean(w.label, 80), usedPercent: w.usedPercent, windowMinutes: finite(w.windowMinutes) ? w.windowMinutes : null, resetsAt: iso(w.resetsAt) }; }) };
      if (!snapshots[account.id] || new Date(value.at) >= new Date(snapshots[account.id].at)) snapshots[account.id] = value;
    }
    persist({ ...db, snapshots }); return overview();
  }
  return {
    overview, refresh, setManual, setSnapshot,
    async handle(req, res, url, pathname = url.pathname) {
      if (!['/api/usage/overview', '/api/usage/refresh', '/api/usage/manual', '/api/usage/snapshot'].includes(pathname)) return false;
      const send = (status, data) => (ctx.send(res, status, data), true);
      try {
        if (pathname === '/api/usage/overview' && req.method === 'GET') return send(200, overview());
        if (pathname === '/api/usage/manual' && req.method === 'GET') return send(200, { manual: db.manual });
        if (pathname === '/api/usage/overview' || req.method !== 'POST') return send(405, { error: 'Method not allowed' });
        if (pathname === '/api/usage/refresh') return send(200, await refresh());
        const body = await ctx.readBody(req);
        return send(200, pathname === '/api/usage/manual' ? setManual(body) : setSnapshot(body));
      } catch { return send(400, { error: 'Usage settings could not be updated. Check quota values and connection availability.' }); }
    },
  };
};
module.exports.windowOf = windowOf;
