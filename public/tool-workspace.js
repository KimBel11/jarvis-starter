/* Desktop tool workspace: real backend operations and explicitly labelled previews. */
(() => {
  const desktop = () => !!window.__jarvisDesktop || matchMedia('(min-width: 1000px)').matches;
  let panel, current, poll, generation = 0, minimized = false, lastFocus, resizeWatch;
  const el = (s) => panel?.querySelector(s);
  function close() {
    generation++; clearTimeout(poll); resizeWatch?.disconnect(); resizeWatch=null; panel?.remove(); panel = null; current = null;
    document.body.classList.remove('tool-workspace-open', 'tool-workspace-minimized');
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
  }
  function minimize() { if (!panel) return; minimized = true; panel.classList.add('minimized'); document.body.classList.remove('tool-workspace-open'); document.body.classList.add('tool-workspace-minimized'); const button = el('[data-tw="minimize"]'); button.textContent = '+'; button.setAttribute('aria-label', 'Restore workspace'); }
  function boundPanel() {
    if(!panel)return;
    const r=panel.getBoundingClientRect(),gap=16;
    panel.style.left=Math.max(gap,Math.min(r.left,innerWidth-r.width-gap))+'px';
    panel.style.top=Math.max(gap,Math.min(r.top,innerHeight-r.height-gap))+'px';
  }
  function floating() {
    const header=el('header');header.tabIndex=0;header.setAttribute('aria-label','Move tool window. Drag or use arrow keys.');
    let drag;
    header.addEventListener('pointerdown',e=>{if(e.target.closest('button,input')||e.button!==0)return;const r=panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};header.setPointerCapture(e.pointerId);});
    header.addEventListener('pointermove',e=>{if(!drag)return;panel.style.left=(drag.left+e.clientX-drag.x)+'px';panel.style.top=(drag.top+e.clientY-drag.y)+'px';boundPanel();});
    const end=()=>{drag=null;};header.addEventListener('pointerup',end);header.addEventListener('pointercancel',end);header.addEventListener('lostpointercapture',end);
    header.addEventListener('keydown',e=>{if(e.target!==header)return;const d={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[e.key];if(!d)return;e.preventDefault();const r=panel.getBoundingClientRect();panel.style.left=r.left+d[0]+'px';panel.style.top=r.top+d[1]+'px';boundPanel();});
    resizeWatch=new ResizeObserver(boundPanel);resizeWatch.observe(panel);boundPanel();
  }
  function message(text, bad = false) { const node = el('.tw-status'); if (node) { node.textContent = text; node.classList.toggle('error', bad); } }
  function shell(kind) {
    lastFocus = document.activeElement;
    panel = document.createElement('aside'); panel.id = 'toolWorkspace'; panel.setAttribute('aria-label', 'Jarvis tool workspace');
    panel.innerHTML = `<header><div><span class="tw-eyebrow">JARVIS WORKSPACE</span><h2>${kind === 'blender' ? 'Blender studio' : 'iPhone Simulator'}</h2></div><button class="btn sm" data-tw="minimize" aria-label="Minimize workspace">−</button><button class="btn sm" data-tw="close" aria-label="Close workspace">×</button></header><div class="tw-body"><p class="tw-status" role="status">Connecting…</p><div class="tw-controls"></div><div class="tw-preview"></div><p class="tw-note"></p></div>`;
    panel.addEventListener('click', (event) => {
      const action = event.target.closest('[data-tw]')?.dataset.tw;
      if (action === 'close') return close();
      if (action === 'minimize') { minimized = !minimized; panel.classList.toggle('minimized', minimized); document.body.classList.toggle('tool-workspace-open', !minimized); document.body.classList.toggle('tool-workspace-minimized', minimized); event.target.textContent = minimized ? '+' : '−'; event.target.setAttribute('aria-label', minimized ? 'Restore workspace' : 'Minimize workspace'); }
    });
    document.body.append(panel); document.body.classList.add('tool-workspace-open');floating();
    el('[data-tw="close"]').focus({ preventScroll: true });
  }
  async function command(action) {
    clearTimeout(poll); const token = generation, selected = { ...current }; const controls = el('.tw-controls');
    controls.querySelectorAll('button,select').forEach(b => b.disabled = true);
    message(action === 'render' || action === 'convert' ? 'Processing in Blender… This can take a few minutes.' : 'Working…');
    try {
      const body = selected.kind === 'blender' ? { path: selected.path, angle: el('[name="angle"]')?.value || 'three_quarter' } : { project: selected.project };
      const result = await post('/api/' + (selected.kind === 'simulator' ? 'sim' : 'blender') + '/' + action, body);
      if (token !== generation) return;
      if (selected.kind === 'simulator') { await simulator(token); return; }
      const view = el('.tw-preview');
      if (action === 'render') { const img = document.createElement('img'); img.alt = 'Blender render preview'; img.src = '/api/blender/render-file?id=' + encodeURIComponent(result.id); view.replaceChildren(img); }
      if (action === 'convert') { await mountViewer(view, '/api/blender/model?id=' + encodeURIComponent(result.id), selected.path.split('/').pop()); }
      if (action === 'inspect') { const pre = document.createElement('pre'); pre.textContent = JSON.stringify(result, null, 2); view.replaceChildren(pre); }
      message('Ready · source file unchanged');
    } catch (error) { if (token === generation) message(error.message, true); }
    finally { if (token === generation) controls.querySelectorAll('button,select').forEach(b => b.disabled = false); }
  }
  async function simulator(token) {
    clearTimeout(poll);
    const result = await api('/api/sim/status?project=' + encodeURIComponent(current.project));
    if (token !== generation) return;
    if (result.error || !result.enabled) throw new Error(result.error || 'This project has no configured Simulator app. Configure its app in the project first.');
    message(`${result.app} · ${result.device.name} · ${result.running ? 'Running' : result.booted ? 'App closed' : 'Simulator off'}`);
    el('.tw-controls').innerHTML = `<button class="btn primary" data-action="open">Launch app</button><button class="btn" data-action="stop" ${result.running ? '' : 'disabled'}>Stop app</button><button class="btn" data-action="install" ${result.buildAvailable ? '' : 'disabled'}>Install latest build</button><button class="btn" data-action="build" ${result.canBuild && !result.build?.running ? '' : 'disabled'}>${result.build?.running ? 'Building…' : 'Build app'}</button><label>Device<select name="device">${result.devices.map(d => `<option value="${esc(d.udid)}" ${d.udid === result.device.udid ? 'selected' : ''}>${esc(d.name)} · ${esc(d.runtime)}</option>`).join('')}</select></label>`;
    el('[name="device"]').onchange = async event => { try { await post('/api/sim/device', { project: current.project, udid: event.target.value }); if (token === generation) await simulator(token); } catch (error) { if(token === generation) message(error.message, true); } };
    const view = el('.tw-preview');
    if (result.booted) { let img = view.querySelector('img'); if (!img) { img = document.createElement('img'); img.alt = 'Simulator screenshot preview'; img.className = 'tw-phone'; view.replaceChildren(img); } img.onerror = () => message('Screenshot unavailable. Check the Simulator connection in Settings.', true); img.src = '/api/sim/shot?project=' + encodeURIComponent(current.project) + '&t=' + Date.now(); }
    else view.textContent = 'Launch the app to see its screen here.';
    el('.tw-note').textContent = 'Screenshot preview refreshes every 5 seconds. Launch, build and install run in the background. Touch and keyboard input are not supported in this preview.';
    bindActions();
    const refresh = () => {
      if (token !== generation) return;
      if (document.hidden || minimized) { poll = setTimeout(refresh, 5000); return; }
      simulator(token).catch(error => { if (token === generation) message(error.message, true); });
    };
    poll = setTimeout(refresh, 5000);
  }
  function bindActions() { el('.tw-controls').querySelectorAll('[data-action]').forEach(button => button.onclick = () => command(button.dataset.action)); }
  async function open(kind, options = {}) {
    if (!['blender', 'simulator'].includes(kind)) throw new Error('Unsupported tool workspace');
    if (!desktop()) return { background: true };
    if (window.__jarvisDesktop) document.body.classList.add('native-tool-host');
    close(); minimized = false; current = { ...options, kind }; shell(kind);
    window.dispatchEvent(new CustomEvent('jarvis:tool-open', { detail: { kind } }));
    const token = generation;
    try {
      if (kind === 'simulator') return await simulator(token);
      const status = await api('/api/blender/status'); if (token !== generation) return;
      message(status.installed ? `${status.version || 'Blender'} · ${status.busy || 'Ready'}` : 'Blender is not installed', !status.installed);
      el('.tw-note').textContent = 'Headless Blender tools run inside Jarvis. This is a render or interactive model preview, not the native Blender editor. Your source file is not modified.';
      if (!current.path) { el('.tw-preview').textContent = 'Choose a .blend file from your project’s 3D models to inspect, render or preview it here.'; return; }
      el('.tw-controls').innerHTML = `<div class="tw-filename">${esc(current.path.split('/').pop())}</div><button class="btn" data-action="inspect">Inspect scene</button><button class="btn primary" data-action="render">Render preview</button><button class="btn" data-action="convert">Interactive 3D</button><label>Render angle<select name="angle"><option value="three_quarter">Three quarter</option><option value="front">Front</option><option value="rear">Rear</option><option value="side">Side</option><option value="top">Top</option></select></label>`;
      bindActions(); if (!status.installed) el('.tw-controls').querySelectorAll('button').forEach(b => b.disabled = true);
    } catch (error) { if (token === generation) message(error.message, true); }
  }
  document.addEventListener('click', event => {
    const blend = event.target.closest('[data-blend]'), blenderApp = event.target.closest('#blOpen'), sim = event.target.closest('#smOpen');
    if (blend && blend.dataset.blend.startsWith('open|') || blenderApp) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (desktop()) open('blender', { path: blend?.dataset.blend.slice(5), project: window.routeArg });
      else toast('Blender tools run in the background. Use Inspect or Render image for results.');
    } else if (sim && desktop()) {
      event.preventDefault(); event.stopImmediatePropagation();
      open('simulator', { project: window.routeArg }).then(() => { if (current?.kind === 'simulator') command('open'); });
    }
  }, true);
  window.addEventListener('resize', () => { if (!desktop() && panel) close();else boundPanel(); });
  window.addEventListener('pagehide', close);
  window.JarvisTools = { open, close, minimize, get current() { return current ? { ...current } : null; } };
})();
