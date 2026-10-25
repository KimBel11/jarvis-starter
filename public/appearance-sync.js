'use strict';
(()=>{
 if(new URLSearchParams(location.search).get('appearance-preview')==='1')return;
 const KEY='jarvis.appearance.pending.v1';let revision=-1,busy=false,timer,pending={};
 let baseline={appearance:window.JarvisAppearance.get(),atmosphere:window.JarvisAtmosphere.get()};
 try{pending=JSON.parse(localStorage.getItem(KEY))||{};}catch(_){}
 const remember=()=>{try{localStorage.setItem(KEY,JSON.stringify(pending));}catch(_){}};
 function receive(state){revision=state.revision;for(const [key,controller]of [['appearance',window.JarvisAppearance],['atmosphere',window.JarvisAtmosphere]])if(state[key]){baseline[key]=state[key];controller.receive({...state[key],...(pending[key]||{})});}window.dispatchEvent(new Event('jarvis:shared-appearance'));}
 function image(){const c=document.createElement('canvas'),orb=new Orb(c);orb.preview=true;orb.setState('idle');c.width=256;c.height=256;orb.frame(0,1);const png=c.toDataURL('image/png');orb.observer?.disconnect();Orb.all.delete(orb);return png;}
 async function sync(){if(busy||document.hidden)return;busy=true;try{
 const r=await fetch('/api/appearance?since='+revision,{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('Connection unavailable');const state=await r.json();if(!state.unchanged)receive(state);
 // The first connected device migrates its existing choices exactly once.
 if(revision===0&&!state.appearance){pending={appearance:{...baseline.appearance,...pending.appearance},atmosphere:{...baseline.atmosphere,...pending.atmosphere}};remember();}
 if(Object.keys(pending).length){const sent=JSON.parse(JSON.stringify(pending));const result=await fetch('/api/appearance',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision,...sent,image:image()}),signal:AbortSignal.timeout(8000)});const next=await result.json();if(result.status===409){receive(next);return;}if(!result.ok)throw Error(next.error||'Could not sync');for(const group of Object.keys(sent)){for(const key of Object.keys(sent[group]))if(pending[group]?.[key]===sent[group][key])delete pending[group][key];if(pending[group]&&!Object.keys(pending[group]).length)delete pending[group];}remember();receive(next);}
 window.dispatchEvent(new CustomEvent('jarvis:appearance-sync-status',{detail:{ok:true}}));
 }catch(e){window.dispatchEvent(new CustomEvent('jarvis:appearance-sync-status',{detail:{ok:false}}));}finally{busy=false;}}
 for(const group of ['appearance','atmosphere'])window.addEventListener('jarvis:'+group+'-edit',e=>{const changes={};for(const[k,v]of Object.entries(e.detail))if(v!==baseline[group]?.[k])changes[k]=v;pending[group]=changes;remember();clearTimeout(timer);timer=setTimeout(sync,500);});
 window.addEventListener('online',sync);document.addEventListener('visibilitychange',()=>{if(!document.hidden)sync();});setInterval(sync,5000);sync();
 window.addEventListener('jarvis:appearance-sync-status',e=>{const note=document.querySelector('.appearance-note');if(note)note.textContent=e.detail.ok?'Synced across Jarvis devices. Offline devices catch up when connected.':'Saved here. Waiting for the Jarvis connection to sync your appearance.';});
})();
