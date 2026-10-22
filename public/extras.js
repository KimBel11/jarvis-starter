'use strict';
// Small additions: video preview inside the app (finished videos, scheduled and posted rows), shared everywhere.
(() => {
const vidName = (p) => String(p).split('/').pop();
window.openVideoPreview = function (path, title, opts) {
  opts = opts || {};
  modal(`<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px"><div style="min-width:0"><h2 style="font-size:18px;overflow-wrap:anywhere">${esc(title || vidName(path))}</h2><div class="muted tiny mono" style="overflow-wrap:anywhere">${esc(path)}</div></div><button class="btn sm" id="vpX">✕</button></div>
    <video id="vpVid" src="${fileUrl(path)}" controls autoplay playsinline style="width:100%;max-height:72vh;border-radius:12px;background:#000;display:block"></video>
    <div class="pill-row" style="margin-top:12px">${opts.schedule ? `<button class="btn primary" id="vpSch">Schedule this video</button>` : ''}<a class="btn" href="${fileUrl(path)}" download>Download</a><button class="btn" id="vpFind">Show in Finder</button></div>`, true);
  $('#vpX').onclick = () => { try { $('#vpVid').pause(); } catch {} closeModal(); };
  $('#vpFind').onclick = () => post('/api/reveal', { path }).catch((e) => toast(e.message));
  const sc = $('#vpSch'); if (sc) sc.onclick = () => { closeModal(); opts.schedule(); };
};
const pathOf = (src) => { try { return decodeURIComponent(new URL(src, location.href).searchParams.get('p') || ''); } catch { return ''; } };
document.addEventListener('click', async (e) => {
  // finished-video cards: tap the picture or the name
  const wc = e.target.closest('.wcard'); if (wc && !e.target.closest('button,a,.pl-chip')) { const v = wc.querySelector('video'); const p = v && pathOf(v.getAttribute('src')); if (p) { e.preventDefault(); const sch = wc.querySelector('[data-sch]'); openVideoPreview(p, vidName(p), { schedule: sch ? () => sch.click() : null }); return; } }
  // scheduled and posted rows: tap the title to watch that video
  const row = e.target.closest('.prow .grow .t'); if (row && !e.target.closest('a')) { const base = (row.getAttribute('title') || row.textContent || '').trim(); const pid = (S.soc && S.soc.pid) || window.routeArg; if (!/\.(mp4|mov|m4v)$/i.test(base) && !base) return; try { const r = await api('/api/social/find?project=' + encodeURIComponent(pid) + '&base=' + encodeURIComponent(base)); openVideoPreview(r.path, r.base); } catch { /* title is not a file name: try matching by title */ try { const d = await api(`/api/social/stage?project=${encodeURIComponent(pid)}&stage=ready`); const t = base.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); const f = d.files.find((x) => x.base.toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, ' ').includes(t.split(' ').slice(0, 3).join(' '))); if (f) openVideoPreview(f.path, f.base); else toast('The video file for this post was not found in the finished videos.'); } catch (x) { toast(x.message); } } }
}, true);
})();
