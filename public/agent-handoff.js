'use strict';
(() => {
 const seen=new Set(),known=new Set(),queue=[];let baseline=false,playing=false,started=0,contextTimer=null,hideTimer=null,panel=null,currentTask=null,epoch=0;
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
 const roster=()=>{try{return S.team?.agents||[];}catch{return [];}};
 const main=()=>roster().find(a=>a.main||a.id==='kim')||{id:'kim',name:'User Assistant',glyph:'\u2726'};
 const agent=id=>roster().find(a=>a.id===id)||{id,name:id,glyph:'\u25c8'};
 const reduced=()=>matchMedia('(prefers-reduced-motion:reduce)').matches;
 function clearHome(){window.dispatchEvent(new Event('jarvis:handoff-finished'));clearTimeout(contextTimer);clearTimeout(hideTimer);panel?.remove();panel=null;document.querySelector('.home-graph-hero')?.classList.remove('has-agent-workflow');}
 function home(task){
  const hero=document.querySelector('.home-graph-hero'),visual=hero?.querySelector('.home-scene-visual');if(!visual||!started)return;
  if(!panel?.isConnected){panel=el('section','home-agent-workflow');panel.setAttribute('aria-label','Live agent workflow');visual.append(panel);}
  hero.classList.add('has-agent-workflow');panel.replaceChildren();panel.classList.toggle('is-handoff',!!task);
  if(!task){clearHome();return;}
  const title=el('div','ah-heading','Live assignment · all projects');
  const status=el('p','ah-status',main().name+' → '+agent(task.agent).name+' · '+task.title);status.setAttribute('role','status');
  const network=el('div','home-live-network');network.dataset.homeLive='true';
  const back=el('button','btn sm','Back to orb');back.onclick=clearHome;
  panel.append(title,status,network,back);panel.dataset.taskId=task.id;
  window.JarvisAgentNetwork?.mount(network,{agents:roster()});

 }
 function flight(from,to,container){
  if(!from||!to||!container)return;
  const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();if(!a.width||!b.width)return;
  to.classList.add('ah-receiving');setTimeout(()=>to.classList.remove('ah-receiving'),3200);
  if(reduced())return;
  const icon=el('span','ah-courier',main().glyph||'\u2726');if(!main().glyph||main().glyph==='✦'||main().glyph==='\u2726'){icon.classList.add('an-spirit');icon.innerHTML='<i class="spirit-wing left"></i><i class="spirit-wing right"></i><i class="spirit-core"></i><i class="spirit-eyes"></i>';}window.JarvisCharacters?.paint(icon,main());icon.setAttribute('aria-hidden','true');document.body.append(icon);
  const x=a.x+a.width/2-18,y=a.y+a.height/2-18,dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
  icon.style.left=x+'px';icon.style.top=y+'px';
  const animation=icon.animate([{transform:'translate(0,0) scale(.75)',opacity:0},{transform:'translate(0,-12px) scale(1)',opacity:1,offset:.15},{transform:`translate(${dx*.4}px,${dy*.35-26}px)`,opacity:1,offset:.5},{transform:`translate(${dx}px,${dy}px) scale(.8)`,opacity:1,offset:.88},{transform:`translate(${dx}px,${dy}px) scale(1.5)`,opacity:0}],{duration:2200,easing:'cubic-bezier(.22,.7,.25,1)',fill:'forwards'});
  animation.finished.then(()=>{const card=to.closest('[data-agent-id]');window.JarvisCharacters?.moment(to,main(),agent(card?.dataset.agentId||'agent'));}).catch(()=>{}).finally(()=>icon.remove());setTimeout(()=>{animation.cancel();icon.remove();},2600);
 }
 function transferCard(root,task){
  const r=root.getBoundingClientRect();if(r.bottom<0||r.top>innerHeight)return;
  const card=el('div','ah-team-transfer'),source=el('span','an-symbol',main().glyph||'\u2726'),target=el('span','an-symbol',agent(task.agent).glyph||'\u25c8');
  card.style.top=Math.max(80,r.top+12)+'px';card.style.left=Math.max(12,r.left+12)+'px';card.style.width=Math.min(r.width-24,innerWidth-24,420)+'px';
  const caption=el('div','');caption.append(el('strong','',main().name+' \u2192 '+agent(task.agent).name),el('small','',task.title));target.dataset.agentId=task.agent;window.JarvisCharacters?.paint(source,main());window.JarvisCharacters?.paint(target,agent(task.agent));card.append(source,caption,target);card.setAttribute('role','status');document.body.append(card);flight(source,target,card);setTimeout(()=>card.remove(),3200);
 }
 function teamFlight(task){
  for(const root of document.querySelectorAll('.an-panel')){
   if(root.dataset.homeLive==='true'||!root.getClientRects().length)continue;
   const from=root.querySelector('[data-agent-id="kim"]'),to=root.querySelector('[data-agent-id="'+CSS.escape(task.agent)+'"]');
   if(!from||!to){transferCard(root,task);continue;}
   // Keep user scroll position and collapsed project groups unchanged.
   const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
   if(a.bottom<0||b.bottom<0||a.top>innerHeight||b.top>innerHeight||!b.height){transferCard(root,task);continue;}
   flight(from.querySelector('.an-symbol')||from,to.querySelector('.an-symbol')||to,root);
  }
 }
 function returnToOrb(expected){
  if(panel!==expected||!panel?.isConnected)return;
  const finish=()=>{if(panel!==expected)return;clearHome();if(!window.JarvisHomeReveal?.active&&window.Jarvis?.st?.open)window.Jarvis.open(false);document.body.classList.add('home-handoff-returned');const orb=document.querySelector('#homeOrbBox');if(orb&&!reduced())orb.animate([{transform:'scale(.86)',opacity:.4},{transform:'scale(1)',opacity:1}],{duration:900,easing:'cubic-bezier(.16,1,.3,1)'});};
  if(reduced()){finish();return;}
  panel.animate([{opacity:1,transform:'scale(1)'},{opacity:0,transform:'scale(1.08)',filter:'blur(7px)'}],{duration:900,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}).finished.then(finish).catch(()=>{});
 }
 function showHomeTask(task){
  const version=epoch;clearTimeout(hideTimer);currentTask=task;window.dispatchEvent(new Event('jarvis:handoff-started'));
  // Let the desktop's 3D context view establish itself before the real handoff.
  setTimeout(()=>{if(version!==epoch||!started||currentTask?.id!==task.id)return;
   home(task);const shown=panel;requestAnimationFrame(()=>{if(version===epoch&&panel?.dataset.taskId===task.id)window.JarvisAssignmentPreview?.(panel.querySelector('.home-live-network'),task.agent,true,panel.querySelector('.ah-status'),{disabled:false},'handoff',true,()=>returnToOrb(shown));});

  },Math.max(0,3200-(Date.now()-started)));
 }
 function next(){if(playing||!queue.length)return;playing=true;const task=queue.shift(),version=epoch;
  setTimeout(()=>{if(version===epoch)teamFlight(task);},800);
  if(started)showHomeTask(task);
  setTimeout(()=>{if(version!==epoch)return;playing=false;next();},13000);
 }
 function accept(task,local=false){if(!task?.id||!task.agent)return;if(seen.has(task.id)){if(local&&started&&currentTask?.id!==task.id){showHomeTask(task);}return;}seen.add(task.id);if(seen.size>300)seen.delete(seen.values().next().value);queue.push({...task,local});if(queue.length>12)queue.shift();next();}
 window.addEventListener('jarvis:assignment',e=>accept(e.detail,true));
 window.addEventListener('jarvis:watch',e=>{
  const items=e.detail?.items||[];
  for(const item of items){const fresh=!known.has(item.id);known.add(item.id);
   if(baseline&&fresh&&item.source==='task'&&item.assignedBy==='kim'&&Date.now()-item.createdAt<30000)accept({id:item.taskId,agent:item.agent.id,title:item.title,status:item.status},!!started);
   if(currentTask&&item.taskId===currentTask.id&&panel?.isConnected){const s=panel.querySelector('.ah-status');if(s)s.textContent=({queued:'Queued',planning:'Planning',running:'Working',awaiting_approval:'Waiting for your approval',failed:'Needs attention',done:'Task finished',cancelled:'Cancelled'}[item.status]||item.status)+' \u00b7 '+item.title;}
  }baseline=true;if(known.size>1000){known.clear();items.forEach(i=>known.add(i.id));}
 });
 window.addEventListener('jarvis:graph-request',()=>{epoch++;playing=false;queue.length=0;clearHome();started=Date.now();currentTask=null;});
 window.addEventListener('jarvis:context-tool',()=>{if(!started||panel||contextTimer)return;contextTimer=setTimeout(()=>{contextTimer=null;if(window.Jarvis?.st?.busy&&!currentTask)home(null);},Math.max(1100,3200-(Date.now()-started)));});
 window.addEventListener('jarvis:state',e=>{if(!e.detail?.busy&&panel&&!currentTask){clearTimeout(hideTimer);hideTimer=setTimeout(clearHome,4500);}});
 for(const name of ['jarvis:cancel','jarvis:failed','hashchange'])window.addEventListener(name,()=>{epoch++;started=0;currentTask=null;queue.length=0;clearHome();document.querySelectorAll('.ah-courier,.ah-team-transfer').forEach(n=>n.remove());});
})();

/* Explicit demonstration: never dispatches assignment events or creates tasks. */
(() => {
 let cancelCurrent=null;
 window.JarvisAssignmentPreview=async(root,id,follow,notice,button,scene='handoff',live=false,onComplete=null)=>{
  cancelCurrent?.();
  const from=root.querySelector('.an-main'),to=root.querySelector('[data-agent-id="'+CSS.escape(id)+'"]');if(!from||!to){onComplete?.();return;}
  const details=to.closest('details');if(details)details.open=true;
  let stopped=false,frame=0,figure=null;
  const stop=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);figure?.remove();to.classList.remove('ah-receiving');button.disabled=false;root.dataset.preview='';notice.textContent=live?'Live assignment · '+(to.querySelector('strong')?.textContent||id):'Preview only · no task is created';for(const name of ['wheel','touchstart','keydown','hashchange'])window.removeEventListener(name,stop);if(cancelCurrent===stop)cancelCurrent=null;if(live)onComplete?.();};
  cancelCurrent=stop;button.disabled=true;root.dataset.preview='true';notice.textContent=(live?'Assigning task · travelling to ':'Animation preview · travelling to ')+(to.querySelector('strong')?.textContent||id);
  for(const name of ['wheel','touchstart','keydown','hashchange'])window.addEventListener(name,stop,{passive:true});
  if(matchMedia('(prefers-reduced-motion:reduce)').matches){to.classList.add('ah-receiving');if(follow)to.scrollIntoView({block:'center',behavior:'instant'});setTimeout(()=>{if(!stopped){stop();if(!live)onComplete?.();}},1800);return;}
  if(follow&&root.dataset.homeLive!=='true')from.scrollIntoView({block:'center',behavior:'instant'});
  if(follow&&root.dataset.homeLive==='true'){const port=root.querySelector('.an-scroll');if(port){const r=from.getBoundingClientRect(),p=port.getBoundingClientRect();port.scrollTop+=r.top-p.top-port.clientHeight/2+r.height/2;port.scrollLeft+=r.left-p.left-port.clientWidth/2+r.width/2;}}
  await new Promise(requestAnimationFrame);if(stopped)return;
  figure=document.createElement('span');figure.className='an-spirit an-preview-spirit';figure.setAttribute('aria-hidden','true');figure.innerHTML='<i class="spirit-wing left"></i><i class="spirit-wing right"></i><i class="spirit-core"></i><i class="spirit-eyes"></i>';let coordinator={id:'kim'};try{coordinator=S.team?.agents?.find(a=>a.id==='kim')||coordinator;}catch{}window.JarvisCharacters?.paint(figure,coordinator);document.body.append(figure);
  const center=n=>{const r=n.getBoundingClientRect();return{x:r.left+r.width/2+scrollX,y:r.top+r.height/2+scrollY};};
  const a=center(from),b=center(to),start=performance.now(),port=root.querySelector('.an-scroll'),baseX=port?.scrollLeft||0,targetX=port?Math.max(0,Math.min(port.scrollWidth-port.clientWidth,baseX+to.getBoundingClientRect().left-port.getBoundingClientRect().left-port.clientWidth/2+to.offsetWidth/2)):0,baseScroll=port?.scrollTop||0,targetScroll=port?Math.max(0,Math.min(port.scrollHeight-port.clientHeight,baseScroll+to.getBoundingClientRect().top-port.getBoundingClientRect().top-port.clientHeight/2+to.offsetHeight/2)):0;
  const tick=now=>{if(stopped||!root.isConnected){stop();return;}const t=Math.min(1,(now-start)/5200),p=t*t*(3-2*t),x=a.x+(b.x-a.x)*p+Math.sin(t*Math.PI)*28,rawY=a.y+(b.y-a.y)*p-Math.sin(t*Math.PI)*42;if(follow&&port){port.scrollTop=baseScroll+(targetScroll-baseScroll)*p;port.scrollLeft=baseX+(targetX-baseX)*p;}const y=rawY-(follow&&port?port.scrollTop-baseScroll:0);
   if(follow&&root.dataset.homeLive!=='true')window.scrollTo({top:Math.max(0,y-innerHeight*.46),behavior:'instant'});
   figure.style.left=(x-scrollX-24-(follow&&port?port.scrollLeft-baseX:0))+'px';figure.style.top=(y-scrollY-24)+'px';figure.style.transform=`rotate(${Math.sin(t*Math.PI*4)*9}deg)`;
   if(t<1)frame=requestAnimationFrame(tick);else{figure.remove();to.classList.add('ah-receiving');let recipient={id};try{recipient=S.team?.agents?.find(a=>a.id===id)||recipient;}catch{}window.JarvisCharacters?.moment(to,coordinator,recipient,scene==='teamwork');notice.textContent=live?'Task assigned · '+to.querySelector('strong').textContent:'Preview complete · '+to.querySelector('strong').textContent+' received the demonstration';setTimeout(()=>{if(!stopped){stop();if(!live)onComplete?.();}},2800);}
  };frame=requestAnimationFrame(tick);
 };
})();

// Desktop replies wait for both the response and its visual journey. Keep the
// existing conversation mounted so history, drafts and voice are never reset.
(() => {
 let active=false,busy=false,handoff=false,ready=false,timer=null;
 const eligible=()=>document.body?.classList.contains('graph-home')&&matchMedia('(min-width:801px)').matches;
 const paint=()=>{
  document.body?.classList.toggle('home-awaiting-reply',active);
  const panel=document.querySelector('#jPanel');if(panel)panel.inert=active;
  window.dispatchEvent(new Event('jarvis:home-phase'));
 };
 const reset=()=>{clearTimeout(timer);active=false;busy=false;handoff=false;ready=false;paint();};
 const reveal=()=>{
  if(!active||busy||handoff||!ready)return;
  active=false;paint();
  if(eligible()){
   window.Jarvis?.open(false);
   const panel=document.querySelector('#jPanel');
   if(panel&&!matchMedia('(prefers-reduced-motion:reduce)').matches)panel.animate([{opacity:0,transform:'translateY(18px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.16,1,.3,1)'});
  }
 };
 window.JarvisHomeReveal={get active(){return active;}};
 window.addEventListener('jarvis:graph-request',()=>{
  reset();if(!eligible())return;
  active=true;busy=true;paint();
  timer=setTimeout(()=>{ready=true;reveal();},matchMedia('(prefers-reduced-motion:reduce)').matches?0:3200);
 });
 window.addEventListener('jarvis:state',e=>{busy=!!e.detail?.busy;reveal();});
 window.addEventListener('jarvis:handoff-started',()=>{if(active)handoff=true;});
 window.addEventListener('jarvis:handoff-finished',()=>{handoff=false;reveal();});
 for(const name of ['jarvis:cancel','jarvis:failed','jarvis:conversation-closing','hashchange'])window.addEventListener(name,reset);
 window.addEventListener('resize',()=>{if(active&&!eligible())reset();});
})();
