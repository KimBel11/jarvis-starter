'use strict';
// Tab-local recovery of chat drafts/navigation. Vault fields and credentials are never captured.
window.JarvisProgress = (() => {
  const KEY = 'jarvis.progress.v1'; let restored = false, pending = null, scheduled = null;
  const safeId = /^[a-zA-Z0-9._:-]{1,100}$/;
  function read() { try { const d = JSON.parse(sessionStorage.getItem(KEY)); return d && Date.now()-d.at < 86400000 ? d : null; } catch { return null; } }
  function capture() {
    if (typeof S === 'undefined' || !restored) return;
    const cv = {}; for (const [pid,c] of Object.entries(S.cv || {})) { cv[pid] = {open:c.open || null,drafts:c.drafts || {}}; }
    const j = window.Jarvis && Jarvis.st;
    const messages = [...document.querySelectorAll('#jLog > .jmsg')].slice(-160).map(el=>({role:el.classList.contains('user')?'user':el.classList.contains('ai')?'ai':'note',text:el.dataset.full || el.innerText}));
    const d = {at:Date.now(),route:location.hash,scroll:scrollY,cv,projTab:S.projTab || {},soc:S.soc?{pid:S.soc.pid,tab:S.soc.tab,plat:S.soc.plat}:null,q:S.q || '',range:S.range,sessFilter:S.sessFilter,
      chat:j?{agentId:j.agentId,project:j.project,sessions:j.sessions,draft:(document.querySelector('#jText')||{}).value || '',messages}:null};
    // Preserve the currently visible draft even before its input handler has run.
    const ta=document.querySelector('#cvText'); if(ta) { const pid=location.hash.slice(2).split('/')[1], c=cv[pid]; if(c&&c.open) c.drafts[c.open]=ta.value; }
    try { const json=JSON.stringify(d); if(json.length<1500000) sessionStorage.setItem(KEY,json); } catch {}
  }
  function restoreState() {
    if(restored) return; restored=true; pending=read(); if(!pending) return;
    if(pending.cv) S.cv=pending.cv; if(pending.projTab) S.projTab=pending.projTab;
    if(pending.soc) S.soc={...(S.soc||{}),...pending.soc}; S.q=pending.q || ''; S.range=pending.range || S.range; S.sessFilter=pending.sessFilter || S.sessFilter;
    const search=document.querySelector('#search'); if(search) search.value=S.q;
    const c=pending.chat,j=window.Jarvis&&Jarvis.st;
    if(c&&j) { if(safeId.test(c.agentId||'')) Jarvis.setAgent(c.agentId); if(safeId.test(c.project||'')) Jarvis.setProject(c.project); j.sessions=Object.fromEntries(Object.entries(c.sessions||{}).filter(([k,v])=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v))); const ta=document.querySelector('#jText'); if(ta) ta.value=c.draft || '';
      const log=document.querySelector('#jLog'); if(log && !log.children.length) for(const m of c.messages||[]) { const el=document.createElement('div');el.className='jmsg '+(['user','ai','note'].includes(m.role)?m.role:'note');el.style.whiteSpace='pre-wrap';el.textContent=m.text;log.appendChild(el); }
    }
  }
  function afterRoute() { if(pending&&pending.route===location.hash) { const y=pending.scroll||0;pending=null;requestAnimationFrame(()=>window.scrollTo(0,y)); } }
  function saveSoon() { clearTimeout(scheduled);scheduled=setTimeout(capture,200); }
  document.addEventListener('input',e=>{if(e.target.matches('#cvText,#jText,#search'))saveSoon();});
  document.addEventListener('change',saveSoon);window.addEventListener('pagehide',capture);document.addEventListener('visibilitychange',()=>{if(document.hidden)capture();});
  window.addEventListener('scroll',saveSoon,{passive:true});setInterval(capture,5000);
  return {capture,restoreState,afterRoute};
})();
