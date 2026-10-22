'use strict';
// Premium message box for Jarvis chat (home and side panel): attach images, videos and files, drag and drop, paste, mic, send.
// Files go to /api/chat/upload and are handed to the agent through Jarvis.addAttach (paths on this Mac).
(() => {
const MAX = 250 * 1024 * 1024; const MAXN = 6;
const META = new Map(); window.JarvisFiles = META; // path -> { name, kind, thumb }
const pending = new Map(); // id -> { name, kind, thumb, pct, error }
const ICON = { clip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5l-8.6 8.6a5.2 5.2 0 0 1-7.4-7.4l8.6-8.6a3.5 3.5 0 0 1 5 5l-8.7 8.7a1.8 1.8 0 0 1-2.5-2.5l8-8"/></svg>', mic: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>', send: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>' };
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kindOf = (f) => (/^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|heic|heif|bmp|svg)$/i.test(f.name) ? 'image' : /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm)$/i.test(f.name) ? 'video' : /^audio\//.test(f.type) ? 'audio' : /pdf$/i.test(f.name) ? 'pdf' : 'file');
const size = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB');
const glyph = (k) => (k === 'video' ? '🎬' : k === 'audio' ? '🎧' : k === 'pdf' ? '📕' : '📎');

function chips() {
  const att = (window.Jarvis && Jarvis.getAttach && Jarvis.getAttach()) || [];
  const html = att.map((p) => { const m = META.get(p) || { name: p.split('/').pop().replace(/^[0-9a-f]{8}-/, ''), kind: 'file' }; return `<span class="cmp-chip">${m.thumb ? `<img src="${m.thumb}" alt="">` : `<b>${glyph(m.kind)}</b>`}<span class="cmp-name">${esc(m.name)}</span><button type="button" data-rm="${esc(p)}" aria-label="Remove ${esc(m.name)}">✕</button></span>`; }).join('')
    + [...pending.entries()].map(([id, m]) => `<span class="cmp-chip ${m.error ? 'bad' : ''}">${m.thumb ? `<img src="${m.thumb}" alt="">` : `<b>${glyph(m.kind)}</b>`}<span class="cmp-name">${esc(m.name)}</span>${m.error ? `<em>${esc(m.error)}</em><button type="button" data-drop="${id}" aria-label="Dismiss">✕</button>` : `<span class="cmp-bar"><i style="width:${m.pct || 4}%"></i></span>`}</span>`).join('');
  document.querySelectorAll('.cmp-files').forEach((el) => { el.innerHTML = html; el.hidden = !html; });
  document.querySelectorAll('.cmp').forEach((f) => f.classList.toggle('has-files', !!html));
  syncSend();
}
function syncSend() { document.querySelectorAll('.cmp').forEach((f) => { const t = f.querySelector('textarea,input[type=text],input:not([type])'); const b = f.querySelector('.cmp-send'); if (b && t && !b.classList.contains('stop')) b.disabled = !(t.value.trim() || ((window.Jarvis && Jarvis.getAttach && Jarvis.getAttach().length) || 0)); }); }

function upload(file) {
  const n = ((window.Jarvis && Jarvis.getAttach && Jarvis.getAttach().length) || 0) + pending.size; if (n >= MAXN) return toast(`You can attach up to ${MAXN} files per message`);
  if (file.size > MAX) return toast(file.name + ' is larger than 250 MB');
  const kind = kindOf(file); const id = 'u' + Math.random().toString(36).slice(2, 8); const thumb = kind === 'image' && !/heic|heif/i.test(file.name) ? URL.createObjectURL(file) : '';
  pending.set(id, { name: file.name, kind, thumb, pct: 3 }); chips();
  const x = new XMLHttpRequest(); x.open('POST', '/api/chat/upload'); x.setRequestHeader('X-Filename', encodeURIComponent(file.name)); x.setRequestHeader('Content-Type', 'application/octet-stream');
  x.upload.onprogress = (e) => { if (e.lengthComputable) { const m = pending.get(id); if (m) { m.pct = Math.max(4, Math.round((e.loaded / e.total) * 100)); chips(); } } };
  x.onload = () => { let r = {}; try { r = JSON.parse(x.responseText); } catch {} if (x.status === 200 && r.path) { META.set(r.path, { name: r.name || file.name, kind: r.kind || kind, thumb }); pending.delete(id); Jarvis.addAttach([r.path]); } else { const m = pending.get(id); if (m) { m.error = r.error ? String(r.error).slice(0, 80) : 'Upload failed'; chips(); } } };
  x.onerror = () => { const m = pending.get(id); if (m) { m.error = 'Connection lost'; chips(); } };
  x.send(file);
}
function addFiles(list) { for (const f of [...list]) upload(f); }

function upgrade(form) {
  if (!form || form.dataset.cmp) return; form.dataset.cmp = '1'; form.classList.add('cmp');
  const text = form.querySelector('textarea') || form.querySelector('input[type=text], input:not([type]):not([type=file])'); if (!text) return;
  const mic = form.querySelector('#jMic, #askMic, .mic'); const send = form.querySelector('.ask-send, #jSend, button[type=submit], button.primary');
  const strip = document.createElement('div'); strip.className = 'cmp-files'; strip.hidden = true;
  const row = document.createElement('div'); row.className = 'cmp-row';
  const clip = document.createElement('button'); clip.type = 'button'; clip.className = 'cmp-btn cmp-clip'; clip.title = 'Attach images, videos or files'; clip.setAttribute('aria-label', 'Attach files'); clip.innerHTML = ICON.clip;
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.hidden = true; input.onchange = () => { addFiles(input.files); input.value = ''; }; clip.onclick = () => input.click();
  let m = mic; if (!m) { m = document.createElement('button'); m.type = 'button'; m.className = 'mic'; m.id = 'askMic'; m.title = 'Talk to Jarvis'; m.addEventListener('click', () => { try { Jarvis.orbTap(); } catch {} }); }
  m.classList.add('cmp-btn', 'cmp-mic'); m.innerHTML = ICON.mic;
  if (send) { send.classList.add('cmp-send'); send.classList.remove('btn', 'primary'); if (!send.querySelector('.ask-ico-stop')) send.innerHTML = ICON.send; send.setAttribute('aria-label', 'Send'); }
  text.classList.add('cmp-text'); if (text.tagName === 'INPUT') text.setAttribute('enterkeyhint', 'send');
  row.append(clip, m, text); if (send) row.append(send); form.append(strip, row, input);
  // auto-grow
  const grow = () => { if (text.tagName !== 'TEXTAREA') return; text.style.height = 'auto'; text.style.height = Math.min(text.scrollHeight, 168) + 'px'; syncSend(); }; text.addEventListener('input', grow); setTimeout(grow, 0);
  text.addEventListener('input', syncSend);
  // drag and drop, paste
  ['dragenter', 'dragover'].forEach((ev) => form.addEventListener(ev, (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); form.classList.add('drag'); } }));
  ['dragleave', 'drop'].forEach((ev) => form.addEventListener(ev, () => form.classList.remove('drag')));
  form.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
  text.addEventListener('paste', (e) => { const fs = [...(e.clipboardData ? e.clipboardData.files : [])]; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  // sending with only files: give the agent a sensible request
  form.addEventListener('submit', () => { if (!text.value.trim() && Jarvis.getAttach().length) { text.value = 'Please look at the attached file(s) and tell me what you see.'; } }, true);
  form.addEventListener('click', (e) => { const r = e.target.closest('[data-rm]'); if (r) { Jarvis.removeAttach(r.dataset.rm); return; } const d = e.target.closest('[data-drop]'); if (d) { pending.delete(d.dataset.drop); chips(); } });
  chips();
}
// on phones the placeholder is short so the box stays one line and lines up with its buttons
const phoneMQ = window.matchMedia('(max-width:600px)'), SHORT = 'Ask anything…';
const shortPh = () => { if (!phoneMQ.matches) return; document.querySelectorAll('#askForm .cmp-text, #jForm .cmp-text').forEach((t) => { if (t.placeholder !== SHORT) { t.dataset.longPh = t.placeholder; t.placeholder = SHORT; } }); };
phoneMQ.addEventListener && phoneMQ.addEventListener('change', () => { if (!phoneMQ.matches) document.querySelectorAll('.cmp-text[data-long-ph]').forEach((t) => { t.placeholder = t.dataset.longPh; }); else shortPh(); });
const scan = () => { upgrade(document.querySelector('#askForm')); upgrade(document.querySelector('#jForm')); shortPh(); };
new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true }); scan();
window.addEventListener('jarvis:attach-changed', chips);
// drop files anywhere on the open chat panel
document.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files') && e.target.closest && e.target.closest('#jPanel')) e.preventDefault(); });
document.addEventListener('drop', (e) => { if (e.target.closest && e.target.closest('#jPanel') && !e.target.closest('.cmp') && e.dataTransfer && e.dataTransfer.files.length) { e.preventDefault(); addFiles(e.dataTransfer.files); } });
})();
// iOS ignores user-scalable in Safari: stop the pinch gesture and the double-tap zoom explicitly (taps and scrolling keep working)
(() => {
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((n) => document.addEventListener(n, (e) => e.preventDefault()));
  let last = 0;
  document.addEventListener('touchend', (e) => { const t = Date.now(); if (t - last < 320 && !(e.target.closest && e.target.closest('input,textarea,select,a,button,[contenteditable]'))) e.preventDefault(); last = t; }, { passive: false });
})();
