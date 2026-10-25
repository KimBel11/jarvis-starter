'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const code=fs.readFileSync(require('node:path').join(__dirname,'../public/agent-handoff.js'),'utf8').split('// Desktop replies wait')[1];
function setup(desktop=true){
 const events={},timers=new Map(),classes=new Set(['graph-home']);let opened=0,id=0;
 const panel={inert:false,animate:()=>{}};
 const window={Jarvis:{open:()=>opened++},addEventListener:(n,f)=>(events[n]??=[]).push(f),dispatchEvent:e=>(events[e.type]||[]).forEach(f=>f(e))};
 const document={body:{classList:{contains:n=>classes.has(n),toggle:(n,on)=>on?classes.add(n):classes.delete(n)}},querySelector:()=>panel};
 vm.runInNewContext('// Desktop replies wait'+code,{window,document,Event,matchMedia:q=>({matches:q.includes('min-width')?desktop:false}),setTimeout:f=>{timers.set(++id,f);return id;},clearTimeout:i=>timers.delete(i)});
 return{fire:(type,detail)=>window.dispatchEvent({type,detail}),tick:()=>{const copy=[...timers.values()];timers.clear();copy.forEach(f=>f());},get active(){return window.JarvisHomeReveal.active;},get opened(){return opened;},panel};
}
test('completed response waits for visual lead-in',()=>{const f=setup();f.fire('jarvis:graph-request');f.fire('jarvis:state',{busy:false});assert.equal(f.panel.inert,true);f.tick();assert.equal(f.opened,1);assert.equal(f.panel.inert,false);});
test('handoff and response must both finish in either order',()=>{for(const first of ['reply','animation']){const f=setup();f.fire('jarvis:graph-request');f.fire('jarvis:handoff-started');f.tick();f.fire(first==='reply'?'jarvis:state':'jarvis:handoff-finished',{busy:false});assert.equal(f.opened,0);f.fire(first==='reply'?'jarvis:handoff-finished':'jarvis:state',{busy:false});assert.equal(f.opened,1);}});
test('follow-up hides chat again and close prevents reopening',()=>{const f=setup();f.fire('jarvis:graph-request');f.fire('jarvis:state',{busy:false});f.tick();f.fire('jarvis:graph-request');assert.equal(f.active,true);f.fire('jarvis:conversation-closing');f.fire('jarvis:state',{busy:false});f.tick();assert.equal(f.opened,1);assert.equal(f.panel.inert,false);});
test('failure and navigation release hidden panel; mobile stays unchanged',()=>{for(const event of ['jarvis:failed','hashchange','jarvis:cancel']){const f=setup();f.fire('jarvis:graph-request');f.fire(event);f.tick();assert.equal(f.active,false);assert.equal(f.panel.inert,false);}const f=setup(false);f.fire('jarvis:graph-request');assert.equal(f.active,false);});
