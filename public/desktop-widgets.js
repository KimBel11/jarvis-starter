/* Read-only desktop cards. The desktop layout owns placement and removal. */
(() => {
 'use strict';
 const types=[{id:'notifications',label:'Notifications',description:'Recent alerts across Jarvis, your agents and projects.'},{id:'study',label:'Study calendar',description:'Your saved sessions, grouped by course, with a monthly calendar.'},{id:'social',label:'Social posting',description:'Scheduled, published and failed posts from your posting queue.'},{id:'agents',label:'Agent network',description:'Your agent roster and current task activity.'},{id:'projects',label:'Projects',description:'Quick access to your registered projects.'},{id:'clock',label:'Local time',description:'A quiet clock using this device’s timezone.'}];
 const instances=new Set(),cache=new Map();let flight=null,sequence=0,last=0;
 const media=matchMedia('(min-width:801px)');
 const node=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
 const svg=(tag,attrs={})=>{const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));return e;};
 function graph(){const s=svg('svg',{viewBox:'0 0 280 100','aria-hidden':'true',focusable:'false'});s.classList.add('dw-graphic');return s;}
 function text(body,message){body.append(node('p','dw-message',message));}
 function stamp(card,when){card.querySelector('.dw-updated').textContent=when?'Updated '+new Date(when).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';}
 function social(body,d){
  if(!Array.isArray(d.queue))throw Error('Posting data unavailable');
  const counts=['scheduled','published','failed'].map(status=>d.queue.filter(x=>x.status===status).length),max=Math.max(1,...counts),g=graph();
  ['Scheduled','Published','Failed'].forEach((label,i)=>{const x=12+i*92;g.append(svg('rect',{x,y:88-counts[i]/max*65,width:62,height:Math.max(0,counts[i]/max*65),rx:7,fill:['var(--cyan)','var(--good)','#de8c94'][i],opacity:.7}));g.append(svg('line',{x1:x,y1:89,x2:x+62,y2:89,stroke:'var(--line2)'}));});body.append(g);
  const stats=node('div','dw-stats');['Scheduled','Published','Failed'].forEach((label,i)=>{const c=node('div');c.append(node('strong','',String(counts[i])),node('span','',label));stats.append(c);});body.append(stats);
  text(body,d.queue.length?(d.config?.dry_run?'Dry-run mode · saved queue totals':'Saved posting queue totals'):'No posts in the queue yet');
  const a=node('a','dw-small-link','Open posting queue ↗');a.href='#/queue';body.append(a);
 }
 const palette=['#76d9ec','#bb9cf3','#f1bd76','#7bd5ad','#ed9bb4'];
 function accent(value,fallback){return typeof value==='string'&&/^#[0-9a-f]{3,8}$/i.test(value)?value:fallback;}
 function agents(body,d){
  if(!Array.isArray(d.agents))throw Error('Agent data unavailable');
  /* Live state comes from the watcher stream (tasks and study work, updated every second); /api/team is the fallback. */
  const live=new Map();for(const i of window.JarvisWatch?.items?.()||[]){if(!['queued','planning','running','awaiting_approval','waiting'].includes(i.status))continue;const l=live.get(i.agent.id)||[];l.push(i);live.set(i.agent.id,l);}
  const all=[...d.agents];for(const [id,l] of live)if(!all.some(a=>a.id===id))all.push({id,name:l[0].agent.name,color:l[0].agent.color});
  const stateOf=a=>{const l=live.get(a.id);if(l){const run=l.find(i=>['planning','running'].includes(i.status));if(run)return {s:'working',item:run};const wait=l.find(i=>['awaiting_approval','waiting'].includes(i.status));if(wait)return {s:'waiting',item:wait};return {s:'queued',item:l[0]};}
   if(['running','planning'].includes(a.status?.current?.status))return {s:'working',title:a.status.current.title};if(a.status?.state==='waiting')return {s:'waiting'};if(a.status?.queued>0)return {s:'queued'};return {s:'idle'};};
  const states=new Map(all.map(a=>[a,stateOf(a)])),rank={working:0,waiting:1,queued:2,idle:3};
  all.sort((a,b)=>rank[states.get(a).s]-rank[states.get(b).s]);
  const working=all.filter(a=>states.get(a).s==='working'),waitingList=all.filter(a=>states.get(a).s==='waiting'),queuedList=all.filter(a=>states.get(a).s==='queued');
  const summary=node('div','dw-agent-summary');summary.classList.toggle('is-working',working.length>0||!!window.Jarvis?.st?.busy);
  const parts=[];if(working.length)parts.push(working.length+' working');if(waitingList.length)parts.push(waitingList.length+' awaiting you');if(queuedList.length)parts.push(queuedList.length+' queued');
  summary.append(node('span','dw-live-dot'),node('strong','',parts.length?parts.join(' · '):window.Jarvis?.st?.busy?'Jarvis is working':'No active assigned tasks'));body.append(summary);
  const g=graph();g.classList.add('dw-network-map');const points=[...working,...all.filter(a=>!working.includes(a))].slice(0,8);points.forEach((a,i)=>{const angle=i*Math.PI*2/Math.max(1,points.length),x=140+Math.cos(angle)*100,y=50+Math.sin(angle)*32,busy=working.includes(a),color=accent(a.color,palette[i%palette.length]);g.append(svg('line',{x1:140,y1:50,x2:x,y2:y,stroke:busy?color:'var(--line2)','stroke-width':busy?1.5:1,opacity:busy?.8:.5}));const dot=svg('circle',{cx:x,cy:y,r:busy?5:3,fill:busy?color:'var(--muted)',opacity:busy?1:.45});if(busy)dot.classList.add('dw-network-active');g.append(dot);});g.append(svg('circle',{cx:140,cy:50,r:10,fill:'var(--panel2)',stroke:working.length?'var(--cyan)':'var(--line2)','stroke-width':1.5}));body.append(g);
  const network=node('div','dw-agent-network');
  [...working,...all.filter(a=>!working.includes(a))].slice(0,8).forEach((a,i)=>{
   const st=states.get(a),busy=st.s==='working',waiting=st.s==='waiting',link=node('a','dw-agent-node'+(busy?' is-working':'')+(waiting?' is-waiting':''));link.href='#/team';link.style.setProperty('--agent-color',accent(a.color,palette[i%palette.length]));
   const task=st.item?.title||st.title||'',name=a.name||a.id,status=busy?(task||'Working'):waiting?(st.item?.status==='waiting'?'Needs your input':'Awaiting approval'):st.s==='queued'?'Queued'+(task?' · '+task:''):'Idle';link.title=name+' · '+status;link.setAttribute('aria-label',name+' · '+status+(st.item?'. Opens the live window':''));
   if(st.item)link.onclick=e=>{if(window.JarvisWatch?.open(st.item.id))e.preventDefault();};
   const info=node('span','dw-agent-info');info.append(node('strong','',name),node('span','',status));link.append(node('span','dw-agent-avatar',String(name).trim().slice(0,1).toUpperCase()),info,node('span','dw-live-dot'));network.append(link);
  });body.append(network);
  text(body,all.length+' agents'+(waitingList.length?' · '+waitingList.length+' awaiting you':'')+(queuedList.length?' · '+queuedList.length+' queued':'')+(all.length>8?' · showing 8':''));
  if(!all.length)text(body,'No agents configured');
  if(working.length&&window.Jarvis?.st?.busy)text(body,'Jarvis is also handling your conversation');
 }
 function projects(body,d){
  if(!Array.isArray(d.projects))throw Error('Project data unavailable');
  if(!d.projects.length){text(body,'No projects registered yet');return;}
  const list=node('div','dw-projects');d.projects.slice(0,6).forEach((p,i)=>{const a=node('a','dw-project');a.href='#/project/'+encodeURIComponent(p.id);a.style.setProperty('--project-color',accent(p.color,palette[i%palette.length]));const info=node('span','dw-project-info');info.append(node('strong','',p.name||p.id),node('span','',p.description||'Open workspace'));a.append(node('span','dw-project-monogram',String(p.name||p.id).trim().slice(0,2).toUpperCase()),info,node('span','dw-arrow','↗'));list.append(a);});body.append(list);if(d.projects.length>6)text(body,'+'+(d.projects.length-6)+' more in Projects');
 }

 function notifications(body,d){
  if(!Array.isArray(d.notifications))throw Error('Notifications unavailable');
  text(body,d.unread?d.unread+' unread '+(d.unread===1?'notification':'notifications'):'You’re all caught up');
  if(!d.notifications.length){text(body,'Agent and project alerts will appear here.');return;}
  const list=node('div','dw-alerts');for(const alert of d.notifications.slice(0,5)){const a=node('a','dw-alert'+(!alert.readAt?' is-unread':''));a.href=typeof alert.href==='string'&&/^#\/[a-zA-Z0-9/_?=&%.-]*$/.test(alert.href)?alert.href:'#/home';a.append(node('strong','',alert.title||'Jarvis update'),node('span','',alert.body||''));if(Number.isFinite(Number(alert.createdAt))){const time=node('time','',new Date(alert.createdAt).toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));time.dateTime=new Date(alert.createdAt).toISOString();a.append(time);}list.append(a);}body.append(list);
 }
 function isImportant(s){return /\b(exam|examination|deadline|due|submission|tentamen|inlämning)\b/i.test([s.type,s.kind,s.title].filter(Boolean).join(' '));}
 function study(body,d){
  if(!Array.isArray(d.courses))throw Error('Study calendar unavailable');
  const card=body.closest('.desktop-widget'),now=new Date(),month=new Date(now.getFullYear(),now.getMonth()+Number(card.dataset.monthOffset||0),1),courses=d.courses.filter(c=>c.status!=='retired');
  const rows=courses.flatMap(c=>(c.sessions||[]).filter(s=>!s.retiredAt&&!['retired','cancelled'].includes(s.status)&&s.sourceStatus!=='cancelled'&&Number.isFinite(Date.parse(s.at))).map(s=>({...s,course:c.name,courseId:c.id,courseColor:accent(c.color,palette[courses.indexOf(c)%palette.length])}))),confirmed=rows.filter(s=>s.sourceStatus!=='not_observed');
  const controls=node('div','dw-calendar-controls'),prev=node('button','','‹'),next=node('button','','›'),title=node('strong','',month.toLocaleDateString([],{month:'long',year:'numeric'}));
  prev.type=next.type='button';prev.setAttribute('aria-label','Previous month');next.setAttribute('aria-label','Next month');
  prev.onclick=()=>{card.dataset.monthOffset=Number(card.dataset.monthOffset||0)-1;card.dataset.selectedDay='';render(card);};next.onclick=()=>{card.dataset.monthOffset=Number(card.dataset.monthOffset||0)+1;card.dataset.selectedDay='';render(card);};controls.append(prev,title,next);body.append(controls);
  const grid=node('div','dw-calendar-grid');grid.setAttribute('aria-label',title.textContent+' study sessions');
  ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach(t=>grid.append(node('span','dw-weekday',t)));
  const pad=(month.getDay()+6)%7,days=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  for(let i=0;i<pad;i++)grid.append(node('span'));
  const selected=card.dataset.selectedDay;
  for(let day=1;day<=days;day++){const date=new Date(month.getFullYear(),month.getMonth(),day),events=confirmed.filter(s=>new Date(s.at).toDateString()===date.toDateString()),cell=node(events.length?'button':'span','dw-calendar-day',day);if(date.toDateString()===now.toDateString()){cell.classList.add('is-today');cell.setAttribute('aria-current','date');}if(events.length){cell.type='button';cell.classList.add('has-session');cell.title=events.map(s=>s.course+': '+s.title).join('\n');cell.setAttribute('aria-label',date.toLocaleDateString()+': '+cell.title);cell.setAttribute('aria-pressed',String(selected===date.toDateString()));if(selected===date.toDateString())cell.classList.add('is-selected');cell.onclick=()=>{card.dataset.selectedDay=selected===date.toDateString()?'':date.toDateString();render(card);};const dots=node('span','dw-day-dots');[...new Map(events.map(e=>[e.courseId,e])).values()].slice(0,3).forEach(e=>{const dot=node('i');dot.style.background=e.courseColor;dots.append(dot);});cell.append(dots);if(events.some(isImportant))cell.classList.add('is-important');}grid.append(cell);}body.append(grid);
  const legend=node('div','dw-calendar-legend');courses.forEach((c,i)=>{const label=node('span','',c.name),dot=node('i');dot.style.background=accent(c.color,palette[i%palette.length]);label.prepend(dot);legend.append(label);});body.append(legend);
  const upcoming=confirmed.filter(s=>Date.parse(s.at)>=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime()).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at));
  const shown=selected?confirmed.filter(s=>new Date(s.at).toDateString()===selected).sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)):upcoming;
  body.append(node('div','dw-agenda-title',selected?new Date(selected).toLocaleDateString([],{month:'long',day:'numeric'}):'Upcoming sessions'));
  if(!shown.length)text(body,courses.length?'No upcoming sessions saved. Add dates in Study modules.':'No active study modules.');
  const list=node('ul','dw-agenda');for(const session of shown.slice(0,5)){const item=node('li');item.style.setProperty('--course-color',session.courseColor);if(isImportant(session))item.classList.add('is-important');const date=new Date(session.at),time=node('time','',date.toLocaleString([],{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}));time.dateTime=date.toISOString();item.append(node('span','dw-course',session.course),node('strong','',session.title),time);if(session.prepWorkId)item.append(node('small','','Preparation requested'));list.append(item);}body.append(list);
  const uncertain=rows.filter(s=>s.sourceStatus==='not_observed'&&Date.parse(s.at)>Date.now()).length;if(uncertain)text(body,uncertain+' saved '+(uncertain===1?'date needs':'dates need')+' verification in Study modules.');
  if(shown.length>5)text(body,'+'+(shown.length-5)+' more upcoming sessions');
  if(d.project){const a=node('a','dw-small-link','Open Study modules ↗');a.href='#/project/'+encodeURIComponent(d.project);a.onclick=()=>{if(typeof S!=='undefined')S.projTab[d.project]='study';};body.append(a);}
  text(body,'Saved session dates · '+Intl.DateTimeFormat().resolvedOptions().timeZone);
 }
 function clock(body){const now=new Date(),time=node('time','dw-clock',now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}));time.dateTime=now.toISOString();body.append(time);text(body,now.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'}));text(body,Intl.DateTimeFormat().resolvedOptions().timeZone);}
 const renderers={social,agents,projects,clock,study,notifications},endpoints={notifications:'/api/notifications',study:'/api/study/program',social:'/api/socialq',agents:'/api/team',projects:'/api/projects'},links={social:'#/social',agents:'#/team',projects:'#/projects'};
 function render(card){const type=card.dataset.widgetType,body=card.querySelector('.dw-body');body.replaceChildren();if(type==='clock'){clock(body);return;}
  const value=cache.get(type);if(!value){text(body,'Loading…');return;}
  if(value.error){text(body,'Temporarily unavailable');text(body,'Open the section to check its connection.');stamp(card,null);return;}
  try{renderers[type](body,value.data);stamp(card,value.at);}catch{text(body,'Temporarily unavailable');stamp(card,null);}
 }
 function eligible(){return media.matches&&!document.hidden&&['','#/','#/home'].includes(location.hash)&&document.body.classList.contains('graph-home');}
 function visible(card){return card.isConnected&&!card.hidden&&!card.closest('.dc-hidden,[hidden]')&&card.getClientRects().length>0;}
 function live(){for(const card of instances)if(visible(card))render(card);}
 async function refresh(force=false){
  for(const card of instances)if(!card.isConnected)instances.delete(card);
  if(!eligible())return;const connected=[...instances].filter(visible);if(!connected.length){sequence++;flight?.abort();flight=null;return;}
  if(flight||!force&&Date.now()-last<20000){live();return;}last=Date.now();
  const wanted=[...new Set(connected.map(n=>n.dataset.widgetType))].filter(t=>endpoints[t]);if(!wanted.length){live();return;}
  const controller=new AbortController(),token=++sequence;flight=controller;const timeout=setTimeout(()=>controller.abort(),12000);
  try{await Promise.all(wanted.map(async type=>{try{const r=await fetch(endpoints[type],{signal:controller.signal,headers:{Accept:'application/json'}});if(!r.ok)throw Error('Unavailable');const data=await r.json();if(token===sequence&&eligible())cache.set(type,{data,at:Date.now()});}catch{if(token===sequence&&eligible())cache.set(type,{error:true});}}));if(token===sequence)live();}finally{clearTimeout(timeout);if(flight===controller)flight=null;}
 }
 function create(type){if(!renderers[type])throw Error('Unknown desktop widget');const card=node('section','desktop-widget');card.dataset.widgetType=type;card.setAttribute('aria-label',types.find(t=>t.id===type).label);
  const header=node('header','dw-header'),heading=node('h2','',types.find(t=>t.id===type).label);header.append(heading);if(links[type]){const a=node('a','dw-open','↗');a.href=links[type];a.setAttribute('aria-label','Open '+heading.textContent);header.append(a);}card.append(header,node('div','dw-body'),node('small','dw-updated'));instances.add(card);render(card);
  requestAnimationFrame(()=>refresh(true));return card;
 }
 function pause(){if(!eligible()){sequence++;flight?.abort();flight=null;}else refresh(true);}
 function localActivity(){if(eligible())for(const card of instances)if(card.dataset.widgetType==='agents'&&visible(card))render(card);}
 function notificationUpdate(event){const d=event.detail;if(!Array.isArray(d?.notifications))return;cache.set('notifications',{data:d,at:Date.now()});if(eligible())for(const card of instances)if(card.dataset.widgetType==='notifications'&&visible(card))render(card);}
 window.addEventListener('jarvis:notifications',notificationUpdate);
 let watchSig='';function watchUpdate(e){const sig=JSON.stringify((e.detail?.items||[]).map(i=>[i.id,i.status]));if(sig===watchSig)return;watchSig=sig;localActivity();}
 window.addEventListener('jarvis:watch',watchUpdate);
 const timer=setInterval(()=>refresh(),25000);window.addEventListener('jarvis:state',localActivity);document.addEventListener('visibilitychange',pause);window.addEventListener('hashchange',pause);media.addEventListener('change',pause);
 window.JarvisDesktopWidgets={types,create,refresh:()=>refresh(true),remove(card){instances.delete(card);},cleanup(){window.removeEventListener('jarvis:notifications',notificationUpdate);window.removeEventListener('jarvis:watch',watchUpdate);window.removeEventListener('jarvis:state',localActivity);clearInterval(timer);sequence++;flight?.abort();instances.clear();document.removeEventListener('visibilitychange',pause);window.removeEventListener('hashchange',pause);media.removeEventListener('change',pause);}};
})();
