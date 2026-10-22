'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtN = (n) => (n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n || 0)));
const fmtB = (b) => (b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B');
const ago = (t) => { const s = (Date.now() - (typeof t === 'string' ? Date.parse(t) : t)) / 1000; if (!(s >= 0)) return '—'; if (s < 90) return 'just now'; if (s < 3600) return Math.round(s / 60) + 'm ago'; if (s < 86400) return Math.round(s / 3600) + 'h ago'; if (s < 86400 * 14) return Math.round(s / 86400) + 'd ago'; return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
const ICON = { image: '🖼️', video: '🎬', audio: '🎵', doc: '📄', code: '⌨️', other: '📦' };
// Remote (phone) sessions: sensitive actions ask for the passphrase again (valid 5 min), then the action is retried automatically.
function askStepUp() {
  return new Promise((resolve, reject) => {
    modal(`<h2 style="font-size:19px;margin-bottom:4px">Confirm it's you</h2><div class="muted" style="margin-bottom:14px">This action needs your Jarvis passphrase again. It stays unlocked for 5 minutes.</div><div class="field"><input id="suPass" type="password" autocomplete="current-password" placeholder="Passphrase"></div><div id="suErr" class="t-err" hidden></div><div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px"><button class="btn" id="suX">Cancel</button><button class="btn primary" id="suGo">Confirm</button></div>`);
    const inp = $('#suPass'); inp.focus();
    const go = async () => { try { const r = await fetch('/api/remote/stepup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ passphrase: inp.value }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Wrong passphrase'); closeModal(); resolve(); } catch (e) { const el = $('#suErr'); el.hidden = false; el.textContent = e.message; inp.select(); } };
    $('#suGo').onclick = go; inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
    $('#suX').onclick = () => { closeModal(); reject(new Error('Cancelled')); };
  });
}
const api = async (u, opt) => {
  const r = await fetch(u, opt); const j = await r.json().catch(() => ({}));
  if (r.status === 401 && j.login) { try { const t = +sessionStorage.getItem('reloadAt') || 0; if (Date.now() - t > 15000) { sessionStorage.setItem('reloadAt', Date.now()); location.reload(); } } catch { location.reload(); } throw new Error('Please sign in again'); }
  if (r.status === 403 && j.stepup && !(opt && opt._retried)) { await askStepUp(); return api(u, { ...(opt || {}), _retried: true }); }
  if (!r.ok) throw new Error(j.error || r.statusText);
  return j;
};
const post = (u, b) => api(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) });
const fileUrl = (p) => '/api/file?p=' + encodeURIComponent(p);
function toast(m) { const t = $('#toast'); t.textContent = m; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200); }

const S = { running: [], projects: [], pins: [], health: null, usage: null, sessions: null, agents: null, media: null, q: '', range: 30, sessFilter: 'all' };
const pinSet = () => new Set(S.pins.map((p) => p.path));
const proj = (id) => S.projects.find((p) => p.id === id);
const pcolor = (id) => (proj(id) || {}).color || '#6b7a93';
const pname = (id) => (proj(id) || {}).name || 'Other';

const NAV = [
  ['home', '✦', 'Home'], ['overview', '◉', 'Dashboard'], ['projects', '▦', 'Projects'], ['social', '▣', 'Social & key files'], ['obsidian', '◇', 'Obsidian'],
  ['sec', 'Team'], ['team', '⬡', 'Agent team'], ['council', '⚖', 'Council'], ['video', '◈', 'Video Intel'], ['voice', '♪', 'Voice studio'],
  ['sec', 'Connections'], ['vault', '⛨', 'Vault & keys'], ['platforms', '✺', 'Platforms'], ['agents', '⚙', 'Plugins & skills'], ['mobile', '▯', 'iPhone & remote'], ['health', '✚', 'System check'],
  ['sec', 'Insights'], ['usage', '◔', 'Usage'], ['sessions', '≣', 'Sessions'],
];
function renderNav() {
  const cur = location.hash.slice(2).split('/')[0] || 'control';
  $('#nav').innerHTML = NAV.map((n) => n[0] === 'sec' ? `<div class="sec">${n[1]}</div>` : `<a data-r="${n[0]}" class="${cur === n[0] || (cur === 'project' && n[0] === 'projects') ? 'on' : ''}"><span class="ic">${n[1]}</span>${n[2]}</a>`).join('') +
    `<div class="sec">Projects</div>` + S.projects.map((p) => `<a data-r="project/${p.id}" class="${location.hash === '#/project/' + p.id ? 'on' : ''}"><span class="dot" style="background:${p.color}"></span>${esc(p.name)}</a>`).join('');
  $('#nav').onclick = (e) => { const a = e.target.closest('a'); if (a) location.hash = '#/' + a.dataset.r; };
}
function renderStatus() {
  const h = S.health; if (!h) return;
  const c = (label, ok, warn) => `<span class="chip ${ok ? 'ok' : warn ? 'warn' : 'bad'}"><i></i>${label}</span>`;
  $('#agentStatus').innerHTML = `<div class="pill-row">${c('Claude Code', h.claude.cli)}${c('Codex ' + (h.codex.cli || h.codex.app ? '' : '(data only)'), h.codex.cli || h.codex.app, h.codex.data)}${c('Drive', h.drive)}</div>`;
  const ix = h.index; $('#indexStatus').innerHTML = ix.ready ? `Indexed ${ix.files.claude} Claude + ${ix.files.codex} Codex sessions` : `Indexing usage… ${ix.progress}/${ix.total}<div class="progress"><i style="width:${ix.total ? (ix.progress / ix.total) * 100 : 5}%"></i></div>`;
}

/* ---------- charts ---------- */
function barChart(el, days, keys, colors) {
  const W = 760, H = 210, pl = 40, pb = 24, pt = 8, n = days.length;
  const max = Math.max(1, ...days.map((d) => keys.reduce((s, k) => s + (d[k] || 0), 0)));
  const bw = (W - pl) / n, ticks = 4;
  let g = '';
  for (let i = 0; i <= ticks; i++) { const y = pt + (H - pb - pt) * (1 - i / ticks); g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" stroke="var(--line)" /><text x="${pl - 6}" y="${y + 4}" text-anchor="end" fill="var(--dim)" font-size="10">${fmtN((max * i) / ticks)}</text>`; }
  days.forEach((d, i) => {
    let y = H - pb; const x = pl + i * bw + bw * 0.14, w = bw * 0.72;
    keys.forEach((k, ki) => { const h = ((d[k] || 0) / max) * (H - pb - pt); y -= h; if (h > 0) g += `<rect class="b" style="--k:${i}" x="${x}" y="${y}" width="${w}" height="${h}" rx="2.5" fill="${colors[ki]}" opacity=".92" />`; });
    g += `<rect data-i="${i}" x="${pl + i * bw}" y="0" width="${bw}" height="${H - pb}" fill="transparent" />`;
    if (n <= 16 || i % Math.ceil(n / 10) === 0) g += `<text x="${x + w / 2}" y="${H - 7}" text-anchor="middle" fill="var(--dim)" font-size="10">${d.label}</text>`;
  });
  el.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${g}</svg>`;
  el.onmousemove = (e) => {
    const r = e.target.closest('rect[data-i]'); let t = $('.tip'); if (!r) { if (t) t.remove(); return; }
    const d = days[+r.dataset.i]; if (!t) { t = document.createElement('div'); t.className = 'tip'; document.body.appendChild(t); }
    t.innerHTML = `<b>${d.full}</b><br>` + keys.map((k, i) => `<span style="color:${colors[i]}">●</span> ${k}: ${fmtN(d[k] || 0)}`).join('<br>'); t.style.left = e.clientX + 14 + 'px'; t.style.top = e.clientY + 14 + 'px';
  };
  el.onmouseleave = () => { const t = $('.tip'); if (t) t.remove(); };
}
function dayList(usage, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5); const k = d.toLocaleDateString('sv-SE'); const u = usage.days[k] || {}; out.push({ claude: u.claude || 0, codex: u.codex || 0, label: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), full: d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }); }
  return out;
}
const sum = (days, k) => days.reduce((s, d) => s + d[k], 0);
const legend = () => `<div class="legend"><span><i style="background:var(--claude)"></i>Claude</span><span><i style="background:var(--codex)"></i>Codex</span></div>`;

/* ---------- views ---------- */
function projCard(p) {
  const sc = p.scan; const ses = (S.sessions || []).filter((s) => s.project === p.id);
  const kinds = sc ? Object.entries(sc.kinds) : []; const tot = kinds.reduce((s, [, v]) => s + v, 0) || 1;
  const kc = { image: '#c77dff', video: '#ff6a3d', doc: '#5b8cff', code: '#35d49a', audio: '#ffc233', model: '#ff9d3d', other: '#4b566b' };
  return `<div class="card hover pcard" style="--c:${p.color}" data-go="project/${p.id}">
    <div class="card-h"><div><div class="name">${esc(p.name)}</div><div class="muted tiny">${esc(p.description || '')}</div><div class="muted tiny mono">${esc(p.path.replace('/Volumes/', ''))}</div></div>${p.exists ? '' : '<span class="tag">missing</span>'}</div>
    ${sc ? `<div class="kv"><div><b>${fmtN(sc.files)}${sc.truncated ? '+' : ''}</b><span>files</span></div><div><b>${fmtB(sc.bytes)}</b><span>size</span></div><div><b>${ses.length || '—'}</b><span>AI sessions</span></div></div>
    <div class="bar">${kinds.map(([k, v]) => `<i style="width:${(v / tot) * 100}%;background:${kc[k]}" title="${k}: ${v}"></i>`).join('')}</div>
    <div class="muted tiny" style="margin-top:10px">Last change ${sc.recent[0] ? ago(sc.recent[0].mtime) + ' · ' + esc(sc.recent[0].rel.split('/').pop()) : '—'}</div>`
    : `<div class="kv"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div><div class="muted tiny">Scanning folder…</div>`}</div>`;
}
function sessRow(s) {
  return `<div class="row click" data-sess="${esc(s.id)}"><span class="tag ${s.agent}">${s.agent === 'claude' ? 'Claude' : 'Codex'}</span><div class="grow"><div class="t">${esc(s.title)}</div><div class="muted tiny">${s.project ? `<span style="color:${pcolor(s.project)}">● ${esc(pname(s.project))}</span> · ` : ''}${ago(s.end)} · ${fmtN(s.tokens)} tokens</div></div></div>`;
}
function fileRow(f, pinned) {
  return `<div class="row click" data-open="${esc(f.path)}"><div class="ficon">${ICON[f.kind] || '📦'}</div><div class="grow"><div class="t">${esc(f.rel.split('/').pop())}</div><div class="muted tiny t">${esc(f.rel)}</div></div><span class="muted tiny">${ago(f.mtime)}</span></div>`;
}

function vOverview(v) {
  const u = S.usage, ses = S.sessions || [];
  const days = u ? dayList(u, 14) : [];
  const week = u ? dayList(u, 7) : [];
  const lim = u && u.codexLimits && u.codexLimits.primary;
  const hr = new Date().getHours(); const greet = hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const allRecent = S.projects.flatMap((p) => ((p.scan && p.scan.recent) || []).map((f) => ({ ...f, project: p.id }))).sort((a, b) => b.mtime - a.mtime).slice(0, 8);
  const activeToday = ses.filter((s) => Date.now() - Date.parse(s.end) < 864e5).length;
  v.innerHTML = `
  <section class="jhero">
    <div class="jhero-orb" id="heroOrbBox" title="Talk to Jarvis"><canvas id="heroOrb"></canvas></div>
    <div class="jhero-main">
      <h1>${greet}, @@NAME@@.</h1>
      <div class="sub" style="margin-bottom:14px">${S.projects.length} projects · ${activeToday} AI session${activeToday === 1 ? '' : 's'} in the last 24h · ${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</div>
      <form class="askbar" id="askForm"><button type="button" class="mic" id="askMic" title="Talk to Jarvis"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button><input id="askInput" autocomplete="off" placeholder="Ask Jarvis, or say “open usage”, “start Claude in my project”…"><button class="btn primary">Ask</button></form>
      <div class="pill-row" style="margin-top:12px">${['What changed in my projects today?', 'Which project needs attention?', 'Summarize my project status'].map((q) => `<button class="chip-btn" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}${S.projects.map((p) => `<button class="btn sm claude" data-launch="claude:${p.id}" title="Open Claude Code in ${esc(p.name)}">▶ Claude · ${esc(p.name)}</button>`).join('')}</div>
    </div>
  </section>
  <div class="card live" style="margin-bottom:16px"><div class="card-h"><h2><span class="live-dot"></span> Live agents</h2><span class="muted">running right now on this Mac</span></div><div id="liveBox">${liveHtml()}</div></div>
  <div class="grid g5" style="margin-bottom:16px">
    <div class="card stat"><div class="k">Projects</div><div class="v">${S.projects.length}</div><div class="d">${S.projects.filter((p) => p.exists).length} on disk</div></div>
    <div class="card stat"><div class="k">Tokens · 7 days</div><div class="v">${u ? fmtN(sum(week, 'claude') + sum(week, 'codex')) : '…'}</div><div class="d">${u ? `<span style="color:var(--claude)">${fmtN(sum(week, 'claude'))}</span> Claude · <span style="color:var(--codex)">${fmtN(sum(week, 'codex'))}</span> Codex` : 'indexing'}</div></div>
    <div class="card stat"><div class="k">Sessions</div><div class="v">${ses.length || '…'}</div><div class="d">${ses.filter((s) => s.agent === 'claude').length} Claude · ${ses.filter((s) => s.agent === 'codex').length} Codex</div></div>
    <div class="card stat"><div class="k">Skills</div><div class="v">${S.agents ? S.agents.claude.skills.length + S.agents.codex.skills.length : '…'}</div><div class="d">${S.agents ? S.agents.claude.skills.length + ' Claude · ' + S.agents.codex.skills.length + ' Codex' : ''}</div></div>
    <div class="card stat"><div class="k">Codex weekly limit</div><div class="v">${lim ? Math.round(lim.used_percent) + '%' : '—'}</div><div class="d">${lim && lim.resets_at ? 'resets ' + new Date(lim.resets_at * 1000).toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' }) : 'as of last session'}</div></div>
  </div>
  <div class="grid g2" style="margin-bottom:16px">${S.projects.map(projCard).join('')}</div>
  <div class="grid g-main">
    <div class="card"><div class="card-h"><h2>Token usage · last 14 days</h2>${legend()}</div><div id="ovChart">${u ? '' : '<div class="skeleton" style="height:200px"></div>'}</div></div>
    <div class="card"><div class="card-h"><h2>Recent sessions</h2><a data-go="sessions" style="cursor:pointer">All →</a></div>${ses.slice(0, 6).map(sessRow).join('') || '<div class="empty">Indexing sessions…</div>'}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-h"><h2>Latest file activity</h2><span class="muted">across all projects</span></div>${allRecent.map((f) => fileRow(f)).join('') || '<div class="empty">Scanning…</div>'}</div>
    <div class="card"><div class="card-h"><h2>★ Pinned key files</h2><a data-go="social" style="cursor:pointer">Manage →</a></div>${S.pins.length ? S.pins.slice(0, 8).map((p) => fileRow({ path: p.path, rel: p.path.split('/').slice(-3).join('/'), mtime: p.at, kind: 'doc' })).join('') : '<div class="empty">Pin the files you need most from <a data-go="social" style="cursor:pointer">Social & key files</a>.</div>'}</div>
  </div>`;
  if (u) barChart($('#ovChart'), days, ['claude', 'codex'], ['var(--claude)', 'var(--codex)']);
  const ho = $('#heroOrb'); if (ho) new Orb(ho);
  $('#heroOrbBox').onclick = () => Jarvis.orbTap();
  $('#askForm').onsubmit = (e) => { e.preventDefault(); const q = $('#askInput').value; if (q.trim()) { if (Jarvis.st.agentId !== 'kim') Jarvis.setAgent('kim'); Jarvis.send(q, false); } };
  $('#askMic').onclick = () => Jarvis.startListening();
}

function liveHtml() {
  const seen = new Set(); const list = (S.running || []).filter((r) => { if (!r.cwd || r.cwd === '/' || r.cwd.includes('.app/')) return false; const k = r.agent + '|' + r.cwd; if (seen.has(k)) return false; seen.add(k); return true; });
  if (!list.length) return '<div class="muted" style="padding:8px 0">No agent processes running. Start one from a project, or ask Jarvis.</div>';
  const up = (s) => (s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + 'm' : s < 172800 ? Math.round(s / 3600) + 'h' : Math.round(s / 86400) + 'd');
  return list.map((r) => `<div class="row"><span class="live-dot ${r.agent}"></span><span class="tag ${r.agent}">${r.agent === 'claude' ? 'Claude' : 'Codex'}</span><div class="grow"><div class="t">${r.project ? `<span style="color:${pcolor(r.project)}">● ${esc(pname(r.project))}</span>` : esc((r.cwd || '').split('/').slice(-2).join('/') || 'unknown folder')}</div><div class="muted tiny t">${esc(r.via)} · up ${up(r.seconds)} · pid ${r.pid}</div></div>${r.cwd ? `<button class="btn sm ghost" data-reveal="${esc(r.cwd)}">Folder</button>` : ''}</div>`).join('');
}

function vProjects(v) {
  v.innerHTML = `<div class="hello"><div><h1>Projects</h1><div class="sub">Everything you're building, in one place.</div></div><button class="btn primary" id="np2">＋ New project</button></div>
  <div class="grid g2">${S.projects.map(projCard).join('')}</div>
`;
  $('#np2').onclick = newProjectModal;
}

function vProject(v, id) {
  const p = proj(id); if (!p) return (v.innerHTML = '<div class="empty">Project not found.</div>');
  const sc = p.scan; const ses = (S.sessions || []).filter((s) => s.project === id);
  const pins = S.pins.filter((x) => x.path.startsWith(p.path));
  const u = S.usage && S.usage.byProject[id];
  const maxF = sc ? Math.max(...sc.folders.map((f) => f.files), 1) : 1;
  const lastSes = ses[0];
  v.innerHTML = `<div class="muted tiny" style="margin-bottom:10px"><a data-go="projects" style="cursor:pointer">← Projects</a></div>
  <section class="hero" style="--c:${p.color}">
    <div class="hero-main">
      <div class="project-heading"><div class="hero-eyebrow">PROJECT</div><button class="btn sm ghost" id="editProj" aria-label="Edit project">✎ Edit</button></div>
      <h1 class="hero-title">${esc(p.name)}</h1>
      <p class="hero-desc">${p.description ? esc(p.description) : '<span class="dim">No description yet. Add one so you (and the agents) remember what this is.</span>'}</p>
      <div class="muted tiny mono" style="margin-bottom:18px">${esc(p.path)}</div>
      <div class="pill-row"><button class="btn primary" data-convos="${id}">💬 Conversations</button><button class="btn claude" data-launch="claude:${id}">▶ Claude Code</button><button class="btn codex" data-launch="codex:${id}">▶ Codex</button><button class="btn" data-launch="terminal:${id}">Terminal</button></div>
    </div>
    <div class="hero-side">
      <div class="hero-stat"><b>${sc ? fmtN(sc.files) + (sc.truncated ? '+' : '') : '…'}</b><span>files · ${sc ? fmtB(sc.bytes) : ''}</span></div>
      <div class="hero-stat"><b>${ses.length}</b><span>AI sessions${lastSes ? ' · last ' + ago(lastSes.end) : ''}</span></div>
      <div class="hero-stat"><b>${u ? fmtN(u.claude + u.codex) : '—'}</b><span>tokens used</span></div>
    </div>
  </section>
  <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>★ Important files</h2><button class="btn sm" id="editRules">Edit rules</button></div><div id="impBox"><div class="skeleton" style="height:90px"></div></div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card stat"><div class="k">Files</div><div class="v">${sc ? fmtN(sc.files) + (sc.truncated ? '+' : '') : '…'}</div><div class="d">${sc ? fmtB(sc.bytes) : ''}</div></div>
    <div class="card stat"><div class="k">AI sessions</div><div class="v">${ses.length}</div><div class="d">${ses.filter((s) => s.agent === 'claude').length} Claude · ${ses.filter((s) => s.agent === 'codex').length} Codex</div></div>
    <div class="card stat"><div class="k">Tokens used</div><div class="v">${u ? fmtN(u.claude + u.codex) : '—'}</div><div class="d">${u ? `${fmtN(u.claude)} Claude · ${fmtN(u.codex)} Codex` : ''}</div></div>
    <div class="card stat"><div class="k">Key files pinned</div><div class="v">${pins.length}</div><div class="d">${sc ? `${(sc.kinds.video || 0)} videos · ${(sc.kinds.image || 0)} images` : ''}</div></div>
  </div>
  <div class="grid g-main">
    <div class="card"><div class="card-h"><h2>Folders</h2><span class="muted">sorted by latest change</span></div>
      ${sc ? sc.folders.map((f) => `<div class="row click" data-reveal="${esc(p.path + '/' + f.name)}"><div class="ficon">📁</div><div class="grow"><div class="t">${esc(f.name)}</div><div class="bar" style="margin-top:6px;height:4px"><i style="width:${(f.files / maxF) * 100}%;background:${p.color}"></i></div></div><div style="text-align:right"><div class="tiny">${fmtN(f.files)} files · ${fmtB(f.bytes)}</div><div class="muted tiny">${ago(f.last)}</div></div></div>`).join('') : '<div class="skeleton" style="height:120px"></div>'}</div>
    <div class="card"><div class="card-h"><h2>AI sessions</h2></div>${ses.slice(0, 7).map(sessRow).join('') || '<div class="empty">No sessions yet for this project.</div>'}</div>
  </div>
  <div class="grid g2" style="margin-top:16px">
    <div class="card"><div class="card-h"><h2>Recently changed</h2></div>${sc ? sc.recent.slice(0, 14).map((f) => fileRow(f)).join('') : ''}</div>
    <div class="card"><div class="card-h"><h2>★ Key files</h2></div>${pins.map((x) => fileRow({ path: x.path, rel: x.path.replace(p.path + '/', ''), mtime: x.at, kind: 'doc' })).join('') || '<div class="empty">Nothing pinned yet. Pin from Social & key files.</div>'}</div>
  </div>`;
  $('#editProj').onclick = () => editProjectModal(p);
  $('#editRules').onclick = () => rulesModal(p);
  loadImportant(p);
}
async function loadImportant(p) {
  const box = $('#impBox'); if (!box) return;
  try {
    const r = await api('/api/important?project=' + p.id); if (!$('#impBox')) return;
    const pins = pinSet();
    box.innerHTML = (r.scanning ? '<div class="muted tiny" style="margin-bottom:8px">Still scanning, results will fill in…</div>' : '') +
      `<div class="grid g3">${r.rules.map((ru) => `<div class="rule"><div class="rule-h"><b>${esc(ru.label)}</b><span class="tag">${ru.count}</span></div><div class="muted tiny mono t" title="${esc(ru.pattern)}">/${esc(ru.pattern)}/ ${ru.kinds && ru.kinds.length ? '· ' + ru.kinds.join(', ') : ''}${ru.valid ? '' : ' · <span style="color:var(--bad)">invalid pattern</span>'}</div>
        ${ru.files.slice(0, 6).map((f) => `<div class="row click" data-open="${esc(f.path)}"><div class="ficon">${ICON[f.kind] || '📦'}</div><div class="grow"><div class="t">${esc(f.rel.split('/').pop())}</div><div class="muted tiny t">${esc(f.rel)}</div></div><button class="pin-btn ${pins.has(f.path) ? 'on' : ''}" data-pin="${esc(f.path)}" title="Pin">★</button></div>`).join('') || '<div class="muted tiny" style="padding:10px 0">No matches yet.</div>'}
        ${ru.count > 6 ? `<div class="muted tiny" style="padding-top:6px">+ ${ru.count - 6} more, newest first</div>` : ''}</div>`).join('') || '<div class="empty">No rules. Click “Edit rules” to add one.</div>'}</div>`;
  } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
function editProjectModal(p) {
  modal(`<h2 style="font-size:19px;margin-bottom:14px">Edit ${esc(p.name)}</h2>
  <div class="field"><label>Description</label><textarea id="epDesc" rows="3">${esc(p.description || '')}</textarea></div>
  <div class="field"><label>Accent color</label><input id="epColor" type="color" value="${esc(p.color)}" style="height:42px;padding:4px"></div>
  <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="epX">Cancel</button><button class="btn primary" id="epGo">Save</button></div>`);
  $('#epX').onclick = closeModal;
  $('#epGo').onclick = async () => { try { await post('/api/project-update', { id: p.id, description: $('#epDesc').value, color: $('#epColor').value }); closeModal(); await loadAll(); route(); } catch (e) { toast(e.message); } };
}
function rulesModal(p) {
  const kinds = ['video', 'image', 'audio', 'doc', 'code'];
  const rows = (p.rules || []).map((r) => ({ ...r, kinds: [...(r.kinds || [])] }));
  const draw = () => {
    modal(`<h2 style="font-size:19px;margin-bottom:4px">Important-file rules · ${esc(p.name)}</h2><div class="muted" style="margin-bottom:16px">Each rule is a case-insensitive pattern matched against the file path inside the project (regular expression; plain words work too, use <span class="mono">a|b</span> for “or”).</div>
    <div id="rl">${rows.map((r, i) => `<div class="rule-edit" data-i="${i}"><input class="rl-label" value="${esc(r.label)}" placeholder="Label"><input class="rl-pat mono" value="${esc(r.pattern)}" placeholder="pattern, e.g. social|reel"><div class="kinds">${kinds.map((k) => `<label><input type="checkbox" data-k="${k}" ${r.kinds.includes(k) ? 'checked' : ''}>${k}</label>`).join('')}</div><button class="btn sm ghost rl-del">✕</button></div>`).join('')}</div>
    <button class="btn sm" id="rlAdd" style="margin:8px 0 18px">＋ Add rule</button>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="rlX">Cancel</button><button class="btn primary" id="rlGo">Save rules</button></div>`, true);
    const sync = () => document.querySelectorAll('.rule-edit').forEach((el) => { const r = rows[+el.dataset.i]; r.label = el.querySelector('.rl-label').value; r.pattern = el.querySelector('.rl-pat').value; r.kinds = [...el.querySelectorAll('input[data-k]:checked')].map((c) => c.dataset.k); });
    $('#rlAdd').onclick = () => { sync(); rows.push({ id: 'r' + Date.now(), label: 'New rule', pattern: '', kinds: [] }); draw(); };
    document.querySelectorAll('.rl-del').forEach((b) => (b.onclick = () => { sync(); rows.splice(+b.closest('.rule-edit').dataset.i, 1); draw(); }));
    $('#rlX').onclick = closeModal;
    $('#rlGo').onclick = async () => { sync(); try { await post('/api/project-update', { id: p.id, rules: rows }); closeModal(); await loadAll(); toast('Rules saved'); route(); } catch (e) { toast('Invalid rule: ' + e.message); } };
  };
  draw();
}

async function vSocial(v) {
  if (!S.media) { v.innerHTML = '<div class="empty">Scanning media…</div>'; const r = await api('/api/media'); S.media = r.media; S.mediaScanning = r.scanning; }
  const f = S.socialFilter || (S.socialFilter = { project: 'all', kind: 'all', pinned: false });
  const pins = pinSet(); const q = S.q.toLowerCase();
  let list = S.media.filter((m) => (f.project === 'all' || m.project === f.project) && (f.kind === 'all' ? m.kind !== 'doc' : m.kind === f.kind) && (!f.pinned || pins.has(m.path)) && (!q || m.rel.toLowerCase().includes(q)));
  const shown = list.slice(0, 180);
  v.innerHTML = `<div class="hello"><div><h1>Social & key files</h1><div class="sub">Videos, images and docs from your content folders (anything under paths like <span class="mono">social, content, final, reels, campaign…</span>). ${S.mediaScanning ? 'Still scanning…' : ''}</div></div></div>
  <div class="tabs" id="sf">
    <button data-k="project:all" class="${f.project === 'all' ? 'on' : ''}">All projects</button>${S.projects.map((p) => `<button data-k="project:${p.id}" class="${f.project === p.id ? 'on' : ''}">${esc(p.name)}</button>`).join('')}
    <span style="width:14px"></span>${['all', 'video', 'image', 'doc'].map((k) => `<button data-k="kind:${k}" class="${f.kind === k ? 'on' : ''}">${k === 'all' ? 'Any type' : k}</button>`).join('')}
    <button data-k="pinned" class="${f.pinned ? 'on' : ''}">★ Pinned only (${S.pins.length})</button></div>
  <div class="muted tiny" style="margin-bottom:12px">${list.length} files${list.length > shown.length ? ' · showing newest ' + shown.length : ''}</div>
  <div class="media-grid">${shown.map((m) => `<div class="m" data-media="${esc(m.path)}"><span class="kind">${m.kind}</span><button class="pin ${pins.has(m.path) ? 'on' : ''}" data-pin="${esc(m.path)}">★</button>
    <div class="th">${m.kind === 'image' && !m.path.toLowerCase().endsWith('.heic') ? `<img loading="lazy" src="${fileUrl(m.path)}">` : m.kind === 'video' ? `<video preload="metadata" muted src="${fileUrl(m.path)}#t=0.6"></video>` : ICON[m.kind]}</div>
    <div class="cap"><div class="t">${esc(m.rel.split('/').pop())}</div><div class="muted tiny"><span style="color:${pcolor(m.project)}">●</span> ${esc(m.folder)} · ${fmtB(m.size)}</div></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No files match.</div>'}</div>`;
  $('#sf').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; const [k, val] = b.dataset.k.split(':'); if (k === 'pinned') f.pinned = !f.pinned; else f[k] = val; vSocial(v); };
}

function vAgents(v) {
  const a = S.agents; if (!a) return (v.innerHTML = '<div class="empty">Loading…</div>');
  const U = a.usage, q = S.q.toLowerCase(); const h = a.health;
  const skillList = (list, used, agent) => list.filter((s) => !q || (s.name + s.description).toLowerCase().includes(q)).sort((x, y) => (used[y.name] || used[y.dir] || 0) - (used[x.name] || used[x.dir] || 0) || x.name.localeCompare(y.name))
    .map((s) => { const n = used[s.name] || used[s.dir] || used[s.source.startsWith('plugin:') ? s.source.slice(7) + ':' + s.name : ''] || 0; return `<div class="skill"><div style="display:flex;gap:8px;align-items:center;justify-content:space-between"><span class="n">${esc(s.name)}</span><span>${n ? `<span class="tag ${agent}">${n}× used</span> ` : ''}<span class="tag">${esc(s.source)}</span></span></div><div class="d">${esc(s.description)}</div></div>`; }).join('') || '<div class="empty">None</div>';
  const top = (o, n = 8) => Object.entries(o).sort((x, y) => y[1] - x[1]).slice(0, n);
  const mini = (arr) => arr.map(([k, v]) => `<div class="row"><div class="grow t">${esc(k)}</div><b>${v}</b></div>`).join('') || '<div class="muted tiny">No data yet</div>';
  v.innerHTML = `<div class="hello"><div><h1>Plugins & skills</h1><div class="sub">Every skill and plugin available to Claude Code and Codex. Your agents live on the <a data-go="team" style="cursor:pointer">Agent team</a> page.</div></div><a class="btn" data-go="health" style="cursor:pointer">Run system check</a></div>
  <div class="grid g2" style="margin-bottom:16px">
    <div class="card" style="border-top:3px solid var(--claude)"><div class="card-h"><h2 style="color:var(--claude)">Claude Code</h2><span class="chip ${h.claude.cli ? 'ok' : 'bad'}"><i></i>${h.claude.cli ? 'CLI ready' : 'CLI missing'}</span></div>
      <div class="muted tiny mono">${esc(h.claude.cli || '')}</div><div class="kv"><div><b>${a.claude.skills.length}</b><span>skills</span></div><div><b>${a.claude.plugins.length}</b><span>plugins</span></div><div><b>${Object.keys(U.mcp).length}</b><span>MCP servers used</span></div></div>
      <div class="muted tiny">Plugins: ${a.claude.plugins.map((p) => esc(p.name) + ' v' + esc(p.version)).join(', ') || 'none'}</div></div>
    <div class="card" style="border-top:3px solid var(--codex)"><div class="card-h"><h2 style="color:var(--codex)">Codex</h2><span class="chip ${h.codex.cli || h.codex.app ? 'ok' : 'warn'}"><i></i>${h.codex.cli || h.codex.app ? 'Launchable' : 'Reading history only'}</span></div>
      <div class="muted tiny mono">${esc(h.codex.cli || h.codex.app || '~/.codex (data folder found; no codex CLI or app on PATH)')}</div><div class="kv"><div><b>${a.codex.skills.length}</b><span>skills</span></div><div><b>${a.codex.plugins.filter((p) => p.enabled).length}</b><span>plugins on</span></div><div><b>${S.sessions ? S.sessions.filter((s) => s.agent === 'codex').length : '…'}</b><span>sessions</span></div></div>
      <div class="muted tiny">Plugins: ${a.codex.plugins.filter((p) => p.enabled).map((p) => esc(p.name)).join(', ') || 'none'}</div></div>
  </div>
  ${(() => { const b = S.blender || { installed: false, skills: {}, scripts: [] }; return `<div class="card" style="margin-bottom:16px;border-top:3px solid #ff9d3d"><div class="card-h"><h2 style="color:#ff9d3d">🧊 Blender plugin</h2><span class="chip ${b.installed ? 'ok' : 'bad'}"><i></i>${b.installed ? esc(b.version || 'installed') : 'not installed'}</span></div>
    <div class="muted tiny" style="margin-bottom:10px">3D tools for both Claude Code and Codex: inspect a model, edit a copy, export web-ready GLB files and render previews. The 3D Artist agent uses it (Agent team page), and each project has a 3D models tab.</div>
    <div class="kv"><div><b>${b.skills.claude ? '✓' : '✕'} ${b.skills.codex ? '✓' : '✕'}</b><span>skill: Claude · Codex</span></div><div><b>${b.scripts.length}</b><span>helper scripts</span></div><div><b>1</b><span>3D Artist agent</span></div></div>
    <div class="pill-row" style="margin-top:12px"><button class="btn" id="blOpen">Open Blender</button><a class="btn" data-go="health" style="cursor:pointer">System check</a></div></div>`; })()}
  <div class="grid g3" style="margin-bottom:16px">
    <div class="card"><div class="card-h"><h2>Most-used skills (Claude)</h2></div>${mini(top(U.skills))}</div>
    <div class="card"><div class="card-h"><h2>Installed plugins</h2></div>${[...a.claude.plugins.map((p) => ['Claude · ' + p.name, 'v' + p.version]), ...a.codex.plugins.filter((p) => p.enabled).map((p) => ['Codex · ' + p.name, 'on'])].map(([k, v]) => `<div class="row"><div class="grow t">${esc(k)}</div><span class="muted tiny">${esc(v)}</span></div>`).join('') || '<div class="muted tiny">No plugins</div>'}</div>
    <div class="card"><div class="card-h"><h2>Top tools & MCP</h2></div>${mini(top({ ...U.tools, ...Object.fromEntries(Object.entries(U.mcp).map(([k, v]) => ['MCP · ' + k, v])) }))}</div>
  </div>
  <div class="grid g2"><div class="card"><div class="card-h"><h2 style="color:var(--claude)">Claude skills</h2><span class="muted">${a.claude.skills.length}</span></div>${skillList(a.claude.skills, U.skills, 'claude')}</div>
  <div class="card"><div class="card-h"><h2 style="color:var(--codex)">Codex skills</h2><span class="muted">${a.codex.skills.length}</span></div>${skillList(a.codex.skills, {}, 'codex')}</div></div>`;
}

function vUsage(v) {
  const u = S.usage; if (!u) return (v.innerHTML = '<div class="empty">Indexing usage… this takes a minute the first time, then it is cached.</div>');
  const n = S.range === 0 ? 365 : S.range; const days = dayList(u, n);
  const c = sum(days, 'claude'), x = sum(days, 'codex');
  const models = Object.entries(u.models).sort((a, b) => b[1].tokens - a[1].tokens); const mt = models.reduce((s, [, m]) => s + m.tokens, 0) || 1;
  const bp = Object.entries(u.byProject).sort((a, b) => b[1].claude + b[1].codex - a[1].claude - a[1].codex); const pt = bp.reduce((s, [, m]) => s + m.claude + m.codex, 0) || 1;
  const tt = u.tokenTypes; const ttt = tt.input + tt.output + tt.cacheRead + tt.cacheWrite || 1;
  const lim = u.codexLimits;
  const topSes = (S.sessions || []).filter((s) => Date.now() - Date.parse(s.end) < n * 864e5).sort((a, b) => b.tokens - a.tokens).slice(0, 8);
  v.innerHTML = `<div class="hello"><div><h1>Usage</h1><div class="sub">Tokens read straight from your Claude Code and Codex session logs.</div></div>
  <div class="tabs" id="rg" style="margin:0">${[7, 14, 30, 90, 0].map((r) => `<button data-r="${r}" class="${S.range === r ? 'on' : ''}">${r ? r + ' days' : '1 year'}</button>`).join('')}</div></div>
  <div class="grid g4" style="margin-bottom:16px">
    <div class="card stat"><div class="k">Total tokens</div><div class="v">${fmtN(c + x)}</div><div class="d">last ${n} days</div></div>
    <div class="card stat"><div class="k" style="color:var(--claude)">Claude</div><div class="v">${fmtN(c)}</div><div class="d">${Math.round((c / (c + x || 1)) * 100)}% of total</div></div>
    <div class="card stat"><div class="k" style="color:var(--codex)">Codex</div><div class="v">${fmtN(x)}</div><div class="d">${lim && lim.primary ? 'weekly limit ' + Math.round(lim.primary.used_percent) + '% used' : ''}</div></div>
    <div class="card stat"><div class="k">Busiest day</div><div class="v">${fmtN(Math.max(0, ...days.map((d) => d.claude + d.codex)))}</div><div class="d">${(days.slice().sort((a, b) => b.claude + b.codex - a.claude - a.codex)[0] || {}).full || ''}</div></div>
  </div>
  <div class="card" style="margin-bottom:16px"><div class="card-h"><h2>Daily tokens</h2>${legend()}</div><div id="uChart"></div>
    <div class="muted tiny" style="margin-top:6px">Includes cached input. Claude counts are per API response; Codex counts are per session, attributed to its start day.</div></div>
  <div class="grid g3" style="margin-bottom:16px">
    <div class="card"><div class="card-h"><h2>By model</h2></div>${models.map(([k, m]) => `<div class="row"><div class="grow"><div style="display:flex;justify-content:space-between"><span>${esc(k)}</span><b>${fmtN(m.tokens)}</b></div><div class="bar" style="margin-top:6px"><i style="width:${(m.tokens / mt) * 100}%;background:var(--${m.agent})"></i></div></div></div>`).join('')}</div>
    <div class="card"><div class="card-h"><h2>By project</h2></div>${bp.map(([k, m]) => `<div class="row"><div class="grow"><div style="display:flex;justify-content:space-between"><span style="color:${pcolor(k)}">● ${esc(k === 'other' ? 'Other / outside projects' : pname(k))}</span><b>${fmtN(m.claude + m.codex)}</b></div><div class="bar" style="margin-top:6px"><i style="width:${(m.claude / pt) * 100}%;background:var(--claude)"></i><i style="width:${(m.codex / pt) * 100}%;background:var(--codex)"></i></div></div></div>`).join('')}</div>
    <div class="card"><div class="card-h"><h2>Claude token types</h2></div>${[['Cache read', tt.cacheRead, '#5b8cff'], ['Cache write', tt.cacheWrite, '#c77dff'], ['Input', tt.input, '#35d49a'], ['Output', tt.output, '#ff8a5c']].map(([k, val, col]) => `<div class="row"><div class="grow"><div style="display:flex;justify-content:space-between"><span>${k}</span><b>${fmtN(val)}</b></div><div class="bar" style="margin-top:6px"><i style="width:${(val / ttt) * 100}%;background:${col}"></i></div></div></div>`).join('')}
      ${lim && lim.primary ? `<div class="row"><div class="grow"><div style="display:flex;justify-content:space-between"><span>Codex limit window</span><b>${Math.round(lim.primary.used_percent)}%</b></div><div class="bar" style="margin-top:6px"><i style="width:${lim.primary.used_percent}%;background:var(--codex)"></i></div></div></div>` : ''}</div>
  </div>
  <div class="card"><div class="card-h"><h2>Heaviest sessions · last ${n} days</h2></div><table><tr><th>Agent</th><th>Session</th><th>Project</th><th class="num">Tokens</th><th class="num">When</th></tr>${topSes.map((s) => `<tr class="click" data-sess="${esc(s.id)}"><td><span class="tag ${s.agent}">${s.agent}</span></td><td class="ell">${esc(s.title)}</td><td>${s.project ? `<span style="color:${pcolor(s.project)}">● ${esc(pname(s.project))}</span>` : '—'}</td><td class="num">${fmtN(s.tokens)}</td><td class="num">${ago(s.end)}</td></tr>`).join('')}</table></div>`;
  barChart($('#uChart'), days, ['claude', 'codex'], ['var(--claude)', 'var(--codex)']);
  $('#rg').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.range = +b.dataset.r; vUsage(v); } };
}

function vSessions(v) {
  const ses = S.sessions; if (!ses) return (v.innerHTML = '<div class="empty">Indexing sessions…</div>');
  const q = S.q.toLowerCase(); const f = S.sessFilter;
  const matched = ses.filter((s) => (f === 'all' || s.agent === f || s.project === f) && (!q || (s.title + s.cwd).toLowerCase().includes(q)));
  const list = matched.slice(0, S.sessionLimit || 100);
  v.innerHTML = `<div class="hello"><div><h1>Sessions</h1><div class="sub">Your local Claude Code and Codex conversations, including archived Codex chats. Updated automatically. Cloud-only chats need an export.</div></div></div>
  <div class="tabs" id="sfl">${['all', 'claude', 'codex', ...S.projects.map((p) => p.id)].map((k) => `<button data-k="${k}" class="${f === k ? 'on' : ''}">${k === 'all' ? 'All' : k === 'claude' ? 'Claude' : k === 'codex' ? 'Codex' : esc(pname(k))}</button>`).join('')}</div>
  <div class="card"><table><tr><th>Agent</th><th>Title</th><th>Project</th><th class="num">Tokens</th><th class="num">Last active</th></tr>${list.map((s) => `<tr class="click" data-sess="${esc(s.id)}"><td><span class="tag ${s.agent}">${s.agent}</span></td><td class="ell">${esc(s.title)}</td><td>${s.project ? `<span style="color:${pcolor(s.project)}">● ${esc(pname(s.project))}</span>` : '<span class="muted">—</span>'}</td><td class="num">${fmtN(s.tokens)}</td><td class="num">${ago(s.end)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No sessions</td></tr>'}</table>${matched.length>list.length?'<button class="btn" id="sessMore">Show more conversations</button>':''}<div class="muted tiny" style="padding:12px">${list.length} of ${matched.length} conversations</div></div>`;
  if($('#sessMore'))$('#sessMore').onclick=()=>{S.sessionLimit=(S.sessionLimit||100)+100;vSessions(v);};
  $('#sfl').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.sessFilter = b.dataset.k; S.sessionLimit=100; vSessions(v); } };
}

/* ---------- modals & actions ---------- */
function modal(html, wide) { const m = $('#modal'); m.innerHTML = `<div class="sheet ${wide ? 'wide' : ''}">${html}</div>`; m.hidden = false; m.onclick = (e) => { if (e.target === m) closeModal(); }; }
function closeModal() { const m = $('#modal'); m.hidden = true; m.innerHTML = ''; }
function newProjectModal() {
  modal(`<h2 style="font-size:19px;margin-bottom:4px">New project</h2><div class="muted" style="margin-bottom:18px">Creates a folder on your drive with a clean structure, CLAUDE.md and AGENTS.md so both agents know the rules.</div>
  <div class="field"><label>Name</label><input id="npName" placeholder="e.g. Nordic Detail" autofocus></div>
  <div class="field"><label>What is it? (goes into the agent brief)</label><textarea id="npDesc" rows="3" placeholder="One or two sentences"></textarea></div>
  <div class="field"><label>Template</label><select id="npTpl"><option value="general">General</option><option value="app">App / software</option><option value="shop">Shop / website</option><option value="content">Content & video</option></select></div>
  <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="npCancel">Cancel</button><button class="btn primary" id="npGo">Create project</button></div>`);
  $('#npCancel').onclick = closeModal;
  $('#npGo').onclick = async () => { try { const p = await post('/api/projects', { name: $('#npName').value, description: $('#npDesc').value, template: $('#npTpl').value }); closeModal(); toast('Created ' + p.name); await loadAll(); location.hash = '#/project/' + p.id; } catch (e) { toast(e.message); } };
}
function openMedia(path) {
  const m = (S.media || []).find((x) => x.path === path) || { path, rel: path.split('/').pop(), kind: 'doc', size: 0 };
  const pinned = pinSet().has(path);
  const body = m.kind === 'image' ? `<img src="${fileUrl(path)}" style="max-width:100%;max-height:68vh;border-radius:10px;display:block;margin:auto">` : m.kind === 'video' ? `<video src="${fileUrl(path)}" controls autoplay style="max-width:100%;max-height:68vh;border-radius:10px;display:block;margin:auto"></video>` : m.kind === 'audio' ? `<audio controls src="${fileUrl(path)}" style="width:100%"></audio>` : `<div class="empty">${ICON[m.kind]} No inline preview. Use “Open”.</div>`;
  modal(`<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:12px"><div><h2>${esc(m.rel.split('/').pop())}</h2><div class="muted tiny mono">${esc(path)}</div></div><div style="display:flex;gap:8px;flex:none"><button class="btn sm" id="mdPin">${pinned ? '★ Unpin' : '☆ Pin'}</button><button class="btn sm" id="mdFind">Show in Finder</button><button class="btn sm" id="mdOpen">Open</button><button class="btn sm" id="mdX">✕</button></div></div>${body}`, true);
  $('#mdX').onclick = closeModal; $('#mdFind').onclick = () => post('/api/reveal', { path }).catch((e) => toast(e.message)); $('#mdOpen').onclick = () => post('/api/reveal', { path, open: true }).catch((e) => toast(e.message));
  $('#mdPin').onclick = async () => { const r = await post('/api/pins', { path }); S.pins = r.pins; closeModal(); route(); };
}
function openSession(id) {
  const s = (S.sessions || []).find((x) => x.id === id); if (!s) return;
  modal(`<div style="display:flex;justify-content:space-between;gap:12px"><div><span class="tag ${s.agent}">${s.agent}</span><h2 style="margin:10px 0 4px">${esc(s.title)}</h2></div><button class="btn sm" id="sx" style="align-self:flex-start">✕</button></div>
  <div class="kv"><div><b>${fmtN(s.tokens)}</b><span>tokens</span></div><div><b>${fmtN(s.output)}</b><span>output tokens</span></div><div><b>${s.messages || '—'}</b><span>responses</span></div></div>
  <div class="muted tiny">Project: ${s.project ? esc(pname(s.project)) : 'outside tracked projects'}<br>Started ${s.start ? new Date(s.start).toLocaleString() : '—'}<br>Last active ${s.end ? new Date(s.end).toLocaleString() : '—'}</div>
  <div class="field" style="margin-top:14px"><label>Working directory</label><input readonly value="${esc(s.cwd || '')}"></div>
  <div class="field"><label>Resume command</label><input readonly value="${esc(s.agent === 'claude' ? `cd '${s.cwd}' && claude --resume ${s.id}` : `cd '${s.cwd}' && codex resume ${s.id}`)}"></div>
  <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">${!s.project && s.cwd ? '<button class="btn" id="sTrack" title="Track this conversation\'s folder as a Jarvis project">＋ Add this folder as a project</button>' : ''}<button class="btn" id="sHistory">Read conversation</button><button class="btn primary" id="sResume">Continue in Jarvis</button></div>`);
  if ($('#sTrack')) $('#sTrack').onclick = async () => { try { const p = await post('/api/register', { kind: 'project', name: (s.title || 'Project').replace(/\s+/g, ' ').slice(0, 40), path: s.cwd, description: 'Added from a ' + s.agent + ' conversation', source: s.agent }); closeModal(); toast('Added ' + p.name + ' as a project'); await loadAll(); location.hash = '#/project/' + p.id; } catch (e) { toast(e.message); } };
  $('#sx').onclick = closeModal;
  $('#sResume').onclick = async () => { const b=$('#sResume');b.disabled=true;try { const c=await post('/api/convos/import', {agent:s.agent,id:s.id});S.cv=S.cv||{};S.cv[c.project]=S.cv[c.project]||{drafts:{}};S.cv[c.project].open=c.id;S.projTab[c.project]='chat';closeModal();location.hash='#/project/'+c.project;await route();toast('Opened a saved continuation. Your original thread stays unchanged.'); } catch(e){toast(e.message);if(b.isConnected)b.disabled=false;} };
  $('#sHistory').onclick=()=>openSessionHistory(s);

}
async function openSessionHistory(s) {
  modal(`<div style="display:flex;gap:12px;justify-content:space-between"><h2>${esc(s.title)}</h2><button class="btn sm" id="shClose">Close</button></div><p class="muted tiny">Original conversation · read only. Continue in Jarvis creates a separate saved continuation.</p><button class="btn sm" id="shOlder" disabled>Loading…</button><div id="shMessages" style="overflow-wrap:anywhere"></div>`,true);
  $('#shClose').onclick=closeModal;let before;const panel=$('#shMessages'),older=$('#shOlder');
  const load=async()=>{older.disabled=true;try{const d=await api('/api/sessions/history?agent='+encodeURIComponent(s.agent)+'&id='+encodeURIComponent(s.id)+(before===undefined?'':'&before='+before));if(!panel.isConnected)return;before=d.before;panel.insertAdjacentHTML('afterbegin',d.messages.map(m=>`<article style="padding:16px 0;border-bottom:1px solid var(--line)"><b>${m.role==='user'?'You':esc(s.agent)}</b><div style="white-space:pre-wrap;margin-top:8px">${esc(m.text)}</div></article>`).join(''));older.hidden=!d.hasMore;older.textContent='Load earlier messages ('+d.before+')';if(!d.total)panel.textContent='No readable messages yet. Reopen after the current reply finishes.';}catch(e){older.textContent='Retry loading history';toast(e.message);}finally{older.disabled=false;}};older.onclick=load;load();
}
async function doLaunch(spec) { const [agent, project] = spec.split(':'); try { const r = await post('/api/launch', { agent, project }); toast(r.note || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'Opened in Terminal' : 'Started on your Mac')); } catch (e) { toast(e.message); } }

/* ---------- router / data ---------- */
async function route() {
  renderNav();
  const [r, arg] = location.hash.slice(2).split('/'); const v = $('#view');
  const names = { graph: 'Obsidian › Graph', settings: 'Settings', obsidian: 'Obsidian', tools: 'Tools & integrations', control: 'Control center', home: 'Home', team: 'Agent team', council: 'Council', vault: 'Vault & keys', platforms: 'Platforms', video: 'Video Intel', voice: 'Voice studio', overview: 'Dashboard', projects: 'Projects', project: 'Projects › ' + pname(arg), social: 'Social & key files', agents: 'Plugins & skills', health: 'System check', mobile: 'iPhone & remote', usage: 'Usage', sessions: 'Sessions' };
  $('#crumb').innerHTML = `<span class="crumb-p">Jarvis › </span><b>${esc(names[r || 'home'] || 'Home')}</b>`;
  window.routeArg = arg;
  const fn = (window.PAGES && window.PAGES[r || 'home']) || { '': vOverview, overview: vOverview, projects: vProjects, project: (v) => vProject(v, arg), social: vSocial, agents: vAgents, usage: vUsage, sessions: vSessions }[r || ''] || vOverview;
  const key = location.hash; const fresh = route.last !== key; if (fresh) { window.scrollTo(0, 0); route.last = key; }
  if (r === 'project' && arg) Jarvis.setProject(arg);
  await fn(v);
  if (window.JarvisProgress) JarvisProgress.afterRoute();
  if (fresh) { animateIn(v); countUp(v); }
}
function animateIn(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  [...root.querySelectorAll('.stage, .hero-greet, .jhero, .hero, .hello, .tabs, .card, .m, .acard, .bcol, .ventry, .sec-h')].slice(0, 90).forEach((el, i) => { el.style.setProperty('--d', Math.min(i * 55, 700) + 'ms'); el.classList.remove('rise'); void el.offsetWidth; el.classList.add('rise'); });
}
function countUp(root) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  root.querySelectorAll('.stat .v, .hero-stat b, .kv b').forEach((el) => {
    if (el.children.length) return; const m = el.textContent.trim().match(/^(\d+(?:\.\d+)?)(.*)$/); if (!m) return;
    const end = parseFloat(m[1]), dec = (m[1].split('.')[1] || '').length, suf = m[2], t0 = performance.now();
    (function f(t) { const k = Math.min(1, (t - t0) / 1000), e = 1 - Math.pow(1 - k, 4); el.textContent = (end * e).toFixed(dec) + suf; if (k < 1) requestAnimationFrame(f); })(t0);
  });
}
async function loadAll() {
  const [pr, h] = await Promise.all([api('/api/projects'), api('/api/health')]);
  S.projects = pr.projects; S.pins = pr.pins; S.health = h; renderStatus(); renderNav();
  const [u, s, a] = await Promise.all([api('/api/usage'), api('/api/sessions'), api('/api/agents')]).catch(() => []);
  if (u) { S.usage = u; S.sessions = s.sessions; S.agents = a; }
  if (window.loadTeam) await Promise.all([loadTeam(), loadVault(), loadVoice(), window.loadConnectors ? loadConnectors() : null, window.loadBlender ? loadBlender() : null]);
  renderStatus();
}
async function refreshRunning() {
  try { const r = await api('/api/running'); S.running = r.running; window.dispatchEvent(new CustomEvent('jarvis:running', { detail: r.running })); const b = $('#liveBox'); if (b) b.innerHTML = liveHtml(); } catch {}
}
setInterval(refreshRunning, 6000); setTimeout(refreshRunning, 800);
let polling = null;
function poll() {
  clearInterval(polling);
  polling = setInterval(async () => {
    const stillScan = S.projects.some((p) => p.scanning); const indexing = S.health && !S.health.index.ready;
    if (!stillScan && !indexing) { if (Date.now() - (poll.last || 0) > 60000) { poll.last = Date.now(); await refreshData(); } return; }
    await refreshData();
  }, 3000);
}
// Periodic refresh must never rebuild a page the user is working on: typed drafts, open dialogs and tools pages are left alone.
const AUTO_ROUTE_OK = new Set(['overview', 'projects', 'sessions']);
function userIsBusy() {
  if (window.JarvisScene?.active || window.Jarvis?.st.open) return true;
  if (document.querySelector('.sheet') && !$('#modal').hidden) return true;
  const ae = document.activeElement; if (ae && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return true;
  return [...document.querySelectorAll('#view textarea, #view input')].some((el) => !['checkbox', 'radio', 'button', 'range', 'color'].includes(el.type) && String(el.value || '').trim());
}
async function refreshData() {
  try {
    await loadAll(); S.media = null;
    const [r, arg] = location.hash.slice(2).split('/'); const tab = r === 'project' ? (S.projTab[arg] || 'overview') : null;
    const safe = AUTO_ROUTE_OK.has(r) || (r === 'project' && tab === 'overview');
    if (r === 'usage') window.dispatchEvent(new Event('jarvis:usage-refresh'));
    else if (safe && !userIsBusy()) route();
  } catch {}
}


// New version detection: when Jarvis is updated, the open app/page reloads itself as soon as you are idle (never while you type, talk, or a task streams).
(() => {
  let known = null, shown = false;
  const busy = () => userIsBusy() || (window.Jarvis && Jarvis.isActive && Jarvis.isActive()) || !!document.querySelector('#cvStop:not([hidden])') || !!document.querySelector('.sheet:not([hidden])');
  async function check() {
    try { const r = await fetch('/api/version', { cache: 'no-store' }); if (!r.ok) return; const { v } = await r.json(); if (known == null) { known = v; return; } if (v === known) return;
      // Data updates in place; applying new executable UI code is always explicit.
      if (window.JarvisProgress) JarvisProgress.capture();
      if (!shown) { shown = true; const b = document.createElement('button'); b.id = 'newVer'; b.className = 'btn primary'; b.textContent = 'Update ready · Tap when finished'; b.onclick = () => { if (busy()) { toast('Finish your active conversation or close the editor before applying this update. Your work stays open.'); return; } if (window.JarvisProgress) JarvisProgress.capture(); location.reload(); }; document.body.appendChild(b); }
    } catch {}
  }
  setTimeout(check, 1500); setInterval(check, 20000);
})();
document.addEventListener('click', (e) => {
  const t = e.target;
  const pin = t.closest('[data-pin]'); if (pin) { e.stopPropagation(); post('/api/pins', { path: pin.dataset.pin }).then((r) => { S.pins = r.pins; route(); }); return; }
  const ch = t.closest("[data-convos]"); if (ch) { e.stopPropagation(); S.projTab[ch.dataset.convos] = 'chat'; if (window.routeArg === ch.dataset.convos) return route(); location.hash = "#/project/" + ch.dataset.convos; return; }
  const l = t.closest('[data-launch]'); if (l) { e.stopPropagation(); return doLaunch(l.dataset.launch); }
  const rv = t.closest('[data-reveal]'); if (rv) return post('/api/reveal', { path: rv.dataset.reveal }).catch((x) => toast(x.message));
  const mm = t.closest('[data-media]'); if (mm) return openMedia(mm.dataset.media);
  const op = t.closest('[data-open]'); if (op) return post('/api/reveal', { path: op.dataset.open, open: true }).catch((x) => toast(x.message));
  const ss = t.closest('[data-sess]'); if (ss) return openSession(ss.dataset.sess);
  const go = t.closest('[data-go]'); if (go) location.hash = '#/' + go.dataset.go;
});
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); $('#search').focus(); }
  if (e.key === 'Escape') { closeModal(); $('#search').blur(); }
});
$('#search').addEventListener('input', (e) => { S.q = e.target.value; clearTimeout(S.st); S.st = setTimeout(route, 180); });
$('#btnNew').onclick = newProjectModal;
$('#btnRefresh').onclick = async () => { await post('/api/rescan'); await post('/api/reindex'); S.media = null; toast('Rescanning projects and usage…'); setTimeout(refreshData, 800); };
document.addEventListener('mousemove', (e) => { const c = e.target.closest && e.target.closest('.card'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px'); } });
document.addEventListener('click', (e) => { const q = e.target.closest('[data-ask]'); if (q) Jarvis.send(q.dataset.ask, false); });
window.addEventListener('hashchange', route);
// Start only once every script (voice, pages, workspace) has loaded: on a slow link the data could otherwise arrive first.
const startApp = (attempt = 0) => (async () => { await loadAll(); if (window.JarvisProgress) JarvisProgress.restoreState(); await route(); poll(); })().catch((e) => {
  // Jarvis may be restarting (an update): keep trying quietly instead of leaving an error on screen
  $('#view').innerHTML = `<div class="empty"><div class="live-pulse" style="margin-bottom:10px"></div>Jarvis is starting…<br><span class="muted tiny">${attempt > 3 ? 'Still trying to reach the Jarvis server (' + esc(e.message) + '). ' : ''}Trying again automatically.</span><br><button class="btn" style="margin-top:12px" onclick="location.reload()">Try now</button></div>`;
  setTimeout(() => startApp(attempt + 1), Math.min(5000, 1500 + attempt * 500));
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startApp()); else startApp();
