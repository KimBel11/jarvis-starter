'use strict';
// Council page (several AIs answer in parallel, one writes the brief + audio summary) and the Skill library card on Plugins & skills.
S.council = S.council || { roles: null, sel: null, est: null, id: null, timer: null };
const ENG_C = { claude: 'var(--claude)', codex: 'var(--codex)', gemini: '#8b6cf0' };
const roleChip = (r, on) => `<label class="cn-role ${on ? 'on' : ''}" style="--c:${ENG_C[r.engine] || '#8793a8'}"><input type="checkbox" data-r="${esc(r.id)}" ${on ? 'checked' : ''}><b>${esc(r.name)}</b><span>${esc(r.engine)}${r.model ? ' · ' + esc(r.model) : ''}${r.effort ? ' · ' + esc(r.effort) : ''}</span><em>${esc((r.brief || '').split('. ')[0].replace(/\.$/, ''))}.</em></label>`;

function councilResultHtml(c, i) {
  const st = c.status === 'running' ? '<span class="chip warn"><i></i>Working…</span>' : c.status === 'done' ? '<span class="chip ok"><i></i>Done</span>' : '<span class="chip bad"><i></i>Failed</span>';
  const answers = (c.results || []).map((r) => `<div class="card cn-ans" style="border-top:3px solid ${ENG_C[r.engine] || '#8793a8'}"><div class="card-h"><h2>${esc(r.name)}</h2><span class="muted tiny">${esc(r.engine)}${r.model ? ' · ' + esc(r.model) : ''} · ${r.status === 'running' ? 'thinking…' : r.status}</span></div>${r.text ? `<div class="md">${mdLite(r.text)}</div>` : r.error ? `<div class="muted tiny">${esc(r.error)}</div>` : '<div class="typing"><i></i><i></i><i></i></div>'}</div>`).join('');
  const brief = c.brief ? `<div class="card cn-brief"><div class="card-h"><h2>One-page brief</h2><span class="muted tiny">written by ${esc((c.chair || {}).id || '')} (${esc((c.chair || {}).engine || '')}), picked at random</span></div>
    ${c.audio ? `<div class="cn-audio"><button class="btn" data-play="${esc(c.id)}">▶ Listen to the voice note</button><span class="muted tiny">about ${Math.round(c.audio.split(/\s+/).length / 2.6)} seconds</span></div>` : ''}
    <div class="md">${mdLite(c.brief)}</div>${(c.options || []).length ? `<div class="cn-opts">${c.options.map((o) => `<span class="tag">${esc(o)}</span>`).join('')}</div>` : ''}
    <div class="muted tiny" style="margin-top:8px">The council gives options. The decision is yours.${c.cost ? ' Cost about $' + c.cost.toFixed(2) + ' on Claude.' : ''}</div></div>` : '';
  return `<div class="cn-round" data-cid="${esc(c.id)}"><div class="cn-q"><span class="cn-qn">${i ? 'Follow-up ' + i : 'Question'}</span><b>${esc(c.question)}</b>${st}</div>${c.error ? `<div class="card"><div class="muted">${esc(c.error)}</div></div>` : ''}${brief}<details class="cn-det" ${c.status === 'running' || !c.brief ? 'open' : ''}><summary>What each member said</summary><div class="grid g2 cn-grid">${answers}</div></details></div>`;
}

// the whole thread: a first question and its follow-ups
async function councilThread(rootId) {
  const box = document.getElementById('cnOut'); if (!box) return; const C = S.council; C.open = rootId; clearTimeout(C.timer);
  let list = []; try { list = (await api('/api/council/list')).councils; } catch {}
  const ids = [rootId, ...list.filter((x) => x.root === rootId).sort((a, b) => a.createdAt - b.createdAt).map((x) => x.id)];
  const cs = []; for (const id of ids) { try { cs.push(await api('/api/council?id=' + encodeURIComponent(id))); } catch {} }
  if (!document.getElementById('cnOut')) return; if (!cs.length) { box.innerHTML = '<div class="empty">Not found.</div>'; return; }
  const last = cs[cs.length - 1]; const running = cs.some((x) => x.status === 'running'); C.last = last.id;
  box.innerHTML = '<button class="btn sm ghost cv-back" id="cnBack" style="margin-bottom:10px">‹ All councils</button>' + cs.map((x, i) => councilResultHtml(x, i)).join('') + (running ? '' : `<div class="card cn-follow"><div class="card-h"><h2>Ask a follow-up</h2><span class="muted tiny">the council remembers this conversation</span></div><textarea id="cnFu" rows="2" placeholder="e.g. What if we only had half the budget? Which option still works?"></textarea><div class="cn-actions"><button class="btn" id="cnFuEst">Estimate cost</button><span id="cnFuTxt" class="muted tiny">Nothing is sent until you confirm the cost.</span></div><div id="cnFuGo" hidden><button class="btn primary" id="cnFuRun">Yes, ask the council</button></div></div>`);
  const bk = box.querySelector('#cnBack'); if (bk) bk.onclick = () => { C.open = null; clearTimeout(C.timer); vCouncil(document.getElementById('view')); };
  box.querySelectorAll('[data-play]').forEach((b) => (b.onclick = () => { const c = cs.find((x) => x.id === b.dataset.play); if (c && window.Jarvis) { Jarvis.open(); Jarvis.say(c.audio); } }));
  const fe = box.querySelector('#cnFuEst'); if (fe) { const body = () => ({ question: box.querySelector('#cnFu').value, roles: [...C.sel], parent: last.id });
    fe.onclick = async () => { if (!box.querySelector('#cnFu').value.trim()) return toast('Write the follow-up first'); try { const e = await post('/api/council/estimate', body()); box.querySelector('#cnFuTxt').textContent = e.text; box.querySelector('#cnFuGo').hidden = false; } catch (x) { toast(x.message); } };
    box.querySelector('#cnFuRun').onclick = async () => { try { box.querySelector('#cnFuGo').hidden = true; await post('/api/council/run', { ...body(), confirm: true }); toast('The council is working on it'); setTimeout(() => councilThread(rootId), 800); } catch (x) { toast(x.message); } }; }
  if (running) C.timer = setTimeout(() => { if (location.hash.startsWith('#/council')) councilThread(rootId); }, 2500);
  else if (C.autoPlay && last.audio && C.autoPlay === last.id && window.Jarvis) { C.autoPlay = null; Jarvis.open(); Jarvis.say(last.audio); }
}

async function vCouncil(v) {
  const C = S.council;
  v.innerHTML = '<div class="empty">Loading…</div>';
  try { if (!C.roles) { C.roles = (await api('/api/council/roles')).roles; C.sel = new Set(C.roles.map((r) => r.id)); } } catch (e) { v.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  let hist = []; try { hist = (await api('/api/council/list')).councils; } catch {}
  const roots = hist.filter((h) => !h.root); const kids = (id) => hist.filter((h) => h.root === id);
  const item = (h) => { const k = kids(h.id); const lastT = Math.max(h.createdAt, ...k.map((x) => x.createdAt)); const running = [h, ...k].some((x) => x.status === 'running'); return `<div class="cv-item ${C.open === h.id ? 'on' : ''}" data-croot="${esc(h.id)}"><div class="cv-i-t">${esc(h.question.slice(0, 80))}</div><div class="cv-i-m">${running ? '<span class="chip warn"><i></i>working</span>' : `<span class="chip ${h.status === 'done' ? 'ok' : 'bad'}"><i></i>${h.status}</span>`}<span class="muted tiny">${k.length ? k.length + ' follow-up' + (k.length > 1 ? 's' : '') + ' · ' : ''}${ago(lastT)}</span><span class="grow"></span><button class="btn sm ghost" data-cdel="${esc(h.id)}" title="Delete">✕</button></div></div>`; };
  v.innerHTML = `<div class="hello"><div><h1>Council</h1><div class="sub">For a big decision. Several AIs answer the same question at once, each with a different job, and one of them (picked at random) writes a one-page brief plus a voice note you can just listen to. It gives options and never decides for you. Every council is saved here, and you can keep the conversation going with follow-ups.</div></div></div>
  <div class="cv-wrap ${C.open ? 'has-open' : ''}"><aside class="cv-side"><button class="btn primary cv-new" id="cnNew">＋ New question</button><div class="cv-h">Your councils</div>${roots.length ? roots.map(item).join('') : '<div class="muted tiny" style="padding:6px 2px">None yet.</div>'}</aside>
  <section class="cv-main"><div id="cnNewBox" ${C.open ? 'hidden' : ''}>
    <div class="cn-steps"><div class="cn-step"><b>1</b><span>You ask<small>one clear question</small></span></div><div class="cn-step"><b>2</b><span>The AIs answer<small>at the same time</small></span></div><div class="cn-step"><b>3</b><span>One writes the brief<small>and a voice note</small></span></div><div class="cn-step"><b>4</b><span>You decide<small>or ask a follow-up</small></span></div></div>
    <div class="card cn-ask">
      <div><label class="cn-lbl" for="cnQ">Your question</label><textarea id="cnQ" placeholder="What are you deciding? e.g. Should my project launch its first product in Sweden or the Gulf first?"></textarea></div>
      <div><span class="cn-lbl">Who takes part</span><div class="cn-roles">${C.roles.map((r) => roleChip(r, C.sel.has(r.id))).join('')}</div></div>
      <div><label class="cn-lbl" for="cnCtx">Background file (optional)</label><input id="cnCtx" class="cn-in mono" placeholder="Full path to a plan or notes"></div>
      <div class="cn-actions"><button class="btn" id="cnEst">Estimate cost</button><span id="cnEstTxt">Nothing is sent until you confirm the cost.</span></div>
      <div id="cnConfirm" hidden><button class="btn primary" id="cnRun">Yes, run the council</button></div></div></div>
  <div id="cnOut"></div></section></div>`;
  const q = (s) => v.querySelector(s); const body = () => ({ question: q('#cnQ').value, contextPath: q('#cnCtx').value.trim() || undefined, roles: [...C.sel] });
  v.querySelectorAll('.cn-role input').forEach((i) => (i.onchange = () => { i.checked ? C.sel.add(i.dataset.r) : C.sel.delete(i.dataset.r); i.parentNode.classList.toggle('on', i.checked); q('#cnConfirm').hidden = true; }));
  q('#cnNew').onclick = () => { C.open = null; clearTimeout(C.timer); vCouncil(v); };
  q('#cnEst').onclick = async () => { if (!C.sel.size) return toast('Pick at least one member'); if (!q('#cnQ').value.trim()) return toast('Write the question first'); try { C.est = await post('/api/council/estimate', body()); q('#cnEstTxt').textContent = C.est.text; q('#cnConfirm').hidden = false; } catch (e) { toast(e.message); } };
  q('#cnRun').onclick = async () => { try { q('#cnConfirm').hidden = true; const r = await post('/api/council/run', { ...body(), confirm: true }); C.open = r.id; C.autoPlay = r.id; q('#cnNewBox').hidden = true; councilThread(r.id); } catch (e) { toast(e.message); } };
  v.querySelectorAll('[data-croot]').forEach((r) => (r.onclick = (e) => { if (e.target.closest('[data-cdel]')) return; C.open = r.dataset.croot; v.querySelector('.cv-wrap').classList.add('has-open'); q('#cnNewBox').hidden = true; v.querySelectorAll('.cv-item').forEach((x) => x.classList.toggle('on', x === r)); councilThread(C.open); }));
  v.querySelectorAll('[data-cdel]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); if (!confirm('Delete this council and its follow-ups?')) return; try { const id = b.dataset.cdel; for (const k of hist.filter((h) => h.root === id)) await post('/api/council/delete', { id: k.id }); await post('/api/council/delete', { id }); if (C.open === id) C.open = null; vCouncil(v); } catch (x) { toast(x.message); } }));
  if (C.open) councilThread(C.open);
}

/* ---------- Skill library (card on Plugins & skills) ---------- */
async function skillLibHtml() {
  let d; try { d = await api('/api/skills'); } catch (e) { return `<div class="card"><div class="muted">${esc(e.message)}</div></div>`; }
  const own = d.own.map((s) => `<div class="row"><div class="grow"><b>${esc(s.name)}</b><div class="muted tiny">${esc(s.description.slice(0, 160))}</div></div><span class="chip ${s.installed.claude ? 'ok' : 'warn'}"><i></i>Claude</span><span class="chip ${s.installed.codex ? 'ok' : 'warn'}"><i></i>Codex</span></div>`).join('');
  const dup = d.duplicates.length ? d.duplicates.map((g, i) => `<div class="sk-dup"><div><b>Keep ${esc(g.keep.dir)}</b> <span class="muted tiny">(${esc(g.keep.engine)})</span> · <b>Archive ${esc(g.drop.dir)}</b> <span class="muted tiny">(${esc(g.drop.engine)})</span></div><div class="muted tiny">${esc(g.reason)}</div><button class="btn sm sk-arch" data-e="${esc(g.drop.engine)}" data-d="${esc(g.drop.dir)}">Archive ${esc(g.drop.dir)}</button></div>`).join('') : '<div class="muted tiny">No duplicates. Every skill does its own job.</div>';
  const arch = d.archived.length ? d.archived.map((a) => `<div class="row"><div class="grow t">${esc(a.dir)} <span class="muted tiny">${esc(a.engine)} · ${esc(a.day)}</span></div><button class="btn sm ghost sk-rest" data-e="${esc(a.engine)}" data-day="${esc(a.day)}" data-d="${esc(a.dir)}">Restore</button></div>`).join('') : '<div class="muted tiny">Nothing archived. Archiving only moves a skill aside; nothing is ever deleted.</div>';
  const mir = d.mirrored.length ? `<div class="muted tiny" style="margin-top:8px">Same skill kept for both Claude and Codex on purpose: ${d.mirrored.map((m) => esc(m.name)).join(', ')}.</div>` : '';
  return `<div class="card" id="skLib"><div class="card-h"><h2>Skill library</h2><span class="muted tiny">${d.skills.length} skills in total</span></div>
    <div class="muted tiny" style="margin-bottom:8px">Jarvis' own skills teach @@ASSISTANT@@ which AI and model fit which job, and how to run a council. They are installed for both Claude and Codex.</div>
    ${own}<button class="btn sm" id="skInst" style="margin-top:8px">Reinstall for Claude and Codex</button>
    <div class="card-h" style="margin-top:16px"><h2>Duplicates</h2></div>${dup}${mir}
    <div class="card-h" style="margin-top:16px"><h2>Archive</h2></div>${arch}</div>`;
}
function wireSkillLib(root) {
  const redo = async () => { const el = $('#skLib'); if (el) { const h = await skillLibHtml(); el.outerHTML = h; wireSkillLib($('#skLib').parentNode); } };
  root.querySelectorAll('.sk-arch').forEach((b) => (b.onclick = async () => { try { await post('/api/skills/archive', { engine: b.dataset.e, dir: b.dataset.d }); toast('Archived. You can restore it any time.'); redo(); } catch (e) { toast(e.message); } }));
  root.querySelectorAll('.sk-rest').forEach((b) => (b.onclick = async () => { try { await post('/api/skills/restore', { engine: b.dataset.e, day: b.dataset.day, dir: b.dataset.d }); toast('Restored'); redo(); } catch (e) { toast(e.message); } }));
  const i = root.querySelector('#skInst'); if (i) i.onclick = async () => { try { await post('/api/skills/install', {}); toast('Installed'); redo(); } catch (e) { toast(e.message); } };
}
const _agentsPage = (window.PAGES && window.PAGES.agents) || vAgents;
window.PAGES.agents = async function (v) {
  await _agentsPage(v);
  const h = await skillLibHtml(); const first = v.querySelector('.hello');
  const wrap = document.createElement('div'); wrap.style.margin = '0 0 16px'; wrap.innerHTML = h; first ? first.after(wrap) : v.prepend(wrap); wireSkillLib(wrap);
};
window.PAGES.council = vCouncil;
