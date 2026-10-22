'use strict';
// Message queue for the @@ASSISTANT@@ chat (like the Claude Code and Codex chat boxes).
// While a reply is streaming, or its audio is still playing, a typed message waits here instead of interrupting.
// jarvis.js raises 'jarvis:enqueue' for those messages and 'jarvis:settled' when the reply and its audio are done.
(() => {
  const KEY = 'jarvis.queue', MAX = 50;
  const J = () => window.Jarvis;
  const live = (m) => { if (window.JarvisLive) window.JarvisLive(m); };
  const SVG = {
    edit: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/></svg>',
    remove: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    now: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  };
  let items = [], paused = false, editingId = null, internal = false, drainTimer = 0;
  const sent = new Set();

  const clean = (a) => (Array.isArray(a) ? a : []).filter((x) => x && typeof x.id === 'string' && typeof x.text === 'string' && x.text.trim() && x.text.length <= 8000).slice(0, MAX)
    .map((x) => ({ id: x.id, text: x.text, attach: Array.isArray(x.attach) ? x.attach.filter((p) => typeof p === 'string').slice(0, 4) : [], agentId: typeof x.agentId === 'string' ? x.agentId : undefined, project: typeof x.project === 'string' ? x.project : undefined }));
  const read = () => { try { return clean(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; } };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const idle = () => { const s = J().st; return !s.busy && !(s.pending > 0) && !s.playbackPaused && !s.listening; };

  function statusText() {
    if (paused) return 'Paused';
    if (editingId) return 'Waiting while you edit';
    const s = J() && J().st; if (!s) return '';
    if (s.busy) return 'Sends when the reply is done';
    if (s.playbackPaused) return 'Waiting, audio is paused';
    if (s.pending > 0) return 'Sends when the audio ends';
    return 'Sending next…';
  }

  /* ---------- rendering ---------- */
  function el(tag, cls, attrs) { const e = document.createElement(tag); if (cls) e.className = cls; if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
  function button(act, label, cls, html) { const b = el('button', cls || 'q-btn', { type: 'button', 'data-q': act, 'aria-label': label, title: label }); b.innerHTML = html; return b; }

  function renderHost(host) {
    host.hidden = !items.length; host.replaceChildren(); if (!items.length) return;
    const head = el('div', 'q-head');
    const title = el('span', 'q-title'); title.textContent = 'Queued · ' + items.length;
    const status = el('span', 'q-status'); status.textContent = statusText();
    head.append(title, status);
    if (paused) { const r = el('button', 'q-link', { type: 'button', 'data-q': 'resume' }); r.textContent = 'Resume'; head.append(r); }
    const c = el('button', 'q-link', { type: 'button', 'data-q': 'clear' }); c.textContent = 'Clear all'; head.append(c);
    const ol = el('ol', 'q-items', { 'aria-label': 'Queued messages' });
    items.forEach((it, i) => {
      const li = el('li', 'q-item', { 'data-id': it.id }); const n = el('span', 'q-num', { 'aria-hidden': 'true' }); n.textContent = i + 1;
      if (it.id === editingId) {
        li.classList.add('editing');
        const ta = el('textarea', 'q-edit', { rows: '2', 'aria-label': 'Edit queued message ' + (i + 1) }); ta.value = it.text;
        const act = el('span', 'q-actions'); const ok = el('button', 'q-link strong', { type: 'button', 'data-q': 'save' }); ok.textContent = 'Save'; const no = el('button', 'q-link', { type: 'button', 'data-q': 'cancel' }); no.textContent = 'Cancel';
        act.append(ok, no); li.append(n, ta, act);
      } else {
        const t = el('span', 'q-text'); t.textContent = it.text; t.title = it.text;
        if (it.attach && it.attach.length) { const p = el('span', 'q-attach', { 'aria-label': it.attach.length + ' attached' }); p.textContent = '📎' + it.attach.length; li.append(n, t, p); } else li.append(n, t);
        const act = el('span', 'q-actions');
        act.append(button('now', 'Send queued message ' + (i + 1) + ' now', 'q-btn primary', SVG.now), button('edit', 'Edit queued message ' + (i + 1), 'q-btn', SVG.edit), button('remove', 'Remove queued message ' + (i + 1), 'q-btn', SVG.remove));
        li.append(act);
      }
      ol.append(li);
    });
    host.append(head, ol);
  }
  function render() {
    for (const h of document.querySelectorAll('.qhost')) renderHost(h);
    const ta = document.querySelector('.qhost:not([hidden]) .q-edit'); if (ta && ta.isConnected && document.activeElement !== ta && editingId) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }
  function updateStatus() { if (!items.length) return; for (const s of document.querySelectorAll('.qhost .q-status')) s.textContent = statusText(); }

  /* ---------- queue actions ---------- */
  const where = () => { const a = document.querySelector('#jPanel.in:not([hidden]) #jText'); return a || document.querySelector('#askInput') || document.querySelector('#jText'); };
  function add(d) {
    const text = String((d && d.text) || '').trim(); if (!text) return;
    if (items.length >= MAX) { live('The queue is full (' + MAX + ' messages). Your text was put back in the box.'); const box = where(); if (box && !box.value) box.value = text; return; }
    items.push({ id: uid(), text, attach: (d.attach || []).slice(0, 4), agentId: d.agentId, project: d.project });
    save(); render(); live('Message queued, number ' + items.length + (paused ? '. The queue is paused.' : '.')); drain();
  }
  function remove(id) {
    const i = items.findIndex((x) => x.id === id); if (i < 0) return; items.splice(i, 1); if (editingId === id) editingId = null; save(); render();
    live('Removed queued message ' + (i + 1) + '. ' + (items.length ? items.length + ' left.' : 'The queue is empty.'));
    const next = document.querySelector('.qhost:not([hidden]) .q-item:nth-child(' + Math.min(i + 1, items.length || 1) + ') .q-btn'); if (items.length && next) next.focus(); else { const box = where(); if (box) box.focus(); }
    drain();
  }
  function clearAll() { if (!items.length) return; const n = items.length; items = []; editingId = null; save(); render(); live('Cleared ' + n + ' queued message' + (n === 1 ? '' : 's') + '.'); const box = where(); if (box) box.focus(); }
  function setPaused(p, why) { if (paused === p) return; paused = p; render(); live(p ? why || 'Queue paused.' : 'Queue resumed.'); if (!p) drain(); }
  function take(id, gesture) {
    const i = items.findIndex((x) => x.id === id); if (i < 0) return; const it = items.splice(i, 1)[0]; if (sent.has(it.id)) return; sent.add(it.id);
    if (editingId === it.id) editingId = null;
    save(); render(); internal = true;
    try { const p = J().send(it.text, false, { fromQueue: true, gesture: gesture === true, attach: it.attach, agentId: it.agentId, project: it.project }); if (p && p.catch) p.catch(() => {}); } finally { internal = false; }
    live('Sending queued message. ' + (items.length ? items.length + ' still waiting.' : 'The queue is empty.'));
  }
  function startEdit(id) { editingId = id; render(); updateStatus(); }
  function commitEdit(id, text) {
    const it = items.find((x) => x.id === id); editingId = null; if (!it) return render();
    const t = String(text || '').trim(); if (!t) return remove(id); if (t.length > 8000) { live('That message is longer than 8,000 characters.'); editingId = id; return render(); }
    it.text = t; save(); render(); live('Queued message updated.'); drain();
  }

  /* ---------- sending the next message ---------- */
  function drain() { clearTimeout(drainTimer); drainTimer = setTimeout(run, 150); }
  function run() { if (paused || editingId || !items.length || !J() || !idle()) return; take(items[0].id); }

  /* ---------- mounting next to the composers ---------- */
  function onHostClick(e) {
    const b = e.target.closest('[data-q]'); if (!b) return; const li = b.closest('.q-item'), id = li && li.dataset.id;
    switch (b.dataset.q) {
      case 'now': if (id) take(id, true); break;
      case 'edit': if (id) startEdit(id); break;
      case 'remove': if (id) remove(id); break;
      case 'save': if (id) commitEdit(id, li.querySelector('.q-edit').value); break;
      case 'cancel': editingId = null; render(); updateStatus(); drain(); break;
      case 'resume': setPaused(false); break;
      case 'clear': clearAll(); break;
    }
  }
  function onHostKey(e) {
    const ta = e.target.closest && e.target.closest('.q-edit'); if (!ta) return; const id = ta.closest('.q-item').dataset.id;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); commitEdit(id, ta.value); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); editingId = null; render(); updateStatus(); drain(); }
  }
  function makeHost() { const h = el('div', 'qhost'); h.hidden = true; h.addEventListener('click', onHostClick); h.addEventListener('keydown', onHostKey); return h; }
  function makeTools() { const d = el('div', 'qtools'); const R = window.JarvisReplyAudio; if (R) d.append(R.makeToggle(), R.makePrompt()); return d; }
  function mount() {
    // home page composer: messages above it, switches below it
    const comp = document.querySelector('.home-scene-compose'), form = comp && comp.querySelector('#askForm');
    if (form && !comp.querySelector('.qhost')) { const h = makeHost(); form.before(h); form.after(makeTools()); renderHost(h); }
    // chat panel: messages and switches above the input row
    const panel = document.querySelector('#jPanel'), jf = panel && panel.querySelector('#jForm');
    if (jf && !panel.querySelector('.qhost')) { const h = makeHost(); jf.before(h); jf.before(makeTools()); renderHost(h); }
  }
  let mountQueued = false;
  new MutationObserver(() => { if (mountQueued) return; mountQueued = true; requestAnimationFrame(() => { mountQueued = false; mount(); }); }).observe(document.body, { childList: true, subtree: true });

  /* ---------- events from jarvis.js ---------- */
  window.addEventListener('jarvis:enqueue', (e) => add(e.detail));
  window.addEventListener('jarvis:settled', drain);
  window.addEventListener('jarvis:state', (e) => { updateStatus(); if (e.detail && e.detail.state === 'idle') drain(); });
  // @@NAME@@ pressed Stop: keep what is queued, but do not send it until she says so.
  window.addEventListener('jarvis:cancel', () => { if (!internal && items.length) setPaused(true, 'Stopped. The queue is paused with ' + items.length + ' message' + (items.length === 1 ? '' : 's') + '.'); });
  window.addEventListener('jarvis:failed', () => { if (items.length) setPaused(true, 'The reply failed. The queue is paused.'); });
  // another tab changed the queue: follow it, so nothing is sent from two places
  window.addEventListener('storage', (e) => { if (e.key === KEY) { items = read(); editingId = null; render(); } });

  items = read(); if (items.length) { paused = true; setTimeout(() => live(items.length + ' queued message' + (items.length === 1 ? '' : 's') + ' restored. The queue is paused. Resume or remove them.'), 1200); }
  mount(); render();
  // set last: until it exists, jarvis.js sends as before
  window.JarvisQueue = { size: () => items.length, holding: () => !paused && items.length > 0, items: () => items.map((x) => ({ ...x })), add, remove, clear: clearAll, sendNow: (id) => take(id, false), resume: () => setPaused(false), get paused() { return paused; } };
})();
