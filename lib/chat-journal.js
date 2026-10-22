'use strict';
// Home conversations share the project conversation store. The append-only event
// journal preserves streamed replies across a process restart before checkpointing.
const fs=require('fs'),path=require('path'),crypto=require('crypto'),durable=require('./durable-json');
module.exports=function(ctx){
 const dir=path.join(ctx.DATA,'convos'),events=path.join(ctx.DATA,'chat-events');fs.mkdirSync(dir,{recursive:true});fs.mkdirSync(events,{recursive:true});
 const active=new Map(),handles=new Map();
 const valid=id=>/^v[a-z0-9]{5,23}$/.test(String(id||''));
 const file=id=>path.join(dir,id+'.json'),log=id=>path.join(events,id+'.jsonl');
 function apply(c,e){const m=c.messages[c.messages.length-1];if(e.type==='delta'&&typeof e.text==='string')m.text+=e.text;if(e.type==='session'&&e.id)c.sessions[c.activeEngine]=e.id;if(e.type==='tool'){m.tools=m.tools||[];if(m.tools.length<100)m.tools.push(String(e.name||'Tool'));}if(e.type==='error'){m.error=String(e.message||'Run failed');m.status='failed';}if(e.type==='warn'){m.warnings=m.warnings||[];m.warnings.push(String(e.message||'').slice(0,2000));}c.updatedAt=Date.now();}
 // Recovery replays only events newer than the checkpoint sequence.
 for(const n of fs.readdirSync(events).filter(n=>n.endsWith('.jsonl'))){const id=n.slice(0,-6);if(!valid(id))continue;try{const c=durable.read(file(id));if(c.origin!=='home-chat')continue;for(const line of fs.readFileSync(log(id),'utf8').split('\n')){try{const r=JSON.parse(line);if(r.seq>(c.journalSeq||0)){apply(c,r.event);c.journalSeq=r.seq;}}catch{}}if(c.running){c.running=false;const m=c.messages.at(-1);if(m?.role==='ai'){m.status='interrupted';m.error=m.error||'Jarvis restarted before this reply completed. The saved partial reply is retained.';}c.updatedAt=Date.now();durable.write(file(id),c);}}catch{}}
 function start(o){
  let c=null;
  // Resume the matching provider session rather than merging unrelated chats.
  if(o.sessionId)for(const n of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){try{const x=durable.read(path.join(dir,n));if(x.origin==='home-chat'&&!x.running&&x.project===o.project&&x.agentId===o.agentId&&Object.values(x.sessions||{}).includes(o.sessionId)){c=x;break;}}catch{}}
  if(!c){const now=Date.now();c={id:'v'+now.toString(36)+crypto.randomBytes(4).toString('hex'),origin:'home-chat',agentId:o.agentId,project:o.project,title:String(o.prompt||'Conversation').replace(/\s+/g,' ').slice(0,90),engine:o.engine||'claude',model:o.model||'',effort:'',edits:false,instructions:'',sessions:{},messages:[],createdAt:now,updatedAt:now,journalSeq:0};}
  c.activeEngine=o.engine;c.running=true;if(o.sessionId&&!Object.values(c.sessions).includes(o.sessionId))c.sessions[o.engine]=o.sessionId;c.messages.push({role:'user',text:o.prompt,ts:Date.now()},{role:'ai',text:'',engine:o.engine,model:o.model||'',status:'running',ts:Date.now()});durable.write(file(c.id),c);
  active.set(c.id,c);let ended=false,lastWrite=Date.now();
  return {id:c.id,setHandle(h){handles.set(c.id,h);},event(e){if(ended||!['delta','session','tool','error','warn'].includes(e.type))return;const record={seq:(c.journalSeq||0)+1,event:e};fs.appendFileSync(log(c.id),JSON.stringify(record)+'\n',{mode:0o600});apply(c,e);c.journalSeq=record.seq;if(Date.now()-lastWrite>=1000){durable.write(file(c.id),c);lastWrite=Date.now();}},finish(status='completed'){if(ended)return;ended=true;active.delete(c.id);handles.delete(c.id);c.running=false;const m=c.messages.at(-1);m.status=m.error?'failed':status;c.updatedAt=Date.now();durable.write(file(c.id),c);if(status!=='cancelled')ctx.notifications?.publish({id:'home-chat:'+c.id+':'+m.ts,title:m.error?'Jarvis needs attention':'Jarvis reply is ready',body:c.title,project:c.project,agent:c.agentId,kind:'conversation',severity:m.error?'warning':'info',href:c.project?'#/project/'+encodeURIComponent(c.project):'#/'});}};
 }
 function resolve(o){
  if(!o.sessionId)return {sessionId:null,history:''};
  for(const n of fs.readdirSync(dir).filter(n=>n.endsWith('.json'))){try{const c=durable.read(path.join(dir,n));if(c.origin==='home-chat'&&c.agentId===o.agentId&&c.project===o.project&&Object.values(c.sessions||{}).includes(o.sessionId))return {sessionId:c.sessions[o.engine]||null,reviewHistory:c.messages.map(m=>`${m.role}: ${m.text||''}`).join('\n\n'),history:c.activeEngine!==o.engine?c.messages.map(m=>`${m.role}: ${m.text||''}`).join('\n\n'):''};}catch{}}
  // Unknown legacy session may belong to either CLI. Preserve it on disk, but
  // never send an unverified provider session to a newly selected lead.
  return {sessionId:null,history:''};
 }
 return {start,resolve,stop(id){handles.get(id)?.kill();},isRunning:id=>active.has(id),snapshot:id=>active.has(id)?JSON.parse(JSON.stringify(active.get(id))):null};
};
