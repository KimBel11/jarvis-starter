'use strict';
// Extra AI models added by API key (DeepSeek, Kimi, OpenAI, xAI, Mistral, Groq, OpenRouter, Perplexity, or any OpenAI-compatible service).
// Keys live in the encrypted vault (entry "AI · <name>"); this file only keeps names, endpoints, the chosen model and usage counters.
// Claude and Codex stay the main engines; these are text-in/text-out helpers for agents (engine "api") and the council.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PRESETS = [
  { kind: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-chat', keyUrl: 'https://platform.deepseek.com/api_keys', balance: 'deepseek', note: 'Very cheap. Good for drafts, summaries and code explanations.' },
  { kind: 'kimi', name: 'Kimi (Moonshot)', base: 'https://api.moonshot.ai/v1', model: 'kimi-k2-0905-preview', keyUrl: 'https://platform.moonshot.ai/console/api-keys', balance: 'moonshot', note: 'Long context and strong reasoning.' },
  { kind: 'openai', name: 'OpenAI API', base: 'https://api.openai.com/v1', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys', balance: null, note: 'Pay-as-you-go API (separate from the Codex subscription).' },
  { kind: 'xai', name: 'xAI Grok', base: 'https://api.x.ai/v1', model: 'grok-4', keyUrl: 'https://console.x.ai', balance: null, note: 'Grok models with current-events knowledge.' },
  { kind: 'mistral', name: 'Mistral', base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', keyUrl: 'https://console.mistral.ai/api-keys', balance: null, note: 'European models, fast and affordable.' },
  { kind: 'groq', name: 'Groq', base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyUrl: 'https://console.groq.com/keys', balance: null, note: 'Extremely fast open models.' },
  { kind: 'openrouter', name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyUrl: 'https://openrouter.ai/keys', balance: 'openrouter', note: 'One key for hundreds of models.' },
  { kind: 'perplexity', name: 'Perplexity', base: 'https://api.perplexity.ai', model: 'sonar', keyUrl: 'https://www.perplexity.ai/settings/api', balance: null, note: 'Answers with live web sources.' },
  { kind: 'custom', name: 'Custom (OpenAI-compatible)', base: '', model: '', keyUrl: '', balance: null, note: 'Any service that speaks the OpenAI chat API (LM Studio, Ollama, vLLM, Together, Fireworks…).' },
];

module.exports = function makeProviders(ctx, vault) {
  const FILE = path.join(ctx.DATA, 'providers.json');
  let db = { providers: [] }; try { db = { providers: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.mkdirSync(ctx.DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 1), { mode: 0o600 }); } catch {} };
  const day = () => new Date().toISOString().slice(0, 10);
  const get = (id) => db.providers.find((p) => p.id === id);
  const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24);
  const keyOf = (p) => { try { const e = vault.get(p.vaultId); const x = e && (e.vars || []).find((v) => v.k === p.var && v.v); return x ? x.v : null; } catch { return null; } };
  const cleanBase = (b) => String(b || '').trim().replace(/\/+$/, '');
  const okBase = (b) => { try { const u = new URL(b); return u.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname); } catch { return false; } };

  function pub(p) {
    const u = p.usage || {}; const d = u.days || {}; const t = day();
    const week = Object.entries(d).filter(([k]) => k >= new Date(Date.now() - 6 * 864e5).toISOString().slice(0, 10)).reduce((a, [, v]) => ({ calls: a.calls + v.calls, tokens: a.tokens + v.tokens }), { calls: 0, tokens: 0 });
    return { id: p.id, kind: p.kind, name: p.name, base: p.base, model: p.model, hasKey: !!keyOf(p), added: p.added, last: p.last || null, lastError: p.lastError || null, balance: p.balance || null, note: p.note || '',
      usage: { calls: u.calls || 0, tokens: u.tokens || 0, today: d[t] || { calls: 0, tokens: 0 }, week, days: Object.fromEntries(Object.entries(d).slice(-14)) } };
  }
  function count(p, usage) {
    const u = (p.usage = p.usage || { calls: 0, tokens: 0, days: {} }); const t = day(); const n = (usage && (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0))) || 0;
    u.calls++; u.tokens += n; u.days[t] = u.days[t] || { calls: 0, tokens: 0 }; u.days[t].calls++; u.days[t].tokens += n;
    const keys = Object.keys(u.days).sort(); while (keys.length > 60) delete u.days[keys.shift()];
    p.last = new Date().toISOString(); p.lastError = null; save();
  }

  async function models(p) {
    const k = keyOf(p); if (!k) throw new Error('No key stored for ' + p.name);
    const r = await fetch(p.base + '/models', { headers: { Authorization: 'Bearer ' + k }, signal: AbortSignal.timeout(15000) }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(String((j.error && (j.error.message || j.error)) || r.statusText).slice(0, 200));
    return (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean).sort();
  }
  async function balance(p) {
    const k = keyOf(p); if (!k) return null; const preset = PRESETS.find((x) => x.kind === p.kind); const how = preset && preset.balance; if (!how) return null;
    const H = { Authorization: 'Bearer ' + k }; const sig = AbortSignal.timeout(12000);
    try {
      if (how === 'deepseek') { const j = await (await fetch('https://api.deepseek.com/user/balance', { headers: H, signal: sig })).json(); const b = (j.balance_infos || [])[0]; return b ? { text: `${b.total_balance} ${b.currency}`, ok: !!j.is_available, at: Date.now() } : null; }
      if (how === 'moonshot') { const j = await (await fetch(p.base.replace(/\/v1$/, '') + '/v1/users/me/balance', { headers: H, signal: sig })).json(); const b = j.data; return b ? { text: `${Number(b.available_balance).toFixed(2)} available`, ok: b.available_balance > 0, at: Date.now() } : null; }
      if (how === 'openrouter') { const j = await (await fetch('https://openrouter.ai/api/v1/credits', { headers: H, signal: sig })).json(); const b = j.data; return b ? { text: `$${(b.total_credits - b.total_usage).toFixed(2)} left of $${Number(b.total_credits).toFixed(2)}`, ok: b.total_credits > b.total_usage, at: Date.now() } : null; }
    } catch {}
    return null;
  }

  // One streamed chat call. Same event contract as runner.spawnAgent / gemini.run: session | delta | done | error, returns { done, kill }.
  function run(o, onEvent) {
    const ctl = new AbortController(); let finished = false, text = '';
    const emit = (e) => { try { onEvent && onEvent(e); } catch {} };
    let resolveDone; const done = new Promise((r) => (resolveDone = r));
    const finish = (e) => { if (finished) return; finished = true; emit(e); resolveDone(e); };
    (async () => {
      const p = get(o.provider) || db.providers.find((x) => x.id === o.provider || x.kind === o.provider); if (!p) return finish({ type: 'error', message: 'That AI model is not set up. Open AI Models and add it.' });
      const k = keyOf(p); if (!k) return finish({ type: 'error', message: `No API key for ${p.name}. Add it in AI Models.` });
      emit({ type: 'session', id: 'api' + Date.now().toString(36) });
      const msgs = []; if (o.system) msgs.push({ role: 'system', content: String(o.system) }); msgs.push({ role: 'user', content: String(o.input || '') });
      const model = o.model || p.model;
      const r = await fetch(p.base + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + k }, body: JSON.stringify({ model, messages: msgs, stream: true, stream_options: { include_usage: true } }), signal: ctl.signal });
      if (!r.ok) { const j = await r.json().catch(() => ({})); const m = String((j.error && (j.error.message || j.error)) || r.statusText).slice(0, 240); p.lastError = m; save(); return finish({ type: 'error', message: `${p.name}: ${m}` }); }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = '', usage = null;
      for (;;) {
        const { value, done: d } = await rd.read(); if (d) break; buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue; const s = line.slice(5).trim(); if (s === '[DONE]') continue;
          try { const j = JSON.parse(s); const c = j.choices && j.choices[0] && j.choices[0].delta; if (c && c.content) { text += c.content; emit({ type: 'delta', text: c.content }); } if (j.usage) usage = j.usage; } catch {}
        }
      }
      if (!usage) usage = { total_tokens: Math.ceil((String(o.input || '').length + text.length) / 4) };
      count(p, usage);
      finish({ type: 'done', text, streamed: true, sessionId: null, usage: { input_tokens: usage.prompt_tokens || 0, output_tokens: usage.completion_tokens || 0 }, model });
    })().catch((e) => finish({ type: 'error', message: e.name === 'AbortError' ? 'cancelled' : String(e.message || e).slice(0, 240) }));
    return { child: null, done, kill() { try { ctl.abort(); } catch {} finish({ type: 'error', message: 'cancelled' }); } };
  }

  function add(b) {
    const preset = PRESETS.find((x) => x.kind === b.kind) || PRESETS[PRESETS.length - 1];
    const name = String(b.name || preset.name).trim().slice(0, 40); const base = cleanBase(b.base || preset.base); const model = String(b.model || preset.model).trim().slice(0, 80);
    if (!name) throw new Error('Give it a name.'); if (!okBase(base)) throw new Error('The address must start with https:// (or be localhost).'); if (!model) throw new Error('Choose a model name.');
    const value = String(b.key || '').trim(); const id = slug(name) || 'model'; let uid = id, n = 2; while (get(uid) && !b.id) uid = id + '-' + n++;
    let p = b.id ? get(b.id) : null;
    if (!p) { if (!value) throw new Error('Paste the API key.'); p = { id: uid, kind: preset.kind, name, base, model, added: new Date().toISOString(), usage: { calls: 0, tokens: 0, days: {} }, note: preset.note, var: slug(name).toUpperCase().replace(/-/g, '_') + '_API_KEY' }; db.providers.push(p); }
    else { p.name = name; p.base = base; p.model = model; }
    if (value) { const e = vault.setKey({ service: 'other', name: 'AI · ' + p.name, key: p.var, value, id: p.vaultId || undefined }); p.vaultId = e.id; }
    save(); return pub(p);
  }

  return {
    PRESETS, run, get, keyOf, list: () => db.providers.map(pub), count,
    async handle(req, res, url, pth) {
      if (!pth.startsWith('/api/providers')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (pth === '/api/providers' && req.method === 'GET') return S(200, { presets: PRESETS.map(({ balance, ...x }) => ({ ...x, hasBalance: !!balance })), providers: db.providers.map(pub) });
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (pth === '/api/providers/add') return S(200, { provider: add(b) });
        if (pth === '/api/providers/remove') { const p = get(b.id); if (!p) throw new Error('Not found'); try { if (p.vaultId && b.deleteKey) vault.remove && vault.remove(p.vaultId); } catch {} db.providers = db.providers.filter((x) => x !== p); save(); return S(200, { ok: true }); }
        if (pth === '/api/providers/model') { const p = get(b.id); if (!p) throw new Error('Not found'); p.model = String(b.model || '').trim().slice(0, 80) || p.model; save(); return S(200, { provider: pub(p) }); }
        if (pth === '/api/providers/test') { const p = get(b.id); if (!p) throw new Error('Not found'); let out = ''; const h = run({ provider: p.id, input: 'Reply with exactly: connected.', system: 'You are a connectivity test.' }, (e) => { if (e.type === 'delta') out += e.text; }); const end = await h.done; return S(200, end.type === 'error' ? { ok: false, detail: end.message } : { ok: true, detail: `${end.model} answered: ${out.trim().slice(0, 80)}` }); }
        if (pth === '/api/providers/list-models') { const p = get(b.id); if (!p) throw new Error('Not found'); return S(200, { models: await models(p) }); }
        if (pth === '/api/providers/balance') { const p = get(b.id); if (!p) throw new Error('Not found'); p.balance = await balance(p); save(); return S(200, { balance: p.balance }); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
