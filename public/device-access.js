(() => {
 'use strict';
 const h=(t,c,text)=>{const n=document.createElement(t);n.className=c||'';if(text!==undefined)n.textContent=text;return n;};
 async function mount(parent,st){
  const section=h('section','card');section.id='device-access';parent.append(section);
  async function refresh(){
   try {const d=await api('/api/remote/devices');if(!section.isConnected)return;section.replaceChildren(h('h2','','Device access'),h('p','muted','Saved sign-ins, not a list of nearby hardware. Revoking one removes its cookie and remembered sign-in access. It must enter your passphrase again.'));
    if(d.local)section.append(h('p','muted','This host Mac runs Jarvis locally and is trusted by the server. It is not a remote sign-in and cannot be revoked here.'));
    const list=h('div','device-access-list');section.append(list);
    if(!d.devices.length)list.append(h('p','muted','No remote devices are signed in.'));
    for(const device of d.devices){const row=h('div','device-access-row'),info=h('div');info.append(h('strong','',device.name+' · '+device.id.slice(0,8)+(device.current?' · This sign-in':'')),h('small','',device.lastSeen?'Last seen '+new Date(device.lastSeen).toLocaleString():'Last seen unknown · reconnect to identify this older sign-in'));const remove=h('button','btn sm','Revoke access');remove.onclick=async()=>{if(!confirm('Sign out '+device.name+'? It will need your Jarvis passphrase to regain access.'))return;try{await post('/api/remote/devices/revoke',{id:device.id});if(device.current){localStorage.removeItem('jv-device');location.reload();return;}await refresh();toast('Device access revoked');}catch(e){toast(e.message);}};row.append(info,remove);list.append(row);}
    const actions=h('div','pill-row');actions.style.marginTop='18px';const reload=h('button','btn','Refresh devices');reload.onclick=refresh;actions.append(reload);
    if(st.hasPassphrase){const change=h('button','btn primary','Change passphrase');change.onclick=()=>changePassphrase(section,d.local);actions.append(change);}
    if(d.local){const codes=h('button','btn','Show pending verification');codes.onclick=async()=>{try{const pending=await api('/api/remote/verification');let box=section.querySelector('.device-verifications');if(!box){box=h('div','device-verifications');section.append(box);}box.replaceChildren(h('p','muted','Only use a code for a change you requested. Codes expire after five minutes.'));for(const c of pending.requests)box.append(h('small','',c.device+' · request '+c.id.slice(0,8)),h('div','device-code',c.code));if(!pending.requests.length)box.append(h('p','','No pending changes.'));}catch(e){toast(e.message);}};actions.append(codes);}section.append(actions);
   }catch(e){section.replaceChildren(h('p','',e.message));}
  }
  await refresh();
 }
 function changePassphrase(section,isLocal){
  section.querySelector('.device-change')?.remove();const form=h('form','device-change');form.style.marginTop='20px';form.append(h('h3','','Verify a passphrase change'),h('p','muted','Enter your current passphrase, then choose and confirm a new one. The final verification code is shown only in Device access on the host Mac (localhost:4777). Changing it signs out all remote devices.'));
  const input=(label,auto)=>{const wrap=h('label','field',label),el=h('input');el.type='password';el.required=true;el.autocomplete=auto;el.minLength=auto==='new-password'?10:1;el.maxLength=1024;wrap.append(el);form.append(wrap);return el;};
  const current=input('Current passphrase','current-password'),next=input('New passphrase','new-password'),again=input('Confirm new passphrase','new-password'),submit=h('button','btn primary','Request verification'),cancel=h('button','btn','Cancel'),error=h('p','t-err');cancel.type='button';cancel.onclick=()=>form.remove();form.append(submit,cancel,error);section.append(form);
  form.onsubmit=async e=>{e.preventDefault();error.textContent='';if(next.value!==again.value){error.textContent='The new passphrases do not match.';return;}submit.disabled=true;try{const request=await post('/api/remote/verification',{currentPassphrase:current.value,newPassphrase:next.value});current.value=next.value=again.value='';form.replaceChildren(h('p','','Request '+request.id.slice(0,8)+'. Open Device access on the host Mac and select Show pending verification. Enter its six-digit code below.'));
    const code=h('input');code.inputMode='numeric';code.pattern='[0-9]{6}';code.maxLength=6;code.required=true;code.autocomplete='one-time-code';code.setAttribute('aria-label','Host Mac verification code');const finish=h('button','btn primary','Verify and change passphrase');form.append(code,finish,cancel,error);
    form.onsubmit=async ev=>{ev.preventDefault();finish.disabled=true;error.textContent='';try{await post('/api/remote/passphrase',{id:request.id,code:code.value});localStorage.removeItem('jv-device');form.replaceChildren(h('p','','Passphrase changed. All remote sign-ins have been revoked.'));if(!isLocal)location.reload();else toast('Passphrase changed; remote devices signed out');}catch(ex){error.textContent=ex.message;finish.disabled=false;}};
   }catch(ex){error.textContent=ex.message;submit.disabled=false;}};
 }
 window.JarvisDeviceAccess={mount};
})();
