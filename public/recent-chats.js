'use strict';
// "Last conversation" widget for Home: sits next to the daily brief, compressed, and opens a list of recent chats.
// Click a chat to carry on with it in the conversation panel (same agent, folder and session). No voice, just text.
(() => {
  const desktop = matchMedia('(min-width:801px)');
  const E = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ago = (t) => { const m = Math.max(0, (Date.now() - t) / 60000); if (m < 1) return 'just now'; if (m < 60) return Math.round(m) + ' min ago'; const h = m / 60; if (h < 24) return Math.round(h) + ' h ago'; const d = h / 24; return d < 7 ? Math.round(d) + ' d ago' : new Date(t).toLocaleDateString(); };
  let chats = [], loading = false;
  const agentOf = (id) => { try { return (window.S && S.team && S.team.agents || []).find((a) => a.id === id) || null; } catch { return null; } };
  async function load() {
    if (loading) return chats; loading = true;
    try { const r = await fetch('/api/convos/recent?limit=8', { cache: 'no-store' }); if (r.ok) chats = (await r.json()).chats || []; } catch {} finally { loading = false; }
    return chats;
  }
  function rows() {
    if (!chats.length) return '<div class="rc-empty">No conversations yet. Say or type something to Jarvis and it will show up here.</div>';
    return chats.map((c) => { const a = agentOf(c.agentId); return `<button type="button" class="rc-row" data-id="${E(c.id)}"><span class="rc-glyph" style="--c:${E((a && a.color) || '#2dd4ee')}">${E((a && a.glyph) || '✦')}</span><span class="rc-t"><b>${E(c.title)}</b><small>${E(c.last || (a ? a.name : ''))}</small></span><span class="rc-m">${c.running ? '<i class="rc-live"></i>' : ''}${E(ago(c.updatedAt))}<small>${c.count} msg</small></span></button>`; }).join('');
  }
  async function resume(id) {
    try { const r = await fetch('/api/convos/get?id=' + encodeURIComponent(id), { cache: 'no-store' }); if (!r.ok) throw new Error('missing'); const c = await r.json(); window.Jarvis && Jarvis.resumeConversation(c); } catch { if (window.toast) toast('That conversation could not be opened'); }
  }
  function fill(list) { list.innerHTML = rows(); }
  function wire(root, list) {
    root.addEventListener('click', (e) => { const b = e.target.closest('.rc-row'); if (!b) return; e.preventDefault(); resume(b.dataset.id); if (root.tagName === 'DETAILS') root.open = false; });
    // the list opens underneath the pocket; only when the screen leaves no room below does it open above instead
    const place = () => { if (root.tagName !== 'DETAILS' || !root.open) return; const r = root.querySelector('summary').getBoundingClientRect(); const below = innerHeight - r.bottom - 16; list.classList.add('rc-float'); list.style.left = Math.max(8, r.left) + 'px';
      if (below >= 130 || below >= r.top) { list.style.top = (r.bottom + 4) + 'px'; list.style.bottom = 'auto'; list.style.maxHeight = Math.min(340, Math.max(120, below)) + 'px'; }
      else { list.style.top = 'auto'; list.style.bottom = (innerHeight - r.top + 4) + 'px'; list.style.maxHeight = Math.min(340, r.top - 16) + 'px'; } };
    root.addEventListener('toggle', async () => { if (root.open) { fill(list); place(); await load(); fill(list); place(); } });
    window.addEventListener('resize', place);
    document.addEventListener('pointerdown', (e) => { if (root.tagName === 'DETAILS' && root.open && !root.contains(e.target)) root.open = false; });
  }
  // desktop: a compressed pocket under the daily brief
  function mount(pocket) {
    if (!pocket || pocket.dataset.rc) return; pocket.dataset.rc = '1';
    const list = document.createElement('div'); list.className = 'rc-list'; pocket.append(list);
    const sum = pocket.querySelector('summary'); const sub = document.createElement('span'); sub.className = 'rc-sub'; sum.append(sub);
    wire(pocket, list);
    const peek = async () => { await load(); sub.textContent = chats[0] ? '· ' + (chats[0].title.length > 34 ? chats[0].title.slice(0, 33) + '…' : chats[0].title) : ''; };
    peek(); setInterval(() => { if (pocket.isConnected && !document.hidden) peek(); }, 60000);
  }
  // phone / narrow: a card under the daily brief
  function mobileCard() {
    if (desktop.matches) return; const brief = document.getElementById('homeDailyBrief'); if (!brief || document.getElementById('homeLastChat')) return;
    const card = document.createElement('section'); card.id = 'homeLastChat'; card.className = 'home-daily-brief rc-card'; card.setAttribute('aria-label', 'Last conversation');
    card.innerHTML = '<div class="brief-copy"><div class="brief-heading"><span>Last conversation</span></div><small class="rc-last">Loading…</small></div><button type="button" class="btn rc-open">Open</button><div class="rc-list" hidden></div>';
    brief.after(card);
    const list = card.querySelector('.rc-list'), last = card.querySelector('.rc-last'), btn = card.querySelector('.rc-open');
    const peek = async () => { await load(); last.textContent = chats[0] ? chats[0].title : 'Nothing yet'; };
    btn.onclick = async () => { const open = list.hidden; list.hidden = !open; btn.textContent = open ? 'Close' : 'Open'; if (open) { fill(list); await load(); fill(list); } };
    card.addEventListener('click', (e) => { const b = e.target.closest('.rc-row'); if (!b) return; resume(b.dataset.id); list.hidden = true; btn.textContent = 'Open'; });
    peek();
  }
  window.JarvisRecentChats = { mount, refresh: load };
  new MutationObserver(mobileCard).observe(document.documentElement, { childList: true, subtree: true }); mobileCard();
  window.addEventListener('jarvis:reply', () => { load(); });
})();
