'use strict';
// Conversations tab inside every project: one input. Choose Claude, Codex or Both: with Both, the two AIs decide between them who takes each message.
S.cv = S.cv || {};
try{const drafts=JSON.parse(localStorage.getItem('jarvis.projectChatDrafts')||'{}');for(const [pid,values]of Object.entries(drafts))S.cv[pid]={open:null,list:null,drafts:values};}catch{}
function cvPersistDrafts(){try{localStorage.setItem('jarvis.projectChatDrafts',JSON.stringify(Object.fromEntries(Object.entries(S.cv).map(([pid,c])=>[pid,c.drafts||{}]))));}catch{}} // per project: { open: convoId|null, list, drafts }
const CV_PRESETS = [
  ['Plan next steps', 'Look at this project and tell me the 3 most valuable things to do next, in order, with the reason for each. Do not change anything.'],
  ['Review and find problems', 'Review this project carefully. List real problems and risks, most serious first, and how to fix each. Do not change anything until I say so.'],
  ['Help me build', 'Help me build and improve this project step by step. Explain what you will change before you change it, and keep each step small.'],
  ['Write content', 'Help me write content for this project (posts, captions, scripts). Match the tone of what already exists in the folder and give me options.'],
];
const cvEng = { claude: { n: 'Claude', c: 'var(--claude)' }, codex: { n: 'Codex', c: 'var(--codex)' }, both: { n: 'Both', c: 'var(--cyan)' } };
const cvChip = (e) => `<span class="cv-eng" style="--c:${(cvEng[e] || cvEng.claude).c}">${(cvEng[e] || cvEng.claude).n}</span>`;
const cvWho = (m) => (m.engine ? `${cvChip(m.engine)}${m.routed ? `<span class="muted tiny"> chosen by Claude + Codex${m.routed.agreed ? ' (agreed)' : ''}${m.routed.why ? ': ' + esc(m.routed.why) : ''}</span>` : ''}` : '');

async function cvLoad(pid) { const d = await api('/api/convos?project=' + encodeURIComponent(pid)); S.cv[pid].list = d; return d; }

function cvMsgHtml(m) {
  if (m.role === 'note') return `<div class="cv-note">${esc(m.text)}</div>`;
  if (m.role === 'user') return `<div class="cv-m user"><div class="cv-b">${esc(m.text).replace(/\n/g, '<br>')}</div></div>`;
  return `<div class="cv-m ai ${m.role === 'err' ? 'err' : ''}"><div class="cv-b">${mdLite(m.text)}</div>${m.tools && m.tools.length ? `<div class="cv-tools">${m.tools.slice(0, 6).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>` : ''}<div class="cv-meta">${cvWho(m)} ${m.ts ? '· ' + ago(m.ts) : ''}</div></div>`;
}

function cvSettingsHtml(c, cat) {
  const eng = c.engine === 'both' ? 'claude' : c.engine; const list = cat ? (cat[eng] || {}) : {};
  return `<div class="cv-set">
    <div class="field"><label>What should it do? (it follows this in every message)</label><textarea id="cvIns" rows="3" placeholder="e.g. Act as my developer for this project. Keep answers short and ask before changing files.">${esc(c.instructions || '')}</textarea></div>
    <div class="cv-chips">${CV_PRESETS.map((x, i) => `<button type="button" class="chip-btn" data-pre="${i}">${esc(x[0])}</button>`).join('')}</div>
    ${c.engine === 'both' ? '<div class="muted tiny" style="margin-top:8px">With Both, Claude and Codex choose the model and reasoning level themselves.</div>' : `<div class="cv-row"><select class="mini" id="cvModel">${modelOpts(list.models, c.model)}</select><select class="mini" id="cvEff">${effOpts(list.efforts, c.effort)}</select></div>`}
    <label class="sw warn" style="margin-top:10px"><input type="checkbox" id="cvEdits" ${c.edits ? 'checked' : ''}><i></i>Allow it to change files in this project</label>
    <div class="muted tiny" style="margin-top:6px">Off by default: it can read and advise but not edit. It never sees your vault keys.</div></div>`;
}

async function chatTab(box, p) {
  const pid = p.id; const C = (S.cv[pid] = S.cv[pid] || { open: null, list: null, drafts: {} });
  clearInterval(S.cvPoll); const cat = await loadModels();
  let d; try { d = await cvLoad(pid); } catch (e) { box.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  const requested=new URLSearchParams(location.search).get('conversation');if(requested&&C.openedLink!==requested&&d.convos.some(c=>c.id===requested)){C.open=requested;C.openedLink=requested;}
  const row = (c) => `<div class="cv-item ${C.open === c.id ? 'on' : ''}" data-cvopen="${c.id}"><div class="cv-i-t">${esc(c.title)}</div><div class="cv-i-s">${c.running ? '<span class="chip warn"><i></i>answering…</span> ' : ''}${esc(c.last || (c.imported ? 'Continuing an earlier session' : 'No messages yet'))}</div><div class="cv-i-m">${cvChip(c.engine)}<span class="muted tiny">${c.count} msg · ${ago(c.updatedAt)}</span></div></div>`;
  const srow = (s) => `<div class="cv-item cv-sess"><div class="cv-i-t">${esc(s.title)}</div><div class="cv-i-m">${cvChip(s.agent)}<span class="muted tiny">${s.messages || ''} msg · ${ago(s.end)}</span><span class="grow"></span><button class="btn sm" data-imp="${s.agent}|${s.id}">Continue here</button><button class="btn sm ghost" data-term="${s.agent}|${s.id}">Terminal</button></div></div>`;
  box.innerHTML = `<div class="cv-wrap ${C.open ? 'has-open' : ''}">
    <aside class="cv-side">
      <button class="btn primary cv-new" id="cvNew">＋ New conversation</button>
      <div class="cv-h">Conversations in ${esc(p.name)}</div>
      ${d.convos.length ? d.convos.map(row).join('') : '<div class="muted tiny" style="padding:6px 2px">None yet. Press New conversation and just start typing.</div>'}
      ${d.sessions.length ? `<div class="cv-h" style="margin-top:16px">Earlier Claude and Codex sessions in this folder</div>${d.sessions.slice(0, C.sessionLimit || 15).map(srow).join('')}${d.sessions.length > (C.sessionLimit || 15) ? `<button class="btn sm" id="cvMoreSessions">Show more earlier sessions</button>` : ''}` : ''}
    </aside>
    <section class="cv-main" id="cvMain"></section></div>`;
  const more=box.querySelector('#cvMoreSessions');if(more)more.onclick=()=>{C.sessionLimit=(C.sessionLimit||15)+30;chatTab(box,p);};
  const main = box.querySelector('#cvMain');
  box.querySelector('#cvNew').onclick = async () => { try { const c = await post('/api/convos/new', { project: pid, engine: 'both' }); C.open = c.id; C.focus = true; chatTab(box, p); } catch (e) { toast(e.message); } };
  box.querySelectorAll('[data-cvopen]').forEach((el) => (el.onclick = () => { C.open = el.dataset.cvopen; C.focus = true; chatTab(box, p); }));
  box.querySelectorAll('[data-imp]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const [agent, id] = b.dataset.imp.split('|'); try { const c = await post('/api/convos/import', { agent, id }); C.open = c.id; chatTab(box, p); } catch (x) { toast(x.message); } }));
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async (e) => { e.stopPropagation(); const [agent, id] = b.dataset.term.split('|'); try { await post('/api/resume', { agent, id }); toast('Opened in Terminal'); } catch (x) { toast(x.message); } }));
  if (C.open) return cvThread(main, p, C, box, cat);
  main.innerHTML = `<div class="card cv-empty"><div style="font-size:34px">💬</div><h2>Pick a conversation, or start a new one</h2><div class="muted">One box, one conversation. Choose Claude, Codex, or Both and let the two AIs decide who does what. Each conversation remembers everything and you can come back any time.</div><div style="margin-top:14px"><button class="btn primary" id="cvNew2">＋ New conversation</button></div></div>`;
  main.querySelector('#cvNew2').onclick = () => box.querySelector('#cvNew').click();
}

async function cvThread(main, p, C, box, cat) {
  let c; try { c = await api('/api/convos/get?id=' + encodeURIComponent(C.open)); } catch (e) { C.open = null; return chatTab(box, p); }
  const eng = c.engine || 'both';
  C.visibleMessages=C.visibleMessages||100;
  const drawHistory=()=>{const start=Math.max(0,c.messages.length-C.visibleMessages);return (start?'<button class="btn sm" id="cvOlder">Load earlier messages ('+start+')</button>':'')+c.messages.slice(start).map(cvMsgHtml).join('');};
  main.innerHTML = `<div class="card cv-thread"><div class="cv-top"><button class="btn sm ghost cv-back" id="cvBack">‹ History</button><div class="grow"><div class="cv-title" id="cvTitleEl" title="Click to rename">${esc(c.title)}</div><div class="muted tiny">${cvChip(eng)} ${eng === 'both' ? 'Claude and Codex decide who takes each message' : esc(c.model || 'default model')}${(c.edits ? ' · can edit files' : ' · read-only') + (c.continuationMode === 'imported-copy' ? ' · imported continuation' : '')}</div></div><button class="ibtn" id="cvGear" title="What it should do, permissions">⚙</button><button class="ibtn" id="cvDel" title="Delete this conversation">🗑</button></div>
    <details class="cv-ins" id="cvInsBox" ${c.instructions || c.messages.length ? '' : 'open'}><summary>${c.instructions ? 'What it should do' : 'Optional: tell it what it should do'}</summary><div id="cvInsBody"></div></details>
    <div class="cv-log" id="cvLog">${drawHistory() || '<div class="muted tiny" style="padding:10px">Type below. You can change who answers at any time.</div>'}</div>
    <div class="cv-seg" id="cvSeg" role="group" aria-label="Who answers">${['claude', 'codex', 'both'].map((k) => `<button type="button" data-e="${k}" class="${k === eng ? 'on' : ''}" style="--c:${cvEng[k].c}">${k === 'both' ? 'Both · they decide' : cvEng[k].n}</button>`).join('')}</div>
    <label class="sw" style="margin:8px 12px" title="Adds task clarification guidance. Your entire original message is kept."><input type="checkbox" id="cvEnhance" ${c.enhancePrompts ? 'checked' : ''}><i></i>Enhance prompts · keep my exact message</label><form class="cv-in" id="cvForm"><textarea id="cvText" rows="1" placeholder="Message… (Enter to send, Shift+Enter for a new line)"></textarea><button class="btn primary" id="cvSend" type="submit">Send</button><button class="btn" id="cvStop" type="button" hidden>■ Stop</button></form></div>`;
  main.querySelector('#cvEnhance').onchange = async (e) => { const el = e.target; el.disabled = true; try { await post('/api/convos/update', {id:c.id, enhancePrompts:el.checked}); c.enhancePrompts = el.checked; } catch (err) { el.checked = !!c.enhancePrompts; toast(err.message); } finally { el.disabled = false; } };
  const log = main.querySelector('#cvLog');
  const bindOlder=()=>{const b=log.querySelector('#cvOlder');if(b)b.onclick=()=>{const old=log.scrollHeight;C.visibleMessages+=100;log.innerHTML=drawHistory();bindOlder();log.scrollTop=log.scrollHeight-old;};};bindOlder(); const scroll = () => (log.scrollTop = 1e9); scroll();
  main.querySelector('#cvBack').onclick = () => { C.open = null; chatTab(box, p); };
  const body = main.querySelector('#cvInsBody'); const drawSet = () => { body.innerHTML = cvSettingsHtml(c, cat) + '<div style="text-align:right;margin-top:8px"><button class="btn sm primary" id="cvSave" type="button">Save</button></div>'; body.querySelectorAll('[data-pre]').forEach((b) => (b.onclick = () => { body.querySelector('#cvIns').value = CV_PRESETS[+b.dataset.pre][1]; })); };
  drawSet();
  main.querySelector('#cvGear').onclick = () => { const x = main.querySelector('#cvInsBox'); x.open = !x.open; };
  main.querySelector('#cvSave').onclick = async () => { const g = (id) => body.querySelector(id); try { await post('/api/convos/update', { id: c.id, instructions: g('#cvIns').value, edits: g('#cvEdits').checked, model: g('#cvModel') ? g('#cvModel').value : undefined, effort: g('#cvEff') ? g('#cvEff').value : undefined }); toast('Saved'); C.drafts[c.id] = main.querySelector('#cvText').value; chatTab(box, p); } catch (e) { toast(e.message); } };
  main.querySelectorAll('#cvSeg button').forEach((b) => (b.onclick = async () => { try { await post('/api/convos/update', { id: c.id, engine: b.dataset.e, model: '', effort: '' }); C.drafts[c.id] = main.querySelector('#cvText').value; C.focus = true; chatTab(box, p); } catch (e) { toast(e.message); } }));
  main.querySelector('#cvDel').onclick = async () => { if (!confirm('Delete this conversation from Jarvis? (Your project files are not touched.)')) return; try { await post('/api/convos/delete', { id: c.id }); C.open = null; chatTab(box, p); } catch (e) { toast(e.message); } };
  main.querySelector('#cvTitleEl').onclick = async () => { const t = prompt('Name this conversation', c.title); if (t && t.trim()) { await post('/api/convos/update', { id: c.id, title: t.trim() }).catch((e) => toast(e.message)); chatTab(box, p); } };
  const ta = main.querySelector('#cvText'); const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(160, ta.scrollHeight) + 'px'; }; ta.value = C.drafts[c.id] || ''; grow(); ta.oninput = () => { C.drafts[c.id] = ta.value;cvPersistDrafts(); grow(); };
  if (C.focus) { C.focus = false; setTimeout(() => ta.focus(), 60); }
  const setBusy = (b) => { main.querySelector('#cvSend').hidden = b; main.querySelector('#cvStop').hidden = !b; ta.disabled = b; };
  main.querySelector('#cvStop').onclick = () => post('/api/convos/stop', { id: c.id }).catch(() => {});
  let bubble = null, acc = '', routeInfo = null;
  const liveBubble = () => { const el = document.createElement('div'); el.className = 'cv-m ai'; el.innerHTML = '<div class="cv-b"><span class="typing"><i></i><i></i><i></i></span></div><div class="cv-meta"></div>'; log.appendChild(el); scroll(); return el; };
  async function submit(text) {
    text = String(text || ''); if (!text.trim()) return; if (text.length > 12000) { toast('Message exceeds 12,000 characters. Split it; nothing was shortened.'); return; } ta.value = ''; C.drafts[c.id] = '';cvPersistDrafts(); grow(); setBusy(true);
    window.dispatchEvent(new CustomEvent('jarvis:graph-request',{detail:{query:text,project:p.id,agent:c.engine}}));
    log.insertAdjacentHTML('beforeend', cvMsgHtml({ role: 'user', text, ts: Date.now() })); bubble = liveBubble(); acc = ''; routeInfo = null;
    try {
      const r = await fetch('/api/convos/send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: c.id, prompt: text }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const rd = r.body.getReader(), dec = new TextDecoder(); let sb = '';
      for (;;) {
        const { value, done } = await rd.read(); if (done) break; sb += dec.decode(value, { stream: true }); let i;
        while ((i = sb.indexOf('\n\n')) >= 0) {
          const line = sb.slice(0, i).replace(/^data: /, ''); sb = sb.slice(i + 2); let ev; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.type === 'routing') bubble.querySelector('.cv-meta').innerHTML = '<span class="muted tiny">Claude and Codex are deciding who takes this…</span>';
          else if (ev.type === 'route') { routeInfo = ev; bubble.querySelector('.cv-meta').innerHTML = `${cvChip(ev.engine)}<span class="muted tiny"> chosen by Claude + Codex${ev.agreed ? ' (agreed)' : ''}: ${esc(ev.why || '')}</span>`; }
          else if (ev.type === 'delta') { acc += ev.text; bubble.querySelector('.cv-b').innerHTML = mdLite(acc.trim()); scroll(); }
          else if (ev.type === 'tool') { let t = bubble.querySelector('.cv-tools'); if (!t) { t = document.createElement('div'); t.className = 'cv-tools'; bubble.insertBefore(t, bubble.querySelector('.cv-meta')); } t.insertAdjacentHTML('beforeend', `<span class="tag">${esc(ev.name)}</span>`); }
          else if (ev.type === 'error') { bubble.classList.add('err'); bubble.querySelector('.cv-b').innerHTML = esc(ev.message); }
        }
      }
    } catch (e) { if (bubble) { bubble.classList.add('err'); bubble.querySelector('.cv-b').innerHTML = esc(e.message); } }
    setBusy(false); if (location.hash.startsWith('#/project/' + p.id) && C.open === c.id) { const d2 = await api('/api/convos/get?id=' + encodeURIComponent(c.id)).catch(() => null); if (d2 && !d2.running) { c.messages=d2.messages;log.innerHTML=drawHistory();bindOlder();scroll(); if (document.activeElement === document.body) ta.focus(); } }
  }
  main.querySelector('#cvForm').onsubmit = (e) => { e.preventDefault(); submit(ta.value); };
  ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(ta.value); } };
  // it may still be answering (you left the page or locked the phone): show progress until it finishes
  if (c.running) {
    setBusy(true); bubble = liveBubble(); const paint = (d2) => { bubble.querySelector('.cv-b').innerHTML = d2.partial ? mdLite(d2.partial) : '<span class="typing"><i></i><i></i><i></i></span>'; scroll(); };
    paint(c); clearInterval(S.cvPoll);
    S.cvPoll = setInterval(async () => { if (!document.body.contains(main) || C.open !== c.id) return clearInterval(S.cvPoll); const d2 = await api('/api/convos/get?id=' + encodeURIComponent(c.id)).catch(() => null); if (!d2) return; if (d2.running) paint(d2); else { clearInterval(S.cvPoll); chatTab(box, p); } }, 2000);
  }
}
window.chatTab = chatTab;
