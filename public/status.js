'use strict';
(() => {
// 1) "Where things stand": every step is clickable (videos, who is responsible, where each post went and its views).
// 2) Apple review tab (App Store Connect status of each app).  3) Admin app tab (the app running in the iOS Simulator).
S.stage = S.stage || {};
const STAGES = ['raw', 'ready', 'sched', 'post'];
const STAGE_API = { raw: 'raw', ready: 'ready', sched: 'scheduled', post: 'posted' };
const stageOwner = (w, k) => { const v = (w && w.video) || {}, so = (w && w.social) || {}; return k === 'raw' || k === 'ready' ? v.editor : so.poster; };
const agentChip = (id, role) => { if (!id) return ''; const a = agentOf(id); const st = ((S.team && S.team.agents.find((x) => x.id === id)) || {}).status || { state: 'idle' }; return `<span class="ag-chip ${st.state}" style="--c:${a.color || '#8793a8'}" data-agent="${esc(id)}" title="${esc(a.role || '')}"><i>${esc(a.glyph || '•')}</i><b>${esc(a.name)}</b><em>${esc(role ? role + ' · ' : '')}${STATE_LABEL[st.state] || 'Idle'}</em></span>`; };
const fmtDate = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const viewsTxt = (n) => (n == null ? '—' : fmtN(n));

function fileTile(f, pid) {
  const plats = (f.scheduledOn || []).map((k) => plChip(k)).join('');
  return `<div class="st-file" data-media="${esc(f.path)}"><div class="st-thumb">${f.video ? `<video src="${fileUrl(f.path)}#t=0.5" preload="metadata" muted playsinline></video><span class="st-play">▶</span>` : `<img loading="lazy" src="${fileUrl(f.path)}">`}</div><div class="st-fn" title="${esc(f.base)}">${esc(f.base)}</div><div class="st-fm"><span class="muted tiny">${ago(f.mtime)}</span>${plats ? `<span class="st-plats">${plats}</span>` : f.scheduledOn ? '<span class="chip warn"><i></i>not scheduled</span>' : ''}</div></div>`;
}
function postRow(x, pid) {
  const pl = plChip(x.platform);
  return `<div class="st-post"><div class="st-pl">${pl}</div><div class="grow"><div class="st-pt">${esc(x.title || x.base || 'Post')}</div><div class="muted tiny">${esc(plName(x.platform))}${x.account ? ' · ' + esc(x.account) : ''} · ${esc(fmtDate(x.when) || x.when || '')}${x.assumed ? ' · assumed posted' : ''}</div></div>
    ${x.status === 'published' ? `<div class="st-views" data-vkey="${esc(x.key)}" title="Tap to enter the numbers"><b>${viewsTxt(x.views)}</b><span>views</span>${x.likes != null ? `<span>♥ ${fmtN(x.likes)}</span>` : ''}${x.comments != null ? `<span>💬 ${fmtN(x.comments)}</span>` : ''}</div>` : ''}
    ${x.url ? `<a class="btn sm ghost" href="${esc(x.url)}" target="_blank" rel="noopener">Open ↗</a>` : ''}</div>`;
}

async function stageRender(pid, k) {
  const box = document.getElementById('stageBox'); if (!box) return; const C = (S.stage[pid] = S.stage[pid] || {});
  C.stage = k; document.querySelectorAll('#projStatus .pstep').forEach((el) => el.classList.toggle('sel', el.dataset.stage === k));
  box.innerHTML = '<div class="skeleton" style="height:90px;margin-top:14px"></div>';
  let d; try { d = await api(`/api/social/stage?project=${encodeURIComponent(pid)}&stage=${STAGE_API[k]}`); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!S.team) await loadTeam(); if (!document.getElementById('stageBox')) return;
  const owners = k === 'ready' ? agentChip(d.agents.editor, 'Edits') + (d.agents.generator ? agentChip(d.agents.generator, 'Generates') : '') : k === 'post' ? agentChip(d.agents.poster, 'Posts') + agentChip(d.agents.analyst, 'Analyses') : agentChip(d.agents[d.owner], d.owner === 'poster' ? 'Posts' : 'Edits');
  let body = '';
  if (k === 'raw' || k === 'ready') {
    body = d.files.length ? `<div class="st-grid">${d.files.slice(0, C['n' + k] || 24).map((f) => fileTile(f, pid)).join('')}</div>${d.files.length > (C['n' + k] || 24) ? `<button class="btn sm" id="stMore" style="margin-top:10px">Show more (${d.files.length - (C['n' + k] || 24)} left)</button>` : ''}` : `<div class="muted" style="padding:14px 2px">${d.scanning ? 'Still scanning the folders…' : 'Nothing here right now.'}</div>`;
  } else if (k === 'sched') {
    const by = {}; for (const x of d.posts) { const day = x.when ? new Date(x.when).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : 'No date'; (by[day] = by[day] || []).push(x); }
    body = d.posts.length ? Object.entries(by).slice(0, 40).map(([day, list]) => `<div class="day-grp"><div class="dg-h">${esc(day)} <span class="muted tiny">${list.length} post${list.length === 1 ? '' : 's'}</span></div>${list.map((x) => postRow(x, pid)).join('')}</div>`).join('') : '<div class="muted" style="padding:14px 2px">Nothing is scheduled right now.</div>';
  } else {
    const pf = C.plat || 'all'; const list = d.posts.filter((x) => pf === 'all' || x.platform === pf);
    const tiles = [{ platform: 'all', count: d.count, views: d.totalViews, counted: d.withViews }, ...d.byPlatform].map((t) => `<button class="st-pt-tile ${pf === t.platform ? 'on' : ''}" data-pf="${t.platform}"><span class="st-pt-n">${t.platform === 'all' ? 'All platforms' : esc(plName(t.platform))}</span><b>${fmtN(t.count)}</b><span class="muted tiny">posted · ${t.counted ? fmtN(t.views) + ' views' : 'views not collected yet'}</span></button>`).join('');
    body = `<div class="st-pts">${tiles}</div>
      <div class="st-bar"><span class="muted tiny">Views are known for ${d.withViews} of ${d.shown} shown posts. Tap a post's number to type it in.</span><span class="grow"></span><button class="btn sm" id="stYt">Read YouTube views</button><button class="btn sm" id="stAna">Ask the analyst</button></div>
      <div class="st-posts">${list.slice(0, C.npost || 40).map((x) => postRow(x, pid)).join('') || '<div class="muted" style="padding:14px 2px">No posts on this platform.</div>'}</div>${list.length > (C.npost || 40) ? `<button class="btn sm" id="stMore" style="margin-top:10px">Show more (${list.length - (C.npost || 40)} left)</button>` : ''}`;
  }
  box.innerHTML = `<div class="st-head"><div><h3>${esc(d.title)}</h3><div class="muted tiny">${fmtN(d.count)} in total</div></div><div class="st-own"><span class="muted tiny" style="width:100%">Responsible</span>${owners}</div></div>${body}`;
  box.querySelectorAll('[data-media]').forEach((el) => (el.onclick = () => { const f = el.dataset.media; S.media = S.media || []; if (!S.media.some((m) => m.path === f)) S.media.push({ path: f, rel: f.split('/').pop(), kind: /\.(mp4|mov|m4v|webm)$/i.test(f) ? 'video' : 'image', size: 0 }); openMedia(f); }));
  box.querySelectorAll('[data-pf]').forEach((b) => (b.onclick = () => { C.plat = b.dataset.pf; C.npost = 40; stageRender(pid, k); }));
  box.querySelectorAll('[data-agent]').forEach((b) => (b.onclick = () => { if (window.Jarvis) { Jarvis.setAgent(b.dataset.agent); Jarvis.open(); } }));
  const more = box.querySelector('#stMore'); if (more) more.onclick = () => { if (k === 'post') C.npost = (C.npost || 40) + 60; else C['n' + k] = (C['n' + k] || 24) + 48; stageRender(pid, k); };
  box.querySelectorAll('[data-vkey]').forEach((el) => (el.onclick = async () => {
    const cur = d.posts.find((x) => x.key === el.dataset.vkey) || {}; const v = prompt('Views for this post (leave empty to clear):', cur.views != null ? cur.views : ''); if (v === null) return;
    const l = prompt('Likes (optional):', cur.likes != null ? cur.likes : ''); if (l === null) return; const c = prompt('Comments (optional):', cur.comments != null ? cur.comments : ''); if (c === null) return;
    try { await post('/api/social/post-stats', { project: pid, key: el.dataset.vkey, views: v, likes: l, comments: c }); stageRender(pid, k); } catch (e) { toast(e.message); }
  }));
  const yt = box.querySelector('#stYt'); if (yt) yt.onclick = async () => { yt.disabled = true; yt.textContent = 'Reading…'; try { const r = await post('/api/social/refresh-views', { project: pid }); toast(r.updated ? `Updated ${r.updated} YouTube posts` : r.note || 'Nothing to update'); } catch (e) { toast(e.message); } stageRender(pid, k); };
  const an = box.querySelector('#stAna'); if (an) an.onclick = async () => { try { await post('/api/social/analyse', { project: pid }); toast('The analyst has been asked. See Agent team for the result.'); } catch (e) { toast(e.message); } };
  animateIn(box);
}

const _prevProject = window.PAGES.project;
window.PAGES.project = async function (v) {
  await _prevProject(v);
  try {
    const id = window.routeArg; const card = v.querySelector('#projStatus'); if (!card || card.querySelector('#stageBox')) return; if (!S.team) await loadTeam();
    const p = proj(id); const w = (p && p.workspace) || {}; const steps = card.querySelectorAll('.pstep');
    steps.forEach((el, i) => { const k = STAGES[i]; if (!k) return; el.dataset.stage = k; el.classList.add('clickable'); const own = stageOwner(w, k); if (own) el.insertAdjacentHTML('beforeend', `<div class="p-agent" title="Responsible agent">${esc(agentOf(own).glyph)} ${esc(agentOf(own).name)}</div>`); });
    card.insertAdjacentHTML('beforeend', '<div id="stageBox"></div>'); card.querySelector('.pipe').insertAdjacentHTML('afterend', '<div class="muted tiny" style="margin-top:8px">Tap a step to see the videos, who is responsible, and where each post went.</div>');
    card.querySelectorAll('.pstep[data-stage]').forEach((el) => (el.onclick = () => { const C = (S.stage[id] = S.stage[id] || {}); if (C.stage === el.dataset.stage && document.getElementById('stageBox').innerHTML) { C.stage = null; document.getElementById('stageBox').innerHTML = ''; card.querySelectorAll('.pstep').forEach((x) => x.classList.remove('sel')); return; } C.plat = 'all'; stageRender(id, el.dataset.stage); }));
    const C = S.stage[id]; if (C && C.stage) stageRender(id, C.stage);
  } catch {}
};

/* ---------- tabs ---------- */
const _tabsFor = window.tabsFor;
window.tabsFor = (p) => {
  const t = _tabsFor(p); const apps = ((p.workspace || {}).apps || []); const i = Math.max(1, t.findIndex(([k]) => k === 'chat') + 1);
  const extra = []; if (apps.some((a) => a.bundleId)) extra.push(['apple', 'Apple review']); if (apps.some((a) => a.sim)) extra.push(['sim', 'iPhone app']);
  t.splice(i, 0, ...extra); return t;
};

/* ---------- Apple review ---------- */
const LV = { good: 'ok', warn: 'warn', bad: 'bad', info: '' };
const stChip = (s) => `<span class="chip ${LV[s.level] || ''}"><i></i>${esc(s.text)}</span>`;
async function appleTab(box, p) {
  const pid = p.id; const load = async (force) => { box.innerHTML = '<div class="skeleton" style="height:140px"></div>'; let d; try { d = await api('/api/apple/status?project=' + encodeURIComponent(pid) + (force ? '&force=1' : '')); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } if (!document.body.contains(box)) return; draw(d); };
  const draw = (d) => {
    const head = `<div class="card-h"><h2>Apple review status</h2><div class="pill-row"><a class="btn sm" href="https://appstoreconnect.apple.com/apps" target="_blank" rel="noopener">Open App Store Connect ↗</a><button class="btn sm" id="apRef">Refresh</button></div></div>`;
    if (!d.ok) {
      box.innerHTML = `<div class="card">${head}<div class="ap-note ${d.reason === 'no-issuer' ? '' : 'bad'}"><b>${d.reason === 'no-issuer' ? 'One more thing to connect' : d.reason === 'no-key' ? 'Key needed' : 'Cannot read Apple yet'}</b><div>${esc(d.message)}</div></div>
      ${d.reason === 'no-issuer' ? `<div class="field" style="margin-top:12px"><label>Issuer ID</label><input id="apIss" class="mono" placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" autocomplete="off"></div><div style="display:flex;gap:10px;align-items:center"><button class="btn primary" id="apIssGo">Save and connect</button><span class="muted tiny">Saved encrypted in your vault. Read-only: Jarvis can only look, never change anything at Apple.</span></div>` : d.reason === 'no-key' ? '<button class="btn primary" data-go="vault" style="margin-top:12px">Open Vault & keys</button>' : ''}
      ${d.keyId ? `<div class="muted tiny" style="margin-top:10px">Using key ${esc(d.keyId)}</div>` : ''}</div>`;
      const g = box.querySelector('#apIssGo'); if (g) g.onclick = async () => { try { await post('/api/vault/set-key', { service: 'apple', key: 'APP_STORE_CONNECT_ISSUER_ID', value: box.querySelector('#apIss').value.trim() }); toast('Saved'); load(true); } catch (e) { toast(e.message); } };
    } else {
      box.innerHTML = d.apps.map((a) => { const cur = a.versions[0]; const tf = a.builds[0] && a.builds[0].testflight;
        return `<div class="card ap-app" style="margin-bottom:14px">${head.replace('Apple review status', esc(a.name))}
        ${a.error ? `<div class="ap-note bad">${esc(a.error)}</div>` : `<div class="ap-hero">${cur ? `<div class="ap-big ${LV[cur.state.level] || ''}"><span class="muted tiny">App Store version ${esc(cur.version || '')}</span><b>${esc(cur.state.text)}</b></div>` : '<div class="ap-big"><span class="muted tiny">App Store</span><b>No version yet</b></div>'}${tf ? `<div class="ap-big ${LV[tf.level] || ''}"><span class="muted tiny">Latest TestFlight build</span><b>${esc(tf.text)}</b></div>` : ''}</div>
        <div class="grid g2"><div><div class="cn-lbl">Versions</div>${a.versions.map((x) => `<div class="row"><div class="grow t">${esc(x.version || '?')} <span class="muted tiny">${esc((x.platform || '').replace('_', ' '))}</span></div>${stChip(x.state)}</div>`).join('') || '<div class="muted tiny">None</div>'}
        <div class="cn-lbl" style="margin-top:12px">Review submissions</div>${a.submissions.map((x) => `<div class="row"><div class="grow t muted">${x.submitted ? esc(fmtDate(x.submitted)) : 'Not submitted'}</div>${stChip(x.state)}</div>`).join('') || '<div class="muted tiny">None</div>'}</div>
        <div><div class="cn-lbl">Recent builds</div>${a.builds.map((x) => `<div class="row"><div class="grow t">Build ${esc(x.build)} <span class="muted tiny">${x.uploaded ? ago(x.uploaded) : ''}</span></div>${stChip(x.testflight || x.processing)}</div>`).join('') || '<div class="muted tiny">None</div>'}</div></div>
        <div class="muted tiny" style="margin-top:10px">${esc(a.bundleId)} · checked ${ago(d.checkedAt)} · rejection reasons are in App Store Connect › Resolution Center</div>`}</div>`; }).join('');
    }
    box.querySelectorAll('#apRef').forEach((b) => (b.onclick = () => load(true)));
    animateIn(box); if (window.appleExtras) window.appleExtras(box, p, d);
  };
  load(false);
}

/* ---------- Admin app in the iOS Simulator ---------- */
async function simTab(box, p) {
  const pid = p.id; clearInterval(S.simPoll); let d;
  const draw = () => {
    if (!d.enabled) { box.innerHTML = '<div class="card empty">No app in this project is set up for the Simulator.</div>'; return; }
    if (d.error) { box.innerHTML = `<div class="card"><div class="ap-note bad">${esc(d.error)}</div></div>`; return; }
    const chip = (ok, on, off) => `<span class="chip ${ok ? 'ok' : 'warn'}"><i></i>${ok ? on : off}</span>`;
    box.innerHTML = `<div class="grid g-main sim-grid" style="grid-template-columns:minmax(0,1.2fr) minmax(0,1fr);align-items:start">
      <div class="card"><div class="card-h"><h2>${esc(d.app)} · ${esc(d.label || 'iPhone')}</h2></div>
        <div class="pill-row" style="margin-bottom:12px">${chip(d.booted, 'Simulator on', 'Simulator off')}${chip(d.installed, 'App installed', 'App not installed')}${chip(d.running, 'App open', 'App closed')}${chip(d.keep, 'Kept open automatically', 'Not kept open')}</div>
        <div class="sim-btns"><button class="btn primary" id="smOpen">▶ Open the app</button><button class="btn" id="smKeep">${d.keep ? '■ Stop keeping it open' : '↻ Keep it open'}</button><button class="btn" id="smBuild" ${d.canBuild && !(d.build && d.build.running) ? '' : 'disabled'}>${d.build && d.build.running ? 'Building…' : '🔨 Build for Simulator'}</button><button class="btn" id="smInst" ${d.buildAvailable ? '' : 'disabled'} title="${d.buildAvailable ? '' : 'No simulator build found yet'}">Install latest build</button><button class="btn ghost" id="smStop">Close it</button></div>
        ${d.build ? `<div class="ap-note ${d.build.running ? '' : d.build.ok ? '' : 'bad'}" style="margin-top:12px"><b>${d.build.running ? 'Building the app… (a few minutes)' : d.build.ok ? 'Build finished' + (d.build.note ? ': ' + esc(d.build.note) : '') : 'Build failed' + (d.build.note ? ': ' + esc(d.build.note) : '')}</b><pre class="sim-log">${esc((d.build.tail || []).slice(-6).join('\n'))}</pre></div>` : d.buildAvailable ? `<div class="muted tiny" style="margin-top:10px">Latest build: ${ago(d.builtAt)}</div>` : ''}
        <div class="field" style="margin-top:12px"><label>Simulator device</label><select id="smDev">${d.devices.map((x) => `<option value="${x.udid}" ${x.udid === d.device.udid ? 'selected' : ''}>${esc(x.name)} · ${esc(x.runtime)}${x.state === 'Booted' ? ' (on)' : ''}</option>`).join('')}</select></div>
        <div class="ap-note" style="margin-top:12px"><b>How the sign-in works</b><div>Sign in to the account you want once in the Simulator window on your Mac (the picture here is a live view, you cannot type into it). The Simulator keeps the session, so every time Jarvis opens or reopens the app it is still that account. Jarvis never types your password. "Keep it open" restarts the app within 30 seconds if it closes.</div></div></div>
      <div class="card sim-screen"><div class="card-h"><h2>What it shows now</h2><button class="btn sm" id="smShot">Refresh</button></div><div class="sim-phone">${d.booted ? '<img id="smImg" alt="Simulator screen">' : '<div class="muted" style="padding:60px 10px;text-align:center">The Simulator is off.<br>Press “Open the app”.</div>'}</div></div></div>`;
    const img = box.querySelector('#smImg'); const shot = () => { if (img && document.body.contains(img)) img.src = `/api/sim/shot?project=${encodeURIComponent(pid)}&t=${Date.now()}`; }; shot();
    const act = (id, fn) => { const b = box.querySelector(id); if (b) b.onclick = async () => { b.disabled = true; try { d = await fn(); toast('Done'); } catch (e) { toast(e.message); } draw(); }; };
    act('#smOpen', () => post('/api/sim/open', { project: pid })); act('#smKeep', () => post('/api/sim/keep', { project: pid, on: !d.keep })); act('#smStop', () => post('/api/sim/stop', { project: pid })); act('#smInst', () => post('/api/sim/install', { project: pid })); act('#smBuild', () => post('/api/sim/build', { project: pid }));
    box.querySelector('#smShot').onclick = shot; const dv = box.querySelector('#smDev'); if (dv) dv.onchange = async () => { try { d = await post('/api/sim/device', { project: pid, udid: dv.value }); draw(); } catch (e) { toast(e.message); } };
    clearInterval(S.simPoll); S.simPoll = setInterval(async () => { if (!document.body.contains(box.querySelector('#smShot') || document.body)) return clearInterval(S.simPoll); if (!box.querySelector('#smShot')) return clearInterval(S.simPoll); shot(); try { const n = await api('/api/sim/status?project=' + encodeURIComponent(pid)); if (n.running !== d.running || n.booted !== d.booted || (n.build && n.build.running) !== (d.build && d.build.running) || (n.build && n.build.tail && n.build.tail.length && n.build.running)) { d = n; draw(); } } catch {} }, 4000);
  };
  box.innerHTML = '<div class="skeleton" style="height:160px"></div>'; try { d = await api('/api/sim/status?project=' + encodeURIComponent(pid)); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; } draw();
}

/* ---------- Websites: live picture + health, the same for every project ---------- */
const _sitesTab = window.sitesTab;
window.sitesTab = (box, p, ws) => {
  _sitesTab(box, p, ws); const cards = [...box.querySelectorAll('.ws-card')]; const sites = ws.websites || [];
  cards.forEach((card, i) => {
    const s = sites[i]; if (!s || !/^https:\/\//.test(s.url || '')) return; const head = card.querySelector('.ws-head'); if (!head) return;
    head.insertAdjacentHTML('afterend', `<div class="web-hero" data-site="${esc(s.id)}"><div class="web-shot"><div class="web-ph">Taking a picture…</div></div><div class="web-info"><div class="web-h"><span class="chip"><i></i>Checking…</span></div><div class="muted tiny web-m"></div><div class="pill-row" style="margin-top:10px"><a class="btn sm primary" href="${esc(s.url)}" target="_blank" rel="noopener">Open site ↗</a><button class="btn sm" data-wcheck>Check now</button><button class="btn sm ghost" data-wshot>New picture</button></div></div></div>`);
    const hero = card.querySelector('.web-hero'); const shot = (refresh) => { const img = new Image(); img.alt = s.name; img.onload = () => { hero.querySelector('.web-shot').innerHTML = ''; hero.querySelector('.web-shot').appendChild(img); }; img.onerror = () => { hero.querySelector('.web-shot').innerHTML = '<div class="web-ph">No picture available</div>'; }; img.src = `/api/web/shot?project=${encodeURIComponent(p.id)}&id=${encodeURIComponent(s.id)}${refresh ? '&refresh=1' : ''}&t=${Date.now()}`; };
    hero.querySelector('[data-wshot]').onclick = () => { hero.querySelector('.web-shot').innerHTML = '<div class="web-ph">Taking a picture…</div>'; shot(true); }; shot(false);
    hero.querySelector('[data-wcheck]').onclick = () => webHealth(p.id, true);
  });
  if (cards.length) webHealth(p.id, false);
};
async function webHealth(pid, force) {
  let d; try { d = await api('/api/web/health?project=' + encodeURIComponent(pid) + (force ? '&force=1' : '')); } catch { return; }
  for (const s of d.sites) { const hero = document.querySelector(`.web-hero[data-site="${CSS.escape(s.id)}"]`); if (!hero) continue; const slow = s.ms > 2500; const cls = !s.up ? 'bad' : slow ? 'warn' : 'ok';
    hero.querySelector('.web-h').innerHTML = `<span class="chip ${cls}"><i></i>${!s.up ? (s.status ? 'Problem (' + s.status + ')' : 'Not reachable') : slow ? 'Online but slow' : 'Online'}</span>`; hero.querySelector('.web-m').textContent = `${s.ms} ms · ${s.https ? 'secure (https)' : 'not secure'}${s.status ? ' · HTTP ' + s.status : ''}${s.error ? ' · ' + s.error : ''} · checked just now`; }
}

/* ---------- Social media: the full picture inside each project (same for every project) ---------- */
const _socialTab = window.socialTab;
window.socialTab = (box, p, ws) => {
  _socialTab(box, p, ws); if (!ws.social) return; box.insertAdjacentHTML('afterbegin', '<div id="socEmbed" style="margin-bottom:16px"><div class="skeleton" style="height:140px"></div></div>');
  (async () => {
    const sum = await loadSocialSummary(); const cur = sum.projects.find((x) => x.project === p.id); const el = document.getElementById('socEmbed'); if (!el) return; if (!cur) return el.remove();
    S.soc.embed = S.soc.embed || {}; const tab = S.soc.embed[p.id] || 'glance';
    el.innerHTML = `<div class="tabs" id="socEmbTabs" style="margin-bottom:12px">${[['glance', 'At a glance'], ['schedule', 'Schedule'], ['accounts', 'Accounts & analytics']].map(([k, n]) => `<button data-et="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('')}</div><div id="socEmbBody"></div>`;
    el.querySelector('#socEmbTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { S.soc.embed[p.id] = b.dataset.et; window.socialTab(box, p, ws); box.querySelectorAll('#socEmbed').forEach((x, i) => i && x.remove()); } };
    const body = el.querySelector('#socEmbBody'); S.soc.pid = p.id;
    try { if (tab === 'schedule') await scheduleTab(body, cur); else if (tab === 'accounts') await accountsTab(body, cur); else await glanceTab(body, cur); } catch (e) { body.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; }
    body.querySelectorAll('.pipe .pstep').forEach((el, i) => { if (!STAGES[i]) return; el.classList.add('clickable'); el.title = 'Show the videos'; el.onclick = () => { S.stage[p.id] = { stage: STAGES[i], plat: 'all' }; S.projTab[p.id] = 'overview'; route(); }; });
    animateIn(body);
  })();
};

/* ---------- Control room strip: the same four cards on every project ---------- */
async function controlRoom(pid, host) {
  const p = proj(pid); const apps = ((p.workspace || {}).apps || []); const hasSim = apps.some((a) => a.sim), hasApple = apps.some((a) => a.bundleId), hasWeb = (((p.workspace || {}).websites) || []).some((s) => /^https:/.test(s.url || ''));
  const cards = [];
  if (hasApple) cards.push({ tab: 'apple', ic: '🍎', t: 'Apple review', load: async () => { const d = await api('/api/apple/status?project=' + pid); if (!d.ok) return { v: d.reason === 'no-issuer' ? 'Connect Apple' : 'Needs setup', l: 'warn', s: d.reason === 'no-issuer' ? 'Paste the Issuer ID' : 'Open to fix' }; const a = d.apps[0] || {}; const x = (a.versions || [])[0]; return x ? { v: x.state.text, l: LV[x.state.level] || '', s: `Version ${x.version || ''}${a.builds && a.builds[0] ? ' · build ' + a.builds[0].build : ''}` } : { v: 'No version yet', l: '', s: a.error || '' }; } });
  if (hasSim) cards.push({ tab: 'sim', ic: '📱', t: 'iPhone app', load: async () => { const d = await api('/api/sim/status?project=' + pid); if (!d.enabled || d.error) return { v: 'Unavailable', l: 'bad', s: d.error || '' }; return { v: d.running ? 'Open in Simulator' : d.booted ? 'Simulator on, app closed' : 'Simulator off', l: d.running ? 'ok' : 'warn', s: (d.keep ? 'Kept open · ' : '') + (d.installed ? 'App installed' : 'Not installed yet') }; } });
  if (hasWeb) cards.push({ tab: 'sites', ic: '🌐', t: 'Websites', load: async () => { const d = await api('/api/web/health?project=' + pid); const up = d.sites.filter((s) => s.up).length; return { v: `${up} of ${d.sites.length} online`, l: up === d.sites.length ? 'ok' : 'bad', s: d.sites.length ? Math.round(d.sites.reduce((a, s) => a + s.ms, 0) / d.sites.length) + ' ms average' : '' }; } });
  if ((p.workspace || {}).social) cards.push({ tab: 'social', ic: '📣', t: 'Social media', load: async () => { const sum = await loadSocialSummary(); const c = sum.projects.find((x) => x.project === pid); if (!c) return { v: '—', l: '', s: '' }; return { v: `${fmtN(c.published)} posted`, l: c.runwayDays >= 3 ? 'ok' : 'warn', s: `${fmtN(c.scheduled)} scheduled · queue ${c.runwayDays} day${c.runwayDays === 1 ? '' : 's'}` }; } });
  if (!cards.length) return;
  host.innerHTML = cards.map((c, i) => `<button class="cr-card" data-cr="${c.tab}"><span class="cr-ic">${c.ic}</span><span class="cr-t">${c.t}</span><b class="cr-v" id="crv${i}">…</b><span class="cr-s muted tiny" id="crs${i}"></span></button>`).join('');
  host.querySelectorAll('.cr-card').forEach((b) => (b.onclick = () => { S.projTab[pid] = b.dataset.cr; route(); }));
  cards.forEach(async (c, i) => { try { const r = await c.load(); const v = document.getElementById('crv' + i); if (!v) return; v.textContent = r.v; v.parentNode.className = 'cr-card ' + (r.l || ''); document.getElementById('crs' + i).textContent = r.s || ''; } catch (e) { const v = document.getElementById('crv' + i); if (v) v.textContent = 'Not available'; } });
}
const _proj2 = window.PAGES.project;
window.PAGES.project = async function (v) {
  await _proj2(v);
  try { const id = window.routeArg; if ((S.projTab[id] || 'overview') !== 'overview') return; const bar = v.querySelector('.ws-tabs'); if (!bar || v.querySelector('#ctrlRoom')) return; const host = document.createElement('div'); host.id = 'ctrlRoom'; host.className = 'cr-row'; const card = v.querySelector('#projStatus'); if (card) card.before(host); else bar.after(host); controlRoom(id, host); } catch {}
};
window.appleTab = appleTab; window.simTab = simTab;
})();
