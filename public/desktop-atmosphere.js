'use strict';
(() => {
  const KEY='jarvis.desktop.atmosphere.v1';
  const styles=[['aurora','Aurora','Soft ribbons of your accent color'],['stars','Starlight','A quiet field of distant lights'],['flow','Silk','Slow flowing washes of color'],['grid','Perspective','A luminous architectural grid'],['off','None','An uninterrupted canvas']];
  const defaults={style:'aurora',intensity:35,motion:'slow'};
  const clean=p=>({style:styles.some(s=>s[0]===p?.style)?p.style:defaults.style,intensity:Number.isFinite(Number(p?.intensity))?Math.max(0,Math.min(100,Number(p.intensity))):defaults.intensity,motion:['slow','lively','still'].includes(p?.motion)?p.motion:defaults.motion});
  let prefs=clean();try{prefs=clean(JSON.parse(localStorage.getItem(KEY)));}catch(_){}
  const layer=document.createElement('div');layer.id='desktopAtmosphere';layer.setAttribute('aria-hidden','true');
  layer.innerHTML='<i class="da-wash da-one"></i><i class="da-wash da-two"></i><i class="da-stars"></i><i class="da-grid"></i>';
  document.body.prepend(layer);
  function apply(save=false){layer.dataset.style=prefs.style;layer.dataset.motion=prefs.motion;layer.style.setProperty('--da-intensity',String(prefs.intensity/100));layer.style.setProperty('--da-duration',prefs.motion==='lively'?'22s':'48s');let saved=true;if(save)try{localStorage.setItem(KEY,JSON.stringify(prefs));}catch(_){saved=false;}return saved;}
  function visibility(){layer.classList.toggle('da-paused',document.hidden);}
  document.addEventListener('visibilitychange',visibility);visibility();apply();
  window.JarvisAtmosphere={get:()=>({...prefs})};
  const original=PAGES.settings;
  PAGES.settings=async view=>{
    if(original)await original(view);if(!view.isConnected)return;
    const section=document.createElement('section');section.className='da-settings';section.setAttribute('aria-labelledby','desktopAtmosphereTitle');
    section.innerHTML=`<div class="da-heading"><div><span class="appearance-kicker">DESKTOP CANVAS</span><h2 id="desktopAtmosphereTitle">Atmosphere</h2><p>Give your workspace a little depth. Your orb stays at the center of attention.</p></div><button type="button" class="btn" data-da-reset>Reset</button></div><div class="da-presets">${styles.map(([id,name,description])=>`<button type="button" data-da-style="${id}" aria-pressed="false"><span class="da-sample da-sample-${id}" aria-hidden="true"></span><strong>${name}</strong><small>${description}</small></button>`).join('')}</div><div class="da-controls"><label>Intensity <output data-da-value></output><input data-da-intensity type="range" min="0" max="100" step="5"></label><label>Animation<select data-da-motion><option value="slow">Slow drift</option><option value="lively">Flowing</option><option value="still">Still</option></select></label></div><p class="da-note" role="status">Desktop home only. Saved on this device. Reduced-motion preferences are respected.</p>`;
    const hub=view.querySelector('.settings-hub')||view;const appearance=hub.querySelector('.appearance-panel');if(appearance)appearance.after(section);else hub.append(section);
    function sync(){section.querySelectorAll('[data-da-style]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.daStyle===prefs.style)));section.querySelector('[data-da-intensity]').value=prefs.intensity;section.querySelector('[data-da-value]').textContent=`${prefs.intensity}%`;section.querySelector('[data-da-motion]').value=prefs.motion;}
    function update(){const saved=apply(true);sync();section.querySelector('.da-note').textContent=saved?'Desktop home only. Saved on this device. Reduced-motion preferences are respected.':'Preview applied. Device storage is unavailable; changes will reset after reload.';}
    section.addEventListener('click',e=>{const button=e.target.closest('button');if(!button)return;if(button.hasAttribute('data-da-reset'))prefs={...defaults};else if(button.dataset.daStyle)prefs.style=button.dataset.daStyle;else return;update();});
    section.querySelector('[data-da-intensity]').addEventListener('input',e=>{prefs.intensity=Number(e.target.value);update();});
    section.querySelector('[data-da-motion]').addEventListener('change',e=>{prefs.motion=e.target.value;update();});sync();
  };
})();
