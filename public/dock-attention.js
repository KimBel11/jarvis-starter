/* Live attention indicator; uses the existing watcher and approval controls. */
(() => {
 'use strict';
 function actionable(items){
  const unique=[...new Map(items.filter(i=>i?.id).map(i=>[i.id,i])).values()];
  return unique.filter(i=>['awaiting_approval','waiting'].includes(i.status)||i.status==='failed'&&!unique.some(n=>n.agent?.id===i.agent?.id&&n.project===i.project&&(n.createdAt||0)>(i.createdAt||0))).sort((a,b)=>({awaiting_approval:0,waiting:1,failed:2}[a.status]-{awaiting_approval:0,waiting:1,failed:2}[b.status]));
 }
 if(typeof module!=='undefined'&&module.exports){module.exports={actionable};return;}
 let pending=[],dialog;
 const node=(tag,text)=>{const n=document.createElement(tag);if(text)n.textContent=text;return n;};
 function draw(){
  const link=document.querySelector('#mnav [data-mr="team"]');if(!link)return;
  let badge=link.querySelector('.agent-attention-badge');if(!badge){badge=node('span');badge.className='agent-attention-badge';badge.setAttribute('aria-hidden','true');link.append(badge);}
  badge.textContent=pending.length>99?'99+':String(pending.length);badge.hidden=!pending.length;link.classList.toggle('needs-attention',!!pending.length);link.setAttribute('aria-label',pending.length?'Agents, '+pending.length+' items need your attention':'Agents');
  if(dialog?.open)renderDialog();
 }
 function renderDialog(){
  dialog.replaceChildren();const head=node('header'),title=node('h2','Needs your attention'),close=node('button','Close');close.className='btn sm';close.onclick=()=>dialog.close();head.append(title,close);dialog.append(head);
  const list=node('div');list.className='agent-attention-list';
  for(const item of pending){const button=node('button');button.className='agent-attention-row';button.append(node('strong',item.agent?.name||'Agent'),node('span',item.title||'Task'),node('small',({awaiting_approval:'Review approval',waiting:'Needs your input',failed:'Review issue'})[item.status]));button.onclick=()=>{dialog.close();window.JarvisWatch?.open(item.id);};list.append(button);}
  if(!pending.length)list.append(node('p','All caught up. No items need your attention.'));
  const all=node('a','View all agents');all.href='#/team';all.className='btn';all.onclick=()=>dialog.close();dialog.append(list,all);
 }
 function boot(){
  document.addEventListener('click',e=>{const link=e.target.closest('#mnav [data-mr="team"]');if(!link||!pending.length||!matchMedia('(max-width:800px)').matches||e.metaKey||e.ctrlKey)return;e.preventDefault();e.stopImmediatePropagation();if(!dialog){dialog=node('dialog');dialog.className='agent-attention-dialog';dialog.setAttribute('aria-label','Agents needing attention');document.body.append(dialog);dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});}renderDialog();dialog.showModal();},{capture:true});
  pending=actionable(window.JarvisWatch?.items?.()||[]);draw();
 }
 window.addEventListener('jarvis:watch',e=>{pending=actionable(e.detail?.items||[]);draw();});window.addEventListener('hashchange',()=>requestAnimationFrame(draw));
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
