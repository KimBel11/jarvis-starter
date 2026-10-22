'use strict';
// Read only provider-owned transcripts. Never write to their session files.
const fs = require('fs');
const readline = require('readline');
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map(c => ['text','input_text','output_text'].includes(c.type) ? (c.text || '') : ['image','input_image','image_url'].includes(c.type) ? '[Image attachment — available in the original conversation]' : '').filter(Boolean).join('\n');
}
async function messages(session) {
  const out = [], seen = new Set();
  const lines = readline.createInterface({input:fs.createReadStream(session.file,{encoding:'utf8'}),crlfDelay:Infinity});
  for await (const line of lines) {
    let o; try {o=JSON.parse(line);} catch {continue;} // a still-writing final line is retried on the next read
    let role, text, key;
    if(session.agent==='claude') {
      if(o.isSidechain || !['user','assistant'].includes(o.type)) continue;
      role=o.type==='user'?'user':'ai';text=textOf(o.message?.content);key=o.uuid;
    } else {
      const p=o.payload || {};
      // response_item is the canonical full message; event_msg duplicates it.
      if(o.type!=='response_item'||p.type!=='message'||!['user','assistant'].includes(p.role))continue;
      role=p.role==='user'?'user':'ai';text=textOf(p.content);key=p.id;
    }
    if(!text || (key && seen.has(key)))continue;
    if(key)seen.add(key);
    out.push({role,text,ts:Date.parse(o.timestamp)||null,engine:role==='ai'?session.agent:undefined});
  }
  return out;
}
async function page(session, params) {
  const all=await messages(session), limit=Math.max(1,Math.min(100,Number(params.get('limit'))||50));
  const before=params.has('before')?Math.max(0,Math.min(all.length,Number(params.get('before'))||0)):all.length;
  const start=Math.max(0,before-limit);
  return {messages:all.slice(start,before),total:all.length,before:start,hasMore:start>0,scope:'Visible text and image placeholders; original provider transcript is preserved.'};
}
module.exports={messages,page,textOf};
