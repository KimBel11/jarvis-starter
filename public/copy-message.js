// Copy button on every chat message (Jarvis replies and your own), like in Claude.
(() => {
  const ICON = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
  const textOf = (m) => { const c = m.cloneNode(true); c.querySelectorAll('.jcopy').forEach((x) => x.remove()); return (c.innerText || c.textContent || '').trim(); };
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); return true; } catch { const a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); let ok = false; try { ok = document.execCommand('copy'); } catch {} a.remove(); return ok; } };
  let timer = 0;
  const add = () => { document.querySelectorAll('#jLog .jmsg.ai, #jLog .jmsg.user').forEach((m) => { if (m.querySelector(':scope > .jcopy') || !m.textContent.trim()) return; const b = document.createElement('button'); b.type = 'button'; b.className = 'jcopy'; b.title = 'Copy message'; b.setAttribute('aria-label', 'Copy message'); b.innerHTML = ICON; m.appendChild(b); }); };
  document.addEventListener('click', async (e) => { const b = e.target.closest('.jcopy'); if (!b) return; e.preventDefault(); e.stopPropagation(); const ok = await copy(textOf(b.closest('.jmsg'))); b.classList.toggle('done', ok); b.title = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.classList.remove('done'); b.title = 'Copy message'; }, 1500); });
  new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(add, 250); }).observe(document.body, { childList: true, subtree: true });
})();
