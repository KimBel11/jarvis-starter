/* Desktop-only shell behavior; never replaces conversation or voice lifecycles. */
(() => {
  const desktop=matchMedia('(min-width:801px)'), side=document.querySelector('body>.side');
  if(!side)return;
  const reveal=document.createElement('button');
  reveal.id='desktopNavReveal'; reveal.type='button';
  reveal.setAttribute('aria-label','Open navigation');reveal.setAttribute('aria-controls','nav');reveal.setAttribute('aria-expanded','false');
  reveal.title='Navigation · hover here or press Enter';document.body.prepend(reveal);
  let closeTimer, pocket=null, chatPocket=null;
  function setOpen(open){
    if(!desktop.matches)return;
    clearTimeout(closeTimer);document.body.classList.toggle('desktop-nav-open',open);
    reveal.setAttribute('aria-expanded',String(open));reveal.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    side.inert=!open;
  }
  function delayedClose(){clearTimeout(closeTimer);closeTimer=setTimeout(()=>{if(!side.matches(':hover')&&!side.contains(document.activeElement))setOpen(false);},220);}
  reveal.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')setOpen(true);});
  reveal.addEventListener('pointerleave',delayedClose);
  reveal.addEventListener('click',()=>{
    if(!desktop.matches)return;
    setOpen(!document.body.classList.contains('desktop-nav-open'));
  });
  side.addEventListener('pointerenter',()=>clearTimeout(closeTimer));
  side.addEventListener('pointerleave',delayedClose);
  side.addEventListener('focusout',delayedClose);
  side.addEventListener('click',e=>{if(desktop.matches&&e.target.closest('a[href]')){document.activeElement?.blur();setOpen(false);}});
  document.addEventListener('pointerdown',e=>{if(desktop.matches&&!side.contains(e.target)&&e.target!==reveal)setOpen(false);});
  document.addEventListener('keydown',e=>{if(desktop.matches&&e.key==='Escape'&&document.body.classList.contains('desktop-nav-open')){setOpen(false);reveal.focus({preventScroll:true});}});
  function adapt(){
    const brief=document.getElementById('homeDailyBrief');
    if(desktop.matches){
      if(brief&&!brief.closest('.desktop-brief-pocket')){
        pocket=document.createElement('details');pocket.className='desktop-brief-pocket';
        const summary=document.createElement('summary');summary.textContent='Today’s brief';pocket.append(summary);
        brief.before(pocket);pocket.append(brief);
      }
      if(pocket?.isConnected&&(!chatPocket||!chatPocket.isConnected)){
        chatPocket=document.createElement('details');chatPocket.className='desktop-chat-pocket';
        const cs=document.createElement('summary');cs.textContent='Last conversation';chatPocket.append(cs);
        pocket.after(chatPocket);window.JarvisRecentChats?.mount(chatPocket);
      }
    }else{
      if(chatPocket?.isConnected)chatPocket.remove();chatPocket=null;
      if(pocket?.isConnected){pocket.before(...[...pocket.children].filter(x=>x.tagName!=='SUMMARY'));pocket.remove();}
      pocket=null;side.inert=false;document.body.classList.remove('desktop-nav-open');
    }
  }
  function archiveLink(){
    const nav=document.querySelector('#nav .nav-primary');if(!nav)return;
    let link=nav.querySelector('[data-r="sessions"]');
    if(desktop.matches&&!link){
      link=document.createElement('a');link.href='#/sessions';link.dataset.r='sessions';link.dataset.desktopArchive='true';
      link.innerHTML='<span class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 4h16v12H9l-5 4V4Zm4 4h8M8 12h5"/></svg></span><span>Conversations</span>';
      nav.querySelector('[data-r="projects"]')?.after(link);
    }
    if(!desktop.matches&&link?.dataset.desktopArchive){link.remove();return;}
    if(link){const active=location.hash.startsWith('#/sessions');link.classList.toggle('on',active);if(active){nav.querySelectorAll('[aria-current]').forEach(a=>{if(a!==link){a.removeAttribute('aria-current');a.classList.remove('on');}});link.setAttribute('aria-current','page');}else link.removeAttribute('aria-current');}
  }
  new MutationObserver(archiveLink).observe(document.getElementById('nav'),{childList:true,subtree:true});
  window.addEventListener('hashchange',archiveLink);archiveLink();
  desktop.addEventListener('change',()=>{if(desktop.matches)setOpen(false);adapt();archiveLink();});
  new MutationObserver(adapt).observe(document.getElementById('view'),{childList:true,subtree:true});
  window.addEventListener('hashchange',()=>{if(desktop.matches)setOpen(false);});
  if(desktop.matches)setOpen(false);adapt();
})();

/* Desktop canvas editor. Layout is local; mobile retains its normal document flow. */
(() => {
 const media=matchMedia('(min-width:801px)'),KEY='jarvis.desktop.layout.v2';
 const specs=[
  ['alerts','.jn-bell','Alerts button',100,44,.95,.045],
  ['activity','#activityHomeButton','Activity button',112,38,.07,.045],
  ['lead','.home-graph-hero>.lead-control','Lead model',340,100,.5,.10],
  ['eyebrow','.home-scene-eyebrow','Workspace label',360,28,.5,.20,true],
  ['greeting','.home-scene-heading h1','Greeting',600,56,.5,.23,false,34],
  ['subtitle','.home-scene-heading p','Subtitle',560,32,.5,.30,false,14],
  ['orb','.home-orb-layer','Orb',Math.min(420,innerHeight*.4),Math.min(420,innerHeight*.4),.5,.52],
  ['orbLabel','.home-orb-name','Orb label',180,30,.5,.70,true,12],
  ['status','.home-scene-status','Status text',520,32,.5,.77,false,13],
  ['composer','.home-scene-compose','Message field',620,62,.5,.85],
  ['hint','.home-scene-footnote','Voice hint',500,30,.5,.93,true,12],
  ['brief','.desktop-brief-pocket','Daily brief',310,120,.16,.87],
  ['lastchat','.desktop-chat-pocket','Last conversation',310,120,.16,.93],
  ['conversation','#view #jPanel','Conversation',Math.min(420,innerWidth*.34),Math.min(440,innerHeight*.44),.83,.54]
 ];
 let state={items:{},widgets:[],snap:true,grid:8,margin:24},legacy={};
 try{const s=JSON.parse(localStorage.getItem(KEY));if(s&&typeof s.items==='object'&&Array.isArray(s.widgets)){state.snap=s.snap!==false;state.grid=[4,8,16,24].includes(s.grid)?s.grid:8;state.margin=[16,24,32,48].includes(s.margin)?s.margin:24;state.items=s.items||{};state.compactManual=s.compactManual===true;state.canvasViewport=s.canvasViewport;state.compactViewport=s.compactViewport;state.compactItems=s.compactItems&&typeof s.compactItems==='object'&&!Array.isArray(s.compactItems)?s.compactItems:{};state.widgets=s.widgets.filter(x=>x&&typeof x.id==='string'&&/^widget-[a-z0-9-]+$/.test(x.id)&&typeof x.type==='string').slice(0,16);}else legacy=JSON.parse(localStorage.getItem('jarvis.desktop.layout.v1')||'{}')||{};}catch{}
 let editing=false,selected=null,drag=null,raf=0,host=null,focused=false,suppressClickUntil=0,blankStart=null;
 const els=new Map(),labels=new Map();
 const ui=document.createElement('aside');ui.id='desktopCanvasEditor';ui.innerHTML='<div class="dc-toolbar"><button data-action="edit" aria-pressed="false">Customize</button><button data-action="focus" aria-pressed="false" title="Click empty space to hide or show widgets">Focus</button><button data-action="add" hidden>Add widget</button><button data-action="layout" hidden>Elements & layout</button><span class="dc-save" role="status"></span></div><section class="dc-panel" hidden aria-label="Desktop customization"><header><strong>Your workspace</strong><button data-action="close" aria-label="Close customization panel">×</button></header><div class="dc-panel-body"></div></section>';document.body.append(ui);
 const panel=ui.querySelector('.dc-panel'),body=ui.querySelector('.dc-panel-body'),editButton=ui.querySelector('[data-action=edit]');let panelMode='layout',renderedKeys='';
 // Share the bottom row without letting notifications cover the toolbar.
 function reserveCorner(){
  const toolbar=ui.querySelector('.dc-toolbar'),r=toolbar.getBoundingClientRect();
  const visible=toolbar.getClientRects().length>0;
  document.documentElement.style.setProperty('--agent-dock-right',(visible?Math.ceil(innerWidth-r.left+12):16)+'px');
 }
 const cornerObserver=new ResizeObserver(reserveCorner);cornerObserver.observe(ui);
 new MutationObserver(reserveCorner).observe(ui,{subtree:true,attributes:true,attributeFilter:['hidden']});
 addEventListener('resize',reserveCorner);
 const guides=document.createElement('div');guides.className='dc-guides';guides.setAttribute('aria-hidden','true');document.body.append(guides);
 const clamp=(v,min,max)=>Math.max(min,Math.min(Math.max(min,max),v)),number=(v,fallback)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
 const active=()=>media.matches&&document.body.classList.contains('graph-home');
 function layoutItems(){return innerWidth>800&&innerWidth<1400?(state.compactItems||(state.compactItems={})):state.items;}
 function save(){if(editing){const compact=innerWidth>800&&innerWidth<1400;if(compact)state.compactManual=true;state[compact?'compactViewport':'canvasViewport']={width:innerWidth,height:innerHeight};}try{localStorage.setItem(KEY,JSON.stringify(state));ui.querySelector('.dc-save').textContent='Saved on this device';}catch{ui.querySelector('.dc-save').textContent='Storage unavailable · layout is temporary';}}
 function config(id,w=300,h=220,x=.8,y=.35,hidden=false,font){
  const items=layoutItems();if(!items[id]&&items!==state.items&&state.items[id])items[id]={...state.items[id]};
  let c=items[id];if(!c||typeof c!=='object'||Array.isArray(c)){c={w,h,x,y,hidden,z:10,font};const old=legacy[id==='subtitle'?'greeting':id];if(Array.isArray(old)){c.x+=number(old[0],0);c.y+=number(old[1],0);}items[id]=c;if(id==='lastchat'&&items.brief&&typeof items.brief.x==='number'){c.x=items.brief.x;c.y=Math.min(.95,items.brief.y+.055);}}
  c.w=clamp(number(c.w,w),id==='orb'?120:70,10000);c.h=clamp(number(c.h,h),id==='orb'?120:26,10000);if(id==='orb')c.h=c.w=Math.min(c.w,c.h);
  c.x=clamp(number(c.x,x),0,1);c.y=clamp(number(c.y,y),0,1);c.z=clamp(number(c.z,10),1,45);c.font=clamp(number(c.font,font||14),9,72);c.hidden=c.hidden===true;return c;
 }
 function apply(id,el){if(id==='conversation'&&!editing){for(const key of ['left','top','width','height','margin'])el.style.removeProperty(key);return;}const saved=config(id),margin=state.margin||24,c={...saved,w:Math.min(saved.w,innerWidth-2*margin),h:Math.min(saved.h,innerHeight-2*margin)};if(id==='orb')c.h=c.w=Math.min(c.w,c.h);const left=clamp(c.x*innerWidth-c.w/2,margin,innerWidth-c.w-margin),top=clamp(c.y*innerHeight-c.h/2,margin,innerHeight-c.h-margin);Object.assign(el.style,{left:left+'px',top:top+'px',width:c.w+'px',height:c.h+'px',zIndex:String(['alerts','activity'].includes(id)?105:c.z)});el.style.setProperty('--dc-font',c.font+'px');if(id==='conversation'){for(const [k,v]of Object.entries({left:left+'px',top:top+'px',width:c.w+'px',height:c.h+'px',margin:'0'}))el.style.setProperty(k,v,'important');}el.classList.toggle('dc-hidden',c.hidden);el.classList.toggle('dc-selected',selected===id);}
 function needsResponsiveFit(crowded){
  const compact=innerWidth<1400;
  if(compact&&!state.compactManual)return true;
  const viewport=state[compact?'compactViewport':'canvasViewport'];
  // Older saved layouts are authoritative too; do not rearrange them on Done.
  const smaller=viewport&&((Number.isFinite(viewport.width)&&innerWidth<viewport.width-1)||(Number.isFinite(viewport.height)&&innerHeight<viewport.height-1));
  return !!(crowded&&(smaller||(compact&&!viewport)));
 }
 // Responsive placement is derived only. Never write it back into the saved canvas.
 function fitWidgets(){
  if(!host)return;
  const cards=state.widgets.map(w=>({id:w.id,el:els.get(w.id),c:config(w.id)})).filter(w=>w.el);
  const visible=cards.filter(w=>!w.c.hidden),gap=state.margin||24;
  const overlap=(a,b)=>a.left<b.right+gap&&a.right+gap>b.left&&a.top<b.bottom+gap&&a.bottom+gap>b.top;
  const requested=w=>{const width=Math.min(w.c.w,innerWidth-2*gap),height=Math.min(w.c.h,innerHeight-2*gap),left=clamp(w.c.x*innerWidth-width/2,gap,innerWidth-width-gap),top=clamp(w.c.y*innerHeight-height/2,gap,innerHeight-height-gap);return {left,top,right:left+width,bottom:top+height};};
  const centers=['orb','greeting','composer'].map(id=>els.get(id)).filter(el=>el&&el.getClientRects().length).map(el=>el.getBoundingClientRect());
  const crowded=visible.some((a,i)=>visible.slice(i+1).some(b=>overlap(requested(a),requested(b)))||centers.some(r=>overlap(requested(a),r)));
  const fitted=!editing&&!drag&&visible.length>0&&needsResponsiveFit(crowded);
  host.classList.toggle('dc-fitted',fitted);
  document.body.classList.toggle('desktop-widget-fit',fitted);
  if(!fitted){for(const w of cards)if(w.el.parentElement!==host)host.append(w.el);host.querySelectorAll('.dc-widget-rail').forEach(r=>r.remove());return;}
  const railWidth=Math.min(340,Math.max(220,innerWidth*.22));
  host.style.setProperty('--rail-width',railWidth+'px');
  for(const side of ['left','right']){
   let rail=host.querySelector('[data-rail="'+side+'"]');
   if(!rail){rail=document.createElement('div');rail.className='dc-widget-rail';rail.dataset.rail=side;rail.setAttribute('role','region');rail.setAttribute('aria-label',side+' workspace widgets');rail.tabIndex=0;host.append(rail);}
   const group=cards.filter(w=>(w.c.x<.5?'left':'right')===side).sort((a,b)=>a.c.y-b.c.y);
   for(const w of group){if(w.el.parentElement!==rail)rail.append(w.el);w.el.style.setProperty('--fitted-height',Math.max(170,Math.min(w.c.h,innerHeight-180))+'px');}
  }
  const left=gap+railWidth+24,right=innerWidth-gap-railWidth-24,lane=Math.max(200,right-left);
  for(const [id,el]of els){if(id.startsWith('widget-')||['conversation','alerts','activity'].includes(id))continue;if(id==='brief'||id==='lastchat'){Object.assign(el.style,{left:gap+'px',top:(innerHeight-(id==='brief'?142:112))+'px',width:railWidth+'px',height:'26px'});continue;}const c=config(id),r=el.getBoundingClientRect(),w=Math.min(r.width,lane),h=id==='orb'?Math.min(w,r.height):r.height;
   el.style.width=w+'px';if(id==='orb')el.style.height=h+'px';
   el.style.left=(id==='orb'?(innerWidth-w)/2:clamp(c.x*innerWidth-w/2,left,right-w))+'px';
   if(id==='orb')el.style.top=clamp(c.y*innerHeight-h/2,110,innerHeight-h-120)+'px';
  }
 }
 function select(id){selected=id;for(const [k,el]of els)el.classList.toggle('dc-selected',k===id);if(!panel.hidden&&panelMode==='layout')renderPanel();}
 function setFocus(value){focused=value;document.body.classList.toggle('desktop-canvas-focus',active()&&focused);ui.querySelector('[data-action=focus]').setAttribute('aria-pressed',String(focused));ui.querySelector('[data-action=focus]').textContent=focused?'Show workspace':'Focus';}
 function snapMove(id,left,top){
  guides.replaceChildren();if(!state.snap)return {left,top};const c=config(id),gap=state.margin||24,grid=state.grid||8;
  left=gap+Math.round((left-gap)/grid)*grid;top=gap+Math.round((top-gap)/grid)*grid;
  const xs=[gap,innerWidth-gap-c.w],ys=[gap,innerHeight-gap-c.h];
  for(const [key,el]of els){if(key===id||!key.startsWith('widget-')||layoutItems()[key]?.hidden||!el.getClientRects().length)continue;const r=el.getBoundingClientRect();xs.push(r.left,r.right-c.w,r.right+gap,r.left-c.w-gap);ys.push(r.top,r.bottom-c.h,r.bottom+gap,r.top-c.h-gap);}
  function near(value,targets,axis){const target=targets.reduce((best,x)=>Math.abs(x-value)<Math.abs(best-value)?x:best,Infinity);if(Math.abs(target-value)>10)return value;const line=document.createElement('i');line.className=axis;line.style[axis==='x'?'left':'top']=target+'px';guides.append(line);return target;}
  return {left:near(left,xs,'x'),top:near(top,ys,'y')};
 }
 function alignDrop(id,el){
  if(!state.snap||!id.startsWith('widget-'))return;const r=el.getBoundingClientRect(),gap=state.margin||24,c=config(id);let target=null,area=0;
  for(const [key,other]of els){if(key===id||!key.startsWith('widget-')||layoutItems()[key]?.hidden||!other.getClientRects().length)continue;const q=other.getBoundingClientRect(),overlap=Math.max(0,Math.min(r.right,q.right)-Math.max(r.left,q.left))*Math.max(0,Math.min(r.bottom,q.bottom)-Math.max(r.top,q.top));if(overlap>area){area=overlap;target=q;}}
  if(!target||area<Math.min(r.width*r.height,target.width*target.height)*.2)return;
  const q=target,positions=[[q.right+gap,q.top],[q.left-q.width-gap,q.top],[q.left,q.bottom+gap],[q.left,q.top-q.height-gap]].filter(([x,y])=>x>=gap&&y>=gap&&x+q.width<=innerWidth-gap&&y+q.height<=innerHeight-gap);
  const free=positions.filter(([x,y])=>![...els].some(([key,other])=>{if(key===id||!key.startsWith('widget-')||layoutItems()[key]?.hidden||!other.getClientRects().length)return false;const b=other.getBoundingClientRect();return x<b.right&&x+q.width>b.left&&y<b.bottom&&y+q.height>b.top;}));
  free.sort((a,b)=>Math.hypot(a[0]-r.left,a[1]-r.top)-Math.hypot(b[0]-r.left,b[1]-r.top));if(!free.length){ui.querySelector('.dc-save').textContent='No clear matching space · move another widget first';return;}
  c.w=q.width;c.h=q.height;c.x=(free[0][0]+c.w/2)/innerWidth;c.y=(free[0][1]+c.h/2)/innerHeight;apply(id,el);el._dcPosition?.();
 }
 function finish(){if(!drag)return;const previous=drag;drag=null;guides.replaceChildren();document.body.classList.remove('dc-dragging');if(previous.moved){if(previous.mode==='move')alignDrop(previous.id,previous.el);suppressClickUntil=Date.now()+400;save();}if(!panel.hidden&&panelMode==='layout')renderPanel();}
 function begin(e,id,el,mode){if(!active()||e.button!==0||document.body.classList.contains('jarvis-scene-open'))return;e.preventDefault();e.stopPropagation();if(host?.classList.contains('dc-fitted')){editing=true;sync();}select(id);const c=config(id),r=el.getBoundingClientRect();drag={id,el,mode,pointer:e.pointerId,x:e.clientX,y:e.clientY,left:r.left,top:r.top,w:r.width,h:r.height,moved:false};e.currentTarget.setPointerCapture(e.pointerId);}
 function move(e){if(!drag||drag.pointer!==e.pointerId)return;const {id,el,mode}=drag,c=config(id),dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)<3&&!drag.moved)return;drag.moved=true;document.body.classList.add('dc-dragging');if(mode==='move'){const p=snapMove(id,drag.left+dx,drag.top+dy);c.x=(p.left+c.w/2)/innerWidth;c.y=(p.top+c.h/2)/innerHeight;}else{c.w=drag.w+(id==='orb'?(Math.abs(dx)>Math.abs(dy)?dx:dy):dx);c.h=id==='orb'?c.w:drag.h+dy;c.x=(drag.left+c.w/2)/innerWidth;c.y=(drag.top+c.h/2)/innerHeight;}apply(id,el);el._dcPosition?.();}

 function bind(el,id,label){
  if(el.dataset.canvasElement===id){els.set(id,el);return;}el.dataset.canvasElement=id;el.classList.add('dc-element');els.set(id,el);labels.set(id,label);
  const handle=document.createElement('button');handle.type='button';handle.className='dc-handle';handle.textContent='⠿ '+label;handle.setAttribute('aria-label','Move '+label+'; arrow keys move, Shift moves faster');
  const resize=document.createElement('button');resize.type='button';resize.className='dc-resize';resize.textContent='↘';resize.setAttribute('aria-label','Resize '+label+'; arrow keys resize');
  // Inputs/buttons cannot contain editor buttons. Handles are separate siblings in an overlay.
  const chrome=document.createElement('div');chrome.className='dc-chrome';chrome.dataset.forElement=id;chrome.append(handle,resize);document.body.append(chrome);el._dcChrome=chrome;
  function chromePosition(){const r=el.getBoundingClientRect();Object.assign(chrome.style,{left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});chrome.hidden=!active()||!editing||layoutItems()[id]?.hidden===true||!el.getClientRects().length;}
  el._dcPosition=chromePosition;
  if(id.startsWith('widget-')){const header=el.querySelector('.dw-header');if(header){header.tabIndex=0;header.setAttribute('aria-label','Move '+label+'; drag or use arrow keys');header.title='Drag to move · arrow keys to adjust';header.addEventListener('pointerdown',e=>{if(e.target.closest('a,button,input,select'))return;begin(e,id,el,'move');});header.addEventListener('pointermove',move);for(const event of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(event,finish);header.addEventListener('keydown',e=>{if(!active()||e.target!==header||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const c=config(id),n=e.shiftKey?24:(state.grid||8);c.x+=(e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0)/innerWidth;c.y+=(e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0)/innerHeight;apply(id,el);chromePosition();save();});}}

  for(const [button,mode]of [[handle,'move'],[resize,'size']]){
   button.addEventListener('pointerdown',e=>{if(editing)begin(e,id,el,mode);});
   button.addEventListener('pointermove',move);
   button.addEventListener('pointerup',finish);button.addEventListener('pointercancel',finish);button.addEventListener('lostpointercapture',finish);
   button.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();select(id);});
   button.addEventListener('keydown',e=>{if(!editing||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const c=config(id),n=e.shiftKey?20:5,dx=e.key==='ArrowLeft'?-n:e.key==='ArrowRight'?n:0,dy=e.key==='ArrowUp'?-n:e.key==='ArrowDown'?n:0;if(mode==='move'){c.x+=dx/innerWidth;c.y+=dy/innerHeight;}else{c.w+=id==='orb'?(dx||dy):dx;c.h=id==='orb'?c.w:c.h+dy;}apply(id,el);chromePosition();save();});
  }
 }
 function renderPanel(){
  renderedKeys=[...labels.keys()].join('|');body.replaceChildren();const profile=document.createElement('p');profile.textContent=innerWidth<1400?'Compact-screen layout · your large-screen arrangement is kept separately.':'Large-screen layout · smaller windows adapt without changing this arrangement.';body.append(profile);
  if(panelMode==='add'){
   const p=document.createElement('p');p.textContent='Add a live window. Move, resize or hide it whenever you like.';body.append(p);
   for(const type of window.JarvisDesktopWidgets?.types||[]){const b=document.createElement('button');b.className='dc-catalog';const title=document.createElement('strong'),desc=document.createElement('small');title.textContent=type.label;desc.textContent=type.description;b.append(title,desc);b.onclick=()=>{if(state.widgets.length>=16){ui.querySelector('.dc-save').textContent='Up to 16 widgets per workspace';return;}const id='widget-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,6);state.widgets.push({id,type:type.id});const positions=[[.15,.34],[.85,.34],[.15,.67],[.85,.69]],pos=positions[(state.widgets.length-1)%4];config(id,Math.min(300,Math.max(200,(innerWidth-400)/2)),type.id==='clock'?170:type.id==='study'?420:260,pos[0],pos[1]);save();selected=id;panelMode='layout';schedule();renderPanel();};body.append(b);}return;
  }
  const snapping=document.createElement('label');snapping.className='dc-snap-setting';const check=document.createElement('input');check.type='checkbox';check.checked=state.snap!==false;check.onchange=()=>{state.snap=check.checked;save();};snapping.append(check,document.createTextNode('Snap to grid and match overlapping widgets'));body.append(snapping);
  const preferences=document.createElement('div');preferences.className='dc-fields';for(const [key,label,options]of [['grid','Grid spacing',[4,8,16,24]],['margin','Edge & widget gap',[16,24,32,48]]]){const l=document.createElement('label'),input=document.createElement('select');l.textContent=label;for(const n of options){const o=document.createElement('option');o.value=n;o.textContent=n+' px';input.append(o);}input.value=state[key];input.onchange=()=>{state[key]=Number(input.value);save();schedule();};l.append(input);preferences.append(l);}body.append(preferences);
  const list=document.createElement('div');list.className='dc-element-list';for(const [id,label]of labels){const row=document.createElement('div'),b=document.createElement('button'),visible=document.createElement('input');b.textContent=label;b.classList.toggle('on',selected===id);b.onclick=()=>select(id);visible.type='checkbox';visible.checked=!layoutItems()[id]?.hidden;visible.setAttribute('aria-label','Show '+label);visible.onchange=()=>{config(id).hidden=!visible.checked;save();schedule();};row.append(visible,b);list.append(row);}body.append(list);
  if(selected&&els.has(selected)){
   const c=config(selected),title=document.createElement('h3');title.textContent=labels.get(selected);body.append(title);
   const grid=document.createElement('div');grid.className='dc-fields';
   for(const [key,label,value,min,max]of [['x','Horizontal center (%)',Math.round(c.x*100),0,100],['y','Vertical center (%)',Math.round(c.y*100),0,100],['w',selected==='orb'?'Orb size (px)':'Width (px)',Math.round(c.w),selected==='orb'?120:70,innerWidth-40],...(selected==='orb'?[]:[['h','Height (px)',Math.round(c.h),26,innerHeight-80]]),...(['greeting','subtitle','eyebrow','orbLabel','status','hint'].includes(selected)?[['font','Text size (px)',c.font,9,72]]:[])]){const l=document.createElement('label'),input=document.createElement('input');l.textContent=label;input.type='number';input.value=value;input.min=min;input.max=max;input.step=1;input.onchange=()=>{const n=Number(input.value);if(!Number.isFinite(n))return;c[key]=(key==='x'||key==='y')?n/100:n;if(selected==='orb'&&key==='w')c.h=n;apply(selected,els.get(selected));els.get(selected)._dcPosition?.();save();};l.append(input);grid.append(l);}body.append(grid);
   const front=document.createElement('button');front.textContent='Bring to front';front.onclick=()=>{c.z=Math.min(45,Math.max(...Object.values(layoutItems()).map(x=>number(x.z,10)))+1);apply(selected,els.get(selected));save();};body.append(front);
   if(selected.startsWith('widget-')){const remove=document.createElement('button');remove.textContent='Remove widget';remove.onclick=()=>{const id=selected,el=els.get(id);el?._dcChrome?.remove();window.JarvisDesktopWidgets?.remove?.(el);el?.remove();els.delete(id);labels.delete(id);delete state.items[id];if(state.compactItems)delete state.compactItems[id];state.widgets=state.widgets.filter(x=>x.id!==id);selected=null;save();renderPanel();};body.append(remove);}
  }
  const reset=document.createElement('button');reset.className='dc-reset';reset.textContent='Reset to centered layout';reset.onclick=()=>{for(const el of els.values()){window.JarvisDesktopWidgets?.remove?.(el);el._dcChrome?.remove();delete el.dataset.canvasElement;el.classList.remove('dc-element');}host?.remove();host=null;els.clear();labels.clear();state={items:{},widgets:[],snap:true,grid:8,margin:24};legacy={};selected=null;save();schedule();renderPanel();};body.append(reset);
 }
 function ensureWidgets(){
  const view=document.getElementById('view');if(!host?.isConnected){host=document.createElement('div');host.id='desktopWidgetHost';view.append(host);}host.hidden=false;
  for(const item of state.widgets){if(!els.has(item.id)){if(!window.JarvisDesktopWidgets?.types.some(t=>t.id===item.type))continue;const el=window.JarvisDesktopWidgets.create(item.type);if(!el)continue;host.append(el);config(item.id);bind(el,item.id,(window.JarvisDesktopWidgets.types.find(t=>t.id===item.type)||{}).label||'Widget');}const el=els.get(item.id);el.classList.add('dc-element');apply(item.id,el);el._dcPosition?.();}
 }
 function sync(){
  raf=0;const on=active();ui.hidden=!on;
  if(!on){finish();editing=false;setFocus(false);}
  editButton.disabled=false;editButton.textContent=editing?'Done':'Customize';editButton.setAttribute('aria-pressed',String(editing));ui.querySelectorAll('.dc-toolbar button:not([data-action=edit]):not([data-action=focus])').forEach(b=>b.hidden=!editing);document.body.classList.toggle('desktop-canvas-editing',on&&editing);if(!on||!editing)panel.hidden=true;
  for(const [id,el]of [...els])if(!el.isConnected){el._dcChrome?.remove();els.delete(id);labels.delete(id);}
  if(!on){document.body.classList.remove('desktop-widget-fit');for(const el of els.values()){el.classList.remove('dc-element','dc-hidden');for(const k of ['left','top','width','height','z-index','margin'])el.style.removeProperty(k);el._dcChrome.hidden=true;}if(host)host.hidden=true;if(document.body.classList.contains('graph-home')&&!media.matches){window.JarvisPhoneWidgets?.mount(document.getElementById('view'));window.JarvisPhoneWidgets?.show();window.JarvisHomeShortcuts?.refresh();}return;}
  for(const [id,selector,label,w,h,x,y,hidden,font]of specs){const el=document.querySelector(selector);if(!el)continue;config(id,w,h,x,y,hidden,font);bind(el,id,label);el.classList.add('dc-element');apply(id,el);el._dcPosition?.();}
  window.JarvisPhoneWidgets?.hide();ensureWidgets();
  fitWidgets();for(const el of els.values())el._dcPosition?.();
  if(!panel.hidden&&panelMode==='layout'&&renderedKeys!==[...labels.keys()].join('|'))renderPanel();
 }
 function schedule(){if(!raf)raf=requestAnimationFrame(sync);}
 ui.addEventListener('click',e=>{const action=e.target.closest('[data-action]')?.dataset.action;if(!action)return;if(action==='focus'){setFocus(!focused);}else if(action==='edit'){setFocus(false);if(editing){finish();save();editing=false;}else editing=true;}else if(action==='close')panel.hidden=true;else{panelMode=action==='add'?'add':'layout';panel.hidden=false;renderPanel();}schedule();});
 function blank(e){
  if(!active()||editing||drag||document.body.classList.contains('jarvis-scene-open')||document.body.classList.contains('desktop-nav-open')||document.querySelector('dialog[open],.modal:not([hidden]),[aria-modal=true]'))return false;
  if(e.target.closest('button,a,input,textarea,select,label,summary,.dc-element,.side,#desktopCanvasEditor,.dc-chrome,[contenteditable],canvas'))return false;
  return ['BODY','MAIN'].includes(e.target.tagName)||e.target.matches('#view,.home-graph-hero,.home-scene-visual,#desktopWidgetHost');
 }
 document.addEventListener('pointerdown',e=>{blankStart=e.button===0&&blank(e)?{x:e.clientX,y:e.clientY}:null;});
 document.addEventListener('click',e=>{if(blankStart&&Date.now()>suppressClickUntil&&Math.hypot(e.clientX-blankStart.x,e.clientY-blankStart.y)<4&&blank(e)&&!window.getSelection()?.toString())setFocus(!focused);blankStart=null;});
 document.addEventListener('keydown',e=>{if(e.key==='Escape'&&focused)setFocus(false);if(e.key==='Escape'&&editing){finish();save();editing=false;schedule();}});
 new MutationObserver(schedule).observe(document.getElementById('view'),{childList:true,subtree:true});window.addEventListener('resize',schedule);window.addEventListener('hashchange',schedule);window.addEventListener('jarvis:state',schedule);media.addEventListener('change',schedule);sync();
})();
