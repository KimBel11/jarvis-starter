/* Original vector characters; glyph choices use the existing saved identity field. */
(() => {
 const list=[['🧚','Spirit','Coordinator'],['🦉','Scholar','Research & courses'],['🤖','Builder','Code & engineering'],['🦊','Scout','Discovery & trends'],['🧙','Sage','Planning & review'],['🐱','Muse','Writing & design'],['🐲','Guardian','Security & quality'],['🐧','Producer','Video & publishing']];
 const recommend=a=>{const role=String(a.role||a.name||a.id).toLowerCase();return a.id==='kim'?'🧚':/engineer|code|app|web/.test(role)?'🤖':/trend|scout|search/.test(role)?'🦊':/security|quality|exam|reviewer/.test(role)?'🐲':/lead|research|collector|sources/.test(role)?'🦉':/professor|analysis|analyst|plan|preparation|patterns/.test(role)?'🧙':/video|publish|social/.test(role)?'🐧':'🐱';};
 function svg(g){
  const i=list.findIndex(x=>x[0]===g);const accent=['#a78bfa','#ffc879','#79c8ff','#ff9868','#c7a0ff','#ff92bd','#7ee8b1','#ffe196'][i];if(i<0)return '';
  const tops=[ '<path d="M22 24Q0 2 5 30L22 39M42 24Q64 2 59 30L42 39"/>','<path d="M13 25L10 6 27 17M37 17L54 6 51 25"/>','<path d="M32 15V5M27 5h10"/>','<path d="M13 25L6 3 28 18M36 18L58 3 51 25"/>','<path d="M12 23L34 2 46 23Z"/>','<path d="M15 24L12 8 29 18M35 18L52 8 49 24"/>','<path d="M17 20L13 3 27 15M37 15L51 3 47 20"/>','<path d="M15 30Q0 32 9 51M49 30Q64 32 55 51"/>' ];
  const body=i===2?'<rect x="13" y="16" width="38" height="37" rx="11"/>':'<path d="M13 31Q13 14 32 14Q51 14 51 31L48 47Q44 57 32 55Q20 57 16 47Z"/>';
  const mask=i===1?'<circle cx="23" cy="31" r="10"/><circle cx="41" cy="31" r="10"/>':i===2?'<rect x="18" y="24" width="28" height="17" rx="6"/>':i===3?'<path d="M16 32L32 46 48 32 42 48H22Z"/>':i===7?'<ellipse cx="32" cy="39" rx="13" ry="15"/>':'<ellipse cx="32" cy="32" rx="15" ry="11"/>';
  return `<svg viewBox="0 0 64 64" aria-hidden="true" class="agent-character" data-character="${i}"><ellipse cx="32" cy="59" rx="19" ry="3" fill="#000" opacity=".3"/><g fill="currentColor" fill-opacity=".35" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${tops[i]}${body}</g><g fill="var(--panel,#101820)" fill-opacity=".65" stroke="currentColor" stroke-width="1">${mask}</g><g fill="${accent}"><ellipse cx="24" cy="31" rx="3" ry="4"/><ellipse cx="40" cy="31" rx="3" ry="4"/></g><path d="M28 43Q32 46 36 43" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="20" cy="37" r="3" fill="${accent}" opacity=".7"/><circle cx="44" cy="37" r="3" fill="${accent}" opacity=".7"/></svg>`;
 }
 const chosen=a=>list.some(x=>x[0]===a.glyph)?a.glyph:recommend(a);
 const paint=(node,a,automatic=true)=>{const markup=svg(automatic?chosen(a):a.glyph);node.classList.remove('an-spirit');if(markup){node.innerHTML=markup;node.classList.add('has-character');}else{node.textContent=a.glyph||'✦';node.classList.remove('has-character');}};
 function moment(target,source,recipient,teamwork=false){
  if(!target?.isConnected)return;const box=document.createElement('div');box.className='character-moment'+(teamwork?' is-teamwork':'');box.setAttribute('aria-hidden','true');
  const r=target.getBoundingClientRect();box.style.left=Math.max(8,Math.min(innerWidth-160,r.left+r.width/2-76))+'px';box.style.top=Math.max(12,r.top-62)+'px';
  box.innerHTML='<span class="cm-actor cm-source">'+svg(chosen(source))+'</span><span class="cm-spark">'+(teamwork?'?':'✦')+'</span><span class="cm-actor cm-target">'+svg(chosen(recipient))+'</span><span class="cm-caption">'+(teamwork?'Thinking together':'High five')+'</span>';
  for(const [selector,a] of [['.cm-source',source],['.cm-target',recipient]])if(/^#[0-9a-f]{3,8}$/i.test(a.color))box.querySelector(selector).style.color=a.color;document.body.append(box);setTimeout(()=>box.remove(),2200);
 }
 const html=a=>'<span class="character-inline" style="color:'+(/^#[0-9a-f]{3,8}$/i.test(a.color)?a.color:'var(--cyan)')+'">'+svg(chosen(a))+'</span>';
 window.JarvisCharacters={list,svg,paint,recommend,chosen,moment,html};
 let syncing=false,signature='';
 async function sync(){if(document.hidden||syncing)return;syncing=true;try{const r=await fetch('/api/team',{cache:'no-store',signal:AbortSignal.timeout(8000)});if(!r.ok)return;const team=await r.json();if(!Array.isArray(team.agents))return;const next=JSON.stringify(team.agents.map(a=>[a.id,a.name,a.role,a.glyph,a.color,a.iconShape]));if(next!==signature){signature=next;try{S.team=team;}catch{}window.dispatchEvent(new CustomEvent('jarvis:team-updated',{detail:team}));window.JarvisDesktopWidgets?.refresh();}}catch{}finally{syncing=false;}}
 setInterval(sync,15000);window.addEventListener('focus',sync);document.addEventListener('visibilitychange',sync);window.addEventListener('jarvis:characters-saved',sync);

})();
