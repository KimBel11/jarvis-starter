'use strict';
// Read the existing course records in place; never copy them into another course or chat.
(() => {
 const E=esc;
 const date=t=>new Date(t).toLocaleString([], {dateStyle:'medium',timeStyle:'short'});
 PAGES['glasses-history']=async view=>{
  view.innerHTML='<div class="hello"><div><h1>Glasses conversations</h1><p class="sub">Your saved course questions and answers, grouped by course.</p></div></div><a class="btn" href="#/home">Back to Home</a><div data-glasses-history role="status" style="margin-top:20px">Loading saved conversations…</div>';
  const host=view.querySelector('[data-glasses-history]');
  try{
   const projects=(S.projects||[]).filter(p=>p.kind==='study'||p.id==='studys');
   const programs=await Promise.all(projects.map(async p=>({project:p,program:await api('/api/study/program?project='+encodeURIComponent(p.id))})));
   const groups=await Promise.all(programs.flatMap(({project,program})=>(program.courses||[]).map(async course=>{
    try{return {project,course,data:await api('/api/study/glasses?project='+encodeURIComponent(project.id)+'&course='+encodeURIComponent(course.id))};}
    catch(error){return {project,course,error:error.message};}
   })));
   if(!host.isConnected)return;
   host.removeAttribute('role');
   host.innerHTML=groups.map(({project,course,data,error})=>{
    const threads=new Map();for(const item of data?.items||[]){const id=item.thread||item.id;if(!threads.has(id))threads.set(id,[]);threads.get(id).push(item);}
    return `<section class="card" style="margin:16px 0;padding:20px;min-width:0"><h2>${E(course.name)}</h2><p class="muted">${E(project.name)} · ${threads.size} saved ${threads.size===1?'conversation':'conversations'}</p>${error?`<p role="alert">Could not load this course: ${E(error)}</p>`:[...threads.values()].map(items=>{
     items.sort((a,b)=>a.at-b.at);return `<details style="border-top:1px solid var(--line);padding:16px 0"><summary style="cursor:pointer;overflow-wrap:anywhere;line-height:1.6"><strong>${E(items[0].prompt)}</strong><br><small class="muted">${E(date(items.at(-1).at))} · ${items.length} ${items.length===1?'exchange':'exchanges'}</small></summary>${items.map(item=>`<article style="padding:16px 0;overflow-wrap:anywhere"><small class="muted">${E(date(item.at))}</small><p><b>You</b></p><div style="white-space:pre-wrap">${E(item.prompt)}</div><p><b>${E(course.name)} lead</b></p><div style="white-space:pre-wrap;line-height:1.7">${E(item.answer)}</div>${item.sources?.length?`<details style="margin-top:12px"><summary>Sources (${item.sources.length})</summary>${item.sources.map(s=>`<p><b>${E(s.title||'Course source')}</b></p>${s.quote?`<blockquote style="white-space:pre-wrap">${E(s.quote)}</blockquote>`:''}`).join('')}</details>`:''}</article>`).join('')}<small class="muted">Saved course Q&A · not a council-reviewed deliverable</small></details>`;
    }).join('')||'<p class="muted">No saved glasses conversations for this course yet.</p>'}</section>`;
   }).join('')||'<p>No study courses are available.</p>';
  }catch(error){if(host.isConnected){host.innerHTML=`<p role="alert">Could not load glasses conversations: ${E(error.message)}</p><button class="btn" data-retry>Try again</button>`;host.querySelector('[data-retry]').onclick=()=>PAGES['glasses-history'](view);}}
 };
})();
