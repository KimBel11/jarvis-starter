'use strict';
// Google Gemini engine (REST). The API key comes from the encrypted vault and never reaches the browser.
// Used by agents whose engine is "gemini": text in, streamed text out, optional Google Search grounding and file attachments.
const fs = require('fs');
const path = require('path');

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_RE = /^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|GEMINI_KEY)$/i;
const MIME = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.heic': 'image/heic' };
const TEXT = /\.(txt|md|csv|json|tex|html|py|js|ts)$/i;

module.exports = function makeGemini(ctx, vault) {
  const SET = path.join(ctx.DATA, 'gemini.json');
  let cfg = { model: '' }; try { cfg = { ...cfg, ...JSON.parse(fs.readFileSync(SET, 'utf8')) }; } catch {}
  const save = () => { try { fs.mkdirSync(ctx.DATA, { recursive: true }); fs.writeFileSync(SET, JSON.stringify(cfg)); } catch {} };
  const key = () => { try { return vault.find(KEY_RE) || vault.findInService('gemini', /KEY|TOKEN/i); } catch { return null; } };
  const history = new Map(); // sessionId -> [{role, parts}]
  let modelsCache = null;

  async function listModels(force) {
    if (!force && modelsCache && Date.now() - modelsCache.at < 600000) return modelsCache.list;
    const k = key(); if (!k) throw new Error('No Gemini API key in the vault. Add GEMINI_API_KEY in Vault & keys.');
    const r = await fetch(`${API}/models?pageSize=100&key=${encodeURIComponent(k)}`, { signal: AbortSignal.timeout(20000) }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('Gemini: ' + String((j.error && j.error.message) || r.statusText).slice(0, 200));
    const list = (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /^models\/gemini/.test(m.name)).map((m) => ({ id: m.name.replace(/^models\//, ''), name: m.displayName || m.name, desc: (m.description || '').slice(0, 140), inputLimit: m.inputTokenLimit }));
    list.sort((a, b) => b.id.localeCompare(a.id)); modelsCache = { at: Date.now(), list }; return list;
  }
  async function pickModel() { if (cfg.model) return cfg.model; const l = await listModels(); const pick = l.find((m) => /pro/.test(m.id) && !/preview|exp|vision|image|tts|live|thinking/.test(m.id)) || l.find((m) => /flash/.test(m.id) && !/preview|exp|image|tts|live|lite/.test(m.id)) || l[0]; if (!pick) throw new Error('No Gemini text models available for this key'); return pick.id; }

  function attachParts(paths, root) {
    const parts = []; let total = 0;
    for (const p of (paths || []).slice(0, 4)) {
      const f = path.resolve(String(p)); if (!ctx.inside(f, root) || !fs.existsSync(f)) continue; const st = fs.statSync(f); if (!st.isFile()) continue; total += st.size; if (total > 18 * 1024 * 1024) break;
      const ext = path.extname(f).toLowerCase();
      if (MIME[ext]) parts.push({ inline_data: { mime_type: MIME[ext], data: fs.readFileSync(f).toString('base64') } }, { text: `(attached file: ${path.basename(f)})` });
      else if (TEXT.test(f) && st.size < 400 * 1024) parts.push({ text: `--- ${path.basename(f)} ---\n${fs.readFileSync(f, 'utf8')}` });
    }
    return parts;
  }

  // Same contract as runner.spawnAgent: returns { done, kill } and emits session | delta | warn | done | error events
  function run(o, onEvent) {
    const ctl = new AbortController(); let finished = false, text = '';
    const emit = (e) => { try { onEvent(e); } catch {} };
    let resolveDone; const done = new Promise((r) => (resolveDone = r));
    const finish = (e) => { if (finished) return; finished = true; emit(e); resolveDone(e); };
    (async () => {
      const k = key(); if (!k) return finish({ type: 'error', message: 'No Gemini API key in the vault. Open Vault & keys and add GEMINI_API_KEY.' });
      const sid = o.sessionId && history.has(o.sessionId) ? o.sessionId : 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      emit({ type: 'session', id: sid });
      const model = o.model || (await pickModel());
      const hist = history.get(sid) || [];
      const userParts = [...attachParts(o.attach, o.attachRoot || ctx.DRIVE), { text: String(o.input || '') }];
      const body = { contents: [...hist, { role: 'user', parts: userParts }], generationConfig: { temperature: 0.7 } };
      if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
      if (o.search) body.tools = [{ google_search: {} }];
      const r = await fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(k)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      if (!r.ok) { const j = await r.json().catch(() => ({})); return finish({ type: 'error', message: 'Gemini: ' + String((j.error && j.error.message) || r.statusText).slice(0, 240) }); }
      const rd = r.body.getReader(); const dec = new TextDecoder(); let buf = ''; let usage = null;
      for (;;) {
        const { value, done: d } = await rd.read(); if (d) break; buf += dec.decode(value, { stream: true }); let i;
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line.startsWith('data:')) continue;
          let j; try { j = JSON.parse(line.slice(5)); } catch { continue; }
          const c = j.candidates && j.candidates[0]; const t = c && c.content && (c.content.parts || []).map((p) => p.text || '').join(''); if (t) { text += t; emit({ type: 'delta', text: t }); }
          if (j.usageMetadata) usage = j.usageMetadata; if (c && c.finishReason && c.finishReason !== 'STOP' && c.finishReason !== 'MAX_TOKENS') emit({ type: 'warn', message: 'Gemini stopped: ' + c.finishReason });
        }
      }
      if (text) { hist.push({ role: 'user', parts: [{ text: String(o.input || '') }] }, { role: 'model', parts: [{ text }] }); history.set(sid, hist.slice(-24)); }
      finish({ type: 'done', text, streamed: true, sessionId: sid, usage, model });
    })().catch((e) => finish({ type: 'error', message: e.name === 'AbortError' ? 'cancelled' : String(e.message || e).slice(0, 240) }));
    return { child: null, done, kill() { try { ctl.abort(); } catch {} finish({ type: 'error', message: 'cancelled' }); } };
  }

  return {
    key, run, listModels, pickModel,
    async status() { const k = !!key(); let models = [], error = null; if (k) { try { models = await listModels(); } catch (e) { error = e.message; } } return { configured: k, model: cfg.model || null, models, error }; },
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true);
      if (!p.startsWith('/api/gemini')) return false;
      try {
        if (p === '/api/gemini/status') return S(200, await this.status());
        if (p === '/api/gemini/model' && req.method === 'POST') { const b = await ctx.readBody(req); cfg.model = /^[a-z0-9.\-]{3,60}$/i.test(b.model || '') ? b.model : ''; save(); return S(200, { model: cfg.model }); }
        if (p === '/api/gemini/test' && req.method === 'POST') { let out = ''; const h = run({ input: 'Reply with exactly: Gemini is connected.', system: 'You are a connectivity test.' }, (e) => { if (e.type === 'delta') out += e.text; }); const end = await h.done; return end.type === 'error' ? S(200, { ok: false, detail: end.message }) : S(200, { ok: true, detail: `${end.model} answered: ${out.trim().slice(0, 80)}` }); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
