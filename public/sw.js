'use strict';
// Jarvis service worker.
// It never shows an old copy of Jarvis: pages and code always come live from your Mac. When your Mac or the Jarvis server is not reachable yet
// (for example right after a restart), it shows a "Connecting" page that tells you what has to be running and reconnects by itself.
const CACHE = 'jarvis-shell-v2';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k)))).then(() => self.clients.claim())); });

const OFFLINE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><meta name="theme-color" content="#07090d"><title>Jarvis — connecting</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(900px 500px at 50% -10%,rgba(45,212,238,.16),transparent 60%),#07090d;color:#e8ecf4;font:16px -apple-system,system-ui,sans-serif;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) 18px 32px}
main{width:min(460px,100%)}.orb{width:92px;height:92px;margin:0 auto 18px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#d4fbff,#2dd4ee 40%,#0a5566 75%);box-shadow:0 0 60px rgba(45,212,238,.45);animation:p 2.8s ease-in-out infinite}@keyframes p{50%{transform:scale(1.06);box-shadow:0 0 80px rgba(45,212,238,.6)}}
h1{font-size:21px;text-align:center;margin:0 0 6px}p.sub{color:#8f9ab0;text-align:center;margin:0 0 22px;font-size:14px;line-height:1.45}
.list{display:grid;gap:10px}.row{display:flex;gap:12px;align-items:flex-start;padding:13px 14px;border:1px solid #232c3d;border-radius:14px;background:#0d121b}.dot{flex:0 0 12px;height:12px;margin-top:5px;border-radius:50%;background:#556}.ok .dot{background:#35d49a;box-shadow:0 0 10px #35d49a88}.bad .dot{background:#ff6b78}.wait .dot{background:#e6b04a;animation:b 1s infinite}@keyframes b{50%{opacity:.35}}
.row b{display:block;font-size:14.5px}.row small{display:block;color:#8f9ab0;font-size:12.5px;line-height:1.4;margin-top:2px}
button{margin-top:20px;width:100%;padding:14px;border-radius:14px;border:0;background:linear-gradient(135deg,#1fb8d3,#2d7ff0);color:#fff;font:600 16px -apple-system,system-ui,sans-serif}.foot{color:#6d7890;font-size:12px;text-align:center;margin-top:14px}</style></head><body><main>
<div class="orb"></div><h1 id="t">Connecting to Jarvis…</h1><p class="sub" id="s">Your Mac has to be on with Jarvis running. This page reconnects by itself as soon as it is.</p>
<div class="list" id="l"></div><button id="b">Try again now</button><div class="foot" id="f"></div></main><script>
const rows=[['net','This device is online','Wi-Fi or mobile data is on.'],['mac','Your Mac is on and awake','Not asleep, not shut down. After a restart give it 1–2 minutes.'],['srv','The Jarvis server is running','It starts by itself after you log in to the Mac, once the external drive is connected. Double-click start.command if it does not.'],['ts','Tailscale is connected on this device','Needed whenever you are not on the same Wi-Fi as the Mac. Open the Tailscale app and check it says Connected.'],['hub','OrbStack is running on the Mac','Only for social media posting (Postiz). Jarvis itself works without it.']];
const st={};const L=document.getElementById('l');
function draw(){L.innerHTML=rows.map(([k,a,b])=>{const s=st[k]||'wait';return '<div class="row '+s+'"><span class="dot"></span><div><b>'+a+'</b><small>'+(s==='ok'?'Looks fine.':b)+'</small></div></div>'}).join('')}
let n=0,busy=false;async function check(){if(busy)return;busy=true;n++;st.net=navigator.onLine?'ok':'bad';st.mac=st.srv=st.ts=st.hub='wait';draw();
try{const r=await fetch('/api/health',{cache:'no-store',signal:AbortSignal.timeout(6000)});if(r.status===200||r.status===401){st.mac=st.srv=st.ts='ok';draw();document.getElementById('t').textContent='Jarvis is up — opening…';setTimeout(()=>location.reload(),600);return}
st.srv='bad';st.mac='ok'}catch(e){st.srv='bad';st.mac='wait';st.ts='wait'}
st.hub='wait';draw();document.getElementById('t').textContent='Jarvis is not reachable yet';document.getElementById('f').textContent='Checked '+n+' time'+(n>1?'s':'')+' · retrying every few seconds';busy=false}
document.getElementById('b').onclick=check;window.addEventListener('online',check);draw();check();setInterval(check,4000);
</script></body></html>`;

self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request, { cache: 'no-store' }).catch(() => new Response(OFFLINE, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } })));
  }
  // everything else goes straight to the network (the browser's own error if Jarvis is down): no stale copies
});
