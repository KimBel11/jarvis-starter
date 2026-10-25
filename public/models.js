'use strict';
const modelOpts = (list, cur) => (list || []).map((m) => `<option value="${esc(m.id)}" ${m.id === (cur || '') ? 'selected' : ''}>${esc(m.name)}${m.desc ? ' · ' + esc(m.desc.slice(0, 48)) : ''}</option>`).join('');
// AI Models page: Claude and Codex (main), Gemini, and any extra model added by API key (DeepSeek, Kimi, OpenAI, …) with usage and credit,
// plus a table to choose which model every agent uses.
(() => {
const fmtT = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0));
const PCOL = { deepseek: '#4d8bff', kimi: '#7c5cff', openai: '#10a37f', xai: '#cfd6e4', mistral: '#ff8a1f', groq: '#f55036', openrouter: '#9b8cff', perplexity: '#22b8cf', custom: '#8fa0b8' };
let ST = { providers: [], presets: [], usage: null, gem: null, cat: null };

async function loadAll() {
  const [pv, us, gm, cat] = await Promise.all([api('/api/providers').catch(() => ({ providers: [], presets: [] })), api('/api/usage').catch(() => null), api('/api/gemini/status').catch(() => null), api('/api/models').catch(() => null)]);
  ST = { providers: pv.providers, presets: pv.presets, usage: us, gem: gm, cat }; S.providers = pv.providers; S.models = cat || S.models;
}
const sparkline = (days, color) => { const ks = Object.keys(days || {}).sort().slice(-14); if (!ks.length) return '<div class="muted tiny">No calls yet</div>'; const mx = Math.max(1, ...ks.map((k) => days[k].tokens || days[k].calls)); return `<div class="mm-spark">${ks.map((k) => `<i title="${k}: ${days[k].calls} calls, ${fmtT(days[k].tokens)} tokens" style="height:${Math.max(6, Math.round(((days[k].tokens || days[k].calls) / mx) * 100))}%;background:${color}"></i>`).join('')}</div>`; };
function mainCard(kind) {
  const u = ST.usage || {}; const days = u.days || {}; const keys = Object.keys(days).sort().slice(-14); const sum = keys.reduce((a, k) => a + (days[k][kind] || 0), 0); const today = (days[new Date().toISOString().slice(0, 10)] || {})[kind] || 0;
  const ms = Object.entries(u.models || {}).filter(([, m]) => m.agent === kind); const calls = ms.reduce((a, [, m]) => a + m.calls, 0);
  const col = kind === 'claude' ? 'var(--claude)' : 'var(--codex)'; const lim = u.codexLimits; const credit = kind === 'codex' && lim && lim.credits ? (lim.credits.unlimited ? 'unlimited credits' : 'credits: ' + lim.credits.balance) : '';
  const spark = `<div class="mm-spark">${keys.map((k) => { const mx = Math.max(1, ...keys.map((x) => days[x][kind] || 0)); return `<i title="${k}: ${fmtT(days[k][kind] || 0)} tokens" style="height:${Math.max(4, Math.round(((days[k][kind] || 0) / mx) * 100))}%;background:${col}"></i>`; }).join('')}</div>`;
  return `<div class="card mm-card main" style="--c:${col}"><div class="mm-h"><span class="mm-badge" style="background:${col}">${kind === 'claude' ? 'C' : 'X'}</span><div><h3>${kind === 'claude' ? 'Claude' : 'Codex'}</h3><div class="muted tiny">Main model · ${kind === 'claude' ? 'planning, analysis, writing, review' : 'writing and fixing code'}</div></div><span class="tag good">Main</span></div>
    <div class="mm-stats"><div><b>${fmtT(today)}</b><span>tokens today</span></div><div><b>${fmtT(sum)}</b><span>last 14 days</span></div><div><b>${fmtT(calls)}</b><span>calls total</span></div></div>${spark}
    <div class="muted tiny">${credit ? esc(credit) + ' · ' : ''}${ms.map(([n, m]) => `${esc(n)} ${fmtT(m.tokens)}`).join(' · ') || 'No usage found'}</div></div>`;
}
function gemCard() {
  const g = ST.gem || {}; const cat = ST.cat; const opts = g.models && g.models.length ? g.models.map((m) => `<option value="${esc(m.id)}" ${m.id === g.model ? 'selected' : ''}>${esc(m.name)}</option>`).join('') : '';
  return `<div class="card mm-card" style="--c:#a78bfa"><div class="mm-h"><span class="mm-badge" style="background:#a78bfa">G</span><div><h3>Gemini</h3><div class="muted tiny">Google · long documents, web research, study</div></div><span class="tag ${g.configured ? 'good' : ''}">${g.configured ? 'Connected' : 'No key'}</span></div>
    ${g.configured ? `<div class="mm-row"><select class="mini" id="gmModel"><option value="">Auto-pick the best Pro model</option>${opts}</select><button class="btn sm" id="gmTest">Test</button></div><div class="muted tiny" id="gmOut">${g.error ? esc(g.error) : (g.models || []).length + ' models available'}</div>` : `<div class="muted tiny" style="margin:8px 0">Add GEMINI_API_KEY in Vault & keys to turn it on.</div><button class="btn sm" data-go="vault">Open Vault & keys</button>`}</div>`;
}
function provCard(p) {
  const col = PCOL[p.kind] || '#8fa0b8'; const u = p.usage; const b = p.balance;
  const hasBal = (ST.presets.find((x) => x.kind === p.kind) || {}).hasBalance;
  return `<div class="card mm-card" style="--c:${col}" data-pv="${esc(p.id)}"><div class="mm-h"><span class="mm-badge" style="background:${col}">${esc((p.name[0] || '?').toUpperCase())}</span><div><h3>${esc(p.name)}</h3><div class="muted tiny ell">${esc(p.base.replace(/^https?:\/\//, ''))}</div></div><span class="tag ${p.hasKey ? (p.lastError ? 'bad' : 'good') : ''}">${p.hasKey ? (p.lastError ? 'Error' : 'Ready') : 'No key'}</span></div>
    <div class="mm-stats"><div><b>${fmtT(u.today.tokens)}</b><span>tokens today</span></div><div><b>${fmtT(u.week.tokens)}</b><span>7 days · ${u.week.calls} calls</span></div><div><b>${hasBal ? (b ? esc(b.text) : '—') : 'n/a'}</b><span>${hasBal ? 'credit left' : 'no balance API'}</span></div></div>${sparkline(u.days, col)}
    <div class="mm-row"><input class="mini" data-pvm="${esc(p.id)}" value="${esc(p.model)}" placeholder="model name" title="Model used when an agent picks this AI"><button class="btn sm" data-pvlist="${esc(p.id)}">Models…</button></div>
    ${p.lastError ? `<div class="t-err tiny">${esc(p.lastError)}</div>` : ''}
    <div class="mm-row"><button class="btn sm" data-pvtest="${esc(p.id)}">Test</button>${hasBal ? `<button class="btn sm" data-pvbal="${esc(p.id)}">Refresh credit</button>` : ''}<button class="btn sm ghost" data-pvkey="${esc(p.id)}">New key</button><button class="btn sm ghost" data-pvdel="${esc(p.id)}">Remove</button></div><div class="muted tiny" id="pvo-${esc(p.id)}">${esc(p.note || '')}</div></div>`;
}
function engineOptions(cur) {
  const base = [['claude', 'Claude'], ['codex', 'Codex'], ['gemini', 'Gemini'], ['both', 'Claude + Codex']]; const api = ST.providers.filter((p) => p.hasKey).map((p) => ['api:' + p.id, p.name]);
  return [...base, ...api].map(([v, n]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(n)}</option>`).join('');
}
function modelCell(a) {
  const e = a.engine || 'claude'; const cat = ST.cat; const mm = a.models || {};
  if (e === 'both') return `<span class="muted tiny">Claude ${esc((mm.claude || 'default').replace('claude-', ''))} + Codex ${esc(mm.codex || 'default')}</span>`;
  const list = e === 'claude' ? cat && cat.claude.models : e === 'codex' ? cat && cat.codex.models : e === 'gemini' ? cat && cat.gemini.models : null;
  if (list) return `<select class="mini" data-amm="${esc(a.id)}|${e}">${modelOpts(list, mm[e])}</select>`;
  const p = ST.providers.find((x) => 'api:' + x.id === e); return `<input class="mini" data-amm="${esc(a.id)}|${esc(e)}" value="${esc(mm[e] || '')}" placeholder="${esc(p ? p.model : 'model')}">`;
}
function agentTable() {
  const ag = ((S.team && S.team.agents) || []).filter((a) => a.enabled !== false);
  return `<div class="card"><table class="mm-tbl"><tr><th>Agent</th><th>AI</th><th>Model</th></tr>${ag.map((a) => `<tr><td><span style="color:${a.color}">${a.glyph}</span> ${esc(a.name)}${a.main ? ' <span class="tag good">main</span>' : ''}</td><td><select class="mini" data-aen="${esc(a.id)}">${engineOptions(a.engine || 'claude')}</select></td><td>${modelCell(a)}</td></tr>`).join('')}</table>
    <div class="muted tiny" style="margin-top:8px">Extra AIs answer with text only (no file or shell tools), so they suit research, drafting and second opinions. Agents that edit files should stay on Claude or Codex.</div></div>`;
}
function addModal(pre) {
  modal(`<h2 style="font-size:19px;margin-bottom:4px">Add an AI model</h2><div class="muted" style="margin-bottom:12px">Pick a service, paste its API key. The key is encrypted in your Vault and never shown again.</div>
    <div class="mm-presets">${ST.presets.map((p) => `<button class="mm-pre ${pre === p.kind ? 'on' : ''}" data-pre="${p.kind}" style="--c:${PCOL[p.kind] || '#8fa0b8'}">${esc(p.name)}</button>`).join('')}</div>
    <div id="adForm"></div><div id="adMsg" class="tiny" style="min-height:18px;margin-top:8px"></div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="btn" id="adX">Cancel</button><button class="btn primary" id="adGo">Add & test</button></div>`);
  const draw = (kind) => { const p = ST.presets.find((x) => x.kind === kind); if (!p) return; $('#adForm').dataset.kind = kind; document.querySelectorAll('.mm-pre').forEach((b) => b.classList.toggle('on', b.dataset.pre === kind));
    $('#adForm').innerHTML = `<div class="muted tiny" style="margin:8px 0">${esc(p.note)} ${p.keyUrl ? `<a href="${esc(p.keyUrl)}" target="_blank" rel="noopener">Get a key ↗</a>` : ''}</div>
      <div class="field"><label>Name</label><input id="adName" value="${esc(p.name)}"></div><div class="field"><label>API address</label><input id="adBase" value="${esc(p.base)}" placeholder="https://…/v1"></div>
      <div class="field"><label>Model</label><input id="adModel" value="${esc(p.model)}" placeholder="e.g. deepseek-chat"></div><div class="field"><label>API key</label><input id="adKey" type="password" autocomplete="off" placeholder="paste the key"></div>`; };
  draw(pre || 'deepseek'); document.querySelectorAll('.mm-pre').forEach((b) => (b.onclick = () => draw(b.dataset.pre))); $('#adX').onclick = closeModal;
  $('#adGo').onclick = async () => { const msg = $('#adMsg'); msg.textContent = 'Saving…'; try { const r = await post('/api/providers/add', { kind: $('#adForm').dataset.kind, name: $('#adName').value, base: $('#adBase').value, model: $('#adModel').value, key: $('#adKey').value }); msg.textContent = 'Testing the connection…'; const t = await post('/api/providers/test', { id: r.provider.id }); if (!t.ok) { msg.innerHTML = `<span style="color:var(--bad)">Saved, but the test failed: ${esc(t.detail)}</span>`; await loadAll(); return; } toast(r.provider.name + ' is connected'); closeModal(); route(); } catch (e) { msg.innerHTML = `<span style="color:var(--bad)">${esc(e.message)}</span>`; } };
}
async function vModels(v) {
  v.innerHTML = '<div class="skeleton" style="height:220px"></div>'; await Promise.all([loadAll(), S.team ? 0 : loadTeam()]); if (!S.team) await loadTeam();
  v.innerHTML = `<div class="hello"><div><h1>AI Models</h1><div class="sub">Claude and Codex are the main models. Add any other AI with its API key and see what each one is using.</div></div><div class="pill-row"><button class="btn primary" id="mmAdd">＋ Add an AI model</button></div></div>
    <div class="sec-h"><h2>Main models</h2></div><div class="grid g2">${mainCard('claude')}${mainCard('codex')}</div>
    <div class="sec-h"><h2>More models</h2><span class="muted">added by API key</span></div><div class="grid g2">${gemCard()}${ST.providers.map(provCard).join('')}<div class="card mm-card mm-new" id="mmAdd2"><div style="font-size:30px;line-height:1">＋</div><div><b>Add DeepSeek, Kimi, OpenAI, Grok…</b><div class="muted tiny">or any OpenAI-compatible service</div></div></div></div>
    <div class="sec-h"><h2>Which AI each agent uses</h2><span class="muted">saved instantly</span></div><div id="mmAgents">${agentTable()}</div>`;
  $('#mmAdd').onclick = () => addModal(); $('#mmAdd2').onclick = () => addModal();
  const gm = $('#gmModel'); if (gm) gm.onchange = async () => { await post('/api/gemini/model', { model: gm.value }); toast('Gemini model saved'); };
  const gt = $('#gmTest'); if (gt) gt.onclick = async () => { $('#gmOut').textContent = 'Testing…'; const r = await post('/api/gemini/test').catch((e) => ({ ok: false, detail: e.message })); $('#gmOut').innerHTML = `<span style="color:var(--${r.ok ? 'good' : 'bad'})">${r.ok ? '✓' : '✕'} ${esc(r.detail)}</span>`; };
  v.onchange = async (e) => {
    const m = e.target.closest('[data-pvm]'); if (m) { await post('/api/providers/model', { id: m.dataset.pvm, model: m.value }).catch((x) => toast(x.message)); return toast('Model saved'); }
    const en = e.target.closest('[data-aen]'); if (en) { await post('/api/team/agent', { id: en.dataset.aen, engine: en.value }).catch((x) => toast(x.message)); await loadTeam(); $('#mmAgents').innerHTML = agentTable(); return toast('Saved'); }
    const am = e.target.closest('[data-amm]'); if (am) { const [id, eng] = am.dataset.amm.split('|'); await post('/api/team/agent', { id, models: { [eng]: am.value } }).catch((x) => toast(x.message)); await loadTeam(); return toast('Model saved'); }
  };
  v.onclick = async (e) => {
    const g = (a) => { const el = e.target.closest('[' + a + ']'); return el && el.getAttribute(a); };
    let id;
    if ((id = g('data-pvtest'))) { const o = $('#pvo-' + id); o.textContent = 'Testing…'; const r = await post('/api/providers/test', { id }).catch((x) => ({ ok: false, detail: x.message })); o.innerHTML = `<span style="color:var(--${r.ok ? 'good' : 'bad'})">${r.ok ? '✓' : '✕'} ${esc(r.detail)}</span>`; }
    else if ((id = g('data-pvbal'))) { const o = $('#pvo-' + id); o.textContent = 'Checking credit…'; const r = await post('/api/providers/balance', { id }).catch((x) => ({ error: x.message })); if (r.balance) { await vModels(v); } else o.textContent = r.error || 'This service did not return a balance.'; }
    else if ((id = g('data-pvlist'))) { const o = $('#pvo-' + id); o.textContent = 'Loading models…'; const r = await post('/api/providers/list-models', { id }).catch((x) => ({ error: x.message })); if (r.models) { const inp = document.querySelector(`[data-pvm="${id}"]`); o.innerHTML = r.models.slice(0, 60).map((m) => `<button class="chip-btn" data-pvpick="${esc(id)}|${esc(m)}">${esc(m)}</button>`).join(' '); } else o.textContent = r.error; }
    else if ((id = g('data-pvpick'))) { const [pid, mod] = id.split('|'); await post('/api/providers/model', { id: pid, model: mod }); const inp = document.querySelector(`[data-pvm="${pid}"]`); if (inp) inp.value = mod; toast('Model saved'); }
    else if ((id = g('data-pvkey'))) { const k = prompt('Paste the new API key'); if (k) { const p = ST.providers.find((x) => x.id === id); await post('/api/providers/add', { id, name: p.name, base: p.base, model: p.model, kind: p.kind, key: k }).catch((x) => toast(x.message)); toast('Key replaced'); vModels(v); } }
    else if ((id = g('data-pvdel'))) { if (confirm('Remove this AI model from Jarvis? Agents using it fall back to Claude. The key stays in your Vault.')) { await post('/api/providers/remove', { id }); const ag = (S.team && S.team.agents || []).filter((a) => a.engine === 'api:' + id); for (const a of ag) await post('/api/team/agent', { id: a.id, engine: 'claude' }).catch(() => {}); await loadTeam(); vModels(v); } }
  };
}
window.PAGES.models = vModels;
if (!NAV.some((n) => n[0] === 'models')) { const i = NAV.findIndex((n) => n[0] === 'team'); NAV.splice(i + 1, 0, ['models', '◇', 'AI Models']); }

/* API providers as engine choices in the team page engine box */
const _eb = window.engineBox;
window.engineBox = function (a, cat) {
  let h = _eb(a, cat); const provs = (S.providers || []).filter((p) => p.hasKey); if (!provs.length) return h; const e = a.engine || 'claude';
  h = h.replace(/(<div class="seg" data-ebe="[^"]*">)([\s\S]*?)(<\/div>)/, (m, a1, a2, a3) => a1 + a2 + provs.map((p) => `<button data-v="api:${esc(p.id)}" class="${e === 'api:' + p.id ? 'on' : ''}">${esc(p.name.split(' ')[0])}</button>`).join('') + a3);
  const cur = provs.find((p) => 'api:' + p.id === e); if (cur) h = h.replace(/(<div class="eb-why">|<\/div>\s*$)/, `<div class="eb-row"><span class="eb-t" style="color:${PCOL[cur.kind] || '#8fa0b8'}">${esc(cur.name)}</span><input class="mini" data-ebm="${esc(a.id)}|api:${esc(cur.id)}" value="${esc((a.models || {})['api:' + cur.id] || '')}" placeholder="${esc(cur.model)}"></div>$1`);
  return h;
};
(async () => { try { const r = await api('/api/providers'); S.providers = r.providers; } catch {} })();
})();
