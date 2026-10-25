'use strict';
(()=>{
 const active=new Set(['queued','planning','running','awaiting_approval','waiting']);
 const h=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
 const visible=el=>!!el&&!el.hidden&&el.getClientRects().length>0;
 const dirty=new Set();document.addEventListener('input',e=>{if(e.target.matches('#view input,#view textarea,[contenteditable=true]')&&!e.target.closest('.appearance-panel,.da-settings'))dirty.add(e.target);});
 function blockers(){const out=[];const j=window.Jarvis;
 if(j?.isActive?.())out.push({id:'voice',title:'Jarvis conversation is active',detail:j.st?.busy?'An answer is being generated.':j.st?.listening?'The microphone is listening.':'Speech or a voice session is still active.',action:'Stop conversation',run:()=>{if(confirm('Stop this conversation’s current response and microphone? Saved messages remain available.'))j.cancel();}});
 if(window.JarvisQueue?.holding?.())out.push({id:'queue',title:'Messages are queued to run',detail:'Pause the queue to update safely. Your queued messages will be kept.',action:'Pause queue',run:()=>window.JarvisQueue.pause()});
 const cv=document.querySelector('#cvStop');if(visible(cv))out.push({id:'chat',title:'Project conversation is responding',detail:'Wait for the answer, or stop its current generation.',action:'Stop response',run:()=>{if(confirm('Stop the current project response?'))cv.click();}});
 const modal=document.querySelector('#modal');if(visible(modal)&&modal.querySelector('.sheet'))out.push({id:'editor',title:'An editor or dialog is open',detail:'Save its changes before updating. Closing without saving may discard edits.',action:'Return to editor',run:()=>{close();modal.querySelector('input,textarea,button')?.focus();}});
 const drafts=new Set([...document.querySelectorAll('#askInput,#jText,#cvText'),...dirty]);
 for(const el of drafts)if(el.isConnected&&visible(el)&&!el.closest('#modal')&&String(el.value??el.textContent??'').trim()&&!['checkbox','radio','range','color'].includes(el.type))out.push({id:'draft-'+out.length,title:'Unsent text or an edited field',detail:'Review and save, send, or clear it before updating.',action:'Review text',run:()=>{close();el.scrollIntoView({block:'center'});el.focus();}});
 return out;}
 const button=h('button',"Activity",'activity-pill');button.id='activityHomeButton';button.type='button';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','activityCenter');
 const panel=h('aside',null,'activity-center');panel.id='activityCenter';panel.hidden=true;panel.setAttribute('aria-label','Activity and app updates');
 document.body.append(button,panel);let previouslyFocused,processesExpanded=false;
 function close(){panel.hidden=true;button.setAttribute('aria-expanded','false');previouslyFocused?.focus?.();}
 function action(label,fn){const b=h('button',label,'btn sm');b.type='button';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){toast(e.message);}finally{b.disabled=false;render();}};return b;}
 function row(title,detail){const el=h('section',null,'activity-row');el.append(h('strong',title),h('p',detail));return el;}
 function render(){const tasks=(window.JarvisWatch?.items?.()||[]).filter(t=>active.has(t.status));const blocked=blockers();button.hidden=!['','#/','#/home'].includes(location.hash);button.textContent='Activity · '+(tasks.length+(window.Jarvis?.isActive?.()?1:0));
 if(panel.hidden)return;
 // Preserve keyboard focus as live task state updates.
 const focusKey=panel.contains(document.activeElement)?document.activeElement.dataset.focusKey:null;
 panel.replaceChildren();const head=h('header');head.append(h('h2','Activity & updates'),action('Close',close));panel.append(head);
 panel.append(h('p',blocked.length?`${blocked.length} item${blocked.length===1?'':'s'} needs attention before updating.`:'All clear · safe to update','activity-summary'));
 for(const b of blocked){const el=row(b.title,b.detail);const a=action(b.action,b.run);a.dataset.focusKey=b.id;el.append(a);panel.append(el);}
 const update=action(window.JarvisUpdate?.available()?'Apply update':'App is up to date',()=>window.JarvisUpdate?.apply());update.disabled=blocked.length>0||!window.JarvisUpdate?.available();update.dataset.focusKey='update';panel.append(update);
 panel.append(h('h3',tasks.length?'Live work':'Agents'),h('p','Background tasks keep running through an app update.','muted tiny'));
 if(!tasks.length)panel.append(row('Agents are idle','No active tasks reported.'));
 for(const t of tasks){const el=row(t.agent?.name||'Agent',(t.title||'Task')+' · '+t.status);const view=action('View task',()=>{close();window.JarvisWatch?.open(t.id);});view.dataset.focusKey='view-'+t.id;el.append(view);
 if(t.source==='task'&&t.taskId){const stop=action(t.status==='awaiting_approval'?'Decline plan':'Stop task',async()=>{if(!confirm('Cancel “'+(t.title||'this task')+'”? Completed files are kept; interrupted work may be partial.'))return;await post('/api/tasks/cancel',{id:t.taskId});});stop.dataset.focusKey='stop-'+t.id;el.append(stop);}else if(t.href)el.append(action('Open project',()=>{close();location.hash=t.href;}));panel.append(el);}
 const processes=typeof S!=='undefined'?(S.running||[]):[];if(processes.length){const more=h('details',null,'activity-processes');more.open=processesExpanded;more.ontoggle=()=>{processesExpanded=more.open;};more.append(h('summary','Mac processes · '+processes.length),h('p','Open processes may be idle. They do not block updates; manage them in their original app.','muted tiny'));for(const p of processes)more.append(row((p.agent||'Agent')+' · '+(p.via||'External process'),'PID '+p.pid));panel.append(more);}
 if(window.JarvisQueue?.size?.()&&window.JarvisQueue.paused)panel.append(row('Message queue paused',window.JarvisQueue.size()+' messages saved. You can resume them after updating.'));
 if(focusKey)panel.querySelector('[data-focus-key="'+CSS.escape(focusKey)+'"]')?.focus({preventScroll:true});}
 function open(){previouslyFocused=document.activeElement;panel.hidden=false;button.setAttribute('aria-expanded','true');render();panel.querySelector('button')?.focus();}
 button.onclick=()=>panel.hidden?open():close();panel.addEventListener('keydown',e=>{if(e.key==='Escape'){e.stopPropagation();close();}});
 window.JarvisActivity={open,blockers};window.addEventListener('jarvis:watch',render);window.addEventListener('hashchange',render);window.addEventListener('jarvis:state',render);setInterval(render,2000);render();
})();
