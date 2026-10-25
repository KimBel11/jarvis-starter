/* The dock orb travels into a temporary conversation scene. No route is changed. */
(() => {
  let scene = null, generation = 0;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.body.dataset.motion === 'reduced';
  const duration = () => reduced() ? 1 : 1750;
  function animate(el, frames, ms = duration()) {
    const a = el.animate(frames, {duration:ms,easing:'cubic-bezier(.4,0,.2,1)',fill:'both'});
    scene?.animations.push(a); return a;
  }
  function box(el) { const r=el.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,size:r.width}; }
  function transform(b) { return `translate(${b.x-120}px,${b.y-120}px) scale(${b.size/240})`; }
  function pose(s) { return box(s.flight); }
  function clean(s, restoreFocus = true) {
    if (!s || scene !== s) return;
    generation++; s.animations.forEach(a=>a.cancel());s.graph?.dispose();s.stream?.close();
    // Return the very same canvas, panel and draft to their original owners.
    s.source.append(s.canvas);s.canvas.style.cssText=s.canvasStyle;
    if(s.panelParent?.isConnected)s.panelParent.insertBefore(s.panel,s.panelNext?.parentNode===s.panelParent?s.panelNext:null);else document.body.append(s.panel);
    s.overlay.remove();s.flight.remove();s.source.classList.remove('orb-departed');
    s.inert.forEach(([el,value])=>{el.inert=value;});
    document.body.classList.remove('jarvis-scene-open');document.body.style.overflow=s.overflow;
    scene=null;Jarvis.close();
    if(restoreFocus && s.source.isConnected)s.source.focus({preventScroll:true});
  }
  async function leave(immediate = false) {
    const s=scene;if(!s)return;
    if(s.phase==='leaving'){if(immediate)clean(s,false);return;}
    s.phase='leaving';generation++;
    const from=pose(s),opacity=getComputedStyle(s.overlay).opacity;s.animations.forEach(a=>a.cancel());s.animations=[];
    if(immediate){clean(s,false);return;}
    s.overlay.classList.remove('scene-thinking');s.flight.style.opacity='1';
    const to=box(s.source);
    const flight=animate(s.flight,[{transform:transform(from),opacity:1},{transform:transform(to),opacity:1}]);
    animate(s.overlay,[{opacity:Number(opacity)},{opacity:0}],duration());
    for(const [el] of s.inert)animate(el,[{opacity:0},{opacity:1}]);
    await flight.finished.catch(()=>{});if(scene===s&&s.phase==='leaving')clean(s);
  }
  async function graph(s) {
    if(s.graph || s.mounting)return; if(matchMedia('(max-width:800px)').matches||/iPhone|iPod/.test(navigator.userAgent)){s.status.textContent='Working on it…';return;} /* 3D view is desktop-only */ s.mounting=true;const token=generation;
    try {
      const g=await GraphSpace.mount(s.overlay.querySelector('.scene-graph'),{compact:true,viewOnly:true});
      if(scene!==s||token!==generation){g.dispose();return;}
      s.graph=g;if(s.target)g.focus(s.target);sync();
    } catch { if(scene===s)s.status.textContent='Workspace view unavailable · your conversation continues'; }
    finally{s.mounting=false;}
  }
  function sync() {
    const s=scene;if(!s||s.phase==='leaving')return;
    const thinking=!!Jarvis.st.busy&&Jarvis.state==='thinking';
    s.status.textContent=thinking?'Exploring your workspace':Jarvis.state==='listening'?'Listening to you':Jarvis.state==='speaking'?'Jarvis is speaking':Jarvis.state==='error'?'Try again, or type below':'What’s on your mind?';
    s.thinking=thinking;
    // Finish the rise before introducing the workspace, even for fast requests.
    s.overlay.classList.toggle('scene-thinking',thinking&&s.phase==='open');
    s.flight.classList.toggle('scene-orb-thinking',thinking&&s.phase==='open');
    if(thinking)graph(s);
    if(s.graph){s.graph.setActivity(thinking?'thinking':'idle');thinking?s.graph.resume():s.graph.pause();}
  }
  function focus(target) { const s=scene;if(!s||s.phase==='leaving'||!target)return;s.target=target;s.graph?.focus(target); }
  function enter(source) {
    if(scene){leave();return;}
    const canvas=source.querySelector('canvas'),panel=document.getElementById('jPanel');if(!canvas||!panel)return;
    const origin=box(source),token=++generation;
    const overlay=document.createElement('section');overlay.id='jarvisScene';overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Jarvis conversation');
    overlay.innerHTML='<div class="scene-content"><div class="scene-top"><span>JARVIS</span><button type="button" class="scene-back" aria-label="Return to previous page">← Back</button></div><div class="scene-lead"></div><div class="scene-stage"><div class="scene-orb-target"></div><div class="scene-graph"></div></div><p class="scene-status" role="status"></p><div class="scene-panel"></div><small class="scene-hint">Tap the orb to pause or continue. Back keeps your conversation running.</small></div>';
    const flight=document.createElement('button');flight.id='jarvisFlightOrb';flight.type='button';flight.setAttribute('aria-label','Pause or resume Jarvis');
    const s=scene={phase:'entering',overlay,flight,source,canvas,canvasStyle:canvas.style.cssText,panel,panelParent:panel.parentNode,panelNext:panel.nextSibling,overflow:document.body.style.overflow,inert:[],animations:[],graph:null,stream:null};
    document.body.classList.remove('side-open');document.body.classList.add('jarvis-scene-open');document.body.style.overflow='hidden';
    document.body.append(overlay,flight);source.classList.add('orb-departed');
    for(const el of document.querySelectorAll('body>main,body>.side')){s.inert.push([el,el.inert]);el.inert=true;}
    flight.append(canvas);canvas.style.width='240px';canvas.style.height='240px';
    overlay.querySelector('.scene-panel').append(panel);s.status=overlay.querySelector('.scene-status');
    overlay.querySelector('.scene-back').onclick=()=>leave();flight.onclick=()=>Jarvis.orbTap();
    if(window.JarvisLead)JarvisLead.mount(overlay.querySelector('.scene-lead'));
    const destination=box(overlay.querySelector('.scene-orb-target'));
    flight.style.transform=transform(destination);
    const motion=animate(flight,[{transform:transform(origin)},{transform:transform(destination)}]);
    animate(overlay,[{opacity:0},{opacity:1}]);
    for(const [el] of s.inert)animate(el,[{opacity:1},{opacity:0}]);
    overlay.addEventListener('scroll',()=>{if(scene===s&&s.phase==='open'){s.animations.forEach(a=>{if(a.effect?.target===flight)a.cancel();});flight.style.transform=transform(box(overlay.querySelector('.scene-orb-target')));}});
    // Start audio synchronously in the user gesture, but never force a route.
    if(Jarvis.isActive())Jarvis.open(false);else Jarvis.orbTap();
    panel.hidden=false;panel.classList.add('in');sync();
    const stream=s.stream=new EventSource('/api/graph-activity/events');
    stream.addEventListener('activity',e=>{if(scene===s)try{const d=JSON.parse(e.data);focus(d.activity||d.event||d);}catch{}});
    motion.finished.then(()=>{if(scene!==s||token!==generation)return;s.phase='open';sync();if(!overlay.contains(document.activeElement))flight.focus({preventScroll:true});}).catch(()=>{});
  }
  // Carry the selected orb into Home without opening the legacy conversation scene.
  let homeFlight=null;
  function flyHome(source){
    homeFlight?.();
    const canvas=source.querySelector('canvas');if(!canvas)return;
    const origin=source.getBoundingClientRect(),copy=document.createElement('canvas');
    copy.width=canvas.width;copy.height=canvas.height;copy.getContext('2d').drawImage(canvas,0,0);
    copy.className='dock-home-flight';copy.setAttribute('aria-hidden','true');
    Object.assign(copy.style,{position:'fixed',left:origin.left+'px',top:origin.top+'px',width:origin.width+'px',height:origin.height+'px',zIndex:'450',pointerEvents:'none'});
    document.body.append(copy);let frame=0,animation=null,target=null,previous='',stopped=false;
    const cleanup=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);animation?.cancel();copy.remove();if(target)target.style.visibility=previous;source.classList.remove('orb-departed');if(homeFlight===cleanup)homeFlight=null;};
    homeFlight=cleanup;const started=performance.now();
    const locate=()=>{
      if(stopped)return;target=document.querySelector('#homeOrbBox');
      if(!document.body.classList.contains('graph-home')||!target?.getClientRects().length){if(performance.now()-started<2500)frame=requestAnimationFrame(locate);else cleanup();return;}
      const destination=target.getBoundingClientRect();previous=target.style.visibility;target.style.visibility='hidden';source.classList.add('orb-departed');
      animation=copy.animate([{transform:'translate(0,0) scale(1)',filter:'drop-shadow(0 8px 12px #0007)'},{transform:`translate(${destination.left-origin.left}px,${destination.top-origin.top}px) scale(${destination.width/origin.width},${destination.height/origin.height})`,filter:'drop-shadow(0 16px 22px #0004)'}],{duration:reduced()?1:1250,easing:'cubic-bezier(.22,.8,.2,1)',fill:'forwards'});
      copy.style.transformOrigin='0 0';animation.finished.then(cleanup).catch(cleanup);
    };frame=requestAnimationFrame(locate);
  }
  window.JarvisScene={get active(){return !!scene;},close:leave};
  document.addEventListener('click',e=>{
    const source=e.target.closest?.('#mTalk,#jFab');
    if(source){e.preventDefault();e.stopImmediatePropagation();if(matchMedia('(max-width:800px)').matches||document.body.classList.contains('graph-home')){if(scene)leave(true);const starting=!Jarvis.isActive();if(starting)flyHome(source);Jarvis.orbTap();if(!document.body.classList.contains('graph-home'))location.hash='#/home';return;}if(Jarvis.isActive() || Jarvis.st.playbackPaused){Jarvis.orbTap();return;}enter(source);return;}
    if(scene&&e.target.closest?.('#jClose')){e.preventDefault();e.stopImmediatePropagation();leave();}
  },true);
  document.addEventListener('keydown',e=>{
    if(!scene)return;
    if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();leave();}
    if(e.key==='Tab'){
      const items=[...scene.overlay.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],textarea:not(:disabled)'),scene.flight].filter(el=>el.getClientRects().length);
      const first=items[0],last=items.at(-1);
      if(e.shiftKey&&(document.activeElement===first||!items.includes(document.activeElement))){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||!items.includes(document.activeElement))){e.preventDefault();first?.focus();}
    }
  },true);
  window.addEventListener('hashchange',()=>leave(true));
  window.addEventListener('pagehide',()=>leave(true));
  window.addEventListener('resize',()=>{const s=scene;if(!s)return;if(s.phase!=='open')return;s.animations.forEach(a=>{if(a.effect?.target===s.flight)a.cancel();});s.flight.style.transform=transform(box(s.overlay.querySelector('.scene-orb-target')));});
  window.addEventListener('jarvis:state',sync);
  window.addEventListener('jarvis:graph-focus',e=>focus(e.detail));
  window.addEventListener('jarvis:graph-target',e=>focus(e.detail));
})();
