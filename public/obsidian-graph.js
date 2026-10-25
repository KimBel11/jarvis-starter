'use strict';
// Obsidian graph view: every note across Jarvis Hub and all project folders as a living constellation.
// Own force simulation on a canvas (no libraries): zoom, pan, drag, search, focus mode, folder structure, tags, project colours.
(() => {
const NS = 'jarvis.graph.';
const store = { get: (k, d) => { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set: (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch {} } };
const heat = (t) => { const d = (Date.now() - t) / 864e5; return d < 1 ? '#ffd166' : d < 7 ? '#ff9f5a' : d < 30 ? '#c77dff' : d < 120 ? '#5b8cff' : '#3a4a6b'; };
const sprites = new Map();
function sprite(color) { let c = sprites.get(color); if (c) return c; c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, color + 'ff'); gr.addColorStop(.28, color + 'aa'); gr.addColorStop(.6, color + '33'); gr.addColorStop(1, color + '00'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); sprites.set(color, c); return c; }
const hex6 = (c) => (/^#[0-9a-f]{6}$/i.test(c) ? c : '#8fa0b8');

async function vGraph(v) {
  if(v._knowledgeCleanup)v._knowledgeCleanup();
  v.innerHTML = `<div class="gv"><div class="gv-top"><div><span class="kn-eyebrow">YOUR CONNECTED WORKSPACE</span><h1>Obsidian</h1><div class="muted" id="gvSub">Loading your connections…</div></div><nav class="kn-tabs" aria-label="Knowledge views"><a href="#/obsidian">Notes</a><a href="#/graph" aria-current="page">Graph</a></nav></div><div class="pill-row" style="margin-bottom:12px"><button class="btn sm" id="gvFit">Fit</button><button class="btn sm" id="gvShuffle">Re-arrange</button><button class="btn sm" id="gvRefresh">Refresh</button></div>
    <div class="gv-bar"><input id="gvSearch" type="search" placeholder="Find a note, folder or tag…" autocomplete="off"><div class="seg" id="gvMode"><button data-v="structure">With folders</button><button data-v="links">Links only</button></div>
      <select id="gvColor" class="mini"><option value="project">Colour: project</option><option value="recent">Colour: last edited</option></select></div>
    <div class="gv-chips" id="gvChips"></div>
    <div class="gv-stage" id="gvStage"><canvas id="gvCanvas" role="img" aria-label="Interactive graph of vault notes. Use the note list below for keyboard navigation."></canvas><div class="gv-zoom"><button id="gvOut" aria-label="Zoom out">−</button><button id="gvIn" aria-label="Zoom in">＋</button><button id="gvReset" aria-label="Fit graph">⌖</button></div><div class="gv-hud" id="gvHud"></div><div class="gv-tip" id="gvTip" hidden></div>
      <div class="gv-legend" id="gvLegend"></div><div class="gv-panel" id="gvPanel" hidden></div></div>
    <div class="gv-foot muted tiny" id="gvFoot">Scroll or pinch to zoom · drag the background to move · drag a dot to pull it · select a note to preview it</div><details class="gv-access"><summary id="gvAccessibleTitle">Browse visible notes</summary><div id="gvAccessible" class="gv-access-list"></div></details></div>`;
  const q = (s) => v.querySelector(s); const stage = q('#gvStage'), cv = q('#gvCanvas'), ctx = cv.getContext('2d');
  let data; try { data = await api('/api/obsidian/graph'); } catch (e) { v.innerHTML = `<div class="card">${esc(e.message)}</div>`; return; }
  const opt = { mode: store.get('mode', 'structure'), color: store.get('color', 'project'), off: new Set(store.get('off', [])), orphans: store.get('orphans', true), tags: store.get('tags', false), labels: store.get('labels', true), focus: null };
  q('#gvColor').value = opt.color;

  /* ---------- model ---------- */
  let nodes = [], edges = [], byId = new Map(), adj = new Map(); const pos = new Map(); let allN = [], allE = [];
  function buildModel() {
    allN = []; allE = []; const m = new Map(); const add = (n) => { m.set(n.id, n); allN.push(n); return n; };
    const srcs = data.sources.filter((s) => s.notes);
    srcs.forEach((s) => add({ id: 'src:' + s.id, kind: 'source', label: s.name, source: s.id, color: hex6(s.color), r: 15, mtime: Date.now(), deg: 0 }));
    for (const n of data.nodes) add({ id: n.id, kind: n.ghost ? 'ghost' : 'note', label: n.title || n.name, name: n.name, path: n.path, source: n.source, folder: n.folder, color: n.ghost ? '#8fa0b8' : hex6(n.color), mtime: n.mtime, tags: n.tags, words: n.words, deg: n.deg, r: 3 + Math.sqrt(n.deg) * 2.1 + Math.min(3, Math.sqrt(n.words || 0) / 14) });
    for (const e of data.edges) if (m.has(e.s) && m.has(e.t)) allE.push({ a: e.s, b: e.t, k: 'link' });
    const folders = new Map(); const ensure = (src, fp) => { const id = 'dir:' + src + ':' + fp; if (folders.has(id)) return folders.get(id); const parts = fp.split('/'); const f = add({ id, kind: 'folder', label: parts[parts.length - 1], source: src, color: (m.get('src:' + src) || {}).color || '#8fa0b8', r: 4, deg: 0, mtime: 0, count: 0 }); folders.set(id, f); const parent = parts.length > 1 ? ensure(src, parts.slice(0, -1).join('/')).id : 'src:' + src; if (m.has(parent)) allE.push({ a: id, b: parent, k: 'struct' }); return f; };
    for (const n of data.nodes) { if (n.ghost || !m.has('src:' + n.source)) continue; const parts = n.path.split('/'); const dir = parts.slice(0, -1).join('/'); const pid = dir ? ensure(n.source, dir).id : 'src:' + n.source; allE.push({ a: n.id, b: pid, k: 'struct' }); const f = m.get(pid); if (f.kind === 'folder') { f.count++; f.mtime = Math.max(f.mtime, n.mtime); f.r = 4 + Math.sqrt(f.count) * 1.1; } else f.mtime = Math.max(f.mtime || 0, n.mtime); }
    const tagN = new Map(); for (const n of data.nodes) for (const t of n.tags || []) { let tn = tagN.get(t); if (!tn) { tn = add({ id: 'tag:' + t, kind: 'tag', label: '#' + t, color: '#c77dff', r: 4, deg: 0, mtime: 0, count: 0, source: 'tag' }); tagN.set(t, tn); } tn.count++; tn.r = 4 + Math.sqrt(tn.count) * 1.4; allE.push({ a: n.id, b: tn.id, k: 'tag' }); }
  }
  function applyFilters() {
    const q = q_(); const hasQ = !!q.trim(); let vis = allN.filter((n) => (n.kind === 'tag' ? opt.tags : (n.source === 'tag' || !opt.off.has(n.source))));
    if (opt.mode === 'links') vis = vis.filter((n) => n.kind !== 'folder' && n.kind !== 'source');
    const ok = new Set(vis.map((n) => n.id)); let es = allE.filter((e) => ok.has(e.a) && ok.has(e.b) && (e.k !== 'struct' || opt.mode === 'structure') && (e.k !== 'tag' || opt.tags));
    const deg = new Map(); for (const e of es) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
    if (!opt.orphans) vis = vis.filter((n) => deg.get(n.id) || n.kind === 'source'); 
    if (opt.focus && byId.size) { const keep = new Set([opt.focus]); let fr = [opt.focus]; const a = new Map(); for (const e of es) { (a.get(e.a) || a.set(e.a, []).get(e.a)).push(e.b); (a.get(e.b) || a.set(e.b, []).get(e.b)).push(e.a); } for (let d = 0; d < 2; d++) { const nx = []; for (const id of fr) for (const o of a.get(id) || []) if (!keep.has(o)) { keep.add(o); nx.push(o); } fr = nx; } vis = vis.filter((n) => keep.has(n.id)); }
    const ok2 = new Set(vis.map((n) => n.id)); es = es.filter((e) => ok2.has(e.a) && ok2.has(e.b));
    nodes = vis; byId = new Map(nodes.map((n) => [n.id, n])); edges = es.map((e) => ({ ...e, A: byId.get(e.a), B: byId.get(e.b) })); adj = new Map(nodes.map((n) => [n.id, []])); for (const e of edges) { adj.get(e.a).push(e.B); adj.get(e.b).push(e.A); }
    const anchors = {}; const ss = data.sources.filter((s) => s.notes); ss.forEach((s, i) => { const a = (i / ss.length) * Math.PI * 2 - Math.PI / 2; const R = ss.length > 1 ? 330 : 0; anchors[s.id] = { x: Math.cos(a) * R, y: Math.sin(a) * R }; }); anchors.tag = { x: 0, y: 0 };
    for (const n of nodes) { n.anchor = anchors[n.source] || { x: 0, y: 0 }; const p = pos.get(n.id); if (p) { n.x = p.x; n.y = p.y; } else { const a = Math.random() * 6.283, d = 30 + Math.random() * 160; n.x = n.anchor.x + Math.cos(a) * d; n.y = n.anchor.y + Math.sin(a) * d; } n.vx = 0; n.vy = 0; }
    const hits = hasQ ? new Set(nodes.filter((n) => (n.label + ' ' + (n.path || '') + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q.toLowerCase())).map((n) => n.id)) : null; match = hits;
    wake(1); updateHud(); legend(); accessible();
  }
  const q_ = () => (q('#gvSearch') ? q('#gvSearch').value : ''); let match = null;

  /* ---------- simulation ---------- */
  let alpha = 1, raf = 0, W = 0, H = 0, dpr = 1; const view = { x: 0, y: 0, k: 1 };
  const wake = (a) => { alpha = Math.max(alpha, a); if (!raf) raf = requestAnimationFrame(frame); };
  function step() {
    const cell = 110, grid = new Map(); for (const n of nodes) { const key = Math.floor(n.x / cell) + ',' + Math.floor(n.y / cell); (grid.get(key) || grid.set(key, []).get(key)).push(n); }
    for (const n of nodes) { const cx = Math.floor(n.x / cell), cy = Math.floor(n.y / cell); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const c = grid.get((cx + i) + ',' + (cy + j)); if (!c) continue; for (const o of c) { if (o === n) continue; let dx = n.x - o.x, dy = n.y - o.y, d2 = dx * dx + dy * dy; if (d2 > 12100) continue; if (d2 < 1) { dx = Math.random() - .5; dy = Math.random() - .5; d2 = 1; } const d = Math.sqrt(d2), f = ((n.r + o.r) * 2.2 + 26) / d2 * alpha * 2.4; n.vx += dx / d * f * 9; n.vy += dy / d * f * 9; } } }
    for (const e of edges) { const a = e.A, b = e.B; let dx = b.x - a.x, dy = b.y - a.y; const d = Math.sqrt(dx * dx + dy * dy) || 1; const rest = e.k === 'struct' ? 24 + a.r + b.r : e.k === 'tag' ? 70 : 55 + a.r + b.r; const k = (e.k === 'struct' ? 0.09 : 0.035) * alpha * (d - rest) / d; const wa = 1 / (1 + Math.sqrt((adj.get(a.id) || []).length) * 0.25), wb = 1 / (1 + Math.sqrt((adj.get(b.id) || []).length) * 0.25); a.vx += dx * k * wa; a.vy += dy * k * wa; b.vx -= dx * k * wb; b.vy -= dy * k * wb; }
    for (const n of nodes) { if (n.fixed) { n.vx = n.vy = 0; continue; } const g = n.kind === 'source' ? 0.06 : 0.0055; n.vx += (n.anchor.x - n.x) * g * alpha; n.vy += (n.anchor.y - n.y) * g * alpha; n.vx *= 0.8; n.vy *= 0.8; n.x += Math.max(-30, Math.min(30, n.vx)); n.y += Math.max(-30, Math.min(30, n.vy)); }
  }
  let hover = null, sel = null, drag = null, t0 = performance.now();
  function frame(ts) {
    raf = 0; if (!document.body.contains(cv)) return; if (alpha > 0.015) { step(); step(); alpha *= 0.985; }
    for (const n of nodes) pos.set(n.id, { x: n.x, y: n.y }); if (!touched) fit(false); draw(ts); if (alpha > 0.015 || drag || pulse) raf = requestAnimationFrame(frame);
  }
  let pulse = false; // Settle the graph instead of continuously consuming a CPU core.
  const toS = (x, y) => [(x * view.k) + view.x, (y * view.k) + view.y]; const toW = (x, y) => [(x - view.x) / view.k, (y - view.y) / view.k];
  const NB = () => { const f = hover || sel; if (!f) return null; const s = new Set([f.id]); for (const o of adj.get(f.id) || []) s.add(o.id); return s; };
  function colorOf(n) { return opt.color === 'recent' ? (n.kind === 'ghost' ? '#8fa0b8' : n.kind === 'tag' ? '#c77dff' : heat(n.mtime || 0)) : n.color; }
  function draw(ts) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.save(); ctx.translate(view.x, view.y); ctx.scale(view.k, view.k);
    const nb = NB(); const dim = (id) => (nb && !nb.has(id)) || (match && !match.has(id));
    ctx.lineCap = 'round';
    for (const e of edges) { const lit = nb && nb.has(e.a) && nb.has(e.b) && (hover || sel) && (e.a === (hover || sel).id || e.b === (hover || sel).id); const faded = (nb && !lit) || (match && !(match.has(e.a) && match.has(e.b))); ctx.globalAlpha = lit ? 0.95 : faded ? 0.03 : e.k === 'struct' ? 0.13 : 0.34; ctx.strokeStyle = lit ? '#ffffff' : colorOf(e.A); ctx.lineWidth = (lit ? 1.6 : e.k === 'link' ? 1.1 : 0.7) / Math.sqrt(view.k); ctx.beginPath(); ctx.moveTo(e.A.x, e.A.y); ctx.lineTo(e.B.x, e.B.y); ctx.stroke(); }
    ctx.globalCompositeOperation = 'lighter';
    for (const n of nodes) { const c = colorOf(n); const faded = dim(n.id); const R = n.r * (n.kind === 'note' && n.deg > 3 ? 3.4 : 2.6); ctx.globalAlpha = faded ? 0.07 : n.kind === 'folder' ? 0.35 : 0.8; ctx.drawImage(sprite(c), n.x - R, n.y - R, R * 2, R * 2); }
    ctx.globalCompositeOperation = 'source-over';
    const day = Date.now(); const ph = (ts / 900) % 1;
    for (const n of nodes) { const faded = dim(n.id); const c = colorOf(n); ctx.globalAlpha = faded ? 0.12 : 1;
      if (n.kind === 'ghost') { ctx.strokeStyle = c; ctx.lineWidth = 1.2 / view.k; ctx.setLineDash([2, 2]); ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, 6.283); ctx.stroke(); ctx.setLineDash([]); continue; }
      ctx.fillStyle = n.kind === 'folder' ? '#0b1220' : c; ctx.beginPath(); if (n.kind === 'tag') { ctx.moveTo(n.x, n.y - n.r); ctx.lineTo(n.x + n.r, n.y); ctx.lineTo(n.x, n.y + n.r); ctx.lineTo(n.x - n.r, n.y); ctx.closePath(); } else ctx.arc(n.x, n.y, n.kind === 'source' ? n.r : n.r * (n.kind === 'folder' ? .8 : 1), 0, 6.283); ctx.fill();
      if (n.kind === 'folder' || n.kind === 'source') { ctx.strokeStyle = c; ctx.lineWidth = (n.kind === 'source' ? 2.4 : 1.4) / Math.sqrt(view.k); ctx.stroke(); }
      if (n.kind === 'note' && day - n.mtime < 864e5 && !faded) { ctx.globalAlpha = 0.6 * (1 - ph); ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.4 / view.k; ctx.beginPath(); ctx.arc(n.x, n.y, n.r + 2 + ph * 9, 0, 6.283); ctx.stroke(); } }
    if (sel || hover) { const f = hover || sel; ctx.globalAlpha = 1; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 / view.k; ctx.beginPath(); ctx.arc(f.x, f.y, f.r + 3, 0, 6.283); ctx.stroke(); }
    if (opt.labels) { ctx.globalAlpha = 1; ctx.textAlign = 'center'; const fs = Math.max(9, 12 / Math.sqrt(view.k)); ctx.font = `600 ${fs}px -apple-system,BlinkMacSystemFont,Inter,sans-serif`; let count = 0; const lab = []; for (const n of nodes) { const f = hover === n || sel === n || (nb && nb.has(n.id) && nodes.length < 700) || (match && match.has(n.id) && match.size < 40); const big = n.kind === 'source' || (n.kind === 'folder' && n.count > 5 && view.k > 0.45) || (n.deg > 4 && view.k > 0.55) || view.k > 2.2; if (!(f || (big && !dim(n.id)))) continue; const [sx, sy] = toS(n.x, n.y); if (sx < -40 || sy < -20 || sx > W + 40 || sy > H + 20) continue; lab.push([f ? 0 : 1, n]); }
      lab.sort((a, b) => a[0] - b[0]); for (const [, n] of lab) { if (count++ > 160) break; const t = n.label.length > 34 ? n.label.slice(0, 33) + '…' : n.label; ctx.lineWidth = 3 / view.k; ctx.strokeStyle = 'rgba(4,8,16,.9)'; ctx.strokeText(t, n.x, n.y + n.r + fs + 1); ctx.fillStyle = hover === n || sel === n ? '#fff' : '#cfe3ff'; ctx.fillText(t, n.x, n.y + n.r + fs + 1); } }
    ctx.restore();
  }

  /* ---------- sizing / interaction ---------- */
  function resize() { const r = stage.getBoundingClientRect(); W = Math.max(280, r.width); H = Math.max(320, r.height); dpr = Math.min(2, window.devicePixelRatio || 1); cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px'; draw(performance.now()); }
  function fit(redraw = true) { if (!nodes.length) return; let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const n of nodes) { a = Math.min(a, n.x); b = Math.min(b, n.y); c = Math.max(c, n.x); d = Math.max(d, n.y); } const w = Math.max(80, c - a), h = Math.max(80, d - b); view.k = Math.min(2.2, Math.min((W - 60) / w, (H - 60) / h)); view.x = W / 2 - ((a + c) / 2) * view.k; view.y = H / 2 - ((b + d) / 2) * view.k; if (redraw) wake(0.001); }
  const pick = (sx, sy) => { const [x, y] = toW(sx, sy); let best = null, bd = 1e9; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y) - n.r; if (d < bd && d < 8 / view.k + 2) { bd = d; best = n; } } return best; };
  const rect = () => cv.getBoundingClientRect(); const ptrs = new Map(); let pinch = null, moved = 0;
  cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); const r = rect(); const p = [e.clientX - r.left, e.clientY - r.top]; ptrs.set(e.pointerId, p); moved = 0; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), k: view.k }; drag = null; return; } const n = pick(...p); drag = n ? { n, off: toW(...p) } : { bg: true, sx: p[0], sy: p[1], vx: view.x, vy: view.y }; if (n) { n.fixed = true; wake(0.4); } });
  cv.addEventListener('pointermove', (e) => { const r = rect(); const p = [e.clientX - r.left, e.clientY - r.top]; if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, p);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const nk = Math.max(0.08, Math.min(6, pinch.k * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d)); const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2; const [wx, wy] = toW(cx, cy); view.k = nk; view.x = cx - wx * nk; view.y = cy - wy * nk; wake(0.001); return; }
    if (drag) { moved += 1; if (drag.bg) { view.x = drag.vx + p[0] - drag.sx; view.y = drag.vy + p[1] - drag.sy; } else { const [x, y] = toW(...p); drag.n.x = x; drag.n.y = y; wake(0.35); } wake(0.001); return; }
    const n = e.pointerType === 'mouse' ? pick(...p) : null; if (n !== hover) { hover = n; cv.style.cursor = n ? 'pointer' : 'grab'; tip(n, e); wake(0.001); } else if (n) tip(n, e); });
  const up = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (drag && !drag.bg) { drag.n.fixed = false; if (moved < 4) select(drag.n); } else if (drag && drag.bg && moved < 4) select(null); drag = null; };
  cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up); cv.addEventListener('pointerleave', () => { if (hover) { hover = null; tip(null); wake(0.001); } });
  cv.addEventListener('wheel', (e) => { e.preventDefault(); const r = rect(); const sx = e.clientX - r.left, sy = e.clientY - r.top; const [wx, wy] = toW(sx, sy); const nk = Math.max(0.08, Math.min(6, view.k * Math.exp(-e.deltaY * 0.0015))); view.k = nk; view.x = sx - wx * nk; view.y = sy - wy * nk; wake(0.001); }, { passive: false });
  cv.addEventListener('dblclick', (e) => { const r = rect(); const n = pick(e.clientX - r.left, e.clientY - r.top); if (n) { opt.focus = opt.focus === n.id ? null : n.id; applyFilters(); fit(); } });
  const tipEl = q('#gvTip'); function tip(n, e) { if (!n) { tipEl.hidden = true; return; } const r = stage.getBoundingClientRect(); tipEl.hidden = false; tipEl.innerHTML = `<b>${esc(n.label)}</b><span>${esc(n.kind === 'note' ? (n.path || '') : n.kind === 'ghost' ? 'linked but not created yet' : n.kind === 'folder' ? n.count + ' notes' : n.kind === 'tag' ? n.count + ' notes' : 'project')}${n.deg ? ' · ' + n.deg + ' links' : ''}</span>`; tipEl.style.left = Math.min(r.width - 230, Math.max(8, e.clientX - r.left + 14)) + 'px'; tipEl.style.top = Math.max(8, e.clientY - r.top + 14) + 'px'; }

  /* ---------- panel / hud / legend ---------- */
  const panel = q('#gvPanel');
  async function select(n) {
    sel = n; wake(0.001); if (!n) { panel.hidden = true; return; } panel.hidden = false; const links = (adj.get(n.id) || []).filter((o) => o.kind === 'note' || o.kind === 'ghost' || o.kind === 'tag');
    const head = `<button class="gv-x" id="gvClose" aria-label="Close">×</button><div class="gv-ph"><span class="gv-dot" style="background:${colorOf(n)}"></span><div><h3>${esc(n.label)}</h3><div class="muted tiny">${esc(n.kind === 'note' ? n.path : n.kind === 'ghost' ? 'Linked from other notes, not created yet' : n.kind === 'folder' ? 'Folder · ' + n.count + ' notes' : n.kind === 'tag' ? 'Tag · ' + n.count + ' notes' : 'Project')}</div></div></div>`;
    const chips = (n.tags || []).map((t) => `<button class="chip-btn" data-gvtag="${esc(t)}">#${esc(t)}</button>`).join(' ');
    panel.innerHTML = `${head}<div class="gv-pb">${n.kind === 'note' ? `<div class="gv-meta"><span>${esc(n.words || 0)} words</span><span>edited ${esc(ago(n.mtime))}</span><span>${n.deg || 0} links</span></div>${chips ? `<div style="margin:8px 0">${chips}</div>` : ''}<div class="gv-prev" id="gvPrev">Loading preview…</div><div class="pill-row" style="margin:10px 0"><a class="btn sm primary" id="gvOpenOb" hidden>Open in Obsidian</a><button class="btn sm" id="gvEdit">Edit in Jarvis</button></div>` : ''}
      <div class="gv-act"><button class="btn sm" id="gvFocus">${opt.focus === n.id ? 'Show everything' : 'Focus on connections'}</button></div>
      ${links.length ? `<h4>Connected (${links.length})</h4><div class="gv-links">${links.slice(0, 40).map((o) => `<button data-gvgo="${esc(o.id)}"><i style="background:${colorOf(o)}"></i>${esc(o.label)}</button>`).join('')}</div>` : '<div class="muted tiny" style="margin-top:8px">No links yet. Link it from another note with [[' + esc(n.name || n.label) + ']].</div>'}</div>`;
    q('#gvClose').onclick = () => select(null); const fb = q('#gvFocus'); fb.onclick = () => { opt.focus = opt.focus === n.id ? null : n.id; applyFilters(); fit(); select(byId.get(n.id) || null); };
    if (n.kind === 'note') { try { const d = await api('/api/obsidian/graph/preview?id=' + encodeURIComponent(n.id)); if (sel !== n) return; const body = d.text.replace(/^---[\s\S]*?\n---\n?/, ''); q('#gvPrev').textContent = body.slice(0, 2400) || 'Empty note'; const o = q('#gvOpenOb'); o.href = d.uri; o.hidden = false; q('#gvEdit').onclick = () => { localStorage.setItem('jarvis.obsidian.project', n.source); localStorage.setItem('jarvis.obsidian.openNote', n.path); location.hash = '#/obsidian'; }; } catch (e) { const pv = q('#gvPrev'); if (pv) pv.textContent = e.message; } }
  }
  panel.addEventListener('click', (e) => { const g = e.target.closest('[data-gvgo]'); if (g) { const n = byId.get(g.dataset.gvgo); if (n) { select(n); const [sx, sy] = toS(n.x, n.y); view.x += W / 2 - sx - (window.innerWidth > 800 ? 120 : 0); view.y += H / 2 - sy; wake(0.001); } } const t = e.target.closest('[data-gvtag]'); if (t) { q('#gvSearch').value = t.dataset.gvtag; applyFilters(); } });
  function updateHud() { const st = data.stats; q('#gvSub').textContent = `${st.notes} notes · ${st.links} links · ${st.orphans} not linked yet · ${st.ghosts} missing notes${st.capped ? ' · bounded scan; some notes omitted' : ''}`; q('#gvHud').innerHTML = `<span><b>${nodes.filter((n) => n.kind === 'note').length}</b> shown</span><span><b>${edges.length}</b> connections</span>${opt.focus ? '<button class="chip-btn" id="gvUnfocus">Focus on · clear</button>' : ''}`; const u = q('#gvUnfocus'); if (u) u.onclick = () => { opt.focus = null; applyFilters(); fit(); }; }
  function accessible(){const notes=nodes.filter(n=>n.kind==='note'&&(!match||match.has(n.id)));q('#gvAccessibleTitle').textContent='Browse notes ('+notes.length+')';q('#gvAccessible').innerHTML=notes.slice(0,250).map(n=>`<button class="btn sm" data-gv-access="${esc(n.id)}">${esc(n.label)}</button>`).join('')||'<span class="muted">No visible notes match your filters.</span>';q('#gvAccessible').querySelectorAll('[data-gv-access]').forEach(b=>b.onclick=()=>select(byId.get(b.dataset.gvAccess)));}
  function legend() { q('#gvLegend').innerHTML = opt.color === 'recent' ? [['#ffd166', 'today'], ['#ff9f5a', 'this week'], ['#c77dff', 'this month'], ['#5b8cff', 'this quarter'], ['#3a4a6b', 'older']].map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('') : `<span><i style="background:transparent;border:1px dashed #8fa0b8"></i>missing note</span>${opt.tags ? '<span><i class="dia" style="background:#c77dff"></i>tag</span>' : ''}<span><i class="ring"></i>edited today</span>`; }
  function chips() { q('#gvChips').innerHTML = data.sources.filter((s) => s.notes).map((s) => `<button class="gv-chip ${opt.off.has(s.id) ? '' : 'on'}" data-gvsrc="${esc(s.id)}" style="--c:${hex6(s.color)}"><i></i>${esc(s.name)} <span>${s.notes}</span></button>`).join('') + `<button class="gv-chip ${opt.orphans ? 'on' : ''}" data-gvopt="orphans" style="--c:#8fa0b8"><i></i>Unlinked notes</button><button class="gv-chip ${opt.tags ? 'on' : ''}" data-gvopt="tags" style="--c:#c77dff"><i></i>Tags</button><button class="gv-chip ${opt.labels ? 'on' : ''}" data-gvopt="labels" style="--c:#cfe3ff"><i></i>Names</button>`; }
  q('#gvChips').onclick = (e) => { const s = e.target.closest('[data-gvsrc]'), o = e.target.closest('[data-gvopt]'); if (s) { const id = s.dataset.gvsrc; opt.off.has(id) ? opt.off.delete(id) : opt.off.add(id); store.set('off', [...opt.off]); } else if (o) { const k = o.dataset.gvopt; opt[k] = !opt[k]; store.set(k, opt[k]); } else return; chips(); applyFilters(); fit(); };
  const seg = q('#gvMode'); const markSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === opt.mode)); markSeg();
  seg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; opt.mode = b.dataset.v; store.set('mode', opt.mode); markSeg(); applyFilters(); fit(); };
  q('#gvColor').onchange = (e) => { opt.color = e.target.value; store.set('color', opt.color); legend(); wake(0.001); };
  let st; q('#gvSearch').oninput = () => { clearTimeout(st); st = setTimeout(() => { applyFilters(); if (match && match.size) { const f = nodes.filter((n) => match.has(n.id)); if (f.length === 1) select(f[0]); } }, 160); };
  q('#gvFit').onclick = fit; q('#gvReset').onclick=fit;const zoom=d=>{const [wx,wy]=toW(W/2,H/2);view.k=Math.max(.08,Math.min(6,view.k*d));view.x=W/2-wx*view.k;view.y=H/2-wy*view.k;wake(.001);};q('#gvIn').onclick=()=>zoom(1.25);q('#gvOut').onclick=()=>zoom(.8); q('#gvShuffle').onclick = () => { for (const n of nodes) { n.x = n.anchor.x + (Math.random() - .5) * 300; n.y = n.anchor.y + (Math.random() - .5) * 300; } wake(1); fit(); };
  q('#gvRefresh').onclick = async () => { try{const refreshed=await api('/api/obsidian/graph?fresh=1');if(!document.body.contains(cv))return;data=refreshed;buildModel();chips();applyFilters();toast('Graph refreshed');}catch(e){toast(e.message);} };
  let touched = false,closed=false; ['pointerdown', 'wheel'].forEach((ev) => cv.addEventListener(ev, () => (touched = true), { passive: true }));
  const ro=new ResizeObserver(()=>{if(closed)return;resize();if(!touched)fit();});ro.observe(stage);
  const key=e=>{if(e.key==='Escape')select(null);};window.addEventListener('keydown',key);
  const cleanup=()=>{if(closed)return;closed=true;cancelAnimationFrame(raf);raf=0;ro.disconnect();clearTimeout(st);window.removeEventListener('keydown',key);observer.disconnect();if(v._knowledgeCleanup===cleanup)delete v._knowledgeCleanup;};
  const observer=new MutationObserver(()=>{if(!v.contains(cv))cleanup();});observer.observe(v,{childList:true});v._knowledgeCleanup=cleanup;
  buildModel();chips();resize();applyFilters();wake(1);fit();cv.style.cursor='grab';

}
window.PAGES.graph = vGraph;
})();
