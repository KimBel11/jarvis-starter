'use strict';
// Pages: Home (User Assistant), Team, Vault & keys, Platforms, Video Intel, Voice studio.
const SVC = () => (S.vault && S.vault.services) || [];
const svcById = (id) => SVC().find((s) => s.id === id) || { id, name: id, color: '#8793a8', glyph: '·', cat: 'Other', desc: '', url: '' };
const agentOf = (id) => (S.team && S.team.agents.find((a) => a.id === id)) || { id, name: id, glyph: '•', color: '#8793a8' };
const STATE_LABEL = { working: 'Working', waiting: 'Needs your OK', queued: 'Queued', idle: 'Idle' };
const dur = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h'; };
const mdLite = (t) => esc(t || '').replace(/^### (.*)$/gm, '<h4>$1</h4>').replace(/^## (.*)$/gm, '<h3>$1</h3>').replace(/^# (.*)$/gm, '<h3>$1</h3>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/^\s*[-*] (.*)$/gm, '<li>$1</li>').replace(/(<li>[\s\S]*?<\/li>)(?!\n?<li>)/g, '<ul>$1</ul>').replace(/\n{2,}/g, '<br><br>').replace(/\n/g, '<br>');
async function loadTeam() { try { S.team = await api('/api/team'); Jarvis.refreshAgents && Jarvis.refreshAgents(); } catch {} }
async function loadVault() { try { S.vault = await api('/api/vault'); } catch (e) { S.vault = S.vault || { status: { ok: false, error: e.message }, services: [], entries: [] }; } }
async function loadVoice() { try { S.voice = await api('/api/voice/status'); } catch {} }

/* ================= HOME ================= */
function ring(p, color, big, small) {
  const C = 2 * Math.PI * 54; return `<div class="ring-box"><svg viewBox="0 0 130 130"><circle cx="65" cy="65" r="54" class="ring-bg"/><circle cx="65" cy="65" r="54" class="ring-fg" style="stroke:${color};stroke-dasharray:${C};stroke-dashoffset:${C}" data-p="${Math.max(0.02, Math.min(1, p))}" data-c="${C}"/></svg><div class="ring-c"><b>${big}</b><span>${small}</span></div></div>`;
}
function hudSvg() {
  let ticks = ''; for (let i = 0; i < 60; i++) { const a = (i / 60) * 2 * Math.PI, r1 = 188, r2 = i % 5 ? 194 : 200; ticks += `<line x1="${200 + Math.cos(a) * r1}" y1="${200 + Math.sin(a) * r1}" x2="${200 + Math.cos(a) * r2}" y2="${200 + Math.sin(a) * r2}"/>`; }
  return `<svg class="hud" viewBox="0 0 400 400" aria-hidden="true"><g class="hud-ticks">${ticks}</g><circle class="hud-r1" cx="200" cy="200" r="170"/><circle class="hud-r2" cx="200" cy="200" r="150"/><circle class="hud-r3" cx="200" cy="200" r="132"/></svg>`;
}
function agentCard(a, full) {
  const s = a.status; const tk = s.current ? (S.team.tasks.find((t) => t.id === s.current.id) || {}) : null;
  const lastLog = tk && tk.log && tk.log.length ? tk.log[tk.log.length - 1] : '';
  const proj = a.project ? S.projects.find((p) => p.id === a.project) : null;
  return `<div class="acard ${s.state}" style="--c:${a.color}" data-agent="${a.id}">
    <div class="a-top"><div class="a-glyph"><i class="a-ring"></i><span>${window.JarvisCharacters?.html(a)||''}</span></div><div class="grow"><div class="a-name">${esc(a.name)}${a.main ? ' <span class="tag p" style="--c:' + a.color + '">main agent</span>' : ''}</div><div class="muted tiny">${esc(a.role)}</div></div><span class="a-state">${STATE_LABEL[s.state]}</span></div>
    <div class="a-now">${s.current ? `<b>${esc(s.current.title)}</b> <span class="muted tiny">· ${s.current.status === 'planning' ? 'planning' : 'working'} ${dur(Date.now() - s.current.since)}</span><div class="a-log mono">${esc(lastLog || 'starting…')}</div>` : s.waiting.length ? `<b>${s.waiting.length} plan${s.waiting.length > 1 ? 's' : ''} ready</b> <span class="muted tiny">· waiting for your approval</span>` : s.queued ? `<b>${s.queued} queued</b>` : s.last ? `<span class="muted tiny">Last:</span> ${esc(s.last.title)} <span class="tag">${s.last.status}</span>` : '<span class="muted">Ready for work</span>'}</div>
    ${full ? `<div class="muted tiny" style="margin:6px 0 8px">${esc(a.desc)}</div>` : ''}
    <div class="a-foot"><span class="tag ${a.engine}">${({ claude: 'Claude', codex: 'Codex', gemini: 'Gemini' })[a.engine] || a.engine}</span>${proj ? `<span class="tag p" style="--c:${proj.color}">${esc(proj.name)}</span>` : ''}${a.approval ? '<span class="tag" title="Plans first, executes only after your approval">approval-gated</span>' : ''}<span class="grow"></span><button class="btn sm" data-agent-details="${esc(a.id)}">Edit & access</button><button class="btn sm" data-give="${a.id}">Give task</button><button class="btn sm ghost" data-chat="${a.id}">Chat</button></div></div>`;
}
const colOf = { awaiting_approval: 'approve', running: 'run', planning: 'run', queued: 'queue', done: 'done', failed: 'done', cancelled: 'done' };
function taskCard(t) {
  const a = agentOf(t.agent); const live = ['running', 'planning'].includes(t.status);
  const ST_L = { awaiting_approval: 'Plan ready', running: 'Running', planning: 'Planning', queued: 'Queued', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
  return `<div class="tcard ${t.status}" data-task="${t.id}" style="--c:${a.color}"><div class="t-h"><span class="t-g">${window.JarvisCharacters?.html(a)||''}</span><b class="t">${esc(t.title)}</b></div><div class="muted tiny">${esc(a.name)} · ${ST_L[t.status]}${live && t.startedAt ? ' · ' + dur(Date.now() - t.startedAt) : t.finishedAt ? ' · ' + ago(t.finishedAt) : ''}</div>${live ? `<div class="a-log mono">${esc((t.log && t.log[t.log.length - 1]) || 'starting…')}</div><div class="shimmer-bar"></div>` : ''}${t.status === 'awaiting_approval' ? `<div class="t-plan">${esc((t.plan || '').replace(/\s+/g, ' ').slice(0, 170))}…</div><div class="t-act"><button class="btn sm primary" data-approve="${t.id}">Review & approve</button></div>` : ''}${t.status === 'failed' ? `<div class="t-err">${esc(t.error || 'failed')}</div>` : ''}</div>`;
}
function boardHtml() {
  const tasks = (S.team && S.team.tasks) || []; const cols = [['approve', 'Needs your approval', '#ffc233'], ['run', 'Working now', '#2dd4ee'], ['queue', 'Queued', '#8793a8'], ['done', 'Finished', '#35d49a']];
  return `<div class="board">${cols.map(([k, label, c]) => { const list = tasks.filter((t) => colOf[t.status] === k).slice(0, k === 'done' ? 6 : 12); return `<div class="bcol" style="--c:${c}"><div class="bcol-h"><i></i>${label}<span class="tag">${tasks.filter((t) => colOf[t.status] === k).length}</span></div>${list.map(taskCard).join('') || '<div class="muted tiny" style="padding:10px 4px">Nothing here</div>'}</div>`; }).join('')}</div>`;
}
function briefHtml() {
  const b = S.briefing; if (S.briefGenerating) return `<div class="card-h"><h2>☀ Today's rundown</h2><span class="muted">User Assistant is writing it…</span></div><div class="skeleton" style="height:22px;width:70%;margin-bottom:12px"></div><div class="skeleton" style="height:64px"></div>`;
  if (!b) return `<div class="card-h"><h2>☀ Today's rundown</h2></div><div class="empty" style="padding:14px 0">No rundown for today yet.<br><span class="tiny">Jarvis writes one automatically every morning from ${((S.team && S.team.settings.briefingHour) || 7)}:00 while it is running.</span><br><br><button class="btn primary" id="briefGo">Write today's rundown now</button></div>`;
  const planHtml = b.plan.length ? `<div class="plan"><div class="plan-h">Proposed work for today <button class="btn sm" id="planAll">Assign all</button></div>${b.plan.map((x) => { const a = agentOf(x.agent); return `<div class="plan-i ${x.assigned ? 'assigned' : ''}" style="--c:${a.color}"><span class="t-g">${window.JarvisCharacters?.html(a)||''}</span><div class="grow"><b>${esc(x.title)}</b><div class="muted tiny">${esc(a.name)} · ${esc(x.why || '')}</div></div>${x.assigned ? '<span class="tag">assigned</span>' : `<button class="btn sm" data-plan="${x.id}">Assign</button>`}</div>`; }).join('')}</div>` : '';
  return `<div class="card-h"><h2>☀ Today's rundown</h2><div style="display:flex;gap:8px"><button class="btn sm primary" id="briefPlay">▶ Listen</button><button class="btn sm ghost" id="briefRe" title="Write a fresh one">↻</button></div></div>
    <div class="b-head">${esc(b.headline)}</div><div class="muted tiny" style="margin-bottom:12px">Written ${new Date(b.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}${b.cost ? ' · ' + Math.round(b.cost * 100) + '¢' : ''}</div>
    <div class="b-secs">${b.sections.map((s) => `<div class="b-sec"><h3>${esc(s.title)}</h3><ul>${(s.items || []).map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('')}</div>${planHtml}${b.risks && b.risks.length ? `<div class="b-risk">⚠ ${b.risks.map(esc).join(' · ')}</div>` : ''}`;
}

async function vHome(v) {
  const u = S.usage; const t = S.team; const agents = (t && t.agents) || [];
  const hr = new Date().getHours(); const greet = hr < 5 ? 'Late night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const days = u ? dayList(u, 30) : []; const maxDay = Math.max(1, ...days.map((d) => d.claude)); const today = days.length ? days[days.length - 1] : { claude: 0, codex: 0 };
  const w7 = days.slice(-7); const c7 = sum(w7, 'claude'), x7 = sum(w7, 'codex'); const lim = u && u.codexLimits && u.codexLimits.primary;
  const working = agents.filter((a) => a.status.state === 'working').length, waiting = agents.reduce((n, a) => n + a.status.waiting.length, 0);
  v.innerHTML = `
  <section class="stage">
    <div class="gauge left"><div class="g-label" style="color:var(--claude)">CLAUDE</div>${ring(today.claude / maxDay, 'var(--claude)', u ? fmtN(today.claude) : '…', 'tokens today')}<div class="g-lines"><div><b>${u ? fmtN(c7) : '…'}</b><span>last 7 days</span></div><div><b>${u ? fmtN(sum(days, 'claude')) : '…'}</b><span>last 30 days</span></div></div></div>
    <div class="core"><div class="orb-wrap" id="homeOrbBox" title="Click to talk">${hudSvg()}<canvas id="homeOrb"></canvas></div><div class="core-name">USER ASSISTANT</div><div class="core-sub"><span id="homeState">${esc(Jarvis.state === 'idle' ? 'Tap the orb to talk' : Jarvis.state)}</span> · main agent · ${working} working${waiting ? ` · <b style="color:var(--warn)">${waiting} need${waiting > 1 ? '' : 's'} your OK</b>` : ''}</div></div>
    <div class="gauge right"><div class="g-label" style="color:var(--codex)">CODEX</div>${ring(lim ? lim.used_percent / 100 : today.codex / Math.max(1, ...days.map((d) => d.codex)), 'var(--codex)', lim ? Math.round(lim.used_percent) + '%' : (u ? fmtN(today.codex) : '…'), lim ? 'weekly limit used' : 'tokens today')}<div class="g-lines"><div><b>${u ? fmtN(x7) : '…'}</b><span>last 7 days</span></div><div><b>${lim && lim.resets_at ? new Date(lim.resets_at * 1000).toLocaleDateString(undefined, { weekday: 'short' }) : '—'}</b><span>limit resets</span></div></div></div>
  </section>
  <div class="hero-greet"><h1>${greet}, User.</h1><div class="sub">${new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })} · ${S.projects.length} projects · ${agents.length} agents on your team</div></div>
  <form class="askbar big" id="askForm"><button type="button" class="mic" id="askMic" title="Talk to User Assistant"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button><input id="askInput" autocomplete="off" placeholder="Ask User Assistant anything…"><button class="btn primary">Send</button></form>
  <div class="pill-row chip-scroll" style="justify-content:center;margin:12px 0 24px">${['What is everyone working on?', 'Analyse how project-alpha is performing', 'Edit the newest project-beta raw footage', 'Open usage'].map((q) => `<button class="chip-btn" data-ask="${esc(q)}">${esc(q)}</button>`).join('')}</div>
  <div class="grid g-main"><div class="card briefing" id="briefBox">${briefHtml()}</div><div class="card" id="focusBox"></div></div>
  <div class="sec-h"><h2>Your team</h2><a data-go="team" style="cursor:pointer">Manage team →</a></div><div id="roster">${rosterHtml(agents) || '<div class="skeleton" style="height:120px"></div>'}</div>
  <div class="sec-h"><h2>Task board</h2><span class="muted">live</span></div><div id="board">${boardHtml()}</div>
  <div class="grid g-main" style="margin-top:18px"><div class="card"><div class="card-h"><h2>Token usage · 14 days</h2>${legend()}</div><div id="hmChart"></div></div><div class="card"><div class="card-h"><h2>Connected platforms</h2><a data-go="platforms" style="cursor:pointer">All →</a></div><div class="plat-strip">${SVC().filter((s) => s.id !== 'other').map((s) => { const on = connectedSvc(s.id); return `<a data-go="platforms" class="pchip ${on ? 'on' : ''}" style="--c:${s.color}" title="${esc(s.name)} — ${on ? 'key stored' : 'no key yet'}">${esc(s.glyph || s.name[0])}</a>`; }).join('') || '<div class="muted">Open Vault & keys to import your keys.</div>'}</div></div></div>`;
  if (u) barChart($('#hmChart'), dayList(u, 14), ['claude', 'codex'], ['var(--claude)', 'var(--codex)']);
  const o = $('#homeOrb'); if (o) new Orb(o);
  requestAnimationFrame(() => document.querySelectorAll('.ring-fg').forEach((r) => { r.style.strokeDashoffset = +r.dataset.c * (1 - +r.dataset.p); }));
  $('#homeOrbBox').onclick = () => Jarvis.orbTap();
  $('#askForm').onsubmit = (e) => { e.preventDefault(); const q = $('#askInput').value; if (q.trim()) { if (Jarvis.st.agentId !== 'kim') Jarvis.setAgent('kim'); Jarvis.send(q, false); } };
  $('#askMic').onclick = () => Jarvis.startListening();
  renderFocus(); wireBrief();
  if (!t) loadTeam().then(() => route());
  if (!S.briefLoaded) { S.briefLoaded = true; try { const r = await api('/api/briefing'); S.briefing = r.briefing; S.briefGenerating = r.generating; if (!r.briefing && !r.generating && r.autoBriefing && hr >= 5 && S.health && S.health.claude.cli) generateBrief(false); else if (document.getElementById('briefBox')) { $('#briefBox').innerHTML = briefHtml(); wireBrief(); } } catch {} }
}
// connected = a key is stored in the vault, or the platform is connected through a Claude/Codex plugin or project website connection
const connectedSvc = (id) => !!(S.vault && S.vault.entries.some((e) => e.service === id && ((e.vars && e.vars.length) || e.file))) || !!(S.connectors && S.connectors[id]);
function renderFocus() {
  const el = $('#focusBox'); if (!el) return; const tasks = (S.team && S.team.tasks) || []; const wait = tasks.filter((t) => t.status === 'awaiting_approval'); const failed = tasks.filter((t) => t.status === 'failed').slice(0, 3);
  el.innerHTML = `<div class="card-h"><h2>⚡ Needs you</h2></div>` + (wait.length ? wait.map((t) => { const a = agentOf(t.agent); return `<div class="need" style="--c:${a.color}"><span class="t-g">${window.JarvisCharacters?.html(a)||''}</span><div class="grow"><b>${esc(t.title)}</b><div class="muted tiny">${esc(a.name)} has a plan ready</div></div><button class="btn sm primary" data-approve="${t.id}">Review</button></div>`; }).join('') : '') + failed.map((t) => `<div class="need bad"><span class="t-g">⚠</span><div class="grow"><b>${esc(t.title)}</b><div class="muted tiny t">${esc(t.error || 'failed')}</div></div><button class="btn sm" data-task="${t.id}">Open</button></div>`).join('') +
    (!wait.length && !failed.length ? `<div class="empty" style="padding:18px 0">All clear. Nothing is waiting for your decision.</div>` : '') +
    `<div class="muted tiny" style="margin-top:12px">Agents that post or spend credits always stop at a plan first. You approve before anything goes public.</div>`;
}
function wireBrief() {
  const go = $('#briefGo'); if (go) go.onclick = () => generateBrief(true);
  const re = $('#briefRe'); if (re) re.onclick = () => generateBrief(true);
  const pl = $('#briefPlay'); if (pl) pl.onclick = () => { if (S.briefing) Jarvis.say(S.briefing.spoken || S.briefing.headline); };
  const all = $('#planAll'); if (all) all.onclick = () => assignPlan('all');
}
async function generateBrief(regenerate) {
  S.briefGenerating = true; const b = $('#briefBox'); if (b) b.innerHTML = briefHtml();
  try { const r = await post('/api/briefing', { regenerate }); S.briefing = r.briefing; } catch (e) { toast(e.message); }
  S.briefGenerating = false; const b2 = $('#briefBox'); if (b2) { b2.innerHTML = briefHtml(); wireBrief(); }
}
async function assignPlan(i) { try { const r = await post('/api/briefing/assign', { index: i }); S.briefing = r.briefing; toast(`${r.tasks.length} task${r.tasks.length === 1 ? '' : 's'} assigned`); await loadTeam(); const b = $('#briefBox'); if (b) { b.innerHTML = briefHtml(); wireBrief(); } refreshTeamViews(); } catch (e) { toast(e.message); } }

/* ---------- live refresh of team widgets ---------- */
// update a block only when its markup really changed and the user is not working inside it (no lost typing, no closing dropdowns)
function setHtml(el, html) { if (!el) return; if (el._h === html) return; const ae = document.activeElement; if (ae && el.contains(ae) && /INPUT|TEXTAREA|SELECT/.test(ae.tagName)) return; el._h = html; el.innerHTML = html; }
function refreshTeamViews() {
  const r = $('#roster'); if (r && S.team) setHtml(r, rosterHtml(S.team.agents, S.teamFull));
  const b = $('#board'); if (b && S.team) setHtml(b, boardHtml());
  renderFocus();
  const full = $('#teamTasks'); if (full) setHtml(full, taskListHtml());
  const tm = $('#taskModal'); if (tm && S.openTask) renderTaskModal(S.openTask, true);
  const hs = $('#homeState'); if (hs && S.team) { const w = S.team.agents.filter((a) => a.status.state === 'working').length; const core = $('.core-sub'); if (core) core.innerHTML = `<span id="homeState">${esc(hs.textContent)}</span> · main agent · ${w} working`; }
}
setInterval(async () => { const r = (location.hash.slice(2).split('/')[0]) || 'home'; if (!['home', 'team', 'video'].includes(r) && !S.openTask) return; const before = JSON.stringify(S.team && S.team.tasks.map((t) => t.status + (t.log || []).length)); await loadTeam(); if (r === 'video') { if (JSON.stringify(S.team.tasks.map((t) => t.status + (t.log || []).length)) !== before) vVideoRefresh(); return; } refreshTeamViews(); }, 4000);
window.addEventListener('jarvis:tasks', async () => { await loadTeam(); refreshTeamViews(); });

/* ---------- task modal ---------- */
function renderTaskModal(id, quiet) {
  const t = S.team.tasks.find((x) => x.id === id); if (!t) return; S.openTask = id; const a = agentOf(t.agent);
  const live = ['running', 'planning'].includes(t.status);
  const body = `<div style="display:flex;justify-content:space-between;gap:12px"><div><span class="tag p" style="--c:${a.color}">${window.JarvisCharacters?.html(a)||''} ${esc(a.name)}</span> <span class="tag">${t.status.replace('_', ' ')}</span> <span class="tag ${t.engine}">${t.engine}</span><h2 style="margin:10px 0 4px;font-size:19px">${esc(t.title)}</h2><div class="muted tiny">Created ${ago(t.createdAt)} by ${esc(t.createdBy)}${t.cost ? ' · cost ≈ ' + Math.round(t.cost * 100) + '¢' : ''}</div></div><button class="btn sm" id="tmX" style="align-self:flex-start">✕</button></div>
    <details style="margin-top:12px"><summary class="muted tiny" style="cursor:pointer">Instructions given</summary><div class="doc">${esc(t.prompt)}</div></details>
    ${t.plan ? `<div class="doc-h">Plan</div><div class="doc">${mdLite(t.plan)}</div>` : ''}
    ${live ? `<div class="doc-h">Live activity</div><div class="doc mono tiny">${(t.log || []).slice(-12).map(esc).join('<br>') || 'starting…'}</div>${t.partial ? `<div class="doc">${mdLite(t.partial)}</div>` : ''}<div class="shimmer-bar"></div>` : ''}
    ${t.output ? `<div class="doc-h">Result</div><div class="doc">${mdLite(t.output)}</div>` : ''}${t.error ? `<div class="t-err" style="margin-top:12px">${esc(t.error)}</div>` : ''}
    ${t.status === 'awaiting_approval' ? `<div class="field" style="margin-top:14px"><label>Notes for the agent (optional) — changes you want before it runs</label><input id="tmNote" placeholder="e.g. use the cheaper model, keep it under 8 seconds"></div><div class="approve-warn">Approving lets <b>${esc(a.name)}</b> execute this plan with its execution tools${(S.team.agents.find((x) => x.id === t.agent) || {}).services && (S.team.agents.find((x) => x.id === t.agent) || {}).services.length ? ' and the credentials for ' + S.team.agents.find((x) => x.id === t.agent).services.map((s) => svcById(s).name).join(', ') : ''}. Posting or generating can cost money or be public.</div>` : ''}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px;flex-wrap:wrap">
      ${t.extractId ? `<button class="btn" data-go="video" id="tmVid">Open in Video Intel</button>` : ''}
      ${t.status === 'awaiting_approval' ? '<button class="btn" id="tmReject">Reject</button><button class="btn primary" id="tmApprove">Approve & run</button>' : ''}
      ${live || t.status === 'queued' ? '<button class="btn" id="tmCancel">Cancel task</button>' : ''}${['failed', 'cancelled'].includes(t.status) ? '<button class="btn primary" id="tmRetry">Retry</button>' : ''}${['done', 'failed', 'cancelled'].includes(t.status) ? '<button class="btn ghost" id="tmRemove">Remove</button>' : ''}</div>`;
  const m = $('#modal'); if (quiet && !m.hidden && $('#taskModal')) { const keep = ($('#tmNote') || {}).value; $('#taskModal').innerHTML = body; if (keep && $('#tmNote')) $('#tmNote').value = keep; } else { modal(`<div id="taskModal">${body}</div>`, true); }
  const act = (url, extra) => async () => { try { await post(url, { id, ...extra }); await loadTeam(); closeModal(); S.openTask = null; refreshTeamViews(); } catch (e) { toast(e.message); } };
  $('#tmX').onclick = () => { closeModal(); S.openTask = null; };
  if ($('#tmApprove')) $('#tmApprove').onclick = async () => { try { await post('/api/tasks/approve', { id, note: ($('#tmNote') || {}).value }); await loadTeam(); toast('Approved. ' + a.name + ' is on it.'); closeModal(); S.openTask = null; refreshTeamViews(); } catch (e) { toast(e.message); } };
  if ($('#tmReject')) $('#tmReject').onclick = act('/api/tasks/cancel'); if ($('#tmCancel')) $('#tmCancel').onclick = act('/api/tasks/cancel'); if ($('#tmRetry')) $('#tmRetry').onclick = act('/api/tasks/retry'); if ($('#tmRemove')) $('#tmRemove').onclick = act('/api/tasks/remove');
  if ($('#tmVid')) $('#tmVid').onclick = () => { closeModal(); S.openTask = null; };
}
function giveTaskModal(agentId, prefill) {
  const a = agentOf(agentId); prefill = prefill || {}; modal(`<h2 style="font-size:19px;margin-bottom:4px">${window.JarvisCharacters?.html(a)||''} Give ${esc(a.name)} a task</h2><div class="muted" style="margin-bottom:14px">${esc(a.desc || '')}${a.approval ? '<br><b>This agent plans first and waits for your approval before it executes.</b>' : ''}</div>
    <div class="field"><label>Short title</label><input id="gtTitle" placeholder="e.g. Autumn teaser for project-alpha"></div><div class="field"><label>What should it do? Be specific (files, platform, format, deadline)</label><textarea id="gtPrompt" rows="5"></textarea></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="gtX">Cancel</button><button class="btn primary" id="gtGo">Assign</button></div>`);
  if (prefill.title) $('#gtTitle').value = prefill.title; if (prefill.prompt) { $('#gtPrompt').value = prefill.prompt; $('#gtPrompt').focus(); $('#gtPrompt').setSelectionRange(prefill.prompt.length, prefill.prompt.length); }
  $('#gtX').onclick = closeModal; $('#gtGo').onclick = async () => { try { const t = await post('/api/tasks', { agent: agentId, title: $('#gtTitle').value || $('#gtPrompt').value, prompt: $('#gtPrompt').value }); closeModal(); await loadTeam(); toast('Assigned to ' + a.name); refreshTeamViews(); } catch (e) { toast(e.message); } };
}

/* ================= TEAM ================= */
function taskListHtml() {
  const tasks = (S.team && S.team.tasks) || []; const f = S.teamFilter || 'all';
  const rows = tasks.filter((t) => f === 'all' || t.agent === f);
  return `<table><tr><th>Task</th><th>Agent</th><th>Status</th><th class="num">When</th></tr>${rows.map((t) => { const a = agentOf(t.agent); return `<tr class="click" data-task="${t.id}"><td class="ell">${esc(t.title)}</td><td><span style="color:${a.color}">${window.JarvisCharacters?.html(a)||''}</span> ${esc(a.name)}</td><td><span class="tag">${t.status.replace('_', ' ')}</span></td><td class="num">${ago(t.createdAt)}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">No tasks yet. Ask User Assistant or press “Give task”.</td></tr>'}</table>`;
}
async function vTeam(v) {
  if (!S.team) await loadTeam(); if (!S.vault) await loadVault(); const t = S.team; if (!t) return (v.innerHTML = '<div class="empty">Loading team…</div>');
  S.teamFull = true; const st = t.settings;
  v.innerHTML = `<div class="hello"><div><h1>Agent team</h1><div class="sub">User Assistant is the main agent. Tell it what you need and it assigns the right specialist. Each agent has its own tools, project, engine and permissions.</div></div><div class="briefing-control" role="group" aria-label="Morning briefing schedule"><label class="sw" for="tmAuto"><input type="checkbox" id="tmAuto" ${st.autoBriefing ? 'checked' : ''}><i aria-hidden="true"></i><span>Morning briefing</span></label><label class="briefing-time" for="tmHour"><span>At</span><select id="tmHour" aria-label="Morning briefing time" ${st.autoBriefing ? '' : 'disabled'}>${Array.from({length:9},(_,i)=>i+4).map((h) => `<option value="${h}" ${h === st.briefingHour ? 'selected' : ''}>${String(h).padStart(2,'0')}:00</option>`).join('')}</select></label><span class="briefing-save" id="tmSaveState" role="status"></span></div></div>
  <div id="agentNetworkPanel"></div><div id="roster">${rosterHtml(t.agents, true)}</div>
  <div class="sec-h"><h2>Agent settings</h2><span class="muted">engine, approval gate and credentials injected at run time</span></div>
  <div class="grid g2">${t.agents.filter((a) => !a.main).map((a) => `<div class="card" style="border-top:3px solid ${a.color}"><div class="card-h"><h3 style="font-size:15px">${window.JarvisCharacters?.html(a)||''} ${esc(a.name)}</h3><label class="sw"><input type="checkbox" data-en="${a.id}" ${a.enabled === false ? '' : 'checked'}><i></i>On</label></div>
    <div class="seg" data-eng="${a.id}"><button class="${a.engine === 'claude' ? 'on' : ''}" data-v="claude">Claude</button><button class="${a.engine === 'codex' ? 'on' : ''}" data-v="codex">Codex</button></div>
    <label class="sw" style="margin:12px 0"><input type="checkbox" data-ap="${a.id}" ${a.approval ? 'checked' : ''}><i></i>Plan first, wait for my approval before executing</label>
    <div class="muted tiny" style="margin-bottom:6px">Credentials this agent receives while executing an approved task:</div>
    <div class="svc-pick" data-svc="${a.id}">${SVC().filter((s) => s.id !== 'other').map((s) => `<button class="${(a.services || []).includes(s.id) ? 'on' : ''}" data-s="${s.id}" style="--c:${s.color}">${esc(s.name.split(' ')[0])}${connectedSvc(s.id) ? '' : ' <i title="no key stored yet">○</i>'}</button>`).join('')}</div></div>`).join('')}</div>
  <div class="sec-h"><h2>All tasks</h2><select id="tmFilter" class="mini"><option value="all">All agents</option>${t.agents.map((a) => `<option value="${a.id}" ${S.teamFilter === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div><div class="card" id="teamTasks">${taskListHtml()}</div>`;
  window.JarvisAgentNetwork?.mount($('#agentNetworkPanel'), t);
  const saveAgent = async (id, patch) => { try { await post('/api/team/agent', { id, ...patch }); await loadTeam(); } catch (e) { toast(e.message); } };
  const saveBriefing = async (key,value) => {
    const toggle=$('#tmAuto'),hour=$('#tmHour'),status=$('#tmSaveState'),previous=S.team.settings[key];toggle.disabled=hour.disabled=true;status.textContent='Saving…';
    try { await post('/api/settings',{[key]:value});S.team.settings[key]=value;status.textContent='Saved'; }
    catch(e){if(key==='autoBriefing')toggle.checked=previous;else hour.value=previous;status.textContent='Not saved';toast(e.message);}
    finally{toggle.disabled=false;hour.disabled=!toggle.checked;}
  };
  $('#tmAuto').onchange=e=>saveBriefing('autoBriefing',e.target.checked);$('#tmHour').onchange=e=>saveBriefing('briefingHour',+e.target.value);
  document.querySelectorAll('[data-en]').forEach((el) => (el.onchange = () => saveAgent(el.dataset.en, { enabled: el.checked })));
  document.querySelectorAll('[data-ap]').forEach((el) => (el.onchange = () => saveAgent(el.dataset.ap, { approval: el.checked })));
  document.querySelectorAll('[data-eng]').forEach((g) => (g.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; await saveAgent(g.dataset.eng, { engine: b.dataset.v }); g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); }));
  document.querySelectorAll('[data-svc]').forEach((g) => (g.onclick = async (e) => { const b = e.target.closest('button'); if (!b) return; b.classList.toggle('on'); await saveAgent(g.dataset.svc, { services: [...g.querySelectorAll('button.on')].map((x) => x.dataset.s) }); }));
  $('#tmFilter').onchange = (e) => { S.teamFilter = e.target.value; $('#teamTasks').innerHTML = taskListHtml(); };
}

/* ================= VAULT ================= */
function entryHtml(e) {
  const s = svcById(e.service);
  return `<div class="ventry" data-eid="${e.id}" style="--c:${s.color}"><div class="v-top"><span class="svc-badge" style="--c:${s.color}">${esc(s.glyph || s.name[0])}</span><div class="grow"><div class="v-name" data-rename="${e.id}" title="Click to rename">${esc(e.name)}</div><div class="muted tiny mono t">${e.source ? esc(e.source.replace('/Volumes/', '').replace(/^.*?Users\/example-user\//, '~/')) : 'added manually'} · updated ${ago(e.updatedAt)}</div></div><select class="mini" data-svcsel="${e.id}">${SVC().map((x) => `<option value="${x.id}" ${x.id === e.service ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div class="v-vars">${e.vars.map((x) => `<div class="v-var"><span class="mono k">${esc(x.k)}</span><span class="mono val" data-val="${e.id}|${esc(x.k)}">${x.empty ? '<i class="muted">empty</i>' : esc(x.hint)}</span><span class="v-act"><button class="ibtn sm" data-reveal-var="${e.id}|${esc(x.k)}" title="Show for 8 seconds">👁</button><button class="ibtn sm" data-copy-var="${e.id}|${esc(x.k)}" title="Copy value">⧉</button><button class="ibtn sm" data-edit-var="${e.id}|${esc(x.k)}" title="Replace this key">✎</button></span></div>`).join('')}${e.file ? `<div class="v-var"><span class="mono k">🔑 ${esc(e.file.name)}</span><span class="muted tiny">${fmtB(e.file.size)} key file, encrypted</span><span class="v-act"><button class="ibtn sm" data-dl-file="${e.id}" title="Download decrypted copy">⭳</button></span></div>` : ''}</div>
    <div class="v-foot"><button class="btn sm" data-edit-var="${e.id}|">✎ Paste new key</button><button class="btn sm ghost" data-copy-env="${e.id}">Copy as .env</button>${e.source ? `<button class="btn sm ghost" data-reveal-src="${esc(e.source)}">Show original</button>` : ''}<span class="grow"></span><button class="btn sm ghost danger-t" data-del-entry="${e.id}">Remove from vault</button></div></div>`;
}
async function vVault(v) {
  await loadVault(); const V = S.vault; const st = V.status;
  const by = {}; for (const e of V.entries) (by[e.service] = by[e.service] || []).push(e);
  const order = SVC().map((s) => s.id).filter((id) => by[id]);
  v.innerHTML = `<div class="hello"><div><h1>Vault & keys</h1><div class="sub">Every API key and .env file, named and encrypted. Agents never read these files: Jarvis hands credentials to an agent only while it executes a task you approved.</div></div><div class="pill-row"><button class="btn" id="vAudit">Activity log</button><button class="btn" id="vAdd">＋ Paste keys</button><button class="btn primary" id="vScan">⌕ Scan & import .env files</button></div></div>
  <div class="vault-hero"><div class="lock"><svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="21" width="30" height="22" rx="5"/><path d="M16 21v-6a8 8 0 0 1 16 0v6"/><circle cx="24" cy="32" r="3" fill="currentColor"/></svg></div><div><b>${st.ok ? 'Vault unlocked' : 'Vault problem'}</b><div class="muted">${st.ok ? `${st.count} item${st.count === 1 ? '' : 's'} · AES-256-GCM · master key in ${st.store === 'keychain' ? 'your macOS Keychain (not on the drive)' : 'a protected file on this Mac (not on the drive)'}` : esc(st.error)}</div></div><div class="grow"></div><div class="pill-row">${SVC().filter((s) => s.id !== 'other').map((s) => `<span class="pchip ${connectedSvc(s.id) ? 'on' : ''}" style="--c:${s.color}" title="${esc(s.name)}">${esc(s.glyph || s.name[0])}</span>`).join('')}</div></div>
  ${order.length ? order.map((id) => { const s = svcById(id); return `<div class="sec-h"><h2><span style="color:${s.color}">●</span> ${esc(s.name)}</h2><span class="muted">${esc(s.desc)}</span></div><div class="grid g2">${by[id].map(entryHtml).join('')}</div>`; }).join('') : `<div class="card empty" style="padding:44px"><div style="font-size:40px;margin-bottom:8px">🔐</div><h2 style="margin-bottom:6px">Nothing in the vault yet</h2>Press <b>Scan & import .env files</b>. Jarvis finds the .env files in your projects, shows you only the variable names, and encrypts the ones you choose. Your original files are left untouched.</div>`}`;
  $('#vScan').onclick = scanModal; $('#vAdd').onclick = () => addKeyModal(); $('#vAudit').onclick = auditModal;
}
async function scanModal() {
  modal('<h2 style="font-size:19px">Scanning for .env files…</h2><div class="skeleton" style="height:60px;margin-top:14px"></div>', true);
  let files; try { files = (await api('/api/vault/scan?force=1')).files; } catch (e) { return modal(`<div class="empty">${esc(e.message)}</div>`); }
  const todo = files.filter((f) => !f.imported && !f.unreadable);
  modal(`<h2 style="font-size:19px;margin-bottom:4px">Found ${files.length} key file${files.length === 1 ? '' : 's'}</h2><div class="muted" style="margin-bottom:14px">Only variable <b>names</b> are shown here. Selected files are read by Jarvis, encrypted, and named as you choose. Originals are not changed or deleted.</div>
  <div class="scan-list">${files.map((f, i) => { const s = svcById(f.service); const pr = f.project ? (S.projects.find((p) => p.id === f.project) || {}).name : null; return `<label class="scan-row ${f.imported || f.unreadable ? 'done' : ''}" style="--c:${s.color}"><input type="checkbox" data-i="${i}" ${f.imported || f.unreadable ? 'disabled' : 'checked'}><span class="svc-badge" style="--c:${s.color}">${esc(s.glyph || s.name[0])}</span><div class="grow"><input class="sc-name" data-n="${i}" value="${esc(f.imported ? '(already in vault)' : s.name + (pr ? ' · ' + pr : '') + (files.filter((x) => x.service === f.service && x.project === f.project).length > 1 ? ' · ' + f.base : ''))}" ${f.imported ? 'disabled' : ''}><div class="muted tiny mono t">${esc(f.path.replace('/Volumes/', '').replace(/^.*?Users\/example-user\//, '~/'))}</div><div class="tiny">${f.unreadable ? `<span style="color:var(--warn)">⚠ ${esc(f.unreadable)}</span>` : f.kind === 'file' ? '🔑 key file (' + fmtB(f.size) + ')' : f.vars.map((x) => `<span class="vn">${esc(x)}</span>`).join('')}</div></div></label>`; }).join('') || '<div class="empty">No .env or key files found in your projects.</div>'}</div>
  <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:16px"><span class="muted tiny">${todo.length} new · ${files.length - todo.length} already imported</span><div style="display:flex;gap:10px"><button class="btn" id="scX">Cancel</button><button class="btn primary" id="scGo" ${todo.length ? '' : 'disabled'}>Encrypt & import selected</button></div></div>`, true);
  $('#scX').onclick = closeModal;
  $('#scGo').onclick = async () => { const items = [...document.querySelectorAll('.scan-row input[type=checkbox]:checked')].map((c) => { const i = +c.dataset.i; return { path: files[i].path, service: files[i].service, name: document.querySelector(`.sc-name[data-n="${i}"]`).value }; }); if (!items.length) return; try { const r = await post('/api/vault/import', { items }); closeModal(); toast(`Encrypted ${r.imported} item${r.imported === 1 ? '' : 's'}` + (r.skipped && r.skipped.length ? `. Skipped ${r.skipped.length}: ${r.skipped[0].error}` : '')); await loadVault(); route(); Jarvis.checkVoice(); } catch (e) { toast(e.message); } };
}
const KEY_GUESS = [[/^AIza[0-9A-Za-z_-]{20,}/, 'gemini'], [/^sk-ant-/, 'anthropic'], [/^sk_[0-9a-f]{20,}/, 'elevenlabs'], [/^sk-(proj-)?[A-Za-z0-9_-]{20,}/, 'openai'], [/^shp(at|ca|ss)_/, 'shopify'], [/^(sk|rk)_(live|test)_/, 'stripe']];
// Paste-only key dialog: pick the service (or paste and it is recognised), paste the key, save. entryId = replace a key that already exists.
function addKeyModal(service, entryId, varKey) {
  const ent = entryId ? S.vault.entries.find((x) => x.id === entryId) : null; const svc0 = ent ? ent.service : (service || 'elevenlabs');
  const msg = () => { const s = svcById($('#akSvc') ? $('#akSvc').value : svc0); const env = ent && varKey ? varKey : s.envName || 'API_KEY'; return `Paste your <b>${esc(s.name)}</b> key below. Jarvis saves it as <span class="mono">${esc(env)}</span>, encrypted, and connects it automatically. Nothing else to fill in.${s.url ? ` <a href="${esc(s.url)}" target="_blank" rel="noopener">Where do I find it?</a>` : ''}`; };
  modal(`<h2 style="font-size:19px;margin-bottom:4px">${ent ? (varKey ? 'Replace ' + esc(varKey) : 'Paste a new key for ' + esc(ent.name)) : 'Add a key'}</h2>
  <div class="muted" id="akMsg" style="margin-bottom:14px"></div>
  ${ent ? '' : `<div class="field"><label>Service</label><select id="akSvc">${SVC().map((s) => `<option value="${s.id}" ${s.id === svc0 ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`}
  <div class="field"><label>Key</label><input id="akKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" class="mono" placeholder="Paste the key here"></div>
  <label class="muted tiny" style="display:flex;gap:6px;align-items:center;margin:-4px 0 12px"><input type="checkbox" id="akShow">Show what I paste</label>
  <details style="margin-bottom:14px"><summary class="muted tiny" style="cursor:pointer">I have a whole .env block (several KEY=VALUE lines)</summary><div class="field" style="margin-top:8px"><textarea id="akText" rows="4" class="mono" placeholder="HIGGSFIELD_API_KEY=…"></textarea></div></details>
  <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="akX">Cancel</button><button class="btn primary" id="akGo">Save and connect</button></div>`);
  const upd = () => { $('#akMsg').innerHTML = msg(); }; upd();
  if ($('#akSvc')) $('#akSvc').onchange = upd;
  $('#akShow').onchange = (e) => { $('#akKey').type = e.target.checked ? 'text' : 'password'; };
  $('#akKey').oninput = () => { if (ent || !$('#akSvc')) return; const g = KEY_GUESS.find(([re]) => re.test($('#akKey').value.trim())); if (g && SVC().some((x) => x.id === g[1])) { $('#akSvc').value = g[1]; upd(); } };
  const keyInput=$('#akKey');setTimeout(() => { if(keyInput?.isConnected)keyInput.focus(); }, 50);
  $('#akX').onclick = closeModal;
  const go = async () => {
    try {
      const block = $('#akText').value.trim(), key = $('#akKey').value.trim();
      if (block && !ent) await post('/api/vault/entry', { name: svcById($('#akSvc').value).name, service: $('#akSvc').value, text: block });
      else await post('/api/vault/set-key', { id: entryId || undefined, key: varKey || undefined, service: $('#akSvc') ? $('#akSvc').value : undefined, value: block && ent ? block : key });
      closeModal(); toast('Saved and connected'); await loadVault(); route(); Jarvis.checkVoice();
    } catch (e) { toast(e.message); }
  };
  $('#akGo').onclick = go; $('#akKey').onkeydown = (e) => { if (e.key === 'Enter') go(); };
}
async function auditModal() { const r = await api('/api/vault/audit'); modal(`<div style="display:flex;justify-content:space-between"><h2 style="font-size:19px">Vault activity</h2><button class="btn sm" id="auX">✕</button></div><div class="muted tiny" style="margin:6px 0 12px">Every import, reveal and delete is logged here (names only, never values).</div><table>${r.log.map((l) => `<tr><td class="muted tiny">${new Date(l.t).toLocaleString()}</td><td><span class="tag">${l.action}</span></td><td>${esc(l.entry || '')}</td><td class="mono tiny">${esc(l.key || '')}</td></tr>`).join('') || '<tr><td class="empty">No activity yet</td></tr>'}</table>`, true); $('#auX').onclick = closeModal; }

/* ================= PLATFORMS ================= */
async function vPlatforms(v) {
  await loadVault(); await Promise.all([loadConnectors(), ...S.projects.map((p) => loadWorkspace(p.id))]); const svcs = SVC().filter((s) => s.id !== 'other'); const sel = S.platSel || svcs[0].id;
  const W = 920, H = 560, cx = 460, cy = 280, rx = 320, ry = 205;
  // place nodes at equal arc-length steps around the ellipse so the sides do not crowd
  const pts = []; let acc = 0, px = null, py = null; for (let k = 0; k <= 720; k++) { const a = (k / 720) * 2 * Math.PI - Math.PI / 2, x = cx + Math.cos(a) * rx, y = cy + Math.sin(a) * ry; if (px !== null) acc += Math.hypot(x - px, y - py); pts.push({ x, y, d: acc }); px = x; py = y; }
  const nodes = svcs.map((s, i) => { const target = (i / svcs.length) * acc; const p = pts.find((q) => q.d >= target) || pts[0]; return { s, x: p.x, y: p.y, on: connectedSvc(s.id) }; });
  const svg = `<svg viewBox="0 0 ${W} ${H}" class="constel"><defs><filter id="glow"><feGaussianBlur stdDeviation="5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    ${nodes.map((n) => `<line x1="${cx}" y1="${cy}" x2="${n.x}" y2="${n.y}" class="spoke ${n.on ? 'on' : ''}" style="--c:${n.s.color}"/>`).join('')}
    ${nodes.map((n, i) => `<g class="node ${n.on ? 'on' : ''} ${n.s.id === sel ? 'sel' : ''}" data-plat="${n.s.id}" transform="translate(${n.x},${n.y})" style="--c:${n.s.color};--d:${i * 70}ms"><circle r="34" class="n-bg"/><circle r="34" class="n-ring"/><text class="n-g" text-anchor="middle" dy="6">${esc(n.s.glyph || n.s.name[0])}</text><text class="n-l" text-anchor="middle" y="54">${esc(n.s.name)}</text></g>`).join('')}</svg>`;
  v.innerHTML = `<div class="hello"><div><h1>Platforms</h1><div class="sub">Everything Jarvis can reach. A green dot means it is connected (a key in the vault or a plugin). Tap one for details or to add a key.</div></div><button class="btn primary" id="plAdd">＋ Add keys</button></div>
  <div class="card constel-wrap"><div class="c-orb"><canvas id="plOrb"></canvas></div>${svg}</div>
  <div class="plat-tiles">${nodes.map((n) => `<button class="ptile ${n.on ? 'on' : ''} ${n.s.id === sel ? 'sel' : ''}" data-plat="${n.s.id}" style="--c:${n.s.color}"><span class="svc-badge" style="--c:${n.s.color}">${esc(n.s.glyph || n.s.name[0])}</span><span class="pt-n">${esc(n.s.name)}</span><i></i></button>`).join('')}</div>
  <div id="platDetail"></div>
  <div class="sec-h"><h2>Plugins, skills & connectors</h2><a data-go="agents" style="cursor:pointer">Open full list →</a></div>
  <div class="grid g3">${S.agents ? `<div class="card"><div class="card-h"><h3 style="color:var(--claude)">Claude Code</h3><span class="tag claude">${S.agents.claude.skills.length} skills</span></div>${S.agents.claude.plugins.map((p) => `<div class="row"><div class="grow t">🔌 ${esc(p.name)}</div><span class="muted tiny">v${esc(p.version)}</span></div>`).join('') || '<div class="muted tiny">No plugins</div>'}${(S.agents.claude.mcp || []).map((m) => `<div class="row"><div class="grow t">⛓ ${esc(m)}</div><span class="tag">MCP</span></div>`).join('')}</div>
    <div class="card"><div class="card-h"><h3 style="color:var(--codex)">Codex</h3><span class="tag codex">${S.agents.codex.skills.length} skills</span></div>${S.agents.codex.plugins.filter((p) => p.enabled).map((p) => `<div class="row"><div class="grow t">🔌 ${esc(p.name)}</div><span class="tag">on</span></div>`).join('') || '<div class="muted tiny">No plugins</div>'}</div>
    <div class="card"><div class="card-h"><h3>Connected tools in Claude chats</h3></div><div class="muted tiny" style="margin-bottom:8px">Connectors you added in Claude (Shopify, Higgsfield, Gmail, Docs…) work in Claude chats. For Jarvis's own agents, store the key in the vault and enable it for that agent on the Team page.</div>${Object.entries((S.usage && S.usage.tools && S.usage.tools.mcp) || {}).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `<div class="row"><div class="grow t mono tiny">${esc(k.length > 20 ? k.slice(0, 8) + '…' : k)}</div><b>${n}×</b></div>`).join('') || '<div class="muted tiny">No connector calls recorded.</div>'}</div>` : '<div class="skeleton" style="height:120px"></div>'}</div>`;
  const o = $('#plOrb'); if (o) new Orb(o); $('#plAdd').onclick = () => addKeyModal(S.platSel);
  const storesFor = (sid) => { if (sid !== 'shopify') return ''; const rows = []; for (const p of S.projects) for (const w of ((S.ws && S.ws[p.id] && S.ws[p.id].websites) || [])) if (w.kind === 'shopify') rows.push({ p, w }); return rows.length ? `<div class="doc-h">Your Shopify stores</div>${rows.map(({ p, w }) => `<div class="row"><span style="color:${p.color}">●</span><div class="grow"><b>${esc(w.name)}</b><div class="muted tiny mono">${esc(w.store || '')}</div></div>${w.connection === 'claude-connector' ? '<span class="chip2 good">✓ Claude connector</span>' : '<span class="chip2 warn">Shopify CLI login (you)</span>'}</div>`).join('')}<div class="muted tiny" style="margin-top:8px">The Claude Shopify connector is linked to the project-alpha store only. For project-beta, Jarvis agents use your Shopify CLI login. To let Jarvis agents work with a store directly, add its Admin API token with “Add key”.</div>` : ''; };
  const viaOf = (sid) => (S.connectors && S.connectors[sid]) || '';
  const detail = () => { const s = svcById(S.platSel || svcs[0].id); const ents = S.vault.entries.filter((e) => e.service === s.id); const users = (S.team ? S.team.agents.filter((a) => (a.services || []).includes(s.id)) : []);
    $('#platDetail').innerHTML = `<div class="card plat-detail" style="--c:${s.color}"><div class="v-top"><span class="svc-badge big" style="--c:${s.color}">${esc(s.glyph || s.name[0])}</span><div class="grow"><h2 style="font-size:20px">${esc(s.name)} <span class="tag">${esc(s.cat)}</span> <span class="chip2 ${ents.length || viaOf(s.id) ? 'good' : 'warn'}">${ents.length ? '✓ key in vault' : viaOf(s.id) ? '✓ connected via plugin' : 'not connected'}</span>${ents.length && viaOf(s.id) ? ` <span class="chip2 good">✓ ${esc(viaOf(s.id))}</span>` : viaOf(s.id) && !ents.length ? ` <span class="chip2">${esc(viaOf(s.id))}</span>` : ''}</h2><div class="muted">${esc(s.desc)}</div></div><div class="pill-row">${s.url ? `<a class="btn" href="${esc(s.url)}" target="_blank" rel="noopener">Open ${esc(s.name.split(' ')[0])} ↗</a>` : ''}<button class="btn primary" data-addsvc="${s.id}">＋ Add key</button></div></div>
      ${ents.length ? `<div class="grid g2" style="margin-top:14px">${ents.map(entryHtml).join('')}</div>` : `<div class="muted" style="margin:14px 0 4px">No key stored in the vault.${viaOf(s.id) ? ' This platform is connected through a plugin, so Claude chats can use it; add a key if Jarvis agents should use it too.' : ' Add one here or use Scan & import in Vault.'}</div>`}${storesFor(s.id)}<div style="margin-top:12px"><label class="sw"><input type="checkbox" data-viaplug="${s.id}" ${viaOf(s.id) ? 'checked' : ''}><i></i>Connected through a Claude / Codex plugin or connector</label></div>${users.length ? `<div class="muted tiny" style="margin-top:12px">Used by: ${users.map((a) => `${window.JarvisCharacters?.html(a)||''} ${esc(a.name)}`).join(' · ')}</div>` : ''}</div>`; };
  detail();
  const pick = (e) => { const g = e.target.closest('[data-plat]'); if (!g) return; S.platSel = g.dataset.plat; document.querySelectorAll('.node').forEach((n) => n.classList.toggle('sel', n.dataset.plat === S.platSel)); document.querySelectorAll('.ptile').forEach((n) => n.classList.toggle('sel', n.dataset.plat === S.platSel)); detail(); if (innerWidth <= 800) $('#platDetail').scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  document.querySelector('.constel').onclick = pick; document.querySelector('.plat-tiles').onclick = pick;
}

/* ================= VIDEO INTEL ================= */
function vVideoRefresh() { if (location.hash.startsWith('#/video')) vVideo($('#view')); }
async function vVideo(v) {
  if (!S.team) await loadTeam(); const ex = (await api('/api/extracts').catch(() => ({ extracts: [] }))).extracts;
  const active = (S.team.tasks || []).filter((t) => t.agent === 'video-intel' && ['queued', 'running', 'planning'].includes(t.status));
  v.innerHTML = `<div class="hello"><div><h1>Video Intel</h1><div class="sub">Send any video. Jarvis pulls out the frames, audio and transcript, and the Video Intel agent writes up everything in it so you can reuse it.</div></div></div>
  <div class="card url-card"><div class="card-h"><h3>🔗 Paste a video link</h3><span class="muted tiny">YouTube · TikTok · Instagram · X · Facebook · Vimeo · Pinterest · direct .mp4 links and more</span></div>
    <div class="url-row"><input id="vUrl" type="url" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Paste any video link here"><button class="btn primary" id="vUrlGo">Analyse</button></div>
    <div class="muted tiny" id="vUrlMsg" style="margin-top:6px">Jarvis downloads it, pulls out the frames, audio and transcript, and the Video Intel agent writes everything up, exactly like an uploaded video. Private or login-only videos cannot be downloaded: upload the file instead.</div></div>
  <div class="card drop" id="drop"><div class="drop-in"><div class="drop-ic">🎞</div><b>Drop a video here</b><div class="muted">or <label class="lnk">choose a file<input type="file" id="vFile" accept="video/*,audio/*" hidden></label> · mp4, mov, webm, mkv, mp3, wav (up to 4 GB)</div><div class="drop-bar" id="dropBar" hidden><i></i></div><div class="muted tiny" id="dropMsg"></div></div></div>
  <div class="grid g2" style="margin:16px 0"><div class="card"><div class="card-h"><h3>What do you want out of it?</h3></div><textarea id="vNote" rows="3" class="plain" placeholder="Optional: e.g. pull out the product claims, the hook structure and every on-screen price."></textarea><div class="field" style="margin:12px 0 0"><label>Or analyse a file already on this Mac (full path)</label><div style="display:flex;gap:8px"><input id="vPath" placeholder="@@WORKSPACE@@/…/clip.mp4"><button class="btn" id="vGoPath">Analyse</button></div></div></div>
  <div class="card"><div class="card-h"><h3>In progress</h3></div>${active.map((t) => `<div class="row click" data-task="${t.id}"><span class="live-dot"></span><div class="grow"><div class="t">${esc(t.title)}</div><div class="muted tiny t mono">${esc((t.log && t.log[t.log.length - 1]) || 'queued…')}</div></div></div>`).join('') || '<div class="muted" style="padding:6px 0">Nothing running.</div>'}</div></div>
  <div class="sec-h"><h2>Extracted videos</h2><span class="muted">${ex.length} saved</span></div>
  <div class="media-grid">${ex.map((e) => `<div class="m" data-extract="${e.id}"><span class="kind">${e.hasReport ? 'report' : 'extracted'}</span><div class="th"><img loading="lazy" src="/api/extract-file?id=${e.id}&f=sheet.jpg" onerror="this.replaceWith(document.createTextNode('🎞'))"></div><div class="cap"><div class="t">${esc(e.name)}</div><div class="muted tiny">${Math.round(e.duration)}s · ${e.language || 'no speech'} · ${ago(e.createdAt)}</div></div></div>`).join('') || '<div class="empty" style="grid-column:1/-1">No videos analysed yet.</div>'}</div>`;
  const startTask = async (p) => { const note = $('#vNote').value.trim(); try { await post('/api/tasks', { agent: 'video-intel', title: /^https?:\/\//i.test(p) ? 'Analyse video from ' + (() => { try { return new URL(p).hostname.replace(/^www\./, ''); } catch { return 'a link'; } })() : 'Analyse ' + p.split('/').pop().slice(0, 50), prompt: `Analyse the video at ${p}${note ? '\n\nKim wants: ' + note : ''}` }); toast('Video Intel is on it'); await loadTeam(); vVideo(v); } catch (e) { toast(e.message); } };
  const upload = (file) => { if (!file) return; const bar = $('#dropBar'), msg = $('#dropMsg'); bar.hidden = false; msg.textContent = 'Uploading ' + file.name + '…'; const x = new XMLHttpRequest(); x.open('POST', '/api/upload?name=' + encodeURIComponent(file.name)); x.setRequestHeader('Content-Type', file.type || 'application/octet-stream'); x.upload.onprogress = (e) => { if (e.lengthComputable) bar.firstElementChild.style.width = (e.loaded / e.total) * 100 + '%'; }; x.onload = () => { try { const j = JSON.parse(x.responseText); if (x.status !== 200) throw new Error(j.error); msg.textContent = 'Uploaded (' + fmtB(j.size) + '). Starting analysis…'; startTask(j.path); } catch (e) { msg.textContent = 'Upload failed: ' + e.message; } }; x.onerror = () => (msg.textContent = 'Upload failed'); x.send(file); };
  $('#vFile').onchange = (e) => upload(e.target.files[0]);
  const drop = $('#drop'); ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); })); ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); })); drop.addEventListener('drop', (e) => upload(e.dataTransfer.files[0]));
  $('#vGoPath').onclick = () => { const p = $('#vPath').value.trim(); if (p) startTask(p); };
  const goUrl = async () => { const u = $('#vUrl').value.trim().replace(/^<|>$/g, ''); const msg = $('#vUrlMsg'); if (!/^https?:\/\/\S+$/i.test(u)) { msg.textContent = 'That does not look like a link. It should start with https://'; return; } const b = $('#vUrlGo'); b.disabled = true; b.textContent = 'Starting…'; try { await startTask(u); } finally { b.disabled = false; b.textContent = 'Analyse'; } };
  $('#vUrlGo').onclick = goUrl; $('#vUrl').onkeydown = (e) => { if (e.key === 'Enter') goUrl(); };
  $('#vUrl').addEventListener('paste', (e) => { const cd = e.clipboardData || window.clipboardData; if (!cd) return; const t = (cd.getData('text') || '').trim(); if (/^https?:\/\/\S+$/i.test(t)) { e.preventDefault(); $('#vUrl').value = t; setTimeout(goUrl, 150); } });
  // pasting a link anywhere on this page (no box focused) fills the box and starts
  if (!window.__vidPaste) { window.__vidPaste = true; document.addEventListener('paste', (e) => { if (!location.hash.startsWith('#/video') || !document.getElementById('vUrl')) return; const ae = document.activeElement; if (ae && /INPUT|TEXTAREA/.test(ae.tagName)) return; const t = ((e.clipboardData || window.clipboardData).getData('text') || '').trim(); if (/^https?:\/\/\S+$/i.test(t)) { document.getElementById('vUrl').value = t; setTimeout(() => document.getElementById('vUrlGo').click(), 150); } }); }
  if (S.openExtract) { const id = S.openExtract; S.openExtract = null; openExtract(id); }
}
async function openExtract(id) {
  const r = await api('/api/extract?id=' + encodeURIComponent(id)); const m = r.meta; const f = (p) => `/api/extract-file?id=${id}&f=${p}`;
  modal(`<div style="display:flex;justify-content:space-between;gap:12px"><div><h2 style="font-size:20px">${esc(m.name)}</h2><div class="muted tiny">${Math.round(m.duration)} s · ${m.width || '?'}×${m.height || '?'} · ${m.language || 'no speech'} · ${fmtB(m.size)}</div></div><button class="btn sm" id="exX" style="align-self:flex-start">✕</button></div>
  <div class="frames">${m.frames.map((fr) => `<figure><img loading="lazy" src="${f(fr.file)}"><figcaption>${fr.t}s</figcaption></figure>`).join('')}</div>
  <div class="grid g2" style="margin-top:14px;align-items:start"><div><div class="doc-h" style="display:flex;justify-content:space-between">Report <span><button class="btn sm" id="exCopy">Copy</button> <a class="btn sm" href="${f('report.md')}&dl=1">Download .md</a></span></div><div class="doc tall">${r.report ? mdLite(r.report) : '<span class="muted">The agent has not written a report yet.</span>'}</div></div>
  <div><div class="doc-h" style="display:flex;justify-content:space-between">Transcript <span>${m.transcript ? `<button class="btn sm" id="exCopyT">Copy</button> <a class="btn sm" href="${f('transcript.txt')}&dl=1">Download</a>` : ''}</span></div><div class="doc tall">${m.transcript ? esc(m.transcript) : '<span class="muted">No transcript. ' + esc((m.notes || []).join(' ')) + '</span>'}</div></div></div>`, true);
  $('#exX').onclick = closeModal; if ($('#exCopy')) $('#exCopy').onclick = () => navigator.clipboard.writeText(r.report || '').then(() => toast('Report copied')); if ($('#exCopyT')) $('#exCopyT').onclick = () => navigator.clipboard.writeText(m.transcript).then(() => toast('Transcript copied'));
}

/* ================= VOICE STUDIO ================= */
const SAMPLE = { en: 'Good morning User. Here is your rundown for today. Two agents are working, and one plan is waiting for your approval.', sv: 'God morgon User. Här är din genomgång för dagen. Två agenter arbetar och en plan väntar på ditt godkännande.', ar: 'صباح الخير كيم. هذا ملخص يومك. وكيلان يعملان الآن، وهناك خطة واحدة تنتظر موافقتك.' };
let testAudio = null;
async function playTest(lang, btn) {
  try { if (btn) btn.disabled = true; const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: SAMPLE[lang], lang }) }); if (!r.ok) throw new Error((await r.json()).error); const b = await r.blob(); if (testAudio) testAudio.pause(); testAudio = new Audio(URL.createObjectURL(b)); testAudio.play(); testAudio.onended = () => btn && (btn.disabled = false); } catch (e) { toast(e.message); if (btn) btn.disabled = false; }
}
async function vVoice(v) {
  await Promise.all([loadVoice(), loadVault()]); const V = S.voice || {};
  if (!V.configured) { v.innerHTML = `<div class="hello"><div><h1>Voice studio</h1><div class="sub">Give Jarvis a human voice in English, Svenska and العربية.</div></div></div><div class="card empty" style="padding:44px"><div style="font-size:40px">🎙</div><h2 style="margin:8px 0">Add your ElevenLabs key first</h2>Open <a data-go="vault" style="cursor:pointer">Vault & keys</a> and press <b>Scan & import .env files</b>. Jarvis recognises an ElevenLabs key automatically. Then come back here to choose voices.</div>`; return; }
  const L = { en: ['English', 'EN'], sv: ['Svenska', 'SV'], ar: ['العربية', 'AR'] }; const t = V.tuning || {};
  v.innerHTML = `<div class="hello"><div><h1>Voice studio</h1><div class="sub">Jarvis speaks with ElevenLabs. Pick the voice for each language and tune how natural it sounds.</div></div><span class="chip ok"><i></i>ElevenLabs connected</span></div>
  <div class="grid g3">${['en', 'sv', 'ar'].map((l) => { const sv = (V.voices || {})[l]; return `<div class="card voice-card"><div class="v-lang">${L[l][1]}</div><h2 style="font-size:20px">${L[l][0]}</h2><div class="v-cur">${sv ? esc(sv.name) : 'No voice chosen'}${sv && sv.auto ? ' <span class="tag">auto</span>' : ''}</div><div style="display:flex;gap:8px;margin-top:14px"><button class="btn primary sm" data-test="${l}">▶ Hear it</button><button class="btn sm" data-pick="${l}">Change voice</button></div></div>`; }).join('')}</div>
  <div class="card" style="margin-top:16px"><div class="card-h"><h2>Tuning</h2><span class="muted">changes apply to every language</span></div><div class="grid g2"><div class="field"><label>Model</label><select id="vsModel">${[['eleven_multilingual_v2', 'Multilingual v2 — most natural (recommended)'], ['eleven_turbo_v2_5', 'Turbo v2.5 — faster'], ['eleven_flash_v2_5', 'Flash v2.5 — fastest'], ['eleven_v3', 'v3 — most expressive']].map(([k, n]) => `<option value="${k}" ${V.model === k ? 'selected' : ''}>${n}</option>`).join('')}</select></div><div></div>
  ${[['stability', 'Stability', 'lower = more emotion and variation'], ['similarity', 'Clarity & similarity', 'higher = closer to the original voice'], ['style', 'Style exaggeration', 'higher = more expressive'], ['speed', 'Speed', '0.7 – 1.2']].map(([k, n, h]) => `<div class="field"><label>${n} <span class="muted tiny">· ${h}</span></label><input type="range" id="vs_${k}" min="${k === 'speed' ? 0.7 : 0}" max="${k === 'speed' ? 1.2 : 1}" step="0.01" value="${t[k]}"><span class="tiny muted" id="vsv_${k}">${(+t[k]).toFixed(2)}</span></div>`).join('')}</div><div class="muted tiny" style="margin-top:4px">Tip: for a calm, human assistant try stability 0.40–0.50 and style 0.2–0.35.</div></div>`;
  document.querySelectorAll('[data-test]').forEach((b) => (b.onclick = () => playTest(b.dataset.test, b)));
  document.querySelectorAll('[data-pick]').forEach((b) => (b.onclick = () => voicePicker(b.dataset.pick)));
  let tm; const save = () => { clearTimeout(tm); tm = setTimeout(async () => { await post('/api/voice/settings', { model: $('#vsModel').value, stability: $('#vs_stability').value, similarity: $('#vs_similarity').value, style: $('#vs_style').value, speed: $('#vs_speed').value }); loadVoice(); }, 350); };
  ['stability', 'similarity', 'style', 'speed'].forEach((k) => ($('#vs_' + k).oninput = (e) => { $('#vsv_' + k).textContent = (+e.target.value).toFixed(2); save(); })); $('#vsModel').onchange = save;
}
async function voicePicker(lang) {
  const names = { en: 'English', sv: 'Svenska', ar: 'العربية' }; let tab = 'mine';
  const draw = async () => {
    modal(`<div style="display:flex;justify-content:space-between"><h2 style="font-size:19px">Choose a voice · ${names[lang]}</h2><button class="btn sm" id="vpX">✕</button></div><div class="tabs" style="margin:12px 0"><button data-t="mine" class="${tab === 'mine' ? 'on' : ''}">My voices</button><button data-t="lib" class="${tab === 'lib' ? 'on' : ''}">Voice library (${names[lang]})</button></div><div id="vpBody"><div class="skeleton" style="height:80px"></div></div>`, true);
    $('#vpX').onclick = closeModal; document.querySelectorAll('.tabs [data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const body = $('#vpBody');
    try {
      if (tab === 'mine') {
        const r = await api('/api/voice/voices'); body.innerHTML = `<div class="vlist">${r.voices.map((x) => `<div class="vrow"><div class="grow"><b>${esc(x.name)}</b> <span class="tag">${esc(x.category || '')}</span>${(x.langs || []).length ? ' <span class="tag claude">' + x.langs.join(' ') + '</span>' : ''}<div class="muted tiny">${esc([x.labels.accent, x.labels.gender, x.labels.age, x.labels.descriptive || x.labels.use_case].filter(Boolean).join(' · ') || x.desc)}</div></div>${x.preview ? `<audio controls preload="none" src="${esc(x.preview)}"></audio>` : ''}<button class="btn sm primary" data-use="${x.id}|${esc(x.name)}">Use</button></div>`).join('') || '<div class="empty">No voices in your account.</div>'}</div>`;
        body.querySelectorAll('[data-use]').forEach((b) => (b.onclick = async () => { const [id, name] = b.dataset.use.split('|'); await post('/api/voice/assign', { lang, voiceId: id, name }); closeModal(); toast(`${name} will speak ${names[lang]}`); vVoice($('#view')); Jarvis.checkVoice(); }));
      } else {
        body.innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px"><input id="vlQ" placeholder="Search: warm, calm, news, young…" style="flex:1"><select id="vlG" class="mini"><option value="">Any</option><option value="male">Male</option><option value="female">Female</option></select><button class="btn" id="vlGo">Search</button></div><div id="vlRes"><div class="muted">Searching…</div></div>`;
        const run = async () => { const q = new URLSearchParams({ lang, q: $('#vlQ').value, gender: $('#vlG').value }); try { const r = await api('/api/voice/library?' + q); $('#vlRes').innerHTML = `<div class="vlist">${r.voices.map((x) => `<div class="vrow"><div class="grow"><b>${esc(x.name)}</b> <span class="tag">${esc(x.accent || x.language || '')}</span><div class="muted tiny">${esc([x.gender, x.age, x.descriptive, x.useCase].filter(Boolean).join(' · '))} · used ${fmtN(x.used || 0)}×</div></div>${x.preview ? `<audio controls preload="none" src="${esc(x.preview)}"></audio>` : ''}<button class="btn sm primary" data-add="${x.ownerId}|${x.voiceId}|${esc(x.name)}">Add & use</button></div>`).join('') || '<div class="empty">No voices found.</div>'}</div>`; $('#vlRes').querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => { const [o, id, name] = b.dataset.add.split('|'); b.disabled = true; b.textContent = 'Adding…'; try { const a = await post('/api/voice/add-shared', { ownerId: o, voiceId: id, name }); await post('/api/voice/assign', { lang, voiceId: a.voiceId, name }); closeModal(); toast(`${name} added and set for ${names[lang]}`); vVoice($('#view')); Jarvis.checkVoice(); } catch (e) { toast(e.message); b.disabled = false; b.textContent = 'Add & use'; } })); } catch (e) { $('#vlRes').innerHTML = `<div class="empty">${esc(e.message)}<br><span class="tiny">The voice library may need a paid ElevenLabs plan.</span></div>`; } };
        $('#vlGo').onclick = run; $('#vlQ').onkeydown = (e) => e.key === 'Enter' && run(); run();
      }
    } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  };
  draw();
}

/* ================= global click wiring for these pages ================= */
document.addEventListener('click', (e) => {
  const t = e.target;
  const give = t.closest('[data-give]'); if (give) { e.stopPropagation(); return giveTaskModal(give.dataset.give); }
  const chat = t.closest('[data-chat]'); if (chat) { e.stopPropagation(); Jarvis.setAgent(chat.dataset.chat); return Jarvis.open(); }
  const ap = t.closest('[data-approve]'); if (ap) { e.stopPropagation(); return renderTaskModal(ap.dataset.approve); }
  const tk = t.closest('[data-task]'); if (tk) return renderTaskModal(tk.dataset.task);
  const pl = t.closest('[data-plan]'); if (pl) return assignPlan(+pl.dataset.plan);
  const ex = t.closest('[data-extract]'); if (ex) return openExtract(ex.dataset.extract);
  const ad = t.closest('[data-addsvc]'); if (ad) return addKeyModal(ad.dataset.addsvc);
  const ac = t.closest('.acard'); if (ac && !t.closest('button')) return renderAgentModal(ac.dataset.agent);
  // vault entry actions
  const ev = t.closest('[data-edit-var]'); if (ev) { const [id, k] = ev.dataset.editVar.split('|'); return addKeyModal(null, id, k || null); }
  const rv = t.closest('[data-reveal-var]'); if (rv) { const [id, k] = rv.dataset.revealVar.split('|'); post('/api/vault/reveal', { id, key: k }).then((r) => { const el = document.querySelector(`[data-val="${CSS.escape(id + '|' + k)}"]`); const old = el.textContent; el.textContent = r.value; setTimeout(() => (el.textContent = old), 8000); }).catch((x) => toast(x.message)); return; }
  const cv = t.closest('[data-copy-var]'); if (cv) { const [id, k] = cv.dataset.copyVar.split('|'); post('/api/vault/reveal', { id, key: k }).then((r) => navigator.clipboard.writeText(r.value)).then(() => toast('Copied. Clear your clipboard when done.')).catch((x) => toast(x.message)); return; }
  const ce = t.closest('[data-copy-env]'); if (ce) { post('/api/vault/reveal', { id: ce.dataset.copyEnv }).then((r) => navigator.clipboard.writeText(r.env)).then(() => toast('Copied as .env')).catch((x) => toast(x.message)); return; }
  const df = t.closest('[data-dl-file]'); if (df) { post('/api/vault/reveal-file', { id: df.dataset.dlFile }).then((r) => { const a = document.createElement('a'); a.href = 'data:application/octet-stream;base64,' + r.b64; a.download = r.name; a.click(); }).catch((x) => toast(x.message)); return; }
  const rs = t.closest('[data-reveal-src]'); if (rs) return post('/api/reveal', { path: rs.dataset.revealSrc }).catch((x) => toast(x.message));
  const de = t.closest('[data-del-entry]'); if (de) { if (confirm('Remove this entry from the vault? The original .env file on disk is not touched.')) post('/api/vault/delete', { id: de.dataset.delEntry }).then(async () => { await loadVault(); route(); }).catch((x) => toast(x.message)); return; }
  const rn = t.closest('[data-rename]'); if (rn && !rn.querySelector('input')) { const id = rn.dataset.rename, old = rn.textContent; rn.innerHTML = `<input value="${esc(old)}" class="inline-edit">`; const inp = rn.querySelector('input'); inp.focus(); inp.select(); const done = async (save) => { const val = inp.value.trim(); if (save && val && val !== old) { await post('/api/vault/update', { id, name: val }).catch((x) => toast(x.message)); await loadVault(); } rn.textContent = save && val ? val : old; }; inp.onblur = () => done(true); inp.onkeydown = (ev) => { if (ev.key === 'Enter') inp.blur(); if (ev.key === 'Escape') { inp.onblur = null; done(false); } }; return; }
});
document.addEventListener('change', (e) => { const vp = e.target.closest('[data-viaplug]'); if (vp) { post('/api/connectors', { service: vp.dataset.viaplug, via: vp.checked ? 'Claude / Codex plugin' : '' }).then((r) => { S.connectors = r.connectors; toast(vp.checked ? 'Marked as connected through a plugin' : 'Plugin connection removed'); route(); }).catch((x) => toast(x.message)); return; } const s = e.target.closest('[data-svcsel]'); if (s) post('/api/vault/update', { id: s.dataset.svcsel, service: s.value }).then(async () => { await loadVault(); route(); }).catch((x) => toast(x.message)); });
function renderAgentModal(id) {
  const a = agentOf(id); const tasks = (S.team.tasks || []).filter((t) => t.agent === id).slice(0, 8); const proj = a.project ? S.projects.find((p) => p.id === a.project) : null;
  modal(`<div style="display:flex;justify-content:space-between;gap:12px"><div style="display:flex;gap:14px;align-items:center"><div class="a-glyph big" style="--c:${a.color}"><i class="a-ring"></i><span>${window.JarvisCharacters?.html(a)||''}</span></div><div><h2 style="font-size:20px">${esc(a.name)}</h2><div class="muted">${esc(a.role)}</div></div></div><button class="btn sm" id="amX" style="align-self:flex-start">✕</button></div>
  <p style="margin:14px 0">${esc(a.desc)}</p><div class="pill-row" style="margin-bottom:12px"><span class="tag ${a.engine}">${a.engine}</span>${proj ? `<span class="tag p" style="--c:${proj.color}">${esc(proj.name)}</span>` : ''}${a.approval ? '<span class="tag">plans first · needs your approval</span>' : '<span class="tag">acts directly</span>'}${(a.services || []).map((s) => `<span class="tag" style="color:${svcById(s).color}">${esc(svcById(s).name)}</span>`).join('')}</div>
  <div class="doc-h">Recent tasks</div>${tasks.map((t) => `<div class="row click" data-task="${t.id}"><div class="grow t">${esc(t.title)}</div><span class="tag">${t.status.replace('_', ' ')}</span><span class="muted tiny">${ago(t.createdAt)}</span></div>`).join('') || '<div class="muted tiny">No tasks yet.</div>'}
  <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px"><button class="btn" id="amChat">Chat</button><button class="btn primary" id="amGive">Give task</button></div>`);
  $('#amX').onclick = closeModal; $('#amChat').onclick = () => { closeModal(); Jarvis.setAgent(id); Jarvis.open(); }; $('#amGive').onclick = () => giveTaskModal(id);
}

window.PAGES = { home: vHome, team: vTeam, vault: vVault, platforms: vPlatforms, video: vVideo, voice: vVoice };
