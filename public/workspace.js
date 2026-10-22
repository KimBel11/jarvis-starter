'use strict';
// Project workspaces (apps, websites, social, video), System check, iPhone & remote, command palette, mobile navigation.
S.ws = S.ws || {}; S.projTab = S.projTab || {};
const TABS = [['overview', 'Overview'], ['apps', 'Apps'], ['sites', 'Websites'], ['social', 'Social media'], ['video', 'Videos'], ['3d', '3D models']];
const GROUP_LABEL = { command: 'Command', shared: 'Shared' };
const copyText = (t, msg) => navigator.clipboard.writeText(t).then(() => toast(msg || 'Copied')).catch(() => toast('Could not copy'));
async function loadWorkspace(id) { try { S.ws[id] = await api('/api/workspace?project=' + encodeURIComponent(id)); } catch (e) { S.ws[id] = S.ws[id] || { apps: [], websites: [], social: null, video: null, error: e.message }; } return S.ws[id]; }
async function loadBlender() { try { S.blender = await api('/api/blender/status'); } catch { S.blender = S.blender || { installed: false, skills: {}, scripts: [] }; } return S.blender; }
async function loadConnectors() { try { S.connectors = (await api('/api/connectors')).connectors; } catch { S.connectors = S.connectors || {}; } }
const hostPath = (p) => esc(String(p || '').replace('/Volumes/', '').replace(/^.*?Users\/[^/]+\//, '~/'));

/* ---------- roster grouped by project ---------- */
function rosterHtml(agents, full) {
  const groups = {}; for (const a of agents) (groups[a.group || 'shared'] = groups[a.group || 'shared'] || []).push(a);
  const order = ['command', ...S.projects.map((p) => p.id), 'shared'].filter((g) => groups[g]);
  for (const g of Object.keys(groups)) if (!order.includes(g)) order.push(g);
  return order.map((g) => { const pr = S.projects.find((p) => p.id === g); const label = pr ? pr.name : GROUP_LABEL[g] || g; const color = pr ? pr.color : 'var(--cyan)'; return `<div class="roster-group"><div class="rg-h" style="--c:${color}"><i></i>${esc(label)}<span class="tag">${groups[g].length}</span></div><div class="roster ${full ? 'big' : ''}">${groups[g].map((a) => agentCard(a, full)).join('')}</div></div>`; }).join('');
}

/* ---------- small building blocks ---------- */
function agentStrip(agentId, role) {
  const a = agentOf(agentId); const st = (S.team && S.team.agents.find((x) => x.id === agentId) || {}).status || { state: 'idle', current: null, waiting: [] };
  const tasks = ((S.team && S.team.tasks) || []).filter((t) => t.agent === agentId).slice(0, 3);
  return `<div class="astrip ${st.state}" style="--c:${a.color}"><span class="t-g">${a.glyph}</span><div class="grow"><div><b>${esc(a.name)}</b> <span class="a-state">${STATE_LABEL[st.state]}</span></div><div class="muted tiny">${esc(role || a.role)}${st.current ? ' · ' + esc(st.current.title) : ''}</div>${tasks.length ? `<div class="astrip-t">${tasks.map((t) => `<span class="tag" data-task="${t.id}" title="${esc(t.title)}">${esc(t.title.slice(0, 26))} · ${t.status.replace('_', ' ')}</span>`).join('')}</div>` : ''}</div></div>`;
}
const fileThumb = (f) => `<div class="m sm" data-media="${esc(f.path)}"><div class="th">${f.kind === 'image' ? `<img loading="lazy" src="${fileUrl(f.path)}">` : f.kind === 'video' ? `<video preload="metadata" muted src="${fileUrl(f.path)}#t=0.6"></video>` : ICON[f.kind] || '📄'}</div><div class="cap"><div class="t">${esc(f.rel.split('/').pop())}</div><div class="muted tiny">${ago(f.mtime)} · ${fmtB(f.size)}</div></div></div>`;
const recentList = (files) => (files && files.length ? files.map((f) => `<div class="row click" data-open="${esc(f.path)}"><div class="ficon">${ICON[f.kind] || '📄'}</div><div class="grow"><div class="t">${esc(f.rel.split('/').pop())}</div><div class="muted tiny t">${esc(f.rel)}</div></div><span class="muted tiny">${ago(f.mtime)}</span></div>`).join('') : '<div class="muted tiny" style="padding:6px 0">Nothing yet.</div>');
function cmdList(item, abs) { return (item.commands || []).length ? `<div class="cmds">${item.commands.map((c, i) => `<div class="cmd"><div class="grow"><div class="tiny muted">${esc(c.label)}</div><code>${esc(c.cmd)}</code></div><button class="btn sm ghost" data-copycmd="${esc(abs)}|${i}|${esc(item.id)}" title="Copy with cd into the folder">⧉</button></div>`).join('')}</div>` : ''; }
const linkList = (item) => ((item.links || []).filter((l) => l.url).length ? `<div class="pill-row" style="margin-top:8px">${item.links.filter((l) => l.url).map((l) => `<a class="btn sm" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('')}</div>` : '');
function actionRow(pid, abs, extra) { return `<div class="pill-row act-row"><button class="btn sm claude" data-launch="claude:${pid}" data-lpath="${esc(abs)}">▶ Claude Code</button><button class="btn sm codex" data-launch="codex:${pid}" data-lpath="${esc(abs)}">▶ Codex</button><button class="btn sm" data-launch="terminal:${pid}" data-lpath="${esc(abs)}">Terminal</button>${extra || ''}<button class="btn sm ghost" data-reveal="${esc(abs)}">Finder</button></div>`; }

/* ---------- tabs ---------- */
function appsTab(box, p, ws) {
  if (!ws.apps.length) return (box.innerHTML = '<div class="card empty">No apps are set up for this project yet.</div>');
  box.innerHTML = ws.apps.map((a) => { const i = a.info || {}; const ver = i.appVersion || i.version; const ag = agentOf(a.agent);
    return `<div class="card ws-card" style="--c:${p.color}"><div class="ws-head"><div class="ws-ic">📱</div><div class="grow"><h2>${esc(a.name)}</h2><div class="muted">${esc(a.platforms || '')}${a.stack ? ' · ' + esc(a.stack) : ''}</div></div><button class="btn sm ghost" data-wsedit="app|${esc(a.id)}">✎ Edit</button></div>
    <div class="chips">${ver ? `<span class="chip2">v${esc(ver)}</span>` : ''}${i.buildNumber ? `<span class="chip2">iOS build ${esc(i.buildNumber)}</span>` : ''}${i.versionCode ? `<span class="chip2">Android code ${esc(i.versionCode)}</span>` : ''}${i.bundleId ? `<span class="chip2 mono">${esc(i.bundleId)}</span>` : ''}${i.expo ? `<span class="chip2">Expo ${esc(i.expo)}</span>` : ''}${a.info && !a.info.exists ? '<span class="chip2 bad">folder missing</span>' : ''}</div>
    <div class="ws-grid"><div>${agentStrip(a.agent, 'Updates this app')}<div class="pill-row" style="margin:12px 0 4px"><button class="btn primary" data-update="${esc(a.agent)}|${esc(a.name)}|${esc(a.abs)}">✦ Update this app</button><button class="btn" data-chat="${esc(a.agent)}">Chat with ${esc(ag.name.split(' ')[0])}</button></div>
      ${actionRow(p.id, a.abs, i.xcworkspace ? `<button class="btn sm" data-open="${esc(i.xcworkspace)}">Open in Xcode</button>` : '')}${a.notes ? `<div class="ws-note">${esc(a.notes)}</div>` : ''}${linkList(a)}</div>
      <div><div class="doc-h" style="margin-top:0">Commands</div>${cmdList(a, a.abs) || '<div class="muted tiny">No saved commands.</div>'}<div class="doc-h">Recently changed</div>${recentList(a.recent)}</div></div></div>`; }).join('');
}
function connChip(site) {
  const c = site.connection;
  if (c === 'claude-connector') return '<span class="chip2 good">✓ Connected through the Claude Shopify connector</span>';
  if (c === 'cli') return '<span class="chip2 warn">Uses your Shopify / Cloudflare CLI login</span>';
  return '';
}
function sitesTab(box, p, ws) {
  if (!ws.websites.length) return (box.innerHTML = '<div class="card empty">No websites are set up for this project yet.</div>');
  box.innerHTML = ws.websites.map((s) => `<div class="card ws-card" style="--c:${p.color}"><div class="ws-head"><div class="ws-ic">${s.kind === 'worker' ? '⚙️' : s.kind === 'shopify' ? '🛒' : '🌐'}</div><div class="grow"><h2>${esc(s.name)}</h2><div class="muted">${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url.replace(/^https?:\/\//, ''))} ↗</a>` : ''}${s.store ? ` · <span class="mono">${esc(s.store)}</span>` : ''}${s.theme ? ` · theme ${esc(s.theme)}` : ''}</div></div><button class="btn sm ghost" data-wsedit="site|${esc(s.id)}">✎ Edit</button></div>
    <div class="chips">${connChip(s)}${s.exists === false ? '<span class="chip2 bad">folder missing</span>' : ''}</div>
    <div class="ws-grid"><div>${agentStrip(s.agent, 'Updates this site')}<div class="pill-row" style="margin:12px 0 4px"><button class="btn primary" data-update="${esc(s.agent)}|${esc(s.name)}|${esc(s.abs)}">✦ Update this site</button><button class="btn" data-chat="${esc(s.agent)}">Chat</button></div>${actionRow(p.id, s.abs)}${s.notes ? `<div class="ws-note">${esc(s.notes)}</div>` : ''}${linkList(s)}</div>
      <div><div class="doc-h" style="margin-top:0">Commands</div>${cmdList(s, s.abs) || '<div class="muted tiny">No saved commands.</div>'}<div class="doc-h">Recently changed</div>${recentList(s.recent)}</div></div></div>`).join('');
}
function platChip(id) { const s = svcById(id); const k = connectedSvc(id); const via = S.connectors && S.connectors[id]; return `<a data-go="platforms" class="plat-pill ${k ? 'on' : ''}" style="--c:${s.color}" title="${k ? (via && !S.vault.entries.some((e) => e.service === id) ? 'Connected: ' + esc(via) : 'Key stored in the vault') : 'No key yet'}"><i></i>${esc(s.name)}</a>`; }
function socialTab(box, p, ws) {
  const so = ws.social; if (!so) return (box.innerHTML = '<div class="card empty">No social media setup for this project yet.</div>');
  const files = so.recent || [];
  box.innerHTML = `<div class="grid g2"><div class="card ws-card" style="--c:${p.color}"><div class="ws-head"><div class="ws-ic">📣</div><div class="grow"><h2>Posting</h2><div class="muted">Publishes your finished content. It always plans first and waits for your approval.</div></div><button class="btn sm ghost" data-wsedit="social|social">✎ Edit</button></div>
    <div class="doc-h" style="margin-top:6px">Platforms</div><div class="plat-pills">${(so.platforms || []).map(platChip).join('')}</div>
    ${agentStrip(so.poster, 'Posts on social media')}<div class="pill-row" style="margin:12px 0"><button class="btn primary" data-update="${esc(so.poster)}|Plan the next posts|${esc(so.abs)}">Plan the next posts</button><button class="btn" data-chat="${esc(so.poster)}">Chat</button></div>
    <div class="muted tiny">Folder: <span class="mono">${hostPath(so.abs)}</span> · ${so.count} files</div>${actionRow(p.id, so.abs)}</div>
    <div class="card ws-card" style="--c:${p.color}"><div class="ws-head"><div class="ws-ic">📊</div><div class="grow"><h2>Analysis & improvement</h2><div class="muted">Studies performance and returns concrete changes.</div></div></div>${agentStrip(so.analyst, 'Analyses performance')}<div class="pill-row" style="margin:12px 0"><button class="btn primary" data-update="${esc(so.analyst)}|Analyse performance|${esc(so.abs)}">Analyse how it's performing</button><button class="btn" data-chat="${esc(so.analyst)}">Chat</button></div><div class="doc-h">Newest social files</div>${recentList(files)}<div style="margin-top:10px"><a class="btn sm" data-go="social">Open Social & key files →</a></div></div></div>`;
}
function videoTab(box, p, ws) {
  const v = ws.video; if (!v) return (box.innerHTML = '<div class="card empty">No video setup for this project yet.</div>');
  const rawNames = (v.raw.recent || []).slice(0, 5).map((f) => f.rel.split('/').pop()).join(', ');
  const col = (title, ic, sub, count, exists, files, body) => `<div class="card ws-card vcol" style="--c:${p.color}"><div class="ws-head"><div class="ws-ic">${ic}</div><div class="grow"><h2>${title}</h2><div class="muted">${sub}</div></div><span class="tag">${exists ? count : 'no folder'}</span></div>${body}<div class="thumbs">${(files || []).slice(0, 6).map(fileThumb).join('') || '<div class="muted tiny">Nothing here yet.</div>'}</div></div>`;
  box.innerHTML = `<div class="grid g3">
    ${col('To edit', '✂️', 'Raw footage waiting for an editor', v.raw.count, v.raw.exists, v.raw.recent, `${agentStrip(v.editor, 'Edits raw footage')}<div class="pill-row" style="margin:12px 0"><button class="btn primary" data-update="${esc(v.editor)}|Edit new footage|${esc(v.rawAbs)}|Edit the newest raw footage in ${esc(v.rawAbs)} (newest files: ${esc(rawNames)}). Make post-ready 9:16 clips with captions and branding, and save them in a new folder next to the sources. Tell me which clips you made.">Edit new footage</button><button class="btn sm ghost" data-reveal="${esc(v.rawAbs)}">Finder</button></div>`)}
    ${col('Ready to post', '✅', 'Finished edits', v.ready.count, v.ready.exists, v.ready.recent, `<div class="pill-row" style="margin:6px 0 12px"><button class="btn primary" data-update="${esc((ws.social || {}).poster || '')}|Plan posts from ready videos|${esc(v.readyAbs)}|Look in ${esc(v.readyAbs)} for finished videos and plan how to post them (platform, caption, hashtags, time).">Plan posting</button><button class="btn sm ghost" data-reveal="${esc(v.readyAbs)}">Finder</button></div>`)}
    ${col('Generation', '✨', 'AI-generated videos', v.generated.count, v.generated.exists, v.generated.recent, `${agentStrip(v.generator, 'Generates videos')}<div class="pill-row" style="margin:12px 0"><button class="btn primary" data-update="${esc(v.generator)}|New video|${esc(v.genAbs)}|Create a new short video for ${esc(p.name)}. Topic and goal: ">Generate a video</button><button class="btn sm ghost" data-reveal="${esc(v.genAbs)}">Finder</button></div>`)}
  </div>`;
}

async function vProjectWS(v) {
  const id = window.routeArg; const p = proj(id); if (!p) return (v.innerHTML = '<div class="empty">Project not found.</div>');
  const tabList = window.tabsFor ? tabsFor(p) : TABS; if (!tabList.some(([k]) => k === (S.projTab[id] || 'overview'))) S.projTab[id] = 'overview';
  const linkedConversation=new URLSearchParams(location.search).get('conversation');if(linkedConversation&&S.openedConversationLink!==linkedConversation){S.projTab[id]='chat';S.openedConversationLink=linkedConversation;}
  const tab = S.projTab[id] || 'overview';
  vProject(v, id); const hero = v.querySelector('.hero'); if (!hero) return;
  const bar = document.createElement('div'); bar.className = 'tabs ws-tabs'; bar.innerHTML = tabList.map(([k, n]) => `<button data-wtab="${k}" class="${tab === k ? 'on' : ''}">${n}</button>`).join('');
  hero.after(bar);
  bar.onclick = (e) => { const b = e.target.closest('button'); if (b) { S.projTab[id] = b.dataset.wtab; vProjectWS(v); } };
  if (tab === 'overview') {
   const card=document.createElement('section');card.className='card project-agents';card.style.marginBottom='16px';hero.nextElementSibling.after(card);await renderProjectAgents(card,p);return;
  }
  let n = bar.nextElementSibling; while (n) { const nx = n.nextElementSibling; n.remove(); n = nx; }
  const box = document.createElement('div'); box.id = 'wsBox'; box.innerHTML = '<div class="skeleton" style="height:160px"></div>'; v.appendChild(box);
  if(tab==='access'){await window.accessTab(box,p);return;}
  if(tab==='agents'){await renderProjectAgents(box,p);return;}
  if (!S.team) await loadTeam(); if (!S.connectors) await loadConnectors();
  const ws = await loadWorkspace(id); if (!document.getElementById('wsBox')) return;
  const render = { apps: appsTab, sites: sitesTab, social: socialTab, video: videoTab, '3d': modelsTab, study: window.studyTab, documents: window.documentsTab, chat: window.chatTab, access: window.accessTab, apple: window.appleTab, sim: window.simTab }[tab]; if (render) render(box, p, ws); animateIn(box);
}

/* ---------- 3D models tab (viewer + Blender plugin) ---------- */
S.model = S.model || {};
function ensureMV() { if (!window.__mv) window.__mv = new Promise((res, rej) => { const s = document.createElement('script'); s.type = 'module'; s.src = '/vendor/model-viewer.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the 3D viewer')); document.head.appendChild(s); }); return window.__mv; }
const M3_BIG = 80e6, BLEND_BIG = 400e6;
function viewerHtml(src, name) { return `<div class="mv-wrap"><model-viewer id="mv" src="${esc(src)}" alt="${esc(name)}" camera-controls auto-rotate auto-rotate-delay="1500" rotation-per-second="14deg" shadow-intensity="0" exposure="1.05" environment-image="neutral" interaction-prompt="none" loading="eager"></model-viewer><div class="mv-load" id="mvLoad"><div class="mv-bar"><i id="mvBar"></i></div><span id="mvTxt">Loading model…</span></div></div>`; }
async function mountViewer(pane, src, name) {
  pane.innerHTML = viewerHtml(src, name);
  try { await ensureMV(); } catch (e) { pane.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const mv = pane.querySelector('#mv'); if (!mv) return;
  mv.addEventListener('progress', (e) => { const p = Math.round((e.detail.totalProgress || 0) * 100); const b = pane.querySelector('#mvBar'); if (b) b.style.width = p + '%'; const t = pane.querySelector('#mvTxt'); if (t) t.textContent = 'Loading model… ' + p + '%'; });
  mv.addEventListener('load', () => { const l = pane.querySelector('#mvLoad'); if (l) l.remove(); });
  mv.addEventListener('error', () => { const t = pane.querySelector('#mvTxt'); if (t) t.textContent = 'This file could not be shown (it may be too heavy for the browser).'; });
}
const m3Name = (f) => f.rel.split('/').pop();
function m3Prompt(f) { return `Edit the 3D model ${f.path}. What I want changed: `; }
function renderModelPane(p, ws) {
  const pane = $('#m3Pane'); if (!pane) return; const f = ws.models.files.find((x) => x.path === S.model[p.id]) || ws.models.files[0]; if (!f) return;
  const bl = ['glb', 'blend'].includes(f.ext); const bigGlb = f.ext === 'glb' && f.size > M3_BIG; const bigBlend = f.ext === 'blend' && f.size > BLEND_BIG;
  pane.innerHTML = `<div class="ws-head" style="margin-bottom:10px"><div class="ws-ic">🧊</div><div class="grow"><h2 style="font-size:16px">${esc(m3Name(f))}</h2><div class="muted tiny mono t">${hostPath(f.path)}</div></div><span class="chip2">${f.ext.toUpperCase()}</span><span class="chip2">${fmtB(f.size)}</span></div>
    <div id="mvBox" class="mv-box"></div>
    <div class="pill-row act-row" style="margin-top:12px"><button class="btn primary" data-update="blender-3d|Edit ${esc(m3Name(f))}|${esc(f.path)}|${esc(m3Prompt(f))}">✦ Edit with 3D Artist</button>${f.ext === 'blend' ? `<button class="btn" data-blend="open|${esc(f.path)}">Open in Blender</button>${bigBlend ? '' : `<button class="btn" data-blend="convert|${esc(f.path)}">Preview in 3D</button><button class="btn" data-blend="inspect|${esc(f.path)}">Inspect</button><button class="btn" data-blend="render|${esc(f.path)}">Render image</button>`}` : ''}<button class="btn ghost" data-reveal="${esc(f.path)}">Finder</button></div>
    <div id="m3Extra"></div>`;
  const box = $('#mvBox');
  if (f.ext === 'glb') { if (bigGlb) box.innerHTML = `<div class="mv-warn"><b>${fmtB(f.size)} model.</b> It may take a while to load and can slow your browser.<br><button class="btn sm" id="m3Load" style="margin-top:10px">Load it anyway</button></div>`, $('#m3Load').onclick = () => mountViewer(box, fileUrl(f.path), m3Name(f)); else mountViewer(box, fileUrl(f.path), m3Name(f)); }
  else if (f.ext === 'blend') box.innerHTML = bigBlend ? `<div class="mv-warn"><b>${fmtB(f.size)} Blender file.</b> Opening it headless is slow and can crash Blender, so Jarvis won't do it automatically.<br>Use one of the ready-made <b>.glb</b> versions in the list to look at it, or open it in Blender yourself. Ask the 3D Artist to edit a copy.</div>` : `<div class="mv-warn">This is a Blender file. Press <b>Preview in 3D</b> and Jarvis converts a copy to GLB with Blender (your original is never changed), or open it in Blender to edit.</div>`;
  else box.innerHTML = `<div class="mv-warn">${f.ext.toUpperCase()} files can't be previewed here. Ask the 3D Artist to convert it to GLB.</div>`;
}
function modelsTab(box, p, ws) {
  const m = ws.models; if (!m || !m.count) return (box.innerHTML = '<div class="card empty">No 3D models found in this project yet (.glb, .blend, .fbx, .obj, .usdz).</div>');
  if (!S.model[p.id] || !m.files.some((x) => x.path === S.model[p.id])) { const pick = m.files.find((x) => x.ext === 'glb' && /compressed|landing/i.test(x.rel) && x.size < M3_BIG) || m.files.find((x) => x.ext === 'glb' && x.size < M3_BIG) || m.files[0]; S.model[p.id] = pick.path; }
  const groups = {}; for (const f of m.files) (groups[f.folder] = groups[f.folder] || []).push(f);
  const g = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  box.innerHTML = `<div class="card ws-card" style="--c:${p.color};margin-bottom:14px"><div class="ws-head" style="margin:0"><div class="ws-ic">🧊</div><div class="grow"><h2>3D models</h2><div class="muted">${m.count} files · ${m.glb} web models (GLB) · ${m.blend} Blender sources. Edits are done by the 3D Artist in Blender, always on a copy.</div></div></div><div style="margin-top:12px">${agentStrip('blender-3d', 'Edits models in Blender')}</div></div>
    <div class="m3-grid"><div class="card m3-list">${g.map(([folder, files]) => `<div class="m3-group"><div class="m3-gh">${esc(folder === '.' ? '(project root)' : folder.split('/').slice(-2).join(' / '))}<span class="tag">${files.length}</span></div>${files.map((f) => `<div class="m3-row ${f.path === S.model[p.id] ? 'sel' : ''}" data-m3="${esc(f.path)}"><span class="ext ${f.ext}">${f.ext}</span><span class="grow t">${esc(m3Name(f))}</span><span class="muted tiny">${fmtB(f.size)}</span></div>`).join('')}</div>`).join('')}</div>
    <div class="card m3-pane" id="m3Pane"></div></div>`;
  renderModelPane(p, ws);
  box.querySelector('.m3-list').onclick = (e) => { const r = e.target.closest('[data-m3]'); if (!r) return; S.model[p.id] = r.dataset.m3; box.querySelectorAll('.m3-row').forEach((x) => x.classList.toggle('sel', x === r)); renderModelPane(p, ws); };
}
async function blendAction(kind, path) {
  const ex = $('#m3Extra'); const pid = window.routeArg; const spin = (t) => `<div class="m3-busy"><span class="live-dot"></span> ${t}</div>`;
  try {
    if (kind === 'open') { await post('/api/reveal', { path, app: 'Blender' }); return toast('Opening in Blender…'); }
    if (kind === 'convert') { ex.innerHTML = spin('Blender is converting a copy to GLB… this can take a minute.'); const r = await post('/api/blender/convert', { path, draco: true }); ex.innerHTML = `<div class="muted tiny" style="margin-top:8px">Converted copy: ${fmtB(r.size)}${r.cached ? ' (from cache)' : ''}</div>`; return mountViewer($('#mvBox'), '/api/blender/model?id=' + encodeURIComponent(r.id), path.split('/').pop()); }
    if (kind === 'render') { ex.innerHTML = spin('Blender is rendering a preview (CPU)… about a minute.'); const r = await post('/api/blender/render', { path, angle: 'three_quarter' }); ex.innerHTML = `<div class="doc-h">Preview render</div><img class="m3-render" src="/api/blender/render-file?id=${encodeURIComponent(r.id)}">`; return; }
    if (kind === 'inspect') { ex.innerHTML = spin('Inspecting the file in Blender…'); const i = await post('/api/blender/inspect', { path }); ex.innerHTML = `<div class="doc-h">Inspection · Blender ${esc(i.blender)}</div><div class="chips"><span class="chip2">${i.mesh_objects} mesh objects</span><span class="chip2">${fmtN(i.total_polys)} polygons</span><span class="chip2">${i.materials} materials</span><span class="chip2">${i.images} images</span><span class="chip2">${i.actions.length} animations</span><span class="chip2">${i.cameras} cameras</span></div>${i.warnings.length ? i.warnings.map((w) => `<div class="approve-warn" style="margin-bottom:6px">${esc(w)}</div>`).join('') : ''}<div class="doc-h">Heaviest objects</div><div class="doc">${i.top_objects.slice(0, 12).map((m) => `${esc(m.name)} · ${fmtN(m.polys)} polys`).join('<br>')}</div><div class="doc-h">Collections</div><div class="doc">${i.collections.slice(0, 16).map((c) => `${esc(c.name)} (${c.objects})`).join(' · ') || '—'}</div>`; return; }
  } catch (e) { ex.innerHTML = `<div class="t-err" style="margin-top:10px">${esc(e.message)}</div>`; }
}
document.addEventListener('click', (e) => { if (e.target.closest('#blOpen')) { post('/api/blender/open-app').then(() => toast('Opening Blender…')).catch((x) => toast(x.message)); return; } const b = e.target.closest('[data-blend]'); if (b) { const [k, ...rest] = b.dataset.blend.split('|'); blendAction(k, rest.join('|')); } });

/* ---------- workspace actions ---------- */
function editModal(kind, itemId) {
  const id = window.routeArg; const ws = S.ws[id]; const list = kind === 'app' ? ws.apps : kind === 'site' ? ws.websites : null;
  const item = list ? list.find((x) => x.id === itemId) : kind === 'social' ? ws.social : null; if (!item) return;
  const isSocial = kind === 'social';
  modal(`<h2 style="font-size:19px;margin-bottom:12px">Edit ${isSocial ? 'social media' : esc(item.name)}</h2>
    ${isSocial ? `<div class="field"><label>Folder (inside the project)</label><input id="weP" value="${esc(item.path || '')}"></div><div class="field"><label>Platforms (comma separated ids: tiktok, meta, youtube, snapchat, pinterest, x)</label><input id="weL" value="${esc((item.platforms || []).join(', '))}"></div>`
      : `<div class="field"><label>Name</label><input id="weN" value="${esc(item.name)}"></div><div class="field"><label>Folder (inside the project)</label><input id="weP" value="${esc(item.path || '')}"></div>${kind === 'site' ? `<div class="field"><label>Website address</label><input id="weU" value="${esc(item.url || '')}"></div>` : ''}<div class="field"><label>Notes (what you need to remember)</label><textarea id="weT" rows="4">${esc(item.notes || '')}</textarea></div><div class="field"><label>Commands, one per line: label | command</label><textarea id="weC" rows="5" class="mono">${esc((item.commands || []).map((c) => c.label + ' | ' + c.cmd).join('\n'))}</textarea></div>`}
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn" id="weX">Cancel</button><button class="btn primary" id="weGo">Save</button></div>`);
  $('#weX').onclick = closeModal;
  $('#weGo').onclick = async () => {
    if (isSocial) { item.path = $('#weP').value; item.platforms = $('#weL').value.split(',').map((x) => x.trim()).filter(Boolean); }
    else { item.name = $('#weN').value; item.path = $('#weP').value; item.notes = $('#weT').value; if (kind === 'site') item.url = $('#weU').value; item.commands = $('#weC').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [a, ...b] = l.split('|'); return b.length ? { label: a.trim(), cmd: b.join('|').trim() } : { label: 'Command', cmd: a.trim() }; }); }
    try { await post('/api/workspace-update', { project: id, workspace: { apps: ws.apps, websites: ws.websites, social: ws.social, video: ws.video } }); closeModal(); toast('Saved'); vProjectWS($('#view')); } catch (e) { toast(e.message); }
  };
}
document.addEventListener('click', (e) => {
  const t = e.target;
  const up = t.closest('[data-update]'); if (up) { e.stopPropagation(); const [agent, title, abs, prompt] = up.dataset.update.split('|'); return giveTaskModal(agent, { title, prompt: prompt || `In ${abs}: ` }); }
  const ed = t.closest('[data-wsedit]'); if (ed) { const [k, id] = ed.dataset.wsedit.split('|'); return editModal(k, id); }
  const cc = t.closest('[data-copycmd]'); if (cc) { const [abs, i, itemId] = cc.dataset.copycmd.split('|'); const ws = S.ws[window.routeArg]; const item = [...(ws.apps || []), ...(ws.websites || [])].find((x) => x.id === itemId); const c = item && item.commands[+i]; if (c) copyText(`cd "${abs}" && ${c.cmd}`, 'Copied with cd. Paste it in Terminal.'); return; }
  const lp = t.closest('[data-lpath]'); if (lp && t.closest('[data-launch]')) { e.stopImmediatePropagation(); e.stopPropagation(); const [agent, project] = lp.dataset.launch.split(':'); post('/api/launch', { agent, project, path: lp.dataset.lpath }).then((r) => toast(r.note || 'Opened in Terminal')).catch((x) => toast(x.message)); return; }
  const tb = t.closest('[data-wtab]'); if (tb) return;
}, true);

/* ================= SYSTEM CHECK ================= */
async function vHealth(v) {
  v.innerHTML = '<div class="hello"><div><h1>System check</h1><div class="sub">Running checks…</div></div></div><div class="skeleton" style="height:200px"></div>';
  let r; try { r = await api('/api/selftest'); } catch (e) { return (v.innerHTML = `<div class="empty">${esc(e.message)}</div>`); }
  const groups = {}; for (const x of r.rows) (groups[x.group] = groups[x.group] || []).push(x);
  const icon = { ok: '✓', warn: '!', fail: '✕' };
  v.innerHTML = `<div class="hello"><div><h1>System check</h1><div class="sub">Claude, Codex, skills, plugins, browsers, voice, vault and every agent, tested in one place.</div></div><div class="pill-row"><button class="btn" id="hcAgain">↻ Run again</button></div></div>
  <div class="grid g4" style="margin-bottom:16px"><div class="card stat"><div class="k">Passing</div><div class="v" style="color:var(--good)">${r.counts.ok}</div></div><div class="card stat"><div class="k">Need attention</div><div class="v" style="color:var(--warn)">${r.counts.warn}</div></div><div class="card stat"><div class="k">Broken</div><div class="v" style="color:${r.counts.fail ? 'var(--bad)' : 'var(--dim)'}">${r.counts.fail}</div></div><div class="card stat"><div class="k">Live tests</div><div class="d" style="margin-top:8px"><button class="btn sm" data-live="claude">Claude</button> <button class="btn sm" data-live="codex">Codex</button> <button class="btn sm" data-live="voice">Voice</button></div><div class="d" id="liveOut" style="margin-top:8px">Sends one tiny message (a few cents).</div></div></div>
  ${Object.entries(groups).map(([g, rows]) => `<div class="sec-h"><h2>${esc(g)}</h2><span class="muted">${rows.filter((x) => x.status === 'ok').length}/${rows.length} ok</span></div><div class="card">${rows.map((x) => `<div class="hrow ${x.status}"><span class="h-ic">${icon[x.status]}</span><div class="grow"><div><b>${esc(x.label)}</b></div><div class="muted tiny">${esc(x.detail)}</div>${x.status !== 'ok' && x.fix ? `<div class="h-fix">How to fix: ${esc(x.fix)}</div>` : ''}</div></div>`).join('')}</div>`).join('')}`;
  $('#hcAgain').onclick = () => vHealth(v);
  v.querySelectorAll('[data-live]').forEach((b) => (b.onclick = async () => { const out = $('#liveOut'); out.textContent = 'Testing ' + b.dataset.live + '…'; b.disabled = true; try { const j = await post('/api/selftest/live', { target: b.dataset.live }); out.innerHTML = `<span style="color:${j.ok ? 'var(--good)' : 'var(--bad)'}">${j.ok ? '✓' : '✕'} ${esc(b.dataset.live)}: ${esc(j.detail)}</span>`; } catch (e) { out.textContent = e.message; } b.disabled = false; }));
}

/* ================= iPHONE & REMOTE ================= */
async function vMobile(v) {
  const st = await api('/api/remote/status').catch(() => null); const onLocal = !!st;
  const host = st && st.tailscale.dnsName;
  v.innerHTML = `<div class="hello"><div><h1>iPhone & remote</h1><div class="sub">Use Jarvis as an app on your iPhone, anywhere. It stays private: only your own devices on your private Tailscale network can reach it, behind a passphrase.</div></div></div>
  ${!onLocal ? '<div class="card empty">Remote setup can only be changed from your Mac.</div>' : `
  <div class="steps">
    <div class="step ${st.tailscale.installed ? 'done' : ''}"><div class="n">1</div><div class="grow"><b>Install Tailscale on your Mac and your iPhone</b><div class="muted">Free, from tailscale.com and the App Store. Sign in with the same account on both. ${st.tailscale.installed ? `<span class="chip2 good">Installed on this Mac${st.tailscale.state ? ' · ' + esc(st.tailscale.state) : ''}</span>` : '<span class="chip2 warn">Not found on this Mac</span>'}</div></div></div>
    <div class="step ${host ? 'done' : ''}"><div class="n">2</div><div class="grow"><b>Publish Jarvis privately</b><div class="muted">In Terminal on your Mac, run this once. It gives Jarvis a private https address that only your devices can open.</div><div class="cmd" style="margin-top:8px"><div class="grow"><code>tailscale serve --bg 4777</code></div><button class="btn sm ghost" id="mbCopy">⧉</button></div>${host ? `<div class="muted tiny" style="margin-top:6px">Detected your address: <span class="mono">${esc(host)}</span></div>` : ''}</div></div>
    <div class="step ${st.hasPassphrase ? 'done' : ''}"><div class="n">3</div><div class="grow"><b>Choose a passphrase and turn it on</b><div class="field" style="margin:10px 0 0"><label>Your Tailscale address</label><input id="mbHost" value="${esc((st.hosts && st.hosts[0]) || host || '')}" placeholder="my-mac.tailnet-name.ts.net"></div><div class="field" style="margin:10px 0 0"><label>Passphrase (10+ characters, only for signing in on the phone)</label><input id="mbPass" type="password" placeholder="${st.hasPassphrase ? 'Leave empty to keep the current one' : 'Choose a long passphrase'}" autocomplete="new-password"></div><div class="pill-row" style="margin-top:12px"><button class="btn primary" id="mbSave">${st.enabled ? 'Save changes' : 'Save & turn on remote access'}</button>${st.enabled ? '<button class="btn" id="mbOff">Turn off</button><button class="btn" id="mbRevoke">Sign out all phones</button>' : ''}</div><div class="muted tiny" style="margin-top:8px">Status: ${st.enabled ? `<b style="color:var(--good)">on</b> for ${esc(st.hosts.join(', '))} · ${st.sessions} signed-in device${st.sessions === 1 ? '' : 's'}` : 'off'}</div></div></div>
    <div class="step"><div class="n">4</div><div class="grow"><b>Open it on your iPhone and add it to the Home Screen</b><div class="muted">In Safari open <span class="mono">https://${esc((st.hosts && st.hosts[0]) || host || 'your-address')}</span>, sign in, then tap Share → <b>Add to Home Screen</b>. Jarvis opens full-screen like an app, with the orb, voice and your team.</div></div></div>
  </div>
  <div class="grid g2" style="margin-top:16px"><div class="card"><div class="card-h"><h3>What works on the phone</h3></div><ul class="plain"><li>Talk to @@ASSISTANT@@ with your voice and hear the reply</li><li>See the morning rundown, usage and every agent's status</li><li>Approve or reject plans (posting, video generation, app and website changes)</li><li>Send a video to Video Intel and read the report</li><li>Check projects, apps, websites and recent files</li></ul></div>
  <div class="card"><div class="card-h"><h3>Full control, with a safety check</h3></div><ul class="plain"><li>Everything works from the phone, including the vault, launching Claude/Codex on the Mac, adding projects and changing settings</li><li>Actions that touch keys or remote settings ask for your passphrase again (unlocked for 5 minutes)</li><li>Buttons like Terminal, Finder and Xcode act on the Mac itself</li></ul><div class="muted tiny" style="margin-top:8px">Sign-in is rate limited (5 tries per 10 minutes), sessions last 30 days, and you can sign every phone out above.</div></div></div>`}`;
  if (!onLocal) return;
  $('#mbCopy').onclick = () => copyText('tailscale serve --bg 4777');
  $('#mbSave').onclick = async () => { try { const body = { hosts: [$('#mbHost').value] }; const pw = $('#mbPass').value; if (pw) body.passphrase = pw; await post('/api/remote/setup', body); await post('/api/remote/setup', { enabled: true }); toast('Remote access is on'); vMobile(v); } catch (e) { toast(e.message); } };
  if ($('#mbOff')) $('#mbOff').onclick = async () => { await post('/api/remote/setup', { enabled: false }); vMobile(v); };
  if ($('#mbRevoke')) $('#mbRevoke').onclick = async () => { await post('/api/remote/revoke'); toast('All phones signed out'); vMobile(v); };
}

/* ================= COMMAND PALETTE (⌘K) ================= */
function paletteItems() {
  const items = [];
  const pages = [['home', 'Home'], ['overview', 'Dashboard'], ['projects', 'Projects'], ['social', 'Social & key files'], ['team', 'Agent team'], ['video', 'Video Intel'], ['voice', 'Voice studio'], ['vault', 'Vault & keys'], ['platforms', 'Platforms'], ['agents', 'Plugins & skills'], ['mobile', 'iPhone & remote'], ['health', 'System check'], ['usage', 'Usage'], ['sessions', 'Sessions']];
  for (const [k, n] of pages) items.push({ ic: '→', label: n, hint: 'Go to page', run: () => (location.hash = '#/' + k) });
  for (const p of S.projects) { items.push({ ic: '●', color: p.color, label: p.name, hint: 'Project', run: () => (location.hash = '#/project/' + p.id) }); for (const [k, n] of TABS.slice(1)) items.push({ ic: '●', color: p.color, label: `${p.name} › ${n}`, hint: 'Project tab', run: () => { S.projTab[p.id] = k; location.hash = '#/project/' + p.id; vProjectWS && route(); } }); }
  for (const a of (S.team && S.team.agents) || []) { items.push({ ic: a.glyph, label: 'Give task to ' + a.name, hint: 'Agent', run: () => giveTaskModal(a.id) }); items.push({ ic: a.glyph, label: 'Chat with ' + a.name, hint: 'Agent', run: () => { Jarvis.setAgent(a.id); Jarvis.open(); } }); }
  items.push({ ic: '＋', label: 'New project', hint: 'Action', run: newProjectModal }, { ic: '🎙', label: 'Talk to @@ASSISTANT@@', hint: 'Voice', run: () => Jarvis.startListening() }, { ic: '☀', label: "Write today's rundown", hint: 'Action', run: () => { location.hash = '#/home'; generateBrief(true); } });
  return items;
}
function openPalette() {
  const items = paletteItems(); let sel = 0, list = items;
  const m = $('#modal'); m.hidden = false; m.innerHTML = `<div class="sheet palette"><input id="palQ" placeholder="Search pages, projects, agents, actions…" autocomplete="off"><div id="palL"></div></div>`; m.onclick = (e) => { if (e.target === m) closeModal(); };
  const draw = () => { $('#palL').innerHTML = list.slice(0, 12).map((it, i) => `<div class="pal-i ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="pal-ic" style="${it.color ? 'color:' + it.color : ''}">${it.ic}</span><span class="grow">${esc(it.label)}</span><span class="muted tiny">${esc(it.hint)}</span></div>`).join('') || '<div class="empty">No matches</div>'; };
  const run = (i) => { const it = list[i]; if (!it) return; closeModal(); setTimeout(it.run, 30); };
  const inp = $('#palQ'); inp.focus(); draw();
  inp.oninput = () => { const q = inp.value.toLowerCase().trim(); list = q ? items.filter((it) => q.split(/\s+/).every((w) => (it.label + ' ' + it.hint).toLowerCase().includes(w))) : items; sel = 0; draw(); };
  inp.onkeydown = (e) => { if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, Math.min(list.length, 12) - 1); draw(); e.preventDefault(); } else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); } else if (e.key === 'Enter') run(sel); };
  $('#palL').onclick = (e) => { const r = e.target.closest('.pal-i'); if (r) run(+r.dataset.i); };
}
document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); } });

/* ================= MOBILE NAVIGATION ================= */
(function mobileNav() {
  const bar = document.createElement('nav'); bar.id = 'mnav';
  const item = (r, ic, label) => `<a data-mr="${r}"><span>${ic}</span>${label}</a>`;
  bar.innerHTML = item('home', '✦', 'Home') + item('projects', '▦', 'Projects') + `<button id="mTalk" aria-label="Talk to @@ASSISTANT@@"><canvas></canvas></button>` + item('team', '⬡', 'Team') + `<a id="mMore"><span>≡</span>More</a>`;
  document.body.appendChild(bar);
  new Orb(bar.querySelector('canvas'));
  bar.addEventListener('click', (e) => { const a = e.target.closest('[data-mr]'); if (a) { document.body.classList.remove('side-open'); location.hash = '#/' + a.dataset.mr; } if (e.target.closest('#mMore')) document.body.classList.toggle('side-open'); if (e.target.closest('#mTalk')) Jarvis.orbTap(); });
  const scrim = document.createElement('div'); scrim.id = 'scrim'; scrim.onclick = () => document.body.classList.remove('side-open'); document.body.appendChild(scrim);
  window.addEventListener('hashchange', () => { document.body.classList.remove('side-open'); bar.querySelectorAll('[data-mr]').forEach((a) => a.classList.toggle('on', location.hash.startsWith('#/' + a.dataset.mr))); });
  bar.querySelectorAll('[data-mr]').forEach((a) => a.classList.toggle('on', (location.hash || '#/home').startsWith('#/' + a.dataset.mr)));
})();
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('/sw.js').catch(() => {});

Object.assign(window.PAGES, { project: vProjectWS, health: vHealth, mobile: vMobile });

async function renderProjectAgents(box,p){
 try{if(!S.team)await loadTeam();if(!box.isConnected)return;const agents=(S.team?.agents||[]).filter(a=>a.project===p.id);
 box.innerHTML=`<div class="card-h"><h2>Project agents</h2><button class="btn sm" data-manage-project-agents>Manage assignments</button></div><div class="project-agent-grid">${agents.map(a=>`<article class="project-agent-card"><div><b>${esc(a.name)}</b><p class="muted tiny">${esc(a.role||'')}</p><span class="tag">${esc(a.engine||'claude')}</span><span class="muted tiny"> · ${a.enabled===false?'Disabled':'Enabled'}</span></div><button class="btn sm" data-agent-details="${esc(a.id)}">Edit agent</button></article>`).join('')||'<p class="muted">No agents assigned yet. Choose agents in Manage assignments.</p>'}</div>`;
 box.querySelector('[data-manage-project-agents]').onclick=()=>{S.projTab[p.id]='access';route();setTimeout(()=>document.querySelector('.ac-agents')?.scrollIntoView({block:'center',behavior:'smooth'}),300);};
 }catch(e){box.textContent='Could not load agents: '+e.message;}
}
