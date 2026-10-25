/* Agent watcher windows: a live, read-only popup per working agent on the home page.
   It only listens to /api/watch/events. The one action it can take is Approve or Decline on a plan,
   through the existing /api/tasks/approve and /api/tasks/cancel routes. It is separate from the User Assistant chat. */
(() => {
 'use strict';
 const KEY = 'jarvis.watch.v1', HOME = ['', '#/', '#/home'], W = 380, GAP = 12, EDGE = 16, TOP = 76, FEED_KEEP = 300;
 const ACTIVE = new Set(['queued', 'planning', 'running', 'awaiting_approval', 'waiting']);
 const LABEL = { queued: 'Queued', planning: 'Planning', running: 'Running', awaiting_approval: 'Needs approval', waiting: 'Needs your input', done: 'Done', failed: 'Failed', cancelled: 'Cancelled' };
 const OPENABLE = /\.(jpe?g|png|gif|webp|svg|mp4|mov|m4v|webm|mp3|wav|m4a|pdf|md|txt|csv|json)$/i;
 const items = new Map(), wins = new Map(), chips = new Map();
 let saved = readSaved(), order = Object.values(saved.w).reduce((n, s) => Math.max(n, s.o || 0), 0), initial = true, es = null, fallback = null, root, layer, dock, sr, zTop = 0, tick = 0, notified = false;
 const phone = () => matchMedia('(max-width:800px)').matches;
 const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
 const isHome = () => HOME.includes(location.hash);
 function readSaved() { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v.w === 'object' && v.w ? v : { w: {} }; } catch { return { w: {} }; } }
 function persist() { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {} }
 function prune() { for (const id of Object.keys(saved.w)) if (!items.has(id)) delete saved.w[id]; persist(); }
 const say = (t) => { if (!sr) return; sr.textContent = ''; setTimeout(() => { sr.textContent = t; }, 40); };
 const clock = (ms) => ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
 const span = (a, b) => { const s = Math.max(0, Math.round(((b || Date.now()) - a) / 1000)); return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h'; };
 const plainPost = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
 /* the app's own post() also handles sign-in and step-up prompts, so use it when it exists */
 const send = (u, b) => { let p = null; try { p = typeof post === 'function' ? post : null; } catch {} return (p || plainPost)(u, b); };
 const openers = new Map();

 /* ---------- model ---------- */
 function merge(msg) {
  const it = msg.item, prev = items.get(it.id); let added = [];
  if (msg.full || !prev) { it.feed = (it.feed || []).slice(-FEED_KEEP); added = it.feed; items.set(it.id, it); }
  else { const feed = prev.feed || []; added = (msg.feed || []).filter((e) => e.n > (feed.length ? feed[feed.length - 1].n : 0)); it.feed = feed.concat(added).slice(-FEED_KEEP); items.set(it.id, it); }
  onItem(it, prev, added, !!msg.full && !!prev);
 }
 function remove(id) { items.delete(id); closeDom(id); delete saved.w[id]; persist(); layout(); announce(); }
 function onItem(it, prev, added, rebuilt) {
  let st = saved.w[it.id];
  if (!st) { st = saved.w[it.id] = { s: ACTIVE.has(it.status) ? (initial || (isHome() && it.assignedBy === 'kim') ? 'min' : 'open') : 'closed' }; if (st.s === 'open') { st.o = ++order; enforce(it.id); } persist(); }
  if (prev && prev.status !== it.status) {
   const who = it.agent.name;
   if (it.status === 'awaiting_approval') { if (st.s === 'closed') { st.s = 'min'; persist(); } say(who + ' has a plan waiting for your approval: ' + it.title); }
   else if (it.status === 'done') say(who + ' finished: ' + it.title);
   else if (it.status === 'failed') say(who + ' failed: ' + it.title);
   else if (it.status === 'waiting') say(who + ' needs your input: ' + it.title);
  }
  sync(it.id, added, rebuilt); announce();
 }
 let queued = false;
 function announce() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; window.dispatchEvent(new CustomEvent('jarvis:watch', { detail: { items: [...items.values()] } })); }); }

 /* ---------- state changes ---------- */
 function capacity() { return phone() ? 1 : Math.max(1, Math.floor((innerWidth - EDGE * 2 + GAP) / (W + GAP))); }
 function enforce(keep) {
  const open = Object.entries(saved.w).filter(([id, s]) => s.s === 'open' && items.has(id)).sort((a, b) => (a[1].o || 0) - (b[1].o || 0));
  while (open.length > capacity()) { const i = open.findIndex(([id]) => id !== keep); if (i < 0) break; const [id, s] = open.splice(i, 1)[0]; s.s = 'min'; sync(id); }
 }
 function setState(id, s, opts = {}) {
  const st = saved.w[id] || (saved.w[id] = {}); st.s = s;
  if (s === 'open') { st.o = ++order; enforce(id); }
  persist(); sync(id); layout();
  if (opts.focus) { if (s === 'open') focusWin(id); else if (s === 'min') chips.get(id)?.focus(); }
 }
 function open(id) { if (!items.has(id)) return false; if(!isHome()){location.hash='#/home';root.hidden=false;} const from = document.activeElement; if (from && from !== document.body && !from.closest('.jw-root')) openers.set(id, from); setState(id, 'open', { focus: true }); return true; }
 function openAgent(agentId) {
  const mine = [...items.values()].filter((i) => i.agent.id === agentId);
  const pick = mine.find((i) => ['planning', 'running'].includes(i.status)) || mine.find((i) => i.status === 'awaiting_approval') || mine.find((i) => ACTIVE.has(i.status)) || mine.sort((a, b) => (b.finishedAt || b.createdAt) - (a.finishedAt || a.createdAt))[0];
  return pick ? open(pick.id) : false;
 }

 /* ---------- DOM sync ---------- */
 function closeDom(id) { const w = wins.get(id); if (w) { w.el.remove(); wins.delete(id); } const c = chips.get(id); if (c) { c.remove(); chips.delete(id); } dock.hidden = !dock.children.length; }
 function sync(id, added, rebuilt) {
  const it = items.get(id), st = saved.w[id]; if (!it || !st) return closeDom(id);
  if (st.s === 'open') { const c = chips.get(id); if (c) { c.remove(); chips.delete(id); } let w = wins.get(id); if (!w) { w = build(it); wins.set(id, w); layer.append(w.el); fill(w, it); layout(); } else update(w, it, added, rebuilt); }
  else if (st.s === 'min') { const w = wins.get(id); if (w) { w.el.remove(); wins.delete(id); } chip(it); }
  else closeDom(id);
  dock.hidden = !dock.children.length;
 }
 function chip(it) {
  let b = chips.get(it.id);
  if (!b) { b = h('button', 'jw-chip'); b.type = 'button'; b.append(h('i', 'jw-dot'), h('span', 'jw-chip-name')); b.onclick = () => setState(it.id, 'open', { focus: true }); chips.set(it.id, b); dock.append(b); }
  b.dataset.s = it.status; b.querySelector('.jw-chip-name').textContent = it.agent.name;
  b.setAttribute('aria-label', it.agent.name + ': ' + it.title + ', ' + LABEL[it.status] + '. Open window'); b.title = it.title + ' · ' + LABEL[it.status];
 }

 /* ---------- window ---------- */
 function build(it) {
  const el = h('section', 'jw-win'), uid = 'jw' + (++tick), id = it.id;
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'false'); el.setAttribute('aria-labelledby', uid + 't'); el.tabIndex = -1; el.dataset.id = id;
  const head = h('header', 'jw-head'); head.tabIndex = 0; head.setAttribute('role', 'group'); head.setAttribute('aria-label', 'Window title bar. Alt plus arrow keys move the window; Alt plus Home resets its place.');
  const avatar = h('span', 'jw-avatar'); avatar.setAttribute('aria-hidden', 'true');
  const titles = h('div', 'jw-titles'), agent = h('strong', 'jw-agent'), task = h('span', 'jw-task'); agent.id = uid + 't'; task.id = uid + 'd'; el.setAttribute('aria-describedby', uid + 'd'); titles.append(agent, task);
  const pill = h('span', 'jw-pill'), pdot = h('i', 'jw-dot'), ptxt = h('span'); pdot.setAttribute('aria-hidden', 'true'); pill.append(pdot, ptxt);
  const min = h('button', 'jw-ib'), close = h('button', 'jw-ib'); min.type = close.type = 'button'; min.setAttribute('aria-label', 'Minimise to dock'); close.setAttribute('aria-label', 'Close window');
  min.append(h('span', '', '–')); close.append(h('span', '', '×')); min.firstChild.setAttribute('aria-hidden', 'true'); close.firstChild.setAttribute('aria-hidden', 'true');
  head.append(avatar, titles, pill, min, close);
  const meta = h('div', 'jw-meta');
  const feed = h('div', 'jw-feed'); feed.setAttribute('role', 'log'); feed.setAttribute('aria-live', 'polite'); feed.setAttribute('aria-relevant', 'additions'); feed.setAttribute('aria-label', 'Live activity'); feed.tabIndex = 0;
  const jump = h('button', 'jw-jump', '↓ Jump to latest'); jump.type = 'button'; jump.hidden = true;
  const approve = h('div', 'jw-approve'); approve.hidden = true;
  const note = h('p', 'jw-approve-note', 'This agent made a plan and will not start until you approve it. Read the plan above.'); note.id = uid + 'a';
  const row = h('div', 'jw-approve-row'), decline = h('button', 'jw-btn', 'Decline'), go = h('button', 'jw-btn primary', 'Approve'); decline.type = go.type = 'button'; decline.setAttribute('aria-describedby', note.id); go.setAttribute('aria-describedby', note.id);
  const err = h('p', 'jw-err'); err.setAttribute('role', 'alert'); err.hidden = true; row.append(decline, go); approve.append(note, row, err);
  const foot = h('footer', 'jw-foot'); foot.hidden = true;
  const wrap = h('div', 'jw-feedwrap'); wrap.append(feed, jump);
  el.append(head, meta, wrap, approve, foot);
  const w = { el, id, head, avatar, agent, task, pill, ptxt, meta, feed, jump, approve, decline, go, err, foot, follow: true, unseen: 0, last: 0, live: null, confirming: 0 };
  feed.addEventListener('scroll', () => { const near = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 40; w.follow = near; if (near) { w.unseen = 0; jump.hidden = true; } }, { passive: true });
  jump.onclick = () => { w.follow = true; w.unseen = 0; jump.hidden = true; feed.scrollTop = feed.scrollHeight; feed.focus({ preventScroll: true }); };
  min.onclick = () => setState(id, 'min', { focus: true }); close.onclick = () => { const back = openers.get(id); setState(id, 'closed'); if (back && back.isConnected) back.focus({ preventScroll: true }); openers.delete(id); };
  go.onclick = () => decide(w, 'approve'); decline.onclick = () => { if (!w.confirming) { w.confirming = 1; decline.textContent = 'Confirm decline'; decline.classList.add('danger'); setTimeout(() => { if (w.confirming) { w.confirming = 0; decline.textContent = 'Decline'; decline.classList.remove('danger'); } }, 4000); return; } decide(w, 'cancel'); };
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); e.stopPropagation(); setState(id, 'min', { focus: true }); } });
  el.addEventListener('pointerdown', () => front(el), true);
  head.addEventListener('keydown', (e) => { if (!e.altKey || phone()) return; const st = saved.w[id] || (saved.w[id] = {}), r = el.getBoundingClientRect(), s = 24; let x = st.x ?? r.left, y = st.y ?? r.top;
   if (e.key === 'ArrowLeft') x -= s; else if (e.key === 'ArrowRight') x += s; else if (e.key === 'ArrowUp') y -= s; else if (e.key === 'ArrowDown') y += s; else if (e.key === 'Home') { delete st.x; delete st.y; persist(); layout(); e.preventDefault(); return; } else return;
   e.preventDefault(); st.x = x; st.y = y; persist(); layout(); });
  drag(w);
  return w;
 }
 function front(el) { zTop = (zTop + 1) % 18; el.style.zIndex = 60 + zTop; }
 function drag(w) {
  let sx, sy, ox, oy, on = false;
  w.head.addEventListener('pointerdown', (e) => { if (phone() || e.button !== 0 || e.target.closest('button')) return; const r = w.el.getBoundingClientRect(); sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top; on = true; w.head.setPointerCapture(e.pointerId); w.el.classList.add('is-dragging'); });
  w.head.addEventListener('pointermove', (e) => { if (!on) return; const st = saved.w[w.id] || (saved.w[w.id] = {}); st.x = ox + e.clientX - sx; st.y = oy + e.clientY - sy; place(w, st); });
  const end = () => { if (!on) return; on = false; w.el.classList.remove('is-dragging'); persist(); };
  w.head.addEventListener('pointerup', end); w.head.addEventListener('pointercancel', end);
 }
 const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));
 function place(w, st, auto) {
  const el = w.el; if (phone()) { el.style.left = el.style.top = el.style.height = ''; return; }
  const hgt = Math.max(260, Math.min(560, innerHeight - TOP - 72)); el.style.height = hgt + 'px';
  const x = st.x != null ? clamp(st.x, 8, innerWidth - W - 8) : auto.x, y = st.y != null ? clamp(st.y, 8, innerHeight - 120) : auto.y;
  el.style.left = x + 'px'; el.style.top = y + 'px';
 }
 function layout() {
  const open = [...wins.values()].map((w) => [w, saved.w[w.id] || {}]).sort((a, b) => (a[1].o || 0) - (b[1].o || 0));
  let slot = 0; for (const [w, st] of open) { if (st.x != null) { place(w, st); continue; } place(w, st, { x: innerWidth - EDGE - W - slot * (W + GAP), y: TOP }); slot++; }
  if (phone()) for (const [w] of open) w.el.style.zIndex = '';
 }
 function focusWin(id) { const w = wins.get(id); if (w) { front(w.el); w.el.focus({ preventScroll: true }); } }

 /* ---------- content ---------- */
 const sheetHead = (it) => (it.engine ? it.engine.replace(/^api:/, '') : '') + (it.model ? ' · ' + it.model : '') + (it.effort ? ' · ' + it.effort : '');
 function fill(w, it) { paint(w, it); w.feed.replaceChildren(); for (const e of it.feed || []) w.feed.append(entry(e)); liveBubble(w, it); w.feed.scrollTop = w.feed.scrollHeight; w.follow = true; foot(w, it); }
 function paint(w, it) {
  const c =/^#[0-9a-f]{3,8}$/i.test(it.agent.color || '') ? it.agent.color : '#2dd4ee'; w.el.style.setProperty('--agent', c); w.el.dataset.s = it.status;
  w.avatar.textContent = (it.agent.glyph || it.agent.name || '?').trim().slice(0, 2).toUpperCase(); w.agent.textContent = it.agent.name; w.task.textContent = it.title; w.task.title = it.title;
  w.ptxt.textContent = LABEL[it.status] || it.status; w.pill.dataset.s = it.status;
  const bits = [sheetHead(it), it.course, it.stage, it.startedAt ? 'Started ' + clock(it.startedAt) : it.createdAt ? 'Created ' + clock(it.createdAt) : '', it.cost ? '$' + it.cost.toFixed(2) : ''].filter(Boolean);
  w.meta.textContent = bits.join(' · ');
 }
 function update(w, it, added, rebuilt) {
  paint(w, it);
  if (rebuilt) { fill(w, it); return; }
  if (added && added.length) { const fresh = added.filter((e) => e.n > w.last); const prevLive = w.live; if (prevLive) { prevLive.remove(); w.live = null; } for (const e of fresh) w.feed.append(entry(e)); while (w.feed.children.length > FEED_KEEP) w.feed.firstChild.remove(); if (!w.follow) { w.unseen += fresh.length; if (w.unseen) { w.jump.textContent = '↓ ' + w.unseen + ' new · Jump to latest'; w.jump.hidden = false; } } }
  liveBubble(w, it);
  if (w.follow) w.feed.scrollTop = w.feed.scrollHeight;
  foot(w, it);
 }
 function liveBubble(w, it) {
  if (!it.live) { if (w.live) { w.live.remove(); w.live = null; } return; }
  if (!w.live) { w.live = h('div', 'jw-e say live'); w.live.setAttribute('aria-hidden', 'true'); w.live.append(h('span', 'jw-who', it.agent.name + ' is writing'), h('p', 'jw-txt')); }
  w.live.lastChild.textContent = it.live; if (w.live.parentNode !== w.feed) w.feed.append(w.live);
 }
 function foot(w, it) {
  const last = it.feed && it.feed.length ? it.feed[it.feed.length - 1].n : 0; w.last = last;
  w.approve.hidden = !it.approval; if (!it.approval) { w.confirming = 0; w.decline.textContent = 'Decline'; w.decline.classList.remove('danger'); w.go.disabled = w.decline.disabled = false; w.err.hidden = true; }
  const end = ['done', 'failed', 'cancelled', 'waiting'].includes(it.status);
  w.foot.hidden = !end; if (!end) { w.foot.replaceChildren(); return; }
  const key = it.status + (it.outputs || []).length + (it.files || []).length + (it.error || ''); if (w.foot.dataset.k === key) return; w.foot.dataset.k = key; w.foot.replaceChildren();
  const title = h('strong', 'jw-foot-title', it.status === 'done' ? 'Done' : it.status === 'failed' ? 'Failed' : it.status === 'cancelled' ? 'Cancelled' : 'Needs your input');
  const when = it.finishedAt && it.startedAt ? ' · took ' + span(it.startedAt, it.finishedAt) : ''; const sub = h('span', 'jw-foot-sub', (it.finishedAt ? 'Finished ' + clock(it.finishedAt) : '') + when + (it.cost ? ' · $' + it.cost.toFixed(2) : ''));
  w.foot.append(title, sub); if (it.error) w.foot.append(h('p', 'jw-foot-err', it.error));
  if(it.status==='failed'){
   const limited=/limit|quota|credits|rate.?limit/i.test(it.error||'');
   const guidance=limited?'The AI provider reported a usage limit. Wait for the reset shown above, or choose an available provider in the agent settings. Then retry. Jarvis will not buy credits or retry repeatedly.':/403|401|unauthori|forbidden/i.test(it.error||'')?'Access was refused. Reconnect the affected account or check that the source is accessible, then retry.':'Review the error above, correct the connection or agent settings, then retry.';
   w.foot.append(h('p','jw-foot-err','How to fix: '+guidance));
   const settings=h('a','jw-foot-link','Agent settings ↗');settings.href='#/team/'+encodeURIComponent(it.agent.id);w.foot.append(settings);
   if(it.source==='task'&&it.taskId){const retry=h('button','jw-btn','Retry task');retry.onclick=async()=>{if(!confirm('Retry this task with its current agent and approval settings? Resolve the reported issue first.'))return;retry.disabled=true;try{await send('/api/tasks/retry',{id:it.taskId});retry.textContent='Retry queued';}catch(e){retry.disabled=false;retry.textContent='Retry task';w.foot.append(h('p','jw-foot-err',e.message||'Retry failed'));}};w.foot.append(retry);}
  }
  const files = (list, label) => { if (!list || !list.length) return; const box = h('div', 'jw-files'), cap = h('span', 'jw-files-cap', label); box.append(cap); const ul = h('ul'); for (const f of list.slice(0, 8)) { const li = h('li'); if (OPENABLE.test(f.path)) { const a = h('a', '', f.name); a.href = '/api/file?p=' + encodeURIComponent(f.path); a.target = '_blank'; a.rel = 'noopener'; a.setAttribute('aria-label', 'Open ' + f.name + ' in a new tab'); li.append(a); } else li.append(h('span', '', f.name)); li.append(h('code', '', f.path)); ul.append(li); } box.append(ul); w.foot.append(box); };
  files(it.outputs, 'Output files'); files(it.files, 'Files changed');
  const more = h('a', 'jw-foot-link', it.source === 'study' ? 'Open study module ↗' : 'Open Agent team ↗'); more.href = it.href || '#/team'; w.foot.append(more);
 }
 const LABELS = { user: 'Task', say: '', plan: 'Plan', result: 'Result', error: 'Error', review: 'Council', file: '', step: '', warn: '', status: '' };
 function entry(e) {
  const k = e.k, n = h('div', 'jw-e ' + k); n.dataset.n = e.n;
  if (k === 'status') { n.append(h('span', 'jw-txt', e.text + ' · ' + clock(e.at))); return n; }
  if (k === 'step' || k === 'file' || k === 'warn' || k === 'review') { const ic = h('span', 'jw-ic', k === 'file' ? '✎' : k === 'warn' ? '!' : k === 'review' ? '◇' : '›'); ic.setAttribute('aria-hidden', 'true'); n.append(ic, h('span', 'jw-txt', (k === 'warn' ? 'Warning: ' : k === 'file' ? 'Changed file: ' : '') + e.text)); return n; }
  const label = LABELS[k]; if (label) n.append(h('span', 'jw-who', label));
  if (e.text.length > 700 || k === 'plan' || k === 'result') { const d = h('details'); if (k === 'plan' || k === 'result' || k === 'error') d.open = true; const s = h('summary', '', e.text.slice(0, 140).replace(/\s+/g, ' ') + (e.text.length > 140 ? '…' : '')); d.append(s, h('p', 'jw-txt', e.text)); n.append(d); }
  else n.append(h('p', 'jw-txt', e.text));
  return n;
 }
 async function decide(w, act) {
  const it = items.get(w.id); if (!it || !it.approval) return;
  w.go.disabled = w.decline.disabled = true; w.err.hidden = true; w.go.textContent = act === 'approve' ? 'Approving…' : 'Approve';
  try { await send('/api/tasks/' + act, { id: it.taskId }); w.go.textContent = 'Approve'; say(act === 'approve' ? 'Approved. ' + it.agent.name + ' is starting.' : 'Plan declined.'); }
  catch (e) { w.err.textContent = 'Could not ' + (act === 'approve' ? 'approve' : 'decline') + ': ' + (e.message || 'try again'); w.err.hidden = false; w.go.disabled = w.decline.disabled = false; w.go.textContent = 'Approve'; w.confirming = 0; w.decline.textContent = 'Decline'; w.decline.classList.remove('danger'); }
 }

 /* ---------- connection ---------- */
 function connect() {
  if (es) return; try { es = new EventSource('/api/watch/events'); } catch { return poll(); }
  es.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch { return; } if (fallback) { clearInterval(fallback); fallback = null; } handle(m); };
  es.onerror = () => { if (es && es.readyState === 2) { es.close(); es = null; setTimeout(connect, 5000); } };
 }
 function handle(m) {
  if (m.type === 'item') merge(m); else if (m.type === 'remove') remove(m.id);
  else if (m.type === 'ready') initial = true;
  else if (m.type === 'synced') { initial = false; prune(); enforce(); for (const id of Object.keys(saved.w)) sync(id); layout(); }
 }
 function poll() { if (fallback) return; fallback = setInterval(async () => { try { const r = await fetch('/api/watch', { cache: 'no-store' }); if (!r.ok) return; const j = await r.json(); const ids = new Set(); for (const it of j.items || []) { ids.add(it.id); merge({ item: it, full: true }); } initial = false; for (const id of [...items.keys()]) if (!ids.has(id)) remove(id); } catch {} }, 4000); }

 /* ---------- boot ---------- */
 function visible() { root.hidden = !isHome(); if (!root.hidden) layout(); }
 function boot() {
  root = h('div', 'jw-root'); root.id = 'jwRoot'; layer = h('div', 'jw-layer'); dock = h('div', 'jw-dock'); dock.setAttribute('role', 'group'); dock.setAttribute('aria-label', 'Minimised agent windows'); dock.hidden = true;
  sr = h('div', 'jw-sr'); sr.setAttribute('role', 'status'); sr.setAttribute('aria-live', 'polite'); root.append(layer, dock, sr); document.body.append(root);
  visible(); addEventListener('hashchange', visible); addEventListener('resize', () => { enforce(); layout(); });
  matchMedia('(max-width:800px)').addEventListener('change', () => { enforce(); layout(); });
  connect();
 }
 window.JarvisWatch = { items: () => [...items.values()], open, openAgent };
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
