/* A topology view, not invented telemetry: solid lines are coordinator links;
   dashed lines are shared project scope; pulses represent observed task updates. */
(() => {
 'use strict';
 const mounts=new Map(),colors=['#a58bfa','#63d7dc','#edb870','#ee93bd','#87d7af','#80b8ff','#e4d77b','#b99cab'];
 const h=(t,c,text)=>{const e=document.createElement(t);e.className=c||'';if(text!==undefined)e.textContent=text;return e;};
 const sv=(t,a)=>{const e=document.createElementNS('http://www.w3.org/2000/svg',t);for(const[k,v]of Object.entries(a))e.setAttribute(k,v);return e;};
 function render(root,team,compact){
  const previous=root.querySelector('select')?.value||'',selection=root.dataset.selection||'',oldScroll=root.querySelector('.an-scroll'),scrollX=oldScroll?.scrollLeft||0,scrollY=oldScroll?.scrollTop||0;
  const focused=root.contains(document.activeElement)?document.activeElement.dataset.agentId:null;
  const items=window.JarvisWatch?.items?.()||[],all=[...team.agents];
  for(const it of items)if(it.agent?.id&&!all.some(a=>a.id===it.agent.id))all.push({...it.agent,project:it.project});
  const main=all.find(a=>a.main)||all.find(a=>a.id==='kim');if(!main){root.textContent='Main agent is not configured.';return;}
  const scope=a=>a.project==='studys'&&String(a.name).includes(' · ')?a.project+' / '+a.name.split(' · ')[0]:a.project;
  const projects=[...new Set(all.map(scope).filter(Boolean))];
  root._wireObserver?.disconnect();root.replaceChildren();root.classList.add('an-panel');root.classList.toggle('an-compact',!!compact);
  const head=h('div','an-heading'),intro=h('div');intro.append(h('strong','','Agent constellation'),h('small','','Your coordinator, specialists and live tasks'));head.append(intro);
  const filter=h('select');filter.setAttribute('aria-label','Filter agents by project');filter.append(new Option('All projects',''));for(const p of projects)filter.append(new Option(p,p));filter.value=projects.includes(previous)?previous:'';filter.onchange=()=>{root.dataset.fit='false';render(root,team,compact);};head.append(filter);if(!compact){const fit=h('button','btn sm',root.dataset.fit==='true'?'Actual size':'Fit workflow');fit.onclick=()=>{root.dataset.fit=String(root.dataset.fit!=='true');render(root,team,compact);};head.append(fit);}root.append(head);
  const specialists=all.filter(a=>a!==main&&(!filter.value||scope(a)===filter.value));if(!filter.value)specialists.sort((a,b)=>(scope(a)||'Shared services').localeCompare(scope(b)||'Shared services'));const agents=[main,...specialists];
  const scopes=[...new Set(all.filter(a=>a!==main).map(a=>scope(a)||'Shared services'))];const projectColor=a=>colors[scopes.indexOf(scope(a)||'Shared services')%colors.length];
  const leads=agents.filter(a=>a.project==='studys'&&(a.role==='Course lead'||/^study-.+-lead$/.test(a.id)));
  const parent=a=>{if(a===main)return null;const explicit=agents.find(b=>b.id===a.reportsTo);if(explicit&&explicit!==a)return explicit;return leads.find(l=>l!==a&&a.id.startsWith(l.id.replace(/-lead$/,'')+'-'))||main;};
  const status=a=>{const own=items.filter(i=>i.agent.id===a.id),it=own.find(i=>['running','planning'].includes(i.status))||own.find(i=>['waiting','awaiting_approval','queued'].includes(i.status))||own[0];return {it,active:!!it&&['running','planning'].includes(it.status),label:a.enabled===false?(a.mergedInto?'Replaced':'Disabled'):it?({running:'Working',planning:'Planning',waiting:'Needs input',awaiting_approval:'Awaiting approval',queued:'Queued',done:'Idle · task finished',failed:'Task failed',cancelled:'Idle'}[it.status]||it.status):'Idle'};};
  const working=agents.filter(a=>status(a).active).length;
  const legend=h('div','an-legend');legend.append(h('span','',working?working+' working':'Agents are idle'),h('span','','— Coordinator link'),h('span','','┄ Shared project'),h('span','','● Pulse = task event'));if(!compact){for(const key of scopes.filter(key=>!filter.value||key===filter.value)){const label=h('span','an-project-key',key.replace(/^studys \/ /,''));label.style.color=colors[scopes.indexOf(key)%colors.length];legend.append(label);}}root.append(legend);
  const scroll=h('div','an-scroll'),stage=h('div','an-stage');scroll.tabIndex=0;scroll.setAttribute('aria-label','Agent workflow: swipe to explore, or use Go to agent');
  // A shared world-space layout: Fit changes only zoom, never agent positions.
  const cols=compact?2:6,width=compact?480:1440;
  const points=agents.map(()=>({x:width/2,y:85}));let nextY=250;
  const direct=agents.slice(1).filter(a=>!leads.includes(a)&&parent(a)===main);
  direct.forEach((a,j)=>{const row=Math.floor(j/cols),count=Math.min(cols,direct.length-row*cols);points[agents.indexOf(a)]={x:width/count*(.5+j%cols),y:nextY+row*170};});
  nextY+=Math.ceil(direct.length/cols)*170;
  // Course leads sit beside each other, with their own specialists beneath them.
  const leadCols=compact?1:Math.min(2,leads.length||1);let bottom=nextY;
  for(let row=0;row<Math.ceil(leads.length/leadCols);row++){
   const group=leads.slice(row*leadCols,(row+1)*leadCols),laneWidth=width/group.length;let rowBottom=nextY;
   group.forEach((lead,i)=>{const origin=i*laneWidth;points[agents.indexOf(lead)]={x:origin+laneWidth/2,y:nextY};
    const children=agents.filter(a=>a!==main&&parent(a)===lead),childCols=compact?2:3;
    children.forEach((a,j)=>{const r=Math.floor(j/childCols),count=Math.min(childCols,children.length-r*childCols);points[agents.indexOf(a)]={x:origin+laneWidth/count*(.5+j%childCols),y:nextY+170+r*170};});
    rowBottom=Math.max(rowBottom,nextY+170+Math.ceil(children.length/childCols)*170);
   });nextY=rowBottom+60;bottom=nextY;
  }
  const height=Math.max(350,bottom);stage.style.width=width+'px';stage.style.height=height+'px';
  const wires=sv('svg',{viewBox:`0 0 ${width} ${height}`,'aria-hidden':'true'});stage.append(wires);
  agents.slice(1).forEach((a,j)=>{const i=j+1,p=points[i],q=points[agents.indexOf(parent(a))],s=status(a),path=`M ${q.x} ${q.y+35} C ${q.x} ${p.y-80}, ${p.x} ${p.y-90}, ${p.x} ${p.y-38}`;
   const wire=sv('path',{d:path,class:'an-wire','data-from':parent(a).id,'data-to':a.id});wire.style.stroke=projectColor(a);wire.style.opacity='.48';wires.append(wire);
   const event=s.it?.feed?.at(-1),recent=event&&Date.now()-event.at<15000;
   if(recent){const line=sv('path',{d:path,class:'an-pulse'});line.style.stroke=projectColor(a);wires.append(line);}
   const peer=agents.findIndex((b,k)=>k>0&&k<i&&scope(a)&&scope(b)===scope(a));if(peer>0&&parent(a)===main&&!leads.includes(a)){const b=points[peer];wires.append(sv('path',{d:`M ${b.x} ${b.y} Q ${(b.x+p.x)/2} ${Math.max(b.y,p.y)+50} ${p.x} ${p.y}`,class:'an-shared',style:'stroke:'+projectColor(a)+';opacity:.5'}));}
  });
  const detail=h('div','an-detail');detail.setAttribute('aria-live','polite');
  agents.forEach((a,i)=>{const p=points[i],s=status(a),card=h('button','an-node'+(i===0?' an-main':'')+(s.active?' is-working':''));card.type='button';card.style.left=p.x+'px';card.style.top=p.y+'px';card.style.setProperty('--an-color',/^#[0-9a-f]{3,8}$/i.test(a.color)?a.color:colors[i%colors.length]);card.dataset.agentId=a.id;if(parent(a))card.dataset.reportsTo=parent(a).id;
   card.append(h('span','an-symbol',a.glyph||'✦'),h('strong','',a.name||a.id),h('small','',s.label));if(leads.includes(a)){card.classList.add('an-course-lead');card.append(h('small','an-report-label','Course lead · reports to User'));}card.querySelector('.an-symbol').dataset.shape=a.iconShape||'rounded';card.querySelector('.an-symbol').style.setProperty('--agent-color',a.color||'#2dd4ee');if(i===0&&(!a.glyph||a.glyph==='✦')){const icon=card.querySelector('.an-symbol');icon.classList.add('an-spirit');icon.textContent='';for(const cls of ['spirit-wing left','spirit-wing right','spirit-core','spirit-eyes'])icon.append(h('i',cls));}window.JarvisCharacters?.paint(card.querySelector('.an-symbol'),a);card.title=s.it?.title||a.role||'';card.setAttribute('aria-pressed',String(selection===a.id));
   card.onclick=(event)=>{root.dataset.selection=a.id;for(const c of stage.querySelectorAll('button'))c.setAttribute('aria-pressed',String(c===card));detail.replaceChildren(h('strong','',a.name||a.id),h('p','',a.role||'Project specialist'),h('p','',s.it?.title||'No current task'));
    const edit=h('button','btn sm','Edit name & appearance');edit.onclick=()=>window.editAgentDetails?.(a.id);detail.append(edit);
    if(a.enabled===false){
     const replacement=all.find(other=>other.id===a.mergedInto);
     detail.append(h('p','',replacement?'This older agent was replaced by '+replacement.name+'. Its tasks are routed to that agent; it does not need to be enabled.':'This agent is switched off. Open its settings to review its setup and enable it when ready.'));
     const manage=h('a','btn sm',replacement?'Open replacement agent':'Review agent settings');manage.href='#/team/'+encodeURIComponent(replacement?.id||a.id);detail.append(manage);
    }
    if(s.it){detail.append(h('p','',s.it.assignedBy==='kim'?'Assigned by User Assistant':s.it.assignedBy==='user'?'Assigned by you':'Source: '+(s.it.assignedBy||s.it.source||'saved work')));for(const e of (s.it.feed||[]).slice(-3))detail.append(h('small','an-event',new Date(e.at).toLocaleTimeString()+' · '+e.text));const open=h('button','btn sm','Open task');open.onclick=()=>window.JarvisWatch?.open(s.it.id);detail.append(open);}
    else detail.append(h('small','','Connected to User Assistant for coordination. No communication event recorded.'));if(event&&!compact)window.JarvisTeamWorkspace?.open(a.id);};stage.append(card);if(selection===a.id)card.onclick();
  });
  if(!compact&&root.dataset.homeLive!=='true'){
   const nav=h('div','an-navigation'),jump=h('select');jump.setAttribute('aria-label','Go to agent');jump.append(new Option('Go to agent…',''));agents.forEach(a=>jump.append(new Option(a.name||a.id,a.id)));
   jump.onchange=()=>{if(!jump.value)return;root.dataset.fit='false';const id=jump.value;render(root,team,compact);const port=root.querySelector('.an-scroll'),node=root.querySelector('[data-agent-id="'+CSS.escape(id)+'"]');if(node&&port){const n=node.getBoundingClientRect(),r=port.getBoundingClientRect();port.scrollTo({left:port.scrollLeft+n.left-r.left-(port.clientWidth-n.width)/2,top:port.scrollTop+n.top-r.top-(port.clientHeight-n.height)/2,behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth'});node.focus({preventScroll:true});}};
   nav.append(jump,h('small','','Fit for overview · choose an agent for a closer look · swipe to explore'));root.append(nav);
  }
  const overview=false;
  if(!compact){
   const controls=h('div','an-preview-controls'),target=h('select');target.setAttribute('aria-label','Animation destination agent');
   agents.slice(1).forEach(a=>target.append(new Option((scope(a)||'Shared')+' · '+a.name,a.id)));
   const play=h('button','btn sm','✦ Preview assignment'),follow=h('label','an-follow'),check=h('input');check.type='checkbox';check.checked=true;follow.append(check,document.createTextNode('Follow guide'));
   const notice=h('small','','Preview only · no task is created');notice.setAttribute('role','status');
   play.disabled=!target.options.length;const scene=h('select');scene.setAttribute('aria-label','Preview scene');scene.append(new Option('High-five handoff','handoff'),new Option('Team brainstorm · demo','teamwork'));play.onclick=()=>window.JarvisAssignmentPreview?.(root,target.value,check.checked,notice,play,scene.value);
   controls.append(target,scene,play,follow,notice);if(root.dataset.homeLive!=='true'&&matchMedia('(max-width:800px)').matches){const drawer=h('details','an-preview-drawer');drawer.append(h('summary','','Animation preview'),controls);head.after(drawer);}else head.after(controls);
  }
  scroll.classList.toggle('an-overview-scroll',overview);scroll.append(stage);root.append(scroll,detail);if(root.dataset.fit==='true'&&!compact&&!overview){const scale=Math.min(1,scroll.clientWidth/width,Math.max(0.08,(scroll.clientHeight-16)/height));stage.style.zoom=scale;}scroll.scrollLeft=scrollX;scroll.scrollTop=scrollY;if(focused)stage.querySelector('[data-agent-id="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});if(!selection)detail.append(h('small','','Select an agent for its task, assignment source and recent activity. Shared-project lines show scope, not messages.'));

 }
 window.JarvisAgentNetwork={mount(root,team,opt={}){if(!mounts.has(root))root.dataset.fit=String(!opt.compact&&root.dataset.homeLive!=='true'&&matchMedia('(max-width:800px)').matches);mounts.set(root,{team,compact:opt.compact});render(root,team,opt.compact);}};
 let pending=false;const refresh=()=>{if(pending)return;pending=true;setTimeout(()=>{pending=false;for(const[root,m]of mounts){if(!root.isConnected){mounts.delete(root);continue;}if(document.hidden||root.dataset.preview==='true')continue;render(root,m.team,m.compact);}},650);};
 window.addEventListener('jarvis:team-updated',e=>{for(const m of mounts.values())m.team=e.detail;refresh();});window.addEventListener('resize',refresh);window.addEventListener('jarvis:watch',refresh);document.addEventListener('visibilitychange',refresh);
})();
