/* Home-page approval cards: a plan that needs @@NAME@@’s OK shows up on the home page with Approve, Decline and View plan.
   Nothing here approves anything by itself. The buttons call the existing /api/tasks/approve and /api/tasks/cancel routes, the same ones
   the Agent team page, the watcher windows and iMessage use. Plans and risk come from /api/team; the watcher (JarvisWatch) is only a "something changed" signal
   and the way to open the agent's live window. Study-module runs have no plan-approval step, so they never appear here. */
(() => {
 'use strict';
 const HOME = ['', '#/', '#/home'], EVERY = 10000, KEEP_OK = 7000, KEEP_NO = 3500, CONFIRM_MS = 10000;
 const TAG = { publish: 'Publishes', deploy: 'Deploys', spend: 'Spends credits', delete: 'Deletes', unknown: 'Check first' };
 const UNKNOWN = { level: 'sensitive', kinds: ['unknown'], labels: ['The plan could not be checked for risk. Read it before approving.'], verb: '', cost: '' };
 const cards = new Map();
 let root, bar, barBtn, badge, stack, sr, seq = 0, inflight = false, again = false, baseTitle = null, announced = new Set();
 const h = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
 const isHome = () => HOME.includes(location.hash);
 const plainPost = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }).then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; });
 /* the app's own post() also handles sign-in and step-up prompts, so use it when it exists */
 const send = (u, b) => { let p = null; try { p = typeof post === 'function' ? post : null; } catch {} return (p || plainPost)(u, b); };
 const say = (t) => { sr.textContent = ''; setTimeout(() => { sr.textContent = t; }, 40); };
 const summary = (plan) => String(plan || '').split('\n').map((l) => l.replace(/^[\s>#*\-–•]+/, '').replace(/[*_`]/g, '').trim()).filter(Boolean).slice(0, 4).join('\n');

 /* ---------- data ---------- */
 function normalise(d) {
  const agents = new Map((d.agents || []).map((a) => [a.id, a]));
  return (d.tasks || []).filter((t) => t.status === 'awaiting_approval').map((t) => {
   const a = agents.get(t.agent) || {}, r = t.routing || {}, engine = String(r.engine || t.runEngine || t.engine || a.engine || '').replace(/^api:/, '');
   return { id: t.id, agent: a.name || t.agent, color: /^#[0-9a-f]{3,8}$/i.test(a.color || '') ? a.color : '', title: t.title || t.prompt || 'Untitled task', engine, model: r.model || (a.models && a.models[engine]) || '', plan: String(t.plan || ''), risk: t.risk && Array.isArray(t.risk.kinds) ? t.risk : UNKNOWN, startedAt: t.startedAt || 0, at: t.createdAt || 0 };
  }).sort((x, y) => x.at - y.at);
 }
 async function refresh() {
  if (inflight) { again = true; return; } inflight = true;
  try { const r = await fetch('/api/team', { cache: 'no-store' }); if (r.ok) { const d = await r.json(); if (Array.isArray(d.tasks)) reconcile(normalise(d)); } } catch {} finally { inflight = false; if (again) { again = false; setTimeout(refresh, 300); } }
 }

 /* ---------- cards ---------- */
 function makeCard(t) {
  const uid = 'ap' + (++seq), el = h('article', 'ap-card'); el.dataset.id = t.id; el.setAttribute('role', 'group'); el.setAttribute('aria-labelledby', uid + 'h');
  const head = h('header', 'ap-head'), dot = h('i', 'ap-dot'), titles = h('div', 'ap-titles'), agent = h('strong', 'ap-agent'), task = h('span', 'ap-task'), tag = h('span', 'ap-tag');
  const toggle = h('button', 'ap-ib'); toggle.type = 'button'; toggle.setAttribute('aria-controls', uid + 'b'); const chev = h('span', '', '▾'); chev.setAttribute('aria-hidden', 'true'); toggle.append(chev);
  dot.setAttribute('aria-hidden', 'true'); agent.id = uid + 'h'; titles.append(agent, task); head.append(dot, titles, tag, toggle);
  const body = h('div', 'ap-body'); body.id = uid + 'b';
  const engine = h('p', 'ap-engine'), sum = h('p', 'ap-sum'), willH = h('p', 'ap-will-h', 'If you approve'), will = h('ul', 'ap-will'), cost = h('p', 'ap-cost');
  const full = h('div', 'ap-full'); full.id = uid + 'f'; full.hidden = true; full.tabIndex = 0; full.setAttribute('role', 'region'); full.setAttribute('aria-label', 'Full plan');
  const fullTxt = h('p', 'ap-full-txt'); full.append(fullTxt);
  const live = h('div', 'ap-row ap-live'), openWin = h('button', 'ap-btn small', 'Open agent window'); openWin.type = 'button'; live.hidden = true; live.append(openWin);
  const dec = h('div', 'ap-decline'); dec.hidden = true;
  const lab = h('label', 'ap-lab', 'Reason (optional)'); const reason = h('input', 'ap-reason'); reason.type = 'text'; reason.maxLength = 300; reason.id = uid + 'r'; reason.autocomplete = 'off'; reason.placeholder = 'Short note for the record'; lab.htmlFor = reason.id;
  const drow = h('div', 'ap-row'), back1 = h('button', 'ap-btn', 'Back'), doDecline = h('button', 'ap-btn danger', 'Decline plan'); back1.type = doDecline.type = 'button'; drow.append(back1, doDecline); dec.append(lab, reason, drow);
  const msg = h('p', 'ap-msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite'); msg.hidden = true;
  const acts = h('div', 'ap-row ap-actions'), go = h('button', 'ap-btn primary', 'Approve'), back2 = h('button', 'ap-btn', 'Back'), no = h('button', 'ap-btn', 'Decline'), view = h('button', 'ap-btn', 'View plan');
  go.type = back2.type = no.type = view.type = 'button'; back2.hidden = true; view.setAttribute('aria-controls', full.id); view.setAttribute('aria-expanded', 'false'); acts.append(go, back2, no, view);
  body.append(engine, sum, willH, will, cost, full, live, dec, msg, acts); el.append(head, body);
  const c = { id: t.id, uid, el, t, open: !stack.querySelector('.ap-card:not([data-collapsed])'), plan: false, declining: false, confirming: false, busy: false, result: '', timer: 0, ct: 0, r: { dot, agent, task, tag, toggle, chev, body, engine, sum, willH, will, cost, full, fullTxt, live, openWin, dec, reason, doDecline, back1, back2, msg, acts, go, no, view } };
  toggle.onclick = () => { c.open = !c.open; if (!c.open) reset(c); paint(c); };
  head.addEventListener('click', (e) => { if (!c.open && !e.target.closest('button')) { c.open = true; paint(c); } });
  view.onclick = () => { c.plan = !c.plan; paint(c); };
  openWin.onclick = () => openLive(c);
  go.onclick = () => approve(c); back2.onclick = () => { reset(c); paint(c); go.focus(); };
  no.onclick = () => { c.declining = true; reset(c, true); paint(c); reason.focus(); };
  back1.onclick = () => { c.declining = false; paint(c); no.focus(); };
  doDecline.onclick = () => decline(c);
  reason.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); decline(c); } });
  return c;
 }
 function reset(c, keepDecline) { c.confirming = false; clearTimeout(c.ct); if (!keepDecline) c.declining = false; }
 function paint(c) {
  const t = c.t, r = c.r, risk = t.risk, sensitive = risk.level === 'sensitive', done = !!c.result;
  if (c.open) delete c.el.dataset.collapsed; else c.el.dataset.collapsed = '1';
  c.el.dataset.risk = sensitive ? 'sensitive' : 'local'; c.el.dataset.result = c.result; c.el.setAttribute('aria-busy', String(c.busy));
  if (t.color) c.el.style.setProperty('--agent', t.color);
  r.agent.textContent = t.agent; r.task.textContent = t.title; r.task.title = t.title;
  r.tag.textContent = done ? (c.result === 'approved' ? 'Approved' : c.result === 'declined' ? 'Declined' : 'Done') : risk.kinds.length ? risk.kinds.map((k) => TAG[k] || k).join(' · ') : (risk.labels.some((l) => /^Reads only/.test(l)) ? 'Read only' : 'Local edit');
  r.tag.dataset.level = done ? 'done' : sensitive ? 'sensitive' : 'local';
  r.toggle.setAttribute('aria-expanded', String(c.open)); r.toggle.setAttribute('aria-label', (c.open ? 'Collapse ' : 'Expand ') + t.agent + ': ' + t.title); r.chev.textContent = c.open ? '▴' : '▾';
  r.body.hidden = !c.open;
  r.engine.textContent = [t.engine, t.model].filter(Boolean).join(' · ') || 'Engine not recorded'; r.engine.title = 'Engine and model that will do the work';
  r.sum.textContent = summary(t.plan) || 'This agent did not return plan text. Open the agent window and read what it did before approving.';
  const key = risk.labels.join('|'); if (r.will.dataset.k !== key) { r.will.dataset.k = key; r.will.replaceChildren(...risk.labels.map((l) => h('li', '', l))); }
  r.cost.hidden = !risk.cost; r.cost.textContent = risk.cost ? 'Estimated cost stated in the plan: ' + risk.cost : '';
  if (r.fullTxt.textContent !== t.plan) r.fullTxt.textContent = t.plan;
  r.full.hidden = !c.plan || done; r.view.setAttribute('aria-expanded', String(c.plan)); r.view.textContent = c.plan ? 'Hide plan' : 'View plan';
  r.dec.hidden = !c.declining || done;
  r.go.textContent = c.busy ? (c.declining ? 'Approve' : 'Approving…') : c.confirming ? (risk.verb ? 'Approve and ' + risk.verb + '?' : 'Approve anyway?') : 'Approve';
  r.go.classList.toggle('confirm', c.confirming);
  r.back2.hidden = !c.confirming; r.no.hidden = c.confirming; r.view.hidden = c.confirming;
  r.acts.hidden = done || c.declining;
  r.go.disabled = r.no.disabled = r.view.disabled = r.back2.disabled = r.doDecline.disabled = r.back1.disabled = r.reason.disabled = c.busy;
  r.live.hidden = !(c.result === 'approved' || (c.plan && !done)); r.openWin.textContent = c.result === 'approved' ? 'Open live window' : 'Open agent window';
  if (c.confirming) setMsg(c, 'Second check: ' + risk.labels.filter((l) => !/^(Edits|Reads)/.test(l)).map((l) => l.replace(/\.$/, '')).join('; ').toLowerCase() + (risk.cost ? ' (about ' + risk.cost + ')' : '') + '. Tap “' + r.go.textContent + '” to go ahead, or Back.', 'warn');
  else if (!c.confirming && !c.result && !c.err) setMsg(c, '');
 }
 function setMsg(c, text, kind) { const m = c.r.msg; m.hidden = !text; if (m.textContent !== text) m.textContent = text; m.dataset.k = kind || ''; }

 async function approve(c) {
  if (c.busy || c.result) return;
  const risk = c.t.risk;
  if (risk.level === 'sensitive' && !c.confirming) { c.confirming = true; c.err = ''; clearTimeout(c.ct); c.ct = setTimeout(() => { if (c.confirming && !c.busy) { reset(c); paint(c); } }, CONFIRM_MS); paint(c); return; }
  clearTimeout(c.ct); c.busy = true; c.err = ''; setMsg(c, ''); paint(c);
  const noteId = 'task:' + c.id + ':' + c.t.startedAt + ':awaiting_approval';
  try {
   await send('/api/tasks/approve', { id: c.id });
   c.busy = false; c.confirming = false; c.result = 'approved'; setMsg(c, 'Approved, running', 'good'); paint(c); say('Approved, running. ' + c.t.agent + ' is starting: ' + c.t.title); markRead(noteId);
   settle(c); openLive(c); expire(c, KEEP_OK);
  } catch (e) {
   c.busy = false; reset(c);
   if (/not waiting for approval/i.test(e.message || '')) { c.result = 'handled'; setMsg(c, 'This plan was already handled.', 'warn'); paint(c); expire(c, KEEP_NO); refresh(); return; }
   c.err = 'Could not approve: ' + (e.message || 'try again') + '. Nothing was started.'; setMsg(c, c.err, 'bad'); paint(c); say(c.err);
  }
 }
 async function decline(c) {
  if (c.busy || c.result) return;
  c.busy = true; c.err = ''; setMsg(c, ''); paint(c);
  const noteId = 'task:' + c.id + ':' + c.t.startedAt + ':awaiting_approval';
  try {
   await send('/api/tasks/cancel', { id: c.id, note: c.r.reason.value.trim().slice(0, 300) });
   c.busy = false; c.declining = false; c.result = 'declined'; setMsg(c, 'Plan declined. Nothing was started.', 'good'); paint(c); say('Plan declined.'); markRead(noteId); settle(c); expire(c, KEEP_NO);
  } catch (e) { c.busy = false; c.err = 'Could not decline: ' + (e.message || 'try again'); setMsg(c, c.err, 'bad'); paint(c); say(c.err); c.r.reason.focus(); }
 }
 /* the buttons the user just pressed are hidden now: keep focus on the card, but never pull it out of the composer or another field */
 function settle(c) { const a = document.activeElement; if (!a || a === document.body || c.el.contains(a)) c.r.toggle.focus({ preventScroll: true }); }
 function openLive(c) { try { return !!(window.JarvisWatch && JarvisWatch.open('task:' + c.id)); } catch { return false; } }
 function markRead(id) { send('/api/notifications/read', { id }).then(() => window.JarvisNotifications && JarvisNotifications.refresh && JarvisNotifications.refresh()).catch(() => {}); }
 function expire(c, ms) { clearTimeout(c.timer); c.timer = setTimeout(() => { drop(c.id); refresh(); }, ms); }
 function drop(id) {
  const c = cards.get(id); if (!c) return; clearTimeout(c.timer); clearTimeout(c.ct);
  const had = c.el.contains(document.activeElement); c.el.remove(); cards.delete(id); frame();
  if (had) { const next = stack.querySelector('.ap-ib'); if (next) next.focus({ preventScroll: true }); } /* focus was inside the card that just left: hand it to the next card instead of dropping it to the page */
 }

 /* ---------- stack ---------- */
 function reconcile(list) {
  const ids = new Set(list.map((t) => t.id)), fresh = [];
  for (const t of list) {
   let c = cards.get(t.id);
   if (!c) { c = makeCard(t); cards.set(t.id, c); stack.append(c.el); fresh.push(c); } else { c.t = t; }
   if (!c.result) paint(c);
  }
  for (const [id, c] of cards) if (!ids.has(id) && !c.result && !c.busy) drop(id);
  if (isHome()) { const news = fresh.filter((c) => !announced.has(c.id)); for (const c of news) announced.add(c.id); if (news.length) { const n = pendingCount(); say('Approval needed. ' + news.map((c) => c.t.agent + ': ' + c.t.title + '. ' + (c.t.risk.level === 'sensitive' ? 'This one ' + c.t.risk.labels[0].toLowerCase() + '.' : 'Local changes only.')).join(' ') + (n > 1 ? ' ' + n + ' plans are waiting.' : '')); } }
  frame();
 }
 function pendingCount() { return [...cards.values()].filter((c) => !c.result).length; }
 function frame() {
  const n = pendingCount(), total = cards.size;
  root.hidden = !isHome() || !total;
  bar.hidden = total < 2; badge.textContent = String(n);
  barBtn.firstChild.textContent = n === 1 ? 'plan needs your approval' : 'plans need your approval';
  const anyOpen = [...cards.values()].some((c) => c.open); barBtn.setAttribute('aria-expanded', String(anyOpen)); barBtn.setAttribute('aria-label', n + (n === 1 ? ' plan needs' : ' plans need') + ' your approval. ' + (anyOpen ? 'Collapse all' : 'Expand first'));
  if (n) { if (baseTitle === null) baseTitle = document.title; const want = '(' + n + ') ' + baseTitle; if (document.title !== want) document.title = want; }
  else if (baseTitle !== null) { document.title = baseTitle; baseTitle = null; }
 }

 /* ---------- boot ---------- */
 function boot() {
  root = h('section', 'ap-root'); root.id = 'apRoot'; root.hidden = true; root.setAttribute('aria-label', 'Plans waiting for your approval');
  bar = h('div', 'ap-bar'); bar.hidden = true; barBtn = h('button', 'ap-barbtn'); barBtn.type = 'button'; badge = h('span', 'ap-badge'); barBtn.append(h('span', '', 'plans need your approval')); bar.append(badge, barBtn);
  stack = h('div', 'ap-stack'); sr = h('div', 'ap-sr'); sr.setAttribute('role', 'alert'); sr.setAttribute('aria-live', 'assertive'); sr.setAttribute('aria-atomic', 'true');
  root.append(bar, stack); document.body.append(root, sr);
  barBtn.onclick = () => { const anyOpen = [...cards.values()].some((c) => c.open); [...cards.values()].forEach((c, i) => { c.open = anyOpen ? false : i === 0; if (!c.open) reset(c); paint(c); }); frame(); };
  /* Escape collapses the card you are in (first the decline box, then the card). Focus stays where you are typing otherwise. */
  root.addEventListener('keydown', (e) => {
   if (e.key !== 'Escape' || e.defaultPrevented) return; const el = e.target.closest && e.target.closest('.ap-card'); if (!el) return; const c = cards.get(el.dataset.id); if (!c || c.busy) return;
   e.preventDefault(); e.stopPropagation();
   if (c.declining) { c.declining = false; paint(c); c.r.no.focus(); } else if (c.confirming) { reset(c); paint(c); c.r.go.focus(); } else if (c.plan) { c.plan = false; paint(c); c.r.view.focus(); } else { c.open = false; paint(c); c.r.toggle.focus(); frame(); }
  });
  addEventListener('hashchange', () => { frame(); if (isHome()) refresh(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); }); addEventListener('online', refresh);
  /* the watcher announces every change to a task; refresh only when the set of plans waiting for approval changes */
  addEventListener('jarvis:watch', (e) => { const ids = ((e.detail && e.detail.items) || []).filter((i) => i.approval).map((i) => i.taskId || i.id).sort().join(','); const have = [...cards.values()].filter((c) => !c.result).map((c) => c.id).sort().join(','); if (ids !== have) refresh(); });
  setInterval(() => { if (!document.hidden) refresh(); }, EVERY);
  refresh();
 }
 window.JarvisApprovals = { count: pendingCount, refresh };
 if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
