/* Keep the existing controls and their handlers; reveal them from the graph. */
(()=>{
 'use strict';
 const base=PAGES.team;let current=null,restore=[],stopTaskLayout=()=>{},taskExpanded=false;
 const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='btn sm';b.textContent=label;b.onclick=fn;return b;};
 function close(){for(const [node,parent,next] of restore){if(parent.isConnected)parent.insertBefore(node,next?.parentNode===parent?next:null);}restore=[];document.querySelector('.team-inspector')?.remove();current=null;}
 function move(node,to){if(!node)return;restore.push([node,node.parentNode,node.nextSibling]);to.append(node);}
 function open(id){
  const view=document.querySelector('#view'),a=S.team?.agents.find(a=>a.id===id);if(!a||!view?.classList.contains('team-workspace'))return;
  close();current=id;
  const panel=document.createElement('aside');panel.className='team-inspector';panel.setAttribute('role','dialog');panel.setAttribute('aria-label',a.name+' controls');panel.tabIndex=-1;
  const head=document.createElement('header'),title=document.createElement('strong');title.textContent=a.name;head.append(title,button('Close',()=>{close();view.querySelector(`[data-agent-id="${CSS.escape(id)}"]`)?.focus();}));panel.append(head);
  const content=document.createElement('div');content.className='team-inspector-content';panel.append(content);view.append(panel);
  const detail=view.querySelector('.an-detail');if(detail){const snapshot=document.createElement('div');snapshot.className='team-live-detail';for(const child of [...detail.children]){if(child.tagName==='BUTTON'){const proxy=button(child.textContent,()=>child.click());snapshot.append(proxy);}else snapshot.append(child.cloneNode(true));}content.append(snapshot);}
  move(view.querySelector(`#roster [data-agent="${CSS.escape(id)}"]`)||view.querySelector(`#myAgents [data-agent="${CSS.escape(id)}"]`),content);
  move(view.querySelector(`[data-en="${CSS.escape(id)}"]`)?.closest('.card'),content);
  if(a.main)move(view.querySelector('.briefing-control'),content);
  panel.focus({preventScroll:true});
 }
 function balanceTasks(section,tasks,guide){
  let expanded=taskExpanded,frame=0;
  const toggle=button('Show all tasks ↓',()=>{expanded=!expanded;taskExpanded=expanded;layout();});toggle.classList.add('team-task-toggle');toggle.setAttribute('aria-controls','teamTasks');section.append(toggle);
  function layout(){
   if(!section.isConnected)return;
   const rows=[...tasks.querySelectorAll('tr[data-task]')];rows.forEach(row=>row.hidden=false);
   section.style.height='';toggle.hidden=true;
   const wide=matchMedia('(min-width:1200px)').matches;
   const target=guide?.getBoundingClientRect().height||0;
   let visible=rows.length;
   if(wide&&target>180){
    const heading=section.querySelector('.sec-h');
    const headHeight=heading?heading.getBoundingClientRect().height:0;
    const available=target-headHeight-76;
    const table=tasks.querySelector('table');const origin=table?.getBoundingClientRect().top||0;
    visible=rows.filter(row=>row.getBoundingClientRect().bottom-origin<=available).length;
    visible=Math.max(1,visible);
   }else visible=Math.min(5,rows.length);
   const overflow=visible<rows.length;
   toggle.hidden=!overflow;toggle.setAttribute('aria-expanded',String(expanded));
   toggle.textContent=expanded?'Show fewer tasks ↑':`Show all ${rows.length} tasks ↓`;
   if(overflow&&!expanded){rows.slice(visible).forEach(row=>row.hidden=true);if(wide&&target>180)section.style.height=target+'px';}
  }
  function queue(){cancelAnimationFrame(frame);frame=requestAnimationFrame(layout);}
  const size=new ResizeObserver(queue);if(guide)size.observe(guide);size.observe(section.querySelector('.sec-h')||section);
  const changes=new MutationObserver(queue);changes.observe(tasks,{childList:true,subtree:true});
  window.addEventListener('resize',queue);queue();
  return ()=>{size.disconnect();changes.disconnect();window.removeEventListener('resize',queue);cancelAnimationFrame(frame);};
 }
 window.JarvisTeamWorkspace={open};
 PAGES.team=async function(v){close();stopTaskLayout();await base(v);if(!v.querySelector('#agentNetworkPanel')||v.querySelector('.team-control-store'))return;v.classList.add('team-workspace');
  const store=document.createElement('div');store.hidden=true;store.className='team-control-store';
  const roster=v.querySelector('#roster'),settings=roster?.nextElementSibling;
  // The model guide can be inserted after the roster by an existing extension.
  const settingsHead=[...v.querySelectorAll(':scope > .sec-h')].find(n=>n.querySelector('h2')?.textContent==='Agent settings');
  if(settingsHead){const grid=settingsHead.nextElementSibling;store.append(settingsHead);if(grid)store.append(grid);}
  for(const n of [roster,v.querySelector('#myAgents'),v.querySelector('.briefing-control')])if(n)store.append(n);
  v.append(store);const guide=v.querySelector('#routeGuide'),tasks=v.querySelector('#teamTasks');
  const lower=document.createElement('div');lower.className='team-lower-grid';const taskSection=document.createElement('section');taskSection.className='team-task-section';
  if(tasks){const title=tasks.previousElementSibling;if(title?.classList.contains('sec-h'))taskSection.append(title);taskSection.append(tasks);lower.append(taskSection);}if(guide)lower.append(guide);v.append(lower);if(tasks)stopTaskLayout=balanceTasks(taskSection,tasks,guide);
  const heading=v.querySelector('#agentNetworkPanel .an-heading');const create=button('＋ Create agent',()=>v.querySelector('#abNew')?.click());create.classList.add('team-create');heading?.append(create);
  // Network re-rendering may replace its toolbar; keep the create action outside it.
  const network=v.querySelector('#agentNetworkPanel');network.dataset.fit=String(matchMedia('(max-width:800px)').matches);network.before(create);
  const jumps=document.createElement('nav');jumps.className='team-mobile-jumps';jumps.setAttribute('aria-label','Agent page sections');
  for(const [label,target] of [['Agents',network],['Tasks',taskSection],['Model guide',guide]])if(target){const b=button(label,()=>target.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'instant':'smooth',block:'start'}));jumps.append(b);}
  network.before(jumps);
  if(window.routeArg)open(window.routeArg);
  requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
 };
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&current&&!document.querySelector('#modal .sheet')){close();e.preventDefault();}});
 window.addEventListener('hashchange',()=>{close();stopTaskLayout();if(!location.hash.startsWith('#/team'))document.querySelector('#view')?.classList.remove('team-workspace');});
})();
