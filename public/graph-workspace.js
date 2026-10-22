'use strict';
// Bridge requested targets and observed tool activity into the shared 3D workspace.
(() => {
 let current=null,host=null,pending=null,stream=null,lastTarget=null,requestVersion=0,previewVersion=0,homeScene=null,homeMounting=false;
 const emitStatus=(text)=>{const el=document.querySelector('#graphActivityLabel');if(el)el.textContent=text;};
 const label=t=>t.label||t.path?.split('/').pop()||t.project||'Project workspace';
 function focus(target){if(!target)return;window.dispatchEvent(new CustomEvent('jarvis:graph-target',{detail:target}));target={...target,id:typeof target.id==='string'?target.id:undefined};if(target.status==='done'){emitStatus('Run finished · last observed target remains highlighted');return;}lastTarget=target;if(current)current.focus(target);if(!homeScene)preview(target);emitStatus((target.status==='requested'?'Requested target':target.status==='editing'?'Editing tool invoked':target.status==='searching'?'Searching':target.status==='done'?'Run finished':'Tool target')+' · '+label(target));}
 async function preview(t){const seq=++previewVersion;const box=document.querySelector('#graphFilePreview');if(!box)return;let rel=t.relativePath;const pr=(S.projects||[]).find(p=>p.id===t.project);if(!rel&&pr&&t.path?.startsWith(pr.path+'/'))rel=t.path.slice(pr.path.length+1);if(!rel||!/\.md$/i.test(rel)){box.hidden=true;return;}box.hidden=false;box.querySelector('summary').textContent='File preview · '+rel;const pre=box.querySelector('pre');pre.textContent='Loading a read-only preview…';try{const d=await api('/api/obsidian/note?project='+encodeURIComponent(t.project)+'&path='+encodeURIComponent(rel));if(seq!==previewVersion||!box.isConnected)return;pre.textContent=d.text.slice(0,6000)+(d.text.length>6000?'\n\n[Preview shortened; open the note for the full file.]':'');}catch{if(seq===previewVersion)pre.textContent='Preview unavailable. The camera target does not establish file access.';}}
 async function request(query,project){const version=++requestVersion;try{const d=await post('/api/graph-activity/focus',{query,project:project==='all'?undefined:project});if(version!==requestVersion)return;if(d.target)focus({...d.target,status:'requested'});else if(d.candidates?.length){if(!homeScene)showChoices(d.candidates);else emitStatus('Finding the matching workspace · waiting for file activity');}else emitStatus('No exact indexed target yet · waiting for file activity');}catch{emitStatus('Target lookup unavailable · your conversation continues');}}
 function showChoices(candidates){const box=document.querySelector('#graphTargetChoices');if(!box)return;box.replaceChildren();const message=document.createElement('span');message.textContent='Choose the file or project you mean:';box.appendChild(message);for(const t of candidates.slice(0,8)){const b=document.createElement('button');b.className='btn sm';b.textContent=t.label||t.path||t.project;b.onclick=()=>{focus({...t,status:'requested'});box.replaceChildren();};box.appendChild(b);}emitStatus('Several matching targets · choose one');}
 function openTarget(t){if(!t)return;if(t.path&&/\.md$/i.test(t.path)){localStorage.setItem('jarvis.obsidian.project',t.project||t.source);localStorage.setItem('jarvis.obsidian.openNote',t.relativePath || t.path);location.hash='#/obsidian';}else if(t.project){location.hash='#/project/'+encodeURIComponent(t.project);}}
 function connect(){if(stream)return;stream=new EventSource('/api/graph-activity/events');const receive=e=>{try{const d=JSON.parse(e.data);if(Array.isArray(d.events)){const recent=d.events.filter(t=>t.path||t.project).slice(-1)[0];if(recent)focus(recent);return;}const item=d.activity||d.event||d;if(item.path||item.project)focus(item);}catch{}};stream.addEventListener('activity',receive);stream.addEventListener('snapshot',e=>{try{const d=JSON.parse(e.data);const recent=(d.events||[]).filter(t=>t.path||t.project).slice(-1)[0];if(recent)focus(recent);}catch{}});stream.onmessage=receive;stream.onerror=()=>emitStatus('Activity connection reconnecting · your conversation continues');}
 async function mount(el,compact,viewOnly=false){if(current)current.dispose();host=el;current=null;pending=GraphSpace.mount(el,{compact,viewOnly,onOpen:viewOnly?undefined:openTarget});const next=await pending;if(host!==el||!el.isConnected){next.dispose();return;}current=next;if(lastTarget)focus(lastTarget);connect();if(viewOnly)syncHome();}
 function syncHome(detail){
  if(!homeScene||!homeScene.isConnected||window.JarvisScene?.active)return;
  const state=detail?.state||Jarvis.state||'idle',busy=detail?.busy??Jarvis.st.busy;
  const phone=matchMedia('(max-width:800px)').matches||/iPhone|iPod/.test(navigator.userAgent); /* the 3D workspace view is desktop-only */ const working=state==='thinking'&&!!busy; const active=working&&!phone;
  homeScene.dataset.state=state;homeScene.classList.toggle('is-thinking',active);
  const layer=homeScene.querySelector('.home-search-layer');layer.setAttribute('aria-hidden',String(!active));
  const orb=homeScene.querySelector('#homeOrbBox');orb.setAttribute('aria-label',state==='listening'?'Stop listening':state==='speaking'?'Stop voice reply':busy?'Cancel current request':'Talk to Jarvis');orb.setAttribute('aria-pressed',String(state==='listening'));
  const status=homeScene.querySelector('#homeState');status.textContent=working?'Working through your request':state==='listening'?'Listening · tap the orb to stop':state==='speaking'?'Speaking · tap to pause':state==='error'?'Let’s try that again':'Your space. One conversation away.';
  if(active&&!current&&!homeMounting){homeMounting=true;const el=homeScene.querySelector('#homeGraphHost');mount(el,true,true).catch(()=>{emitStatus('Workspace view unavailable · your conversation continues');}).finally(()=>{homeMounting=false;});}
  if(current&&host===homeScene.querySelector('#homeGraphHost')){current.setActivity?.(active?'thinking':'idle');if(active)current.resume?.();else current.pause?.();}
 }
 let homePanel=null,warmAt=0;
 function warmIndex(){if(Date.now()-warmAt<30000)return;warmAt=Date.now();setTimeout(()=>{if(homeScene&&homeScene.isConnected)fetch('/api/obsidian/graph').then(r=>r.ok?r.json():null).catch(()=>{});},1000);}
 let briefTimer=null,briefPlaying=false;
 async function refreshHomeBrief(){
  const box=document.querySelector('#homeDailyBrief');if(!box)return;
  try{const d=await api('/api/briefing');if(!box.isConnected)return;S.briefing=d.briefing;
   const ready=!!d.briefing?.spoken;
   const raw=d.briefing?.snapshotAt||d.briefing?.createdAt,stamp=raw?new Date(raw):null,valid=stamp&&Number.isFinite(stamp.getTime());
   const time=box.querySelector('time');time.hidden=!ready||!valid;
   if(ready&&valid){const sameDay=stamp.toDateString()===new Date().toDateString();const label=d.briefing.snapshotAt?'As of':'Generated';time.dateTime=stamp.toISOString();time.textContent=label+' '+(sameDay?'':stamp.toLocaleDateString([],{day:'numeric',month:'short'})+' · ')+stamp.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});time.title=stamp.toLocaleString([],{dateStyle:'full',timeStyle:'long'});time.setAttribute('aria-label',label+' '+time.title);}
   box.querySelector('small').textContent=ready?(valid?'Your daily audio briefing':'Audio briefing · generation time unavailable'):d.generating?'Preparing today’s briefing…':'Not generated yet';
   const button=box.querySelector('button');button.disabled=!ready||!!Jarvis.st.busy||Jarvis.state==='listening';
  }catch{if(box.isConnected)box.querySelector('small').textContent='Briefing unavailable · reconnecting shortly';}
 }

 PAGES.home=async function(v){
  clearInterval(briefTimer);document.body.classList.add('graph-home');
  const panelBefore=document.querySelector('#jPanel')||homePanel;if(panelBefore?.parentElement===v)document.body.appendChild(panelBefore);
  v.replaceChildren();
  const stage=null,greeting=null,form=document.createElement('form');form.id='askForm';form.className='askbar';
  form.innerHTML='<textarea id="askInput" rows="1" autocomplete="off" enterkeyhint="send" aria-label="Message Jarvis"></textarea><button type="submit" class="ask-send" aria-label="Send message"><svg class="ask-ico-send" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg><svg class="ask-ico-stop" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg></button>';
  const ask=form.querySelector('textarea'),askBtn=form.querySelector('.ask-send');
  // Grow with the text up to ~7 lines, then scroll inside the box.
  const fit=()=>{if(!ask.clientWidth)return;ask.style.height='auto';const cs=getComputedStyle(ask);ask.style.height=Math.min(ask.scrollHeight,Math.round(parseFloat(cs.lineHeight)*7+parseFloat(cs.paddingTop)+parseFloat(cs.paddingBottom)))+'px';};
  // Empty box while Jarvis is working turns the button into Stop; with text it stays a normal send.
  const sync=()=>{const has=ask.value.trim().length>0,busy=!!Jarvis.st?.busy;form.classList.toggle('has-text',has);form.classList.toggle('is-busy',busy&&!has);askBtn.disabled=!has&&!busy;askBtn.setAttribute('aria-label',busy&&!has?'Stop Jarvis':'Send message');};
  const onState=()=>{if(!form.isConnected){window.removeEventListener('jarvis:state',onState);return;}sync();};
  window.addEventListener('jarvis:state',onState);
  ask.addEventListener('input',()=>{fit();sync();});
  ask.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&e.keyCode!==229){e.preventDefault();form.requestSubmit();}});
  form.onsubmit=e=>{e.preventDefault();if(!ask.value.trim()){if(Jarvis.st?.busy)Jarvis.cancel();return;}if(Jarvis.st.agentId!=='kim')Jarvis.setAgent('kim');Jarvis.send(ask.value,false);ask.value='';fit();sync();};
  queueMicrotask(()=>{fit();sync();});
  const hero=document.createElement('section');hero.className='home-graph-hero';hero.setAttribute('aria-label','Jarvis workspace');
  hero.innerHTML='<header class="home-scene-heading"><span class="home-scene-eyebrow">YOUR PERSONAL WORKSPACE</span><h1>Good to see you, @@NAME@@.</h1><p>Ideas, projects, and everything in between.</p></header><div class="home-scene-visual"><div class="home-orb-layer"><button type="button" id="homeOrbBox" class="home-premium-orb" aria-label="Talk to Jarvis"><canvas id="homeOrb" aria-hidden="true"></canvas><span class="home-orb-ring" aria-hidden="true"></span></button><span class="home-orb-name">JARVIS</span></div><div class="home-search-layer" aria-hidden="true"><div id="homeGraphHost"></div><div class="home-scan-line" aria-hidden="true"></div><div class="home-search-caption"><span class="graph-live-dot"></span><span id="graphActivityLabel">Working through your request</span></div></div></div><div class="home-scene-status" id="homeState" role="status">Your space. One conversation away.</div><div class="home-scene-compose"></div><div class="home-scene-footnote">Tap the orb to speak, or start with a message.</div>';
  if(stage)stage.replaceWith(hero);else v.prepend(hero);greeting?.remove();
  if(form){hero.querySelector('.home-scene-compose').appendChild(form);form.classList.remove('big');const mic=form.querySelector('#askMic');if(mic)mic.remove();const input=form.querySelector('textarea');input.placeholder='What would you like to work on?';input.setAttribute('aria-label','Message Jarvis');}
  homeScene=hero;new Orb(hero.querySelector('#homeOrb'));hero.querySelector('#homeOrbBox').onclick=()=>Jarvis.orbTap();
  // Keep the transcript in document flow so it never covers the workspace on a phone.
  const panel=document.querySelector('#jPanel')||homePanel;if(panel){homePanel=panel;hero.insertAdjacentElement('afterend',panel);}
  const brief=document.createElement('section');brief.id='homeDailyBrief';brief.className='home-daily-brief';brief.setAttribute('aria-label','Daily audio briefing');
  brief.innerHTML='<div class="brief-copy"><div class="brief-heading"><span>Today’s brief</span><time hidden></time></div><small>Checking today’s update…</small></div><button type="button" class="btn" disabled aria-label="Listen to today’s briefing">▶ Listen</button>';
  v.appendChild(brief);brief.querySelector('button').onclick=()=>{if(briefPlaying){briefPlaying=false;Jarvis.cancel();}else if(S.briefing?.spoken&&!Jarvis.st.busy){briefPlaying=true;Jarvis.say(S.briefing.spoken);}brief.querySelector('button').textContent=briefPlaying?'■ End briefing':'▶ Listen';};
  refreshHomeBrief();briefTimer=setInterval(()=>{if(brief.isConnected)refreshHomeBrief();else{clearInterval(briefTimer);briefTimer=null;}},60000);
  syncHome();connect();warmIndex();
 };
 window.addEventListener('jarvis:state',e=>{syncHome(e.detail);const b=document.querySelector('#homeDailyBrief button');if(!b)return;if(briefPlaying&&['idle','listening','error'].includes(e.detail.state)){briefPlaying=false;b.textContent='▶ Listen';}b.disabled=!S.briefing?.spoken||!!e.detail.busy||e.detail.state==='listening';});
 PAGES.graph=async function(v){homeScene=null;document.body.classList.remove('graph-home');v.innerHTML='<section class="graph-page"><header class="kn-heading"><div><span class="kn-eyebrow">YOUR CONNECTED WORKSPACE</span><h1>Obsidian</h1><p>Explore your projects and connected files in 3D.</p></div><nav class="kn-tabs" aria-label="Knowledge views"><a href="#/obsidian">Notes</a><a href="#/graph" aria-current="page">3D Graph</a></nav></header><div class="graph-activity-line"><span class="graph-live-dot"></span><span id="graphActivityLabel" role="status">3D workspace · select a project or file</span></div><div id="graphTargetChoices" class="graph-target-choices"></div><div id="fullGraphHost"></div><details id="graphFilePreview" class="graph-file-preview" hidden><summary>File preview</summary><p>Read-only workspace preview. This does not confirm the agent read the file.</p><pre></pre></details></section>';await mount(v.querySelector('#fullGraphHost'),false);};
 window.addEventListener('jarvis:graph-request',e=>request(e.detail.query,e.detail.project));
 window.addEventListener('jarvis:graph-focus',e=>focus(e.detail));
 new MutationObserver(()=>{if(window.JarvisScene?.active)return;if(homePanel&&!homePanel.isConnected)document.body.appendChild(homePanel);if(host&&!host.isConnected){if(current)current.dispose();current=null;host=null;homeMounting=false;}if(homeScene&&!homeScene.isConnected){homeScene=null;const panel=document.querySelector('#jPanel')||homePanel;if(panel&&!panel.isConnected)document.body.appendChild(panel);}if(location.hash!=='#/home'&&location.hash!=='#/'&&location.hash!==''){document.body.classList.remove('graph-home');const panel=document.querySelector('#jPanel');if(panel&&panel.parentElement!==document.body)document.body.appendChild(panel);}}).observe(document.querySelector('#view'),{childList:true,subtree:true});
 window.GraphWorkspace={focus,request};
})();
