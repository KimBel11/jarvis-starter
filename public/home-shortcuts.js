(()=>{
 'use strict';const KEY='jarvis.phone.shortcuts.v1',media=matchMedia('(max-width:800px)'),specs=[['alerts','.jn-bell','Alerts'],['activity','#activityHomeButton','Activity']];let saved={},editing=false,drag=null;
 try{saved=JSON.parse(localStorage.getItem(KEY)||'{}')||{};}catch{}
 const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
 function save(){try{localStorage.setItem(KEY,JSON.stringify(saved));}catch{}}
 function apply(){const on=media.matches&&document.body.classList.contains('graph-home');for(const [id,selector]of specs){const el=document.querySelector(selector);if(!el)continue;
  if(!on){if(el.dataset.phonePlaced){for(const k of ['left','right','top','bottom'])el.style.removeProperty(k);delete el.dataset.phonePlaced;}el.classList.remove('phone-shortcut-edit');continue;}
  el.classList.toggle('phone-shortcut-edit',editing);const c=saved[id];if(c&&Number.isFinite(c.x)&&Number.isFinite(c.y)){const r=el.getBoundingClientRect();el.style.left=clamp(c.x*innerWidth,12,innerWidth-r.width-12)+'px';el.style.top=clamp(c.y*innerHeight,12,innerHeight-r.height-110)+'px';el.style.right='auto';el.style.bottom='auto';el.dataset.phonePlaced='true';}
  if(el.dataset.phoneMoveBound)continue;el.dataset.phoneMoveBound='true';
  el.addEventListener('click',e=>{if(editing&&media.matches){e.preventDefault();e.stopImmediatePropagation();}},true);
  el.addEventListener('pointerdown',e=>{if(!editing||!media.matches||e.button!==0)return;e.preventDefault();e.stopImmediatePropagation();const r=el.getBoundingClientRect();drag={id,x:e.clientX,y:e.clientY,left:r.left,top:r.top,old:saved[id]&&{...saved[id]}};el.setPointerCapture(e.pointerId);},true);
  el.addEventListener('pointermove',e=>{if(drag?.id!==id)return;e.preventDefault();saved[id]={x:(drag.left+e.clientX-drag.x)/innerWidth,y:(drag.top+e.clientY-drag.y)/innerHeight};apply();});
  for(const event of ['pointerup','pointercancel'])el.addEventListener(event,e=>{if(drag?.id!==id)return;if(event==='pointercancel'){if(drag.old)saved[id]=drag.old;else delete saved[id];}else save();drag=null;apply();});
 }}
 window.JarvisHomeShortcuts={refresh:apply,controls(host,edit){editing=edit;apply();if(!edit)return;const section=document.createElement('details');section.className='pw-controls';const summary=document.createElement('summary');summary.textContent='Move Alerts & Activity';section.append(summary);const help=document.createElement('p');help.className='pw-help';help.textContent='Drag either highlighted button, or set its position below. These positions are saved only for this phone layout.';section.append(help);
  for(const [id,selector,name]of specs){const el=document.querySelector(selector);if(!el)continue;const r=el.getBoundingClientRect();for(const [key,label,value]of [['x','Horizontal',r.left/innerWidth],['y','Vertical',r.top/innerHeight]]){const l=document.createElement('label');l.textContent=name+' · '+label;const input=document.createElement('input');input.type='range';input.min=0;input.max=90;input.value=Math.round((saved[id]?.[key]??value)*100);input.setAttribute('aria-label',name+' '+label);input.oninput=()=>{saved[id]||={x:r.left/innerWidth,y:r.top/innerHeight};saved[id][key]=Number(input.value)/100;apply();};input.onchange=save;l.append(input);section.append(l);}}
  host.append(section);
 }};
 window.addEventListener('resize',apply);window.addEventListener('hashchange',()=>{editing=false;apply();});media.addEventListener('change',apply);document.addEventListener('DOMContentLoaded',apply);setTimeout(apply,0);
})();
