'use strict';
// Keys & access tab for every project (keys incl. Gemini, links such as StudyFetch, assigned agents, shared folders),
// the project editor, side projects (like Even inside Studys) and the nested project list in the sidebar.
(() => {
const PALETTE = ['#ff6a3d', '#35d49a', '#5b8cff', '#c77dff', '#ffc233', '#2dd4ee', '#ff4d8d', '#a78bfa', '#5eead4', '#f97316'];
const kidsOf = (id) => S.projects.filter((p) => p.parent === id);

/* ---------- sidebar: side projects sit under their parent ---------- */
window.renderNav = function () {
  const cur = location.hash.slice(2).split('/')[0] || 'control';
  const row = (p, sub) => `<a data-r="project/${p.id}" class="${location.hash === '#/project/' + p.id ? 'on' : ''} ${sub ? 'sub' : ''}"><span class="dot" style="background:${p.color}"></span>${sub ? '<span class="muted" style="margin-right:4px">└</span>' : ''}${esc(p.name)}</a>`;
  const tops = S.projects.filter((p) => !p.parent || !S.projects.some((x) => x.id === p.parent));
  const tree = tops.map((p) => row(p, false) + kidsOf(p.id).map((k) => row(k, true) + kidsOf(k.id).map((g) => row(g, true)).join('')).join('')).join('');
  $('#nav').innerHTML = NAV.map((n) => n[0] === 'sec' ? `<div class="sec">${n[1]}</div>` : `<a data-r="${n[0]}" class="${cur === n[0] || (cur === 'project' && n[0] === 'projects') ? 'on' : ''}"><span class="ic">${n[1]}</span>${n[2]}</a>`).join('') + `<div class="sec">Projects</div>` + tree;
  $('#nav').onclick = (e) => { const a = e.target.closest('a'); if (a) location.hash = '#/' + a.dataset.r; };
};

/* ---------- tab ---------- */
const _tabs = window.tabsFor;
window.tabsFor = (p) => { const t = _tabs(p); const i = Math.max(1, t.findIndex(([k]) => k === 'chat') + 1); t.splice(i, 0, ['access', 'Keys & access'], ['agents', 'Agents']); return t; };

async function save(pid, body) { return post('/api/proj/update', { id: pid, ...body }); }
const refreshAll = async (pid) => { await loadAll(); S.projTab[pid] = 'access'; route(); };

async function accessTab(box, p) {
  box.innerHTML = '<div class="skeleton" style="height:160px"></div>'; let d;
  try { d = await api('/api/proj/access?project=' + encodeURIComponent(p.id)); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (!document.body.contains(box)) return; const pr = d.project; const svcs = d.services.filter(s => s.id !== 'studyfetch'); const par = pr.parent ? S.projects.find((x) => x.id === pr.parent) : null;
  const order = ['gemini', 'studyfetch', 'openai', 'anthropic'].concat(svcs.map((s) => s.id)); const used = [...new Set([...pr.services].filter(id => svcs.some(s => s.id === id)).sort((a, b) => order.indexOf(a) - order.indexOf(b)))];
  const keyBlock = (s) => { const k = pr.keys.find((x) => x.service === s.id) || { entries: [] }; return `<div class="ac-key" style="--c:${s.color}"><div class="ac-key-h"><span class="svc-badge" style="--c:${s.color}">${esc(s.glyph || s.name[0])}</span><div class="grow"><b>${esc(s.name)}</b><div class="muted tiny">${esc(s.desc || '')}</div></div><button class="btn sm ${k.entries.length ? '' : 'primary'}" data-addkey="${s.id}">${k.entries.length ? '＋ Another key' : '＋ Add key'}</button></div>
    ${k.entries.map((e) => e.vars.map((v) => `<div class="v-var"><span class="mono k">${esc(v.k)}</span><span class="mono val">${v.empty ? '<i class="muted">empty</i>' : esc(v.hint)}</span><span class="v-act"><button class="btn sm" data-editkey="${e.id}|${esc(v.k)}">✎ Replace key</button></span></div>`).join('') || `<div class="v-var"><span class="muted tiny">${esc(e.name)} (key file)</span><span class="v-act"><button class="btn sm" data-editkey="${e.id}|">✎ Replace</button></span></div>`).join('') || '<div class="muted tiny" style="padding:6px 2px">No key saved yet. Paste it once and every agent in this project can use it.</div>'}</div>`; };
  box.innerHTML = `<div class="card"><div class="card-h"><h2>⚙ ${esc(pr.name)}</h2><div class="pill-row"><button class="btn" id="acEdit">✎ Edit project</button><button class="btn" id="acChild">＋ Side project</button></div></div>
    <div class="muted" style="margin-bottom:8px">${esc(pr.description || 'No description yet.')}</div>
    <div class="ac-rel">${par ? `<span class="chip"><i></i>Side project of <a data-go-proj="${par.id}" style="cursor:pointer;text-decoration:underline">${esc(par.name)}</a> · shares its folders and information</span>` : ''}${pr.children.map((k) => `<span class="chip ok"><i></i>Side project: <a data-go-proj="${k.id}" style="cursor:pointer;text-decoration:underline">${esc(k.name)}</a></span>`).join('')}<span class="muted tiny mono">${esc(pr.path)}</span></div></div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h2>🔑 Keys this project's agents can use</h2><span class="muted tiny">encrypted · handed over only while an approved task runs</span></div>
      <div class="ac-chips" id="acSvc">${svcs.filter((s) => s.id !== 'other').map((s) => `<button class="ac-chip ${pr.services.includes(s.id) ? 'on' : ''}" data-svc="${s.id}" style="--c:${s.color}">${esc(s.name)}</button>`).join('')}</div>
      ${used.length ? used.map((id) => keyBlock(svcs.find((s) => s.id === id))).join('') : '<div class="muted tiny" style="margin-top:8px">Tap the services this project uses (for example Google Gemini). Then paste each key once.</div>'}</div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h2>🔗 Links & resources</h2><div class="pill-row"><button class="btn sm" data-addlink="StudyFetch||Shared study-set materials (URL only; no API key)">＋ StudyFetch</button><button class="btn sm primary" data-addlink="||">＋ Add link</button></div></div>
      <div class="muted tiny" style="margin-bottom:8px">Agents receive these links; they must report if a page cannot be read. Paste a StudyFetch shared study-set URL here; no StudyFetch API key is needed. Access depends on the shared page and the agent’s available tools.</div>
      ${pr.resources.map((r, i) => `<div class="row ac-link"><div class="grow"><b>${esc(r.title)}</b><div class="muted tiny"><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.url)}</a>${r.note ? ' · ' + esc(r.note) : ''}</div></div><a class="btn sm" href="${esc(r.url)}" target="_blank" rel="noopener">Open ↗</a><button class="btn sm ghost" data-editlink="${i}">✎</button><button class="btn sm ghost" data-dellink="${i}">✕</button></div>`).join('') || '<div class="muted tiny">No links yet.</div>'}</div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h2>🤖 Agents on this project</h2><button class="btn sm primary" id="acAgSave">Save</button></div>
      <div class="muted tiny" style="margin-bottom:8px">Ticked agents work in this project: they start in its folder, get its links, folders and keys. An agent belongs to one project at a time.</div>
      <div class="ac-agents">${d.roster.map((a) => `<div class="project-agent-assignment"><label class="ac-agent ${a.project === pr.id ? 'on' : ''}" style="--c:${a.color}"><input type="checkbox" data-ag="${a.id}" ${a.project === pr.id ? 'checked' : ''}><span class="t-g">${esc(a.glyph)}</span><span class="grow"><b>${esc(a.name)}</b><span class="muted tiny">${a.project && a.project !== pr.id ? 'now on ' + esc((S.projects.find((x) => x.id === a.project) || {}).name || a.project) : esc(a.role || '')}</span></span></label><button class="btn sm" data-agent-details="${esc(a.id)}">Edit agent</button></div>`).join('')}</div></div>

    <div class="card" style="margin-top:16px"><div class="card-h"><h2>📁 Shared folders</h2><button class="btn sm" id="acAddDir">＋ Add folder</button></div>
      <div class="muted tiny" style="margin-bottom:8px">Extra folders every agent in this project may read and use${par ? `, on top of ${esc(par.name)}'s folders` : ''}${pr.children.length ? ' and its side projects' : ''}.</div>
      ${pr.sharedPaths.map((f, i) => `<div class="row"><div class="grow t mono">${esc(f)}</div><button class="btn sm ghost" data-deldir="${i}">✕</button></div>`).join('') || '<div class="muted tiny">None added.</div>'}</div>`;
  const q = (s) => box.querySelectorAll(s);
  box.querySelector('#acEdit').onclick = () => projectEditor(pr); box.querySelector('#acChild').onclick = () => sideProjectModal(pr);
  q('[data-go-proj]').forEach((a) => (a.onclick = () => (location.hash = '#/project/' + a.dataset.goProj)));
  q('[data-svc]').forEach((b) => (b.onclick = async () => { const cur = new Set(pr.services); cur.has(b.dataset.svc) ? cur.delete(b.dataset.svc) : cur.add(b.dataset.svc); try { await save(pr.id, { services: [...cur] }); await loadAll(); accessTab(box, p); } catch (e) { toast(e.message); } }));
  q('[data-addkey]').forEach((b) => (b.onclick = () => { S.projTab[pr.id] = 'access'; addKeyModal(b.dataset.addkey); }));
  q('[data-editkey]').forEach((b) => (b.onclick = () => { const [id, k] = b.dataset.editkey.split('|'); S.projTab[pr.id] = 'access'; addKeyModal(null, id, k || null); }));
  const linkModal = (i, pre) => { const r = i != null ? pr.resources[i] : { title: pre[0] || '', url: pre[1] || '', note: pre[2] || '' };
    modal(`<h2 style="font-size:19px;margin-bottom:12px">${i != null ? 'Edit link' : 'Add a link'}</h2><div class="field"><label>Name</label><input id="lkT" value="${esc(r.title)}" placeholder="e.g. StudyFetch"></div><div class="field"><label>Address</label><input id="lkU" value="${esc(r.url)}" placeholder="https://…" autocapitalize="off" autocorrect="off"></div><div class="field"><label>Note for the agents (optional)</label><input id="lkN" value="${esc(r.note)}" placeholder="What it is and how to use it"></div><div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="lkX">Cancel</button><button class="btn primary" id="lkGo">Save</button></div>`);
    $('#lkX').onclick = closeModal; $('#lkGo').onclick = async () => { const list = pr.resources.slice(); const n = { title: $('#lkT').value, url: $('#lkU').value.trim(), note: $('#lkN').value }; if (i != null) list[i] = n; else list.push(n); try { await save(pr.id, { resources: list }); closeModal(); toast('Saved'); await loadAll(); accessTab(box, p); } catch (e) { toast(e.message); } }; };
  q('[data-addlink]').forEach((b) => (b.onclick = () => linkModal(null, b.dataset.addlink.split('|'))));
  q('[data-editlink]').forEach((b) => (b.onclick = () => linkModal(+b.dataset.editlink)));
  q('[data-dellink]').forEach((b) => (b.onclick = async () => { const list = pr.resources.filter((_, i) => i !== +b.dataset.dellink); try { await save(pr.id, { resources: list }); accessTab(box, p); } catch (e) { toast(e.message); } }));
  box.querySelector('#acAgSave').onclick = async () => { const ids = [...box.querySelectorAll('[data-ag]:checked')].map((c) => c.dataset.ag); try { await post('/api/proj/agents', { id: pr.id, agents: ids }); await loadTeam(); toast('Agents updated'); accessTab(box, p); } catch (e) { toast(e.message); } };
  box.querySelector('#acAddDir').onclick = () => { const v = prompt('Full path of the folder to share (it must be on this Mac):', pr.path); if (v) save(pr.id, { sharedPaths: [...pr.sharedPaths, v] }).then(() => accessTab(box, p)).catch((e) => toast(e.message)); };
  q('[data-deldir]').forEach((b) => (b.onclick = () => save(pr.id, { sharedPaths: pr.sharedPaths.filter((_, i) => i !== +b.dataset.deldir) }).then(() => accessTab(box, p)).catch((e) => toast(e.message))));
  animateIn(box);
}
window.accessTab = accessTab;

/* ---------- project editor ---------- */
function projectEditor(pr) {
  const others = S.projects.filter((x) => x.id !== pr.id && !isDescendant(x, pr.id));
  modal(`<h2 style="font-size:19px;margin-bottom:12px">Edit project</h2>
    <div class="field"><label>Name</label><input id="peName" value="${esc(pr.name)}"></div>
    <div class="field"><label>What is it? (agents read this)</label><textarea id="peDesc" rows="3">${esc(pr.description || '')}</textarea></div>
    <div class="field"><label>Color</label><div class="ac-colors" id="peCols">${PALETTE.map((c) => `<button type="button" class="ac-col ${c.toLowerCase() === (pr.color || '').toLowerCase() ? 'on' : ''}" data-c="${c}" style="background:${c}"></button>`).join('')}<input type="color" id="peColor" value="${pr.color}"></div></div>
    <div class="field"><label>Folder on this Mac</label><input id="pePath" class="mono" value="${esc(pr.path)}"><div class="muted tiny" style="margin-top:4px">Changing it points Jarvis at another existing folder. Nothing is moved or deleted.</div></div>
    <div class="field"><label>Part of (makes this a side project that shares information)</label><select id="peParent"><option value="">Nothing: a main project</option>${others.map((x) => `<option value="${x.id}" ${pr.parent === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="peX">Cancel</button><button class="btn primary" id="peGo">Save</button></div>`);
  let col = pr.color; $('#peCols').onclick = (e) => { const b = e.target.closest('.ac-col'); if (b) { col = b.dataset.c; $('#peColor').value = col; document.querySelectorAll('.ac-col').forEach((x) => x.classList.toggle('on', x === b)); } }; $('#peColor').oninput = (e) => (col = e.target.value);
  $('#peX').onclick = closeModal; $('#peGo').onclick = async () => { try { await save(pr.id, { name: $('#peName').value, description: $('#peDesc').value, color: col, path: $('#pePath').value, parent: $('#peParent').value || null }); closeModal(); toast('Saved'); await refreshAll(pr.id); } catch (e) { toast(e.message); } };
}
window.editProjectModal=projectEditor;
function isDescendant(x, id) { let p = x, n = 0; while (p && n++ < 6) { if (p.parent === id) return true; p = S.projects.find((q) => q.id === p.parent); } return false; }

function sideProjectModal(parent) {
  modal(`<h2 style="font-size:19px;margin-bottom:4px">New side project of ${esc(parent.name)}</h2><div class="muted" style="margin-bottom:14px">It gets its own folder inside ${esc(parent.name)} and shares the same Sources, Notes, Assignments, Outputs and a Shared folder, so both feel like one.</div>
    <div class="field"><label>Name</label><input id="spName" placeholder="e.g. Even"></div>
    <div class="field"><label>Type</label><select id="spKind"><option value="even">Even G2 smart-glasses app</option><option value="app">App / software</option><option value="study">Study area</option><option value="blank">Blank</option></select></div>
    <div class="field"><label>What is it? (optional)</label><textarea id="spDesc" rows="2"></textarea></div>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="spX">Cancel</button><button class="btn primary" id="spGo">Create side project</button></div>`);
  $('#spX').onclick = closeModal; $('#spGo').onclick = async () => { try { const r = await post('/api/proj/child', { parent: parent.id, name: $('#spName').value, kind: $('#spKind').value, description: $('#spDesc').value }); closeModal(); toast('Created ' + r.name); await loadAll(); await loadTeam(); location.hash = '#/project/' + r.id; } catch (e) { toast(e.message); } };
}

/* ---------- hero: Edit + Side project + "part of" ---------- */
const _proj = window.PAGES.project;
window.PAGES.project = async function (v) {
  await _proj(v);
  try {
    const id = window.routeArg; const p = proj(id); if (!p) return; const hero = v.querySelector('.hero-eyebrow'); if (hero && p.parent) { const par = proj(p.parent); if (par && !hero.querySelector('a')) hero.innerHTML = `SIDE PROJECT OF <a style="cursor:pointer;text-decoration:underline" data-go-par="${par.id}">${esc(par.name.toUpperCase())}</a>`; hero.querySelectorAll('[data-go-par]').forEach((a) => (a.onclick = () => (location.hash = '#/project/' + a.dataset.goPar))); }
    const edit=v.querySelector('#editProj');if(edit)edit.onclick=()=>projectEditor(p);
  } catch {}
};

/* ---------- new project: choose a parent ---------- */
const _np = window.newProjectModal;
window.newProjectModal = function () { _np(); try { const f = document.querySelector('#npTpl').closest('.field'); f.insertAdjacentHTML('afterend', `<div class="field"><label>Part of (optional: makes it a side project)</label><select id="npPar"><option value="">Nothing: a main project</option>${S.projects.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select></div>`); const go = document.querySelector('#npGo'); go.onclick = async () => { try { const par = document.querySelector('#npPar').value; const name = document.querySelector('#npName').value, description = document.querySelector('#npDesc').value, template = document.querySelector('#npTpl').value; const p = par ? await post('/api/proj/child', { parent: par, name, description, kind: template === 'app' ? 'app' : 'blank' }) : await post('/api/projects', { name, description, template }); closeModal(); toast('Created ' + p.name); await loadAll(); await loadTeam(); location.hash = '#/project/' + p.id; } catch (e) { toast(e.message); } }; } catch {} };
})();
