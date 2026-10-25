'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('fs'),path=require('path');
function setup(){
 const events={},utterances=[],players=[];const el={classList:{add(){},remove(){},toggle(){}},setAttribute(){},contains(){return false;},style:{},hidden:false};
 const document={hidden:false,body:{dataset:{},classList:el.classList},querySelector:s=>s==='#jPanel'?el:null,querySelectorAll:()=>[],addEventListener:(k,f)=>events[k]=f};
 const synth={getVoices:()=>[],speak:u=>{utterances.push(u);u.onstart?.();},pause(){this.paused=true;},resume(){this.paused=false;},cancel(){this.cancelled=true;}};
 class Audio{constructor(){players.push(this);}setAttribute(){}play(){this.playing=true;this.onplay?.();return Promise.resolve();}pause(){this.playing=false;}load(){}removeAttribute(){}}
 const window={speechSynthesis:synth,addEventListener:(k,f)=>events[k]=f,dispatchEvent(){}};
 const context={window,document,navigator:{},Audio,SpeechSynthesisUtterance:class{constructor(text){this.text=text;}},URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},Event:class{},CustomEvent:class{},localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){}},S:{team:{agents:[]}},Orb:{setAll(){}},innerWidth:1200,setTimeout,clearTimeout,requestAnimationFrame:()=>1,cancelAnimationFrame(){},fetch:()=>Promise.resolve({ok:true,blob:()=>Promise.resolve({})}),api:async()=>({configured:false}),console};
 vm.createContext(context);let source=fs.readFileSync(path.join(__dirname,'../public/jarvis.js'),'utf8').replace('Jarvis.build();','window.testOut = OutForTest;');source=source.replace('window.Jarvis = Jarvis;', 'window.Jarvis = Jarvis;').replace('return { state: \'idle\', build', 'window.recordTest=recordWithScribe; window.OutForTest=Out; return { state: \'idle\', build').replace('window.testOut = OutForTest;', 'window.testOut=window.OutForTest;');vm.runInContext(source,context);
 return {context,j:window.Jarvis,out:window.testOut,document,events,utterances,players,synth};
}
const settle=()=>new Promise(r=>setImmediate(r));
test('Orb pauses current speech without cancelling background work; second tap resumes',async()=>{const f=setup();f.j.st.busy=true;f.j.st.streamDone=false;f.out.say('One sentence.');await settle();assert.equal(f.utterances.length,1);assert.equal(f.j.orbTap(),'paused');assert.equal(f.j.st.busy,true);assert.equal(f.synth.cancelled,undefined);assert.equal(f.j.orbTap(),'resumed');assert.equal(f.synth.paused,false);f.out.stop();});
test('Queued sentences wait while paused and continue in order',async()=>{const f=setup();f.out.say('First.');f.out.say('Second.');await settle();f.out.pause();f.utterances[0].onend();await settle();assert.equal(f.utterances.length,1);f.out.resume();await settle();assert.equal(f.utterances[1].text,'Second.');f.out.stop();});
test('Audio resolving during a pause cannot start until resumed',async()=>{const f=setup();f.j.st.eleven=true;f.out.pause();f.out.say('Audio.');await settle();assert.equal(f.players.length,0);f.out.resume();await settle();assert.equal(f.players[0].playing,true);f.out.stop();});
test('Closing panel and hiding window retain speech and running task',async()=>{const f=setup();f.j.st.busy=true;f.out.say('Keep speaking.');await settle();f.j.close();f.document.hidden=true;f.events.visibilitychange?.();assert.equal(f.j.st.busy,true);assert.equal(f.j.st.pending,1);assert.equal(f.synth.cancelled,undefined);f.out.stop();});
test('Explicit cancellation clears a paused queue without restarting it',async()=>{const f=setup();f.out.say('First.');f.out.say('Second.');await settle();f.out.pause();f.utterances[0].onend();await settle();f.j.cancel();await settle();assert.equal(f.j.st.pending,0);assert.equal(f.utterances.length,1);assert.equal(f.j.st.busy,false);});
test('Sustained microphone speech pauses the answer and starts listening without cancelling work',async()=>{
 const f=setup(),c=f.context;let now=0,amplitude=0,tick;
 const track={stop(){},label:'Test microphone'};
 c.navigator.mediaDevices={enumerateDevices:async()=>[{kind:'audioinput'}],getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})};
 c.window.AudioContext=class{constructor(){this.state='running';}async resume(){}async close(){}createAnalyser(){return {fftSize:1024,getByteTimeDomainData:a=>a.fill(128+amplitude)};}createMediaStreamSource(){return {connect(){}};}};
 class Recorder{static isTypeSupported(){return true;}constructor(){this.state='inactive';this.mimeType='audio/webm';}start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>this.onstop?.());}}
 c.MediaRecorder=c.window.MediaRecorder=Recorder;c.performance={now:()=>now};c.isSecureContext=true;c.navigator.userAgent='test';
 c.setTimeout=(fn,delay)=>{if(delay===50){tick=fn;return 1;}return setTimeout(fn,delay);};c.clearTimeout=id=>{if(id!==1)clearTimeout(id);};
 c.fetch=async()=>({ok:true,json:async()=>({text:''})});
 f.j.st.busy=true;f.j.st.streamDone=false;f.out.say('Still answering.');await settle();
 const recording=c.window.recordTest(0,true);await settle();
 for(now=50;now<=450;now+=50){tick();}assert.equal(f.j.st.playbackPaused,false);
 amplitude=12;for(now=500;now<=850;now+=50){tick();}
 assert.equal(f.j.st.playbackPaused,true);assert.equal(f.j.st.listening,true);assert.equal(f.j.st.busy,true);assert.equal(f.synth.cancelled,undefined);
 f.j.stopListening(true);await recording;f.out.stop();
});

test('completed autoplay answer respects an orb pause until the next tap',async()=>{const f=setup();f.j.st.busy=true;f.j.orbTap();f.j.st.busy=false;f.j.speakReply('The completed answer.',null,true);await settle();assert.equal(f.utterances.length,0);assert.equal(f.j.st.playbackPaused,true);assert.equal(f.j.orbTap(),'resumed');await settle();assert.equal(f.utterances[0].text,'The completed answer.');assert.equal(f.j.st.open,false);f.out.stop();});

test('Starting voice from the orb keeps the conversation closed during the greeting',async()=>{
 const f=setup();f.document.createElement=()=>({classList:{add(){}},innerHTML:'',appendChild(){}});
 f.j.st.speak=true;
 assert.equal(f.j.orbTap(),'started');
 assert.equal(f.j.st.open,false,'voice startup must not open the typing panel');
 await settle();assert.equal(f.j.st.open,false,'spoken greeting is not the first answer');
 f.j.cancel();
});

test('Close hides the panel immediately, before its Home positioning is removed',()=>{
 const f=setup();f.j.st.open=true;const panel=f.document.querySelector('#jPanel');panel.hidden=false;
 f.j.close();assert.equal(panel.hidden,true);assert.equal(f.j.st.open,false);
});
test('Microphone startup notes do not open the waiting voice conversation',async()=>{
 const f=setup();f.document.createElement=()=>({classList:{add(){}},innerHTML:'',appendChild(){}});
 f.j.st.speak=true;f.j.orbTap();f.out.stop();f.j.st.afterGreet=false;
 f.j.startListening();assert.equal(f.j.st.open,false);f.j.cancel();
});
