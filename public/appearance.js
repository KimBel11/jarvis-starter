'use strict';
(() => {
  const KEY='jarvis.appearance.v1';
  const previewOnly=new URLSearchParams(location.search).get('appearance-preview')==='1';
  const colors=[['glacier','#2dd4ee','Glacier'],['champagne','#d7ad6a','Champagne'],['amethyst','#a78bfa','Amethyst'],['jade','#55d6a1','Jade'],['rose','#ee92b8','Rose'],['sapphire','#5897ff','Sapphire'],['ember','#ff9364','Ember'],['ruby','#f06b83','Ruby'],['ice','#d6f5ff','Ice'],['indigo','#7569ee','Indigo']];
  const defaults={accent:'#2dd4ee',orb:'aurora',motion:'subtle',effect:'particles',density:'comfortable',speed:1,glow:1,deform:1};
  function nearestColor(){const rgb=h=>h.slice(1).match(/../g).map(v=>parseInt(v,16));const a=rgb(prefs.accent);return [...colors].sort((x,y)=>rgb(x[1]).reduce((s,v,i)=>s+(v-a[i])**2,0)-rgb(y[1]).reduce((s,v,i)=>s+(v-a[i])**2,0))[0];} 
  const clamp=(v,min,max,fallback)=>Number.isFinite(Number(v))?Math.max(min,Math.min(max,Number(v))):fallback;
  const iconStyle=()=>['aurora','orbit','minimal','crystal','halo'].includes(prefs.orb)?prefs.orb:'aurora';
  function clean(p={}) { return {speed:clamp(p.speed,0.2,2,1),glow:clamp(p.glow,0,2,1),deform:clamp(p.deform,0,2,1),accent:/^#[0-9a-f]{6}$/i.test(p.accent)?p.accent:defaults.accent,orb:['aurora','orbit','minimal','crystal','halo','liquid','ribbon','wireframe'].includes(p.orb)?p.orb:defaults.orb,motion:['full','subtle','reduced','levitate','drift'].includes(p.motion)?p.motion:defaults.motion,effect:['particles','glow','rings','clean','rays'].includes(p.effect)?p.effect:defaults.effect,density:['comfortable','compact'].includes(p.density)?p.density:defaults.density}; }
  let prefs=clean(); try { prefs=clean(JSON.parse(localStorage.getItem(KEY))||{}); } catch (_) {}
  // when the owner changes the orb or the colour, Jarvis texts the matching profile picture (once things settle for a few seconds)
  let avatarTimer;function scheduleAvatar(){clearTimeout(avatarTimer);avatarTimer=setTimeout(()=>{try{fetch('/api/avatar/changed',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orb:iconStyle(),accent:prefs.accent})}).catch(()=>{});}catch(_){}},6000);}
  function apply(save=false) {
    save=save&&!previewOnly;
    const root=document.documentElement,body=document.body;
    root.style.setProperty('--jarvis-accent',prefs.accent); root.style.setProperty('--cyan',prefs.accent);
    const rgb=prefs.accent.slice(1).match(/../g).map(h=>parseInt(h,16)/255),max=Math.max(...rgb),min=Math.min(...rgb),d=max-min;
    let h=0;if(d)h=(max===rgb[0]?(rgb[1]-rgb[2])/d+(rgb[1]<rgb[2]?6:0):max===rgb[1]?(rgb[2]-rgb[0])/d+2:(rgb[0]-rgb[1])/d+4)*60;
    root.style.setProperty('--orb-hue',`${h-188}deg`);
    root.style.setProperty('--jarvis-motion-ms',prefs.motion==='reduced'?'1ms':prefs.motion==='subtle'?'280ms':'650ms');
    body.dataset.orbStyle=prefs.orb;body.dataset.motion=prefs.motion;body.dataset.density=prefs.density;
    let saved=true;if(save)try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){saved=false;}
    if(save)window.dispatchEvent(new CustomEvent('jarvis:appearance-edit',{detail:{...prefs}}));
    window.dispatchEvent(new CustomEvent('jarvis:appearance',{detail:{...prefs}}));return saved;
  }
  window.JarvisAppearance={get:()=>({...prefs}),receive:value=>{prefs=clean(value);try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){}apply();},colors:colors.map(c=>({...{id:c[0],hex:c[1],name:c[2]}}))};
  // The native lock screen uses the same renderer, not a second copy of the orb design.
  let nativeSyncTimer;
  function syncNativeAppearance() {
    if (previewOnly || !window.__jarvisNative || !window.webkit?.messageHandlers?.native || typeof Orb === 'undefined') return;
    clearTimeout(nativeSyncTimer);
    nativeSyncTimer=setTimeout(()=>{
      let orb;
      try {
        const canvas=document.createElement('canvas');
        orb=new Orb(canvas);orb.preview=true;orb.setState('idle');
        canvas.width=512;canvas.height=512;
        orb.frame(0,1); // Resolve the selected idle palette immediately.
        window.webkit.messageHandlers.native.postMessage({action:'syncLockAppearance',accent:prefs.accent,motion:prefs.motion,orb:prefs.orb,effect:prefs.effect,image:canvas.toDataURL('image/png')});
      } catch (_) { /* Keep the last saved lock appearance if rendering is unavailable. */ }
      finally { if(orb){orb.observer?.disconnect();Orb.all.delete(orb);} }
    },120);
  }
  window.addEventListener('jarvis:appearance',syncNativeAppearance);
  window.addEventListener('pageshow',syncNativeAppearance);
  apply();
  const original=PAGES.settings;
  PAGES.settings=async v=>{
    if(original)await original(v);
    if(!v.isConnected)return;
    const section=document.createElement('section');section.className='appearance-panel';section.setAttribute('aria-labelledby','appearanceTitle');
    section.innerHTML=`<div class="appearance-heading"><div><span class="appearance-kicker">MAKE IT YOURS</span><h2 id="appearanceTitle">Appearance</h2><p>A quieter workspace. A signature of your own.</p></div><button type="button" class="btn" data-reset>Reset</button></div><div class="appearance-layout"><div class="appearance-preview" aria-hidden="true"><canvas class="appearance-preview-canvas"></canvas><span>JARVIS</span><small>Your personal workspace</small></div><div class="appearance-options"><fieldset><legend>Accent color</legend><div class="appearance-swatches">${colors.map(([,c,n])=>`<button type="button" data-color="${c}" style="--swatch:${c}" aria-label="${n}" title="${n}"></button>`).join('')}<label class="appearance-custom">Custom<input type="color" aria-label="Custom accent color" value="${prefs.accent}"></label></div></fieldset><fieldset><legend>Orb style</legend><div class="appearance-choices">${[['aurora','Aurora'],['orbit','Orbital'],['minimal','Sphere'],['crystal','Crystal'],['halo','Halo'],['liquid','Liquid glass'],['ribbon','Ribbon'],['wireframe','Wireframe']].map(([id,n])=>`<button type="button" data-orb="${id}">${n}</button>`).join('')}</div></fieldset><div class="appearance-selects"><label>Motion<select data-pref="motion"><option value="subtle">Subtle</option><option value="full">Energized</option><option value="levitate">Levitate</option><option value="drift">Drift</option><option value="reduced">Reduced</option></select></label><label>Effect<select data-pref="effect"><option value="particles">Stardust</option><option value="glow">Soft glow</option><option value="rings">Ripple rings</option><option value="clean">Clean</option><option value="rays">Solar rays</option></select></label><label>Spacing<select data-pref="density"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></div><div class="appearance-selects">${[["speed","Motion speed",0.2,2],["glow","Outer glow",0,2],["deform","Shape fluidity",0,2]].map(([id,label,min,max])=>`<label>${label}<output data-value="${id}"></output><input type="range" data-pref="${id}" min="${min}" max="${max}" step="0.1"></label>`).join('')}</div><div class="appearance-icon-control"><button type="button" class="btn" data-app-icon>Apply matching app icon</button><p class="appearance-icon-note" role="status"></p></div><p class="appearance-note" role="status">Shared across your Jarvis devices. System reduced-motion preferences take priority.</p></div></div>`;
    const hub=v.querySelector('.settings-hub')||v;const anchor=hub.querySelector('.settings-search-wrap');if(anchor)hub.insertBefore(section,anchor);else hub.prepend(section);
    const preview=new Orb(section.querySelector('canvas'));preview.preview=true;preview.setState('idle');
    let iconPending=false;
    const iconButton=section.querySelector('[data-app-icon]'),iconNote=section.querySelector('.appearance-icon-note');
    function iconHelp(){const c=nearestColor();iconButton.disabled=!window.__jarvisAlternateIcons||iconPending;iconNote.textContent=window.__jarvisAlternateIcons?`App icon: ${c[2]} · ${iconStyle()}. ${iconStyle()!==prefs.orb?"This orb uses the Aurora launcher icon. ":""} ${c[1].toLowerCase()!==prefs.accent.toLowerCase()?'Custom colors use the closest available icon color. ':''}Changes only when you apply.`:'App icon changes are available in the updated iPhone app. Browser and desktop icons stay unchanged.';}
    const externalSync=()=>{if(!section.isConnected){window.removeEventListener('jarvis:shared-appearance',externalSync);return;}sync();};window.addEventListener('jarvis:shared-appearance',externalSync);
    const iconResult=e=>{if(!section.isConnected){window.removeEventListener('jarvis:app-icon-result',iconResult);return;}iconPending=false;clearTimeout(iconTimer);iconButton.disabled=!window.__jarvisAlternateIcons;iconNote.textContent=e.detail?.ok?'App icon updated.':(e.detail?.error||'Could not change the icon. Please try again.');};
    let iconTimer;window.addEventListener('jarvis:app-icon-result',iconResult);
    function sync(){iconHelp();section.querySelectorAll('[data-color]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.color.toLowerCase()===prefs.accent.toLowerCase())));section.querySelectorAll('[data-orb]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.orb===prefs.orb)));section.querySelector('input[type=color]').value=prefs.accent;section.querySelectorAll('[data-pref]').forEach(s=>s.value=prefs[s.dataset.pref]);section.querySelectorAll("[data-value]").forEach(o=>o.textContent=Number(prefs[o.dataset.value]).toFixed(1)+"×");}
    function update(){const saved=apply(true);sync();section.querySelector('.appearance-note').textContent=previewOnly?'Preview only. Your saved appearance has not changed.':saved?'Shared across your Jarvis devices. System reduced-motion preferences take priority.':'Preview applied. Browser storage is unavailable; these changes will reset after reload.';}
    section.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.hasAttribute('data-app-icon')){if(!window.__jarvisAlternateIcons||iconPending)return;iconPending=true;iconButton.disabled=true;iconNote.textContent='Updating app icon…';try{window.webkit.messageHandlers.native.postMessage({action:'setAppIcon',icon:`${iconStyle()}-${nearestColor()[0]}`});iconTimer=setTimeout(()=>{iconPending=false;iconButton.disabled=false;iconNote.textContent='No confirmation received. Try again from the iPhone app.';},15000);}catch(_){iconPending=false;iconButton.disabled=false;iconNote.textContent='App icon connection unavailable.';}return;}if(b.hasAttribute('data-reset'))prefs={...defaults};else if(b.dataset.color)prefs.accent=b.dataset.color;else if(b.dataset.orb)prefs.orb=b.dataset.orb;else return;update();});
    section.addEventListener('input',e=>{if(e.target.type==='color'){prefs.accent=e.target.value;update();}});
    section.addEventListener('change',e=>{if(e.target.dataset.pref){prefs[e.target.dataset.pref]=e.target.type==='range'?Number(e.target.value):e.target.value;update();}});sync();
  };
})();
