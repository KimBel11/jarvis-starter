'use strict';
// Ephemeral metadata only: never stores prompts, tool arguments, file contents or credentials.
const fs = require('fs');
const path = require('path');
module.exports = function graphActivity(ctx) {
  const ring = [], clients = new Set(); let sequence = 0;
  const blocked = /^(?:node_modules|vendor|venv|runtime|site-packages|cache|backups|dist|build|coverage|credentials?|tokens?|secrets?)$|secret|credential|token|password|\.env|\.(?:key|pem|p8|p12|keystore)$/i;
  const inside = (f, r) => { const p = path.relative(r, f); return !p || p !== '..' && !p.startsWith('../') && !path.isAbsolute(p); };
  function projects() { const p = [...(ctx.state.projects || [])]; const hub = path.join(ctx.DRIVE || '@@WORKSPACE@@', 'Jarvis Hub'); if (fs.existsSync(hub) && !p.some(x => x.path === hub)) p.push({id:'hub', name:'Jarvis Hub', path:hub}); return p; }
  function target(input, project, cwd) {
    if (typeof input !== 'string' || !input || input.length > 2000 || /[\x00-\x1f\\]/.test(input)) return null;
    for (const p of projects().sort((a,b)=>String(b.path).length-String(a.path).length)) {
      if (project && p.id !== project) continue;
      try {
        const root = fs.realpathSync(p.path), f = fs.realpathSync(path.resolve(cwd || root, input));
        if (!inside(f, root)) continue;
        const rel = path.relative(root, f);
        if (rel.split(path.sep).some(s => s.startsWith('.') || blocked.test(s))) continue;
        return {project:p.id, projectName:p.name, path:f, relativePath:rel.split(path.sep).join('/'), label:rel ? path.basename(f) : p.name, directory:fs.statSync(f).isDirectory()};
      } catch {}
    }
    return null;
  }
  function record(input = {}) {
    const kind = ['tool','request','task'].includes(input.kind) ? input.kind : null;
    const status = ['requested','opening','read','searching','editing','done'].includes(input.status) ? input.status : null;
    if (!kind || !status) return null;
    const t = input.path ? target(input.path, input.project, input.cwd) : input.cwd ? target(input.cwd,input.project) : null;
    if (input.path && !t) return null;
    if (!t && input.project) { const p=projects().find(p=>p.id===input.project); if(!p)return null; }
    const e = {id:++sequence, at:Date.now(), kind, status, ...(t || (input.project ? {project:input.project} : {})), source:['claude','codex','gemini','jarvis'].includes(input.source) ? input.source : 'jarvis'};
    if (typeof input.run === 'string' && /^[a-f0-9]{16}$/.test(input.run)) e.run=input.run;
    // Do not accept arbitrary human or provider labels, agent names or task IDs.
    if (!e.label) e.label = status === 'done' ? 'Agent activity ended' : status === 'searching' ? 'Searching registered files' : 'Agent working';
    ring.push(e); if(ring.length>100)ring.shift();
    for(const res of clients) try{res.write('data: '+JSON.stringify(e)+'\n\n');}catch{clients.delete(res);}
    return e;
  }
  function focus(query, project) {
    if(typeof query!=='string'||query.length>1000)return {matches:[],reason:'Enter a project name or filename'};
    const q=query.trim().toLowerCase(); if(!q)return {matches:[]};
    const matches=[], seen=new Set(), projectMatches=[];
    const mentioned = value => { const term=String(value||'').toLowerCase(); if(!term)return false;let at=q.indexOf(term);while(at>=0){const before=q[at-1],after=q[at+term.length];if((!before||!/[a-z0-9_]/i.test(before))&&(!after||!/[a-z0-9_]/i.test(after)))return true;at=q.indexOf(term,at+1);}return false; };
    const namedProjects=projects().filter(p=>{const n=String(p.name).toLowerCase();return q===n||q===p.id||q===p.path.toLowerCase()||(/^(jarvis|even)$/.test(n)?q.includes(n+' project')||q.includes('project '+n):mentioned(n));});
    const add=t=>{if(t&&!seen.has(t.path)&&matches.length<20){seen.add(t.path);matches.push(t);}};
    for(const p of projects()) {
      if(project&&p.id!==project)continue;
      if(namedProjects.some(x=>x.id===p.id))projectMatches.push(target(p.path,p.id));
      if(namedProjects.length&&!namedProjects.some(x=>x.id===p.id))continue;
      let scan;try{scan=ctx.getScan&&ctx.getScan(p);}catch{}
      for(const f of ((scan&&scan.data&&scan.data.all)||[]).slice(0,12000)) {
        const full=f.path||f.full; if(!full)continue;
        const rel=f.rel||path.relative(p.path,full), base=path.basename(full).toLowerCase();
        if(q===full.toLowerCase()||q===rel.toLowerCase()||q===base||q===base.replace(/\.[^.]+$/,'')||mentioned(full)||mentioned(rel)||(base.includes('.')&&mentioned(base)))add(target(full,p.id));
      }
    }
    if(!matches.length)for(const t of projectMatches)add(t);
    return {matches, candidates:matches, target:matches.length===1?matches[0]:null, ambiguous:matches.length>1, indexedOnly:true};
  }
  return {record, target, focus, async handle(req,res,url){
    if(!url.pathname.startsWith('/api/graph-activity/'))return false;
    const send=(s,b)=>(ctx.send(res,s,b),true);
    if(req.method==='GET'&&url.pathname==='/api/graph-activity/status')return send(200,{events:ring.slice(),latestId:sequence,ephemeral:true});
    if(req.method==='GET'&&url.pathname==='/api/graph-activity/events'){
      if(clients.size>=12)return send(429,{error:'Too many activity connections'});
      res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('data: '+JSON.stringify({events:ring.slice(),latestId:sequence})+'\n\n');clients.add(res);
      const timer=setInterval(()=>{try{res.write(': heartbeat\n\n');}catch{}},25000);timer.unref();req.on('close',()=>{clearInterval(timer);clients.delete(res);});return true;
    }
    if(req.method==='POST'&&url.pathname==='/api/graph-activity/focus'){
      const b=await ctx.readBody(req), result=focus(b.query,b.project);
      if(result.matches.length===1)record({kind:'request',status:'requested',path:result.matches[0].path,source:'jarvis'});
      return send(200,result);
    }
    return send(404,{error:'Unknown graph activity route'});
  }};
};
