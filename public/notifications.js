/* Persistent inbox, independent of the home layout and current project. */
(() => {
 'use strict';
 const el=(tag,cls,text)=>{const n=document.createElement(tag);n.className=cls||'';if(text!==undefined)n.textContent=text;return n;};
 const bell=el('button','jn-bell','Alerts');bell.type='button';bell.setAttribute('aria-label','Open notifications');
 const panel=el('section','jn-panel');panel.hidden=true;panel.setAttribute('aria-label','Notifications');
 bell.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg><span>Alerts</span><span class="jn-count" hidden></span>';
 document.body.append(bell,panel);
 let snapshot=null,error=false,pending=false,status=null,settings=null,nativeStatus=null,lastDraw="",readRevision=0;
 async function request(path,body){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);try{const r=await fetch(path,{signal:controller.signal,cache:'no-store',...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});const d=await r.json();if(!r.ok)throw Error(d.error||'Request failed');return d;}finally{clearTimeout(timer);}}
 function safeHref(href){return typeof href==='string'&&/^#\/[a-zA-Z0-9/_?=&%.-]*$/.test(href)?href:'#/home';}
 async function mark(body){try{await request('/api/notifications/read',body);readRevision++;if(snapshot){snapshot.notifications=snapshot.notifications.map(n=>body.all||n.id===body.id?{...n,readAt:n.readAt||Date.now()}:n);snapshot.unread=snapshot.notifications.filter(n=>!n.readAt).length;window.dispatchEvent(new CustomEvent('jarvis:notifications',{detail:snapshot}));render();}await refresh();}catch{toast('Could not update this alert. Please try again.');}}
 function render(){
  const signature=JSON.stringify([snapshot,error,panel.hidden,location.hash]);if(signature===lastDraw)return;lastDraw=signature;
  const scroll=panel.scrollTop,focused=panel.contains(document.activeElement)?{text:document.activeElement.textContent,id:document.activeElement.closest('[data-alert-id]')?.dataset.alertId}:null;
  const items=(snapshot?.notifications||[]).filter(n=>!n.readAt),unread=snapshot?.unread||0;
  bell.classList.toggle('has-unread',unread>0);bell.setAttribute('aria-label',unread?'Alerts, '+unread+' unread':'Alerts, no unread notifications');bell.setAttribute('aria-expanded',String(!panel.hidden));const count=bell.querySelector('.jn-count');count.hidden=!unread;count.textContent=unread>99?'99+':String(unread);
  panel.replaceChildren();const header=el('header'),title=el('h2','','Notifications'),close=el('button','','Close');close.onclick=()=>{panel.hidden=true;render();bell.focus();};header.append(title,close);panel.append(header);
  const tools=el('div','jn-tools'),all=el('button','','Mark all read'),configure=el('a','','Delivery settings ↗');all.disabled=!unread;all.onclick=()=>mark({all:true});configure.href='#/settings';configure.onclick=()=>{panel.hidden=true;render();setTimeout(()=>document.querySelector('#notificationSettings')?.scrollIntoView({block:'center'}),300);};tools.append(all,configure);panel.append(tools);
  if(error)panel.append(el('p','jn-muted','Cannot reach Jarvis. Saved alerts will return when the connection is restored.'));
  else if(!snapshot)panel.append(el('p','jn-muted','Loading alerts…'));
  else if(!items.length)panel.append(el('p','jn-muted','You’re all caught up. New agent and project alerts appear here.'));
  for(const n of items){const row=el('article','jn-item'+(!n.readAt?' unread':'')),a=el('a','',n.title||'Jarvis update');a.href=safeHref(n.href);a.onclick=()=>{mark({id:n.id});panel.hidden=true;render();};row.dataset.alertId=n.id;row.append(a,el('p','',n.body||''));const time=el('time','jn-muted',new Date(n.createdAt).toLocaleString());row.append(time);if(!n.readAt){const read=el('button','jn-read','Mark read');read.onclick=()=>mark({id:n.id});row.append(read);}panel.append(row);}
  panel.scrollTop=scroll;if(focused){const target=[...panel.querySelectorAll('button,a')].find(n=>n.textContent===focused.text&&n.closest('[data-alert-id]')?.dataset.alertId===focused.id);(target||panel.querySelector('button'))?.focus({preventScroll:true});}
 }
 function open(){panel.hidden=!panel.hidden;render();if(!panel.hidden){refresh();panel.querySelector('button')?.focus();}}
 bell.onclick=open;document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!panel.hidden){panel.hidden=true;render();bell.focus();}});
 async function refresh(){if(pending)return;pending=true;const revision=readRevision;try{const d=await request('/api/notifications');if(!Array.isArray(d.notifications))throw Error('Invalid inbox');if(revision!==readRevision)return;snapshot=d;error=false;window.dispatchEvent(new CustomEvent('jarvis:notifications',{detail:d}));}catch{error=true;}finally{pending=false;render();}}
 function renderSettings(){if(!settings?.isConnected)return;settings.replaceChildren(el('h2','','Notifications & delivery'),el('p','jn-muted','Agent and project alerts are saved in your inbox. Enable notifications on each device to receive alerts outside Jarvis.'));
  const native=!!window.__jarvisNativeNotifications,enable=el('button','btn','Enable notifications on this device');enable.disabled=!native;enable.onclick=()=>{window.webkit.messageHandlers.native.postMessage({action:'enableNotifications'});};settings.append(enable);
  if(nativeStatus)settings.append(el('p','jn-muted',nativeStatus.message||nativeStatus.error||('Device permission: '+(nativeStatus.permission||'unknown'))));
  if(!native)settings.append(el('p','jn-muted','Install the updated Jarvis Mac or iPhone app to enable native push notifications. Browser notifications are not configured.'));
  const push=status?.push;
  settings.append(el('p','jn-muted',!status?'Checking push delivery…':push?.ready?'Push service is configured. Device permission and registration are required.':'Closed-app push delivery needs setup. In-app alerts remain available.'));
  if(push?.error)settings.append(el('p','jn-muted',push.error));
  if(push&&!push.configured){
   const steps=el('ol','jn-setup');
   for(const text of ['Create an Apple Push Notification service key for Jarvis in your Apple Developer account.', 'Keep the downloaded key on this Mac and connect it to the Jarvis server.', 'Install the push-enabled Jarvis update, then enable notifications on each device.'])steps.append(el('li','',text));
   settings.append(steps);
   const apple=el('a','btn','Open Apple Developer keys');apple.href='https://developer.apple.com/account/resources/authkeys/list';apple.target='_blank';apple.rel='noopener noreferrer';settings.append(apple);
  }
  if(push?.configured&&!push.devices?.some(d=>d.enabled))settings.append(el('p','jn-muted','Apple signing is configured. No device has registered yet—open the updated native app and enable notifications.'));
  for(const d of push?.devices||[])settings.append(el('p','jn-muted',(d.platform||'Device')+' · '+(d.enabled===false?'disabled':d.lastError?'delivery needs attention':d.lastSuccessAt?'last accepted by Apple '+new Date(d.lastSuccessAt).toLocaleString():'registered; delivery not yet verified')));
  settings.append(el('p','jn-muted','The Jarvis server must remain online to send new alerts. Focus modes and system notification settings can silence delivery.'));
  const test=el('button','btn','Send test notification');test.onclick=async()=>{test.disabled=true;try{await request('/api/notifications/test',{});toast('Test alert saved. Check your registered devices and delivery status.');await refresh();await loadStatus();}catch(e){toast(e.message);}finally{test.disabled=false;}};settings.append(test);
  const check=el('button','btn','Check delivery status');check.onclick=async()=>{check.disabled=true;if(native)window.webkit?.messageHandlers?.native?.postMessage({action:'notificationStatus'});await loadStatus();};settings.append(check);
 }
 async function loadStatus(){try{status=await request('/api/notifications/status');}catch{status={push:{ready:false}};}renderSettings();}
 const prev=PAGES.settings;PAGES.settings=async view=>{await prev?.(view);if(!view.isConnected)return;settings=el('section','jn-settings');settings.id='notificationSettings';(view.querySelector('.settings-hub')||view).append(settings);renderSettings();loadStatus();if(window.__jarvisNativeNotifications)window.webkit?.messageHandlers?.native?.postMessage({action:'notificationStatus'});};
 window.addEventListener('jarvis:notification-status',e=>{nativeStatus=e.detail;toast(e.detail?.message||e.detail?.error||'Notification settings updated');loadStatus();});
 window.addEventListener('hashchange',render);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});setInterval(()=>{if(!document.hidden)refresh();},12000);refresh();
 window.JarvisNotifications={open:()=>{panel.hidden=false;render();refresh();},refresh};
})();
