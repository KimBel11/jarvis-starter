'use strict';
// @@ASSISTANT@@ panel: talk (ElevenLabs Scribe or browser recognition), natural voice (ElevenLabs or browser fallback),
// streaming chat with the agent team. @@NAME@@ delegates work: assignments appear as task cards.
const Jarvis = (() => {
  const ST = { attach: [], state: 'idle', agentId: 'kim', raw: null, project: 'all', lang: 'en-US', speak: true, hands: false, edits: false, sessions: (()=>{try{return JSON.parse(localStorage.getItem('jarvis.savedSessions')||'{}');}catch{return {};}})(), open: false, listening: false, busy: false, pending: 0, streamDone: true, eleven: false, voiceLabel: '' };
  const store = { get(k, d) { try { const v = localStorage.getItem('jarvis.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('jarvis.' + k, JSON.stringify(v)); } catch {} } };
  ST.listenOnly = false;
  for (const k of ['agentId', 'lang', 'speak', 'hands', 'listenOnly']) ST[k] = store.get(k, ST[k]);
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const synth = window.speechSynthesis;
  const $$ = (s, r = document) => r.querySelector(s);
  const LABEL = { idle: 'Tap the orb to talk', listening: 'Listening · tap to stop', thinking: 'Thinking · tap to pause voice', speaking: 'Speaking · tap to pause', paused: 'Paused · tap to continue', error: 'Something went wrong' };
  let rec = null, recWanted = false, abort = null, buf = '', bubble = null, finalHeard = false, voices = [], lastSentence = '';
  let requestEpoch = 0;
  let voiceSuspended = false;
  ST.voiceConversation = false; ST.playbackPaused = false;
  let voiceEpoch = 0, listenStarting = false, greetTimer = null, resumeTimer = null;
  let greeted = false; try { greeted = sessionStorage.getItem('jarvis.voiceGreeted') === '1'; } catch {}
  function clearVoiceTimers() { clearTimeout(greetTimer); clearTimeout(resumeTimer); greetTimer = resumeTimer = null; ST.afterGreet = false; }
  function emitState() { window.dispatchEvent(new CustomEvent('jarvis:state', { detail: { state: ST.state, busy: !!ST.busy, listening: !!ST.listening } })); }
  const escH = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const md = (s) => escH(s).replace(/```([\s\S]*?)```/g, '<pre>$1</pre>').replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');

  // The orb wears the colour of the model that is answering: Claude = orange, Codex = blue. Idle is always the original light blue.
  const engineOf = (id) => (id === 'raw-codex' ? 'codex' : id === 'raw-claude' ? 'claude' : (((S.team && S.team.agents) || []).find((a) => a.id === id) || {}).engine || 'claude');
  function storeSessions(){try{localStorage.setItem('jarvis.savedSessions',JSON.stringify(ST.sessions));}catch{}}
  function setModel() { const m = ST.agentId === 'kim' ? (window.JarvisLead?.get()?.lead || S.team?.agents?.find(a=>a.id==='kim')?.primary || 'claude') : engineOf(ST.agentId); Orb.model = m; document.body.dataset.jmodel = m; window.dispatchEvent(new Event('jarvis:agent')); }
  const isActive = () => listenStarting || ST.afterGreet || ST.busy || ST.listening || ST.pending > 0 || ['listening', 'thinking', 'speaking'].includes(ST.state);
  function setState(s) {
    ST.state = s; Jarvis.state = s; Orb.setAll(s);
    const el = $$('#jState'); if (el) el.textContent = (LABEL[s] || s) + (s === 'idle' && ST.eleven && ST.voiceLabel && innerWidth > 800 ? ' · ' + ST.voiceLabel : '');
    const hs = $$('#homeState'); if (hs) hs.textContent = LABEL[s] || s;
    const fab = $$('#jFab'); if (fab) fab.dataset.state = s;
    document.querySelectorAll('.mic').forEach((m) => m.classList.toggle('on', s === 'listening'));
    const orb = $$('#jOrb'); if (orb) { orb.setAttribute('aria-label', LABEL[s] || s); orb.setAttribute('aria-pressed', String(isActive())); }
    const mic = $$('#jMic'); if (mic) mic.setAttribute('aria-label', ST.listening ? 'Finish voice input' : 'Start voice input');
    document.body.dataset.jstate = s; setModel(); emitState();
  }
  async function checkVoice() {
    try { const v = await api('/api/voice/status'); ST.voiceConfigured = !!v.configured; ST.eleven = !!v.configured; const l = v.voices && v.voices.en; ST.voiceLabel = ST.eleven ? 'ElevenLabs' + (l ? ' · ' + l.name : '') : ''; } catch { ST.eleven = false; }
    if (ST.eleven && !greeted && !ST.greetPre) { ST.greetPre = true; try { Out.say && Out.prefetch && Out.prefetch(greeting()); } catch {} }
    const el = $$('#jEngine'); if (el) el.textContent = ST.eleven ? 'ElevenLabs voice' : 'Browser voice — add your ElevenLabs key in Vault for a human voice';
    setState(ST.state);
  }

  /* ================= voice out ================= */
  const detect = (t) => (/[؀-ۿ]/.test(t) ? 'ar' : /[åäöÅÄÖ]|\b(och|att|det|är|jag|inte|som|för|med|hej|tack|vad|hur|kan|ska|vill)\b/i.test(t) ? 'sv' : 'en');
  const clean = (t) => t.replace(/```[\s\S]*?```/g, ' code block. ').replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/https?:\/\/\S+/g, 'a link').replace(/[*_#>~|]/g, '').replace(/^\s*[-•]\s+/gm, '').replace(/\s+/g, ' ').trim();
  const Out = (() => {
    let queue = [], playing = false, epoch = 0, audio = null, actx = null, an = null, raf = 0, player = null, anNode = null;
    // iOS Safari only lets an <audio> element play if it was started by a tap once: use ONE shared element and unlock it on the first gesture.
    const SILENT = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    function getPlayer() {
      if (player) return player;
      player = new Audio(); player.setAttribute('playsinline', ''); player.preload = 'auto';
      try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); anNode = actx.createAnalyser(); anNode.fftSize = 512; const src = actx.createMediaElementSource(player); src.connect(anNode); anNode.connect(actx.destination); } catch {}
      return player;
    }
    let primed = false, finishPlayback = null, paused = false, waiters = [], blockedRetry = null;
    // The browser refused to start audio without a tap: keep the sentence and let the page show a "Tap to play" prompt.
    function setBlocked(fn) { blockedRetry = fn; ST.audioBlocked = !!fn; window.dispatchEvent(new CustomEvent('jarvis:audio-blocked', { detail: { blocked: !!fn } })); }
    const waitForResume = () => paused ? new Promise(resolve => waiters.push(resolve)) : Promise.resolve();
    function wake() { for (const resolve of waiters.splice(0)) resolve(); }
    function pause() { paused = true; ST.playbackPaused = true; if(audio) audio.pause(); if(synth) synth.pause(); cancelAnimationFrame(raf); if(actx?.state==='running')actx.suspend().catch(()=>{}); if(!ST.listening)audioMode('auto'); Orb.level = 0; setState('paused'); }
    function resume() { if(!paused)return; paused = false; ST.playbackPaused = false; audioMode('playback'); if(actx?.state==='suspended')actx.resume().catch(()=>{}); if(audio && finishPlayback)audio.play().catch(()=>{}); if(synth)synth.resume(); wake(); if(!playing)pump(); setState(ST.pending ? 'speaking' : ST.busy ? 'thinking' : 'idle'); }
    function release() {
      if (finishPlayback) finishPlayback();
      if (player) { player.pause(); player.removeAttribute('src'); player.load(); }
      if (actx && actx.state === 'running') actx.suspend().catch(() => {});
      try { if (navigator.mediaSession) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch {}
      primed = false; audioMode('auto');
    }
    function prime() { if (primed) return; primed = true; audioMode('playback'); try { const a = getPlayer(); a.src = SILENT; const my = epoch; const p = a.play(); if (p && p.then) p.then(() => { if (my === epoch && a.src === SILENT) { a.pause(); a.removeAttribute('src'); a.load(); } }).catch(() => {}); if (actx && actx.state === 'suspended') actx.resume(); } catch {} }

    function loadVoices() { voices = synth ? synth.getVoices() : []; }
    if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
    function browserVoice(l2) { const c = voices.filter((v) => v.lang.toLowerCase().startsWith(l2)); const pref = { en: ['Daniel', 'Oliver', 'Samantha'], sv: ['Alva'], ar: ['Majed'] }[l2] || []; return c.sort((a, b) => (pref.findIndex((n) => b.name.includes(n)) + 1 || 0) - (pref.findIndex((n) => a.name.includes(n)) + 1 || 0) + (/premium|enhanced|siri/i.test(b.name) - /premium|enhanced|siri/i.test(a.name)))[0]; }
    function meter() { if (!an) return; const d = new Uint8Array(an.fftSize); const tick = () => { an.getByteTimeDomainData(d); let s = 0; for (const v of d) s += (v - 128) * (v - 128); Orb.level = Math.min(1, (Math.sqrt(s / d.length) / 128) * 5); raf = requestAnimationFrame(tick); }; cancelAnimationFrame(raf); tick(); }
    const memo = new Map();
    function fetchAudio(text, lang, prev) { if (text.length > 90) return fetchAudio0(text, lang, prev); const k = lang + '|' + text; if (!memo.has(k)) memo.set(k, fetchAudio0(text, lang, prev).catch((e) => { memo.delete(k); throw e; })); return memo.get(k); }
    async function fetchAudio0(text, lang, prev) { for (let i = 0; i < 3; i++) { try { const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, lang, prev }) }); if (r.ok) return r.blob(); const msg = (await r.json().catch(() => ({}))).error || r.statusText; if (r.status === 401 || r.status === 400 || i === 2) throw new Error(msg); } catch (e) { if (i === 2 || /key|voice|401|400/i.test(String(e.message))) throw e; } await new Promise((s) => setTimeout(s, 700 * (i + 1))); } }
    function playBlob(blob, myEpoch) {
      return new Promise((resolve) => {
        audioMode('playback'); const a = (audio = getPlayer()); a.src = URL.createObjectURL(blob);
        try { if (actx && actx.state === 'suspended') actx.resume(); an = anNode; meter(); } catch {}
        const url = a.src; let ended = false; const end = () => { if (ended) return; ended = true; finishPlayback = null; a.onended = a.onerror = a.onplay = null; cancelAnimationFrame(raf); Orb.level = 0; URL.revokeObjectURL(url); if (blockedRetry) setBlocked(null); resolve(); }; finishPlayback = end;
        a.onended = end; a.onerror = end; a.onplay = () => { if (blockedRetry) setBlocked(null); if (myEpoch === epoch) setState(paused ? 'paused' : 'speaking'); if(!paused) armInterruption(); };
        if (!paused) a.play().catch((err) => { if (err && err.name === 'NotAllowedError' && myEpoch === epoch && !ended) setBlocked(() => { setBlocked(null); a.play().catch(end); }); else end(); });
      });
    }
    function speakBrowser(text, lang, myEpoch) {
      return new Promise((resolve) => {
        if (!synth) return resolve(); audioMode('playback'); const u = new SpeechSynthesisUtterance(text); const v = browserVoice(lang); if (v) { u.voice = v; u.lang = v.lang; } else u.lang = { en: 'en-GB', sv: 'sv-SE', ar: 'ar-SA' }[lang]; u.rate = 1.03;
        u.onstart = () => { if (myEpoch === epoch) setState(paused ? 'paused' : 'speaking'); if(!paused) armInterruption(); }; u.onboundary = () => { if (myEpoch === epoch) Orb.level = 0.85; }; u.onend = () => { if (myEpoch === epoch) Orb.level = 0; resolve(); }; u.onerror = (ev) => { if (myEpoch === epoch) Orb.level = 0; if (ev && ev.error === 'not-allowed' && myEpoch === epoch) { setBlocked(() => { setBlocked(null); speakBrowser(text, lang, myEpoch).then(resolve); }); return; } resolve(); }; synth.speak(u);
      });
    }
    async function pump() {
      if (playing || paused) return; playing = true; const my = epoch;
      while (queue.length && my === epoch) {
        await waitForResume(); if(my !== epoch) break;
        const it = queue.shift();
        try { if (it.blob) { const blob = await it.blob; await waitForResume(); if (my !== epoch) break; await playBlob(blob, my); } else if (my === epoch) await speakBrowser(it.text, it.lang, my); }
        catch (e) {
          if (my !== epoch) break;
          // never switch to the robot voice when the ElevenLabs voice is set up: skip that sentence, tell @@NAME@@ once in a while, and try the next one
          if (ST.eleven || ST.voiceConfigured) { if (Date.now() - (ST.lastVoiceNote || 0) > 120000) { ST.lastVoiceNote = Date.now(); addMsg('note', 'A sentence could not be spoken with your ElevenLabs voice (' + escH(e.message) + '). The text is above. I will keep trying.'); } }
          else await speakBrowser(it.text, it.lang, my);
        }
        if (my === epoch) ST.pending = Math.max(0, ST.pending - 1);
      }
      if (my === epoch) { playing = false; afterSpeech(); }
    }
    return {
      say(text) { const t = clean(text); if (!t) return; const lang = detect(t); const it = { text: t, lang }; if (!ST.eleven && !ST.voiceConfigured) { try { checkVoice(); } catch {} } if (ST.eleven) { it.blob = fetchAudio(t, lang, lastSentence); it.blob.catch(() => {}); } lastSentence = t; ST.pending++; queue.push(it); pump(); },
      prime, release, pause, resume, get paused(){return paused;}, get blocked(){return !!blockedRetry;}, unblock() { if (blockedRetry) blockedRetry(); }, prefetch(t) { try { fetchAudio(clean(t), detect(t)).catch(() => {}); } catch {} },
      stop() { epoch++; paused = false; ST.playbackPaused = false; wake(); queue = []; playing = false; ST.pending = 0; if (blockedRetry) setBlocked(null); if (ST.audioOwner) { ST.audioOwner = null; window.dispatchEvent(new Event('jarvis:audio')); } if (audio) { try { audio.pause(); } catch {} } cancelAnimationFrame(raf); if (synth) synth.cancel(); Orb.level = 0; release(); },
    };
  })();
  // "Settled" = the reply is finished and its audio (if any) has ended: the message queue sends its next message now.
  function settled() { window.dispatchEvent(new CustomEvent('jarvis:settled')); }
  function afterSpeech() {
    if (!ST.streamDone || ST.pending > 0 || ST.playbackPaused) return; if(recorder && recorder.state!=='inactive' && !ST.listening)stopListening(true); Orb.level = 0; Out.release();
    if (ST.audioOwner) { ST.audioOwner = null; window.dispatchEvent(new Event('jarvis:audio')); }
    if (ST.state === 'speaking' || ST.state === 'thinking') setState('idle');
    settled();
    if (voiceSuspended || ST.playbackPaused) return;
    if (ST.afterGreet) { clearTimeout(greetTimer); ST.afterGreet = false; const my = voiceEpoch; resumeTimer = setTimeout(() => { if (my === voiceEpoch && !ST.busy && ST.state === 'idle') startListening(true); }, 250); return; }
    if (ST.voiceConversation || ST.hands) { const my = voiceEpoch; resumeTimer = setTimeout(() => { if (my === voiceEpoch && !ST.busy && ST.state === 'idle') startListening(true); }, 400); }
  }
  function feedSpeech(chunk, flush) {
    if (voiceSuspended) return;
    buf += chunk; const re = /[^.!?…\n؟]+[.!?…؟]+(?=\s|$)|[^\n]+\n/g; let m, last = 0;
    while ((m = re.exec(buf))) { Out.say(m[0]); last = re.lastIndex; }
    buf = buf.slice(last);
    if (flush && buf.trim()) { Out.say(buf); buf = ''; } else if (buf.length > 280) { const i = buf.lastIndexOf(',', 280); const cut = i > 60 ? i + 1 : 280; Out.say(buf.slice(0, cut)); buf = buf.slice(cut); }
  }
  function stopSpeech() { Out.stop(); }
  function say(text) { voiceSuspended = false; ST.streamDone = true; stopSpeech(); const ss = text.split(/(?<=[.!?…؟])\s+/); for (const s of ss) Out.say(s); }

  /* ================= voice in ================= */
  let micStream = null, micCtx = null, micRaf = 0, recorder = null;
  // does this device have a real microphone? (a Mac mini has none: only a headset, webcam, AirPods or USB microphone gives it one)
  async function micCount() { try { const d = await navigator.mediaDevices.enumerateDevices(); return d.filter((x) => x.kind === 'audioinput').length; } catch { return -1; } }
  function noMicMessage() { return 'This ' + (window.__jarvisDesktop ? 'Mac' : 'device') + ' has no microphone, so I cannot hear you here. Plug in a USB microphone, headset, webcam or AirPods and choose it in System Settings › Sound › Input, then tap the orb again.' + (window.__jarvisDesktop ? ' Meanwhile you can talk to me from your iPhone app, which has a microphone, or type below.' : ''); }
  // iOS: after the microphone has been used the sound can end up in the phone-call earpiece. The Audio Session API puts it back on the loudspeaker.
  const audioMode = (t) => { if(t==='playback' && micStream)t='play-and-record'; try { if (navigator.audioSession) navigator.audioSession.type = t; } catch {} try { if (window.__jarvisNative && !window.__jarvisDesktop) window.webkit.messageHandlers.native.postMessage('audio:' + t); } catch {} };
  const vdbg = (m) => { try { fetch('/api/voice/debug', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ m }) }); } catch {} };
  function stopMeter() { clearTimeout(micRaf); if (micStream) micStream.getTracks().forEach((t) => t.stop()); if (micCtx) micCtx.close().catch(() => {}); micStream = micCtx = null; Orb.level = 0; audioMode(ST.pending > 0 && !ST.playbackPaused ? 'playback' : 'auto'); }
  function micProblem(e) { audioMode('auto');
    const desktop = !!window.__jarvisDesktop; const name = (e && e.name) || '';
    const msg = name === 'OverconstrainedError' ? 'The microphone could not be started with the current settings. Choose another input in System Settings › Sound › Input and try again.' : name === 'NotFoundError' ? 'No microphone was found. Plug one in or choose one in System Settings › Sound › Input.' : desktop ? 'Jarvis does not have microphone access. Open System Settings › Privacy & Security › Microphone and switch Jarvis on, then tap the orb again.' : 'The microphone is blocked. Allow the microphone for this page (the lock icon in the address bar), then tap the orb again.';
    note(msg + (desktop ? ' <a class="mic-open" style="cursor:pointer;text-decoration:underline">Open the setting</a>' : '')); const a = document.querySelector('#jLog .mic-open:last-of-type'); if (a) a.onclick = () => { try { window.webkit.messageHandlers.native.postMessage('micsettings'); } catch {} };
    setState('error'); setTimeout(() => ST.state === 'error' && setState('idle'), 2500);
  }
  async function recordWithScribe(my, monitoring = false) {
    const nMic = await micCount(); if (my !== voiceEpoch) return; vdbg('audio inputs seen by the page: ' + nMic); if (nMic === 0) { if(monitoring){ST.voiceConversation=false;return;} note(noMicMessage()); setState('idle'); return; }
    vdbg(`start: ua=${navigator.userAgent.slice(-40)} secure=${isSecureContext} md=${!!navigator.mediaDevices} rec=${!!window.MediaRecorder} desktop=${!!window.__jarvisDesktop}`);
    // plain request first: some webviews (the Mac app) reject extra audio settings with "Invalid constraint"
    audioMode('play-and-record');
    const tries = [{ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }, { audio: true }]; let lastErr = null;
    for (const c of tries) { try { const acquired = await navigator.mediaDevices.getUserMedia(c); if (my !== voiceEpoch) { acquired.getTracks().forEach((t) => t.stop()); audioMode('auto'); return; } micStream = acquired; lastErr = null; break; } catch (e) { lastErr = e; vdbg('getUserMedia ' + JSON.stringify(c) + ' FAILED: ' + (e && e.name) + ' ' + (e && e.message)); if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'SecurityError')) break; } }
    if (my !== voiceEpoch) return;
    if (lastErr) { listenStarting = false; if(monitoring)ST.voiceConversation=false; micProblem(lastErr); return; }
    const tr = micStream.getAudioTracks()[0]; vdbg(`mic ok: label="${tr && tr.label}" state=${tr && tr.readyState} muted=${tr && tr.muted} enabled=${tr && tr.enabled}`);
    micCtx = new (window.AudioContext || window.webkitAudioContext)(); try { await micCtx.resume(); } catch {} vdbg('audioctx state=' + micCtx.state);
    const an = micCtx.createAnalyser(); an.fftSize = 1024; micCtx.createMediaStreamSource(micStream).connect(an);
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || '';
    const chunks = []; try { recorder = new MediaRecorder(micStream, mime ? { mimeType: mime } : {}); } catch (e) { vdbg('MediaRecorder FAILED: ' + e.message); note('Could not start recording: ' + escH(e.message)); stopMeter(); return; }
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data); recorder.onerror = (e) => vdbg('recorder error ' + (e.error && e.error.message));
    listenStarting = false; ST.listening = !monitoring; if(!monitoring)setState('listening'); recorder.start(250); vdbg('recording mime=' + (recorder.mimeType || mime || 'default'));
    const d = new Uint8Array(an.fftSize); const t0 = performance.now(); let onset = 0; let heard = false, lastVoice = 0, floor = 0, n = 0, cancelled = false, maxRms = 0, manual = false, lastLog = 0;
    const finish = (cancel) => { cancelled = cancel; try { recorder.state !== 'inactive' && recorder.stop(); } catch {} clearTimeout(micRaf); };
    recorder.stopMicLoop = finish;
    const tick = () => {
      an.getByteTimeDomainData(d); let s = 0; for (const v of d) s += (v - 128) * (v - 128); const rms = Math.sqrt(s / d.length) / 128; maxRms = Math.max(maxRms, rms); Orb.level = Math.min(1, rms * 5); const now = performance.now();
      if (now - lastLog > 1500) { lastLog = now; vdbg(`t=${Math.round(now - t0)}ms rms=${rms.toFixed(4)} max=${maxRms.toFixed(4)} chunks=${chunks.length} ctx=${micCtx && micCtx.state}`); }
      // the meter reads nothing at all (a webview that keeps the audio context asleep): record anyway and let @@NAME@@ tap the mic to send
      if (!monitoring && !manual && now - t0 > 2500 && maxRms === 0) { manual = true; vdbg('meter silent -> manual mode'); note('Listening… tap the microphone button when you are done talking.'); }
      if (manual) { if (now - t0 > 40000) return finish(false); micRaf = setTimeout(tick, 50); return; }
      if (now - t0 < 500) { floor = (floor * n + rms) / (n + 1); n++; } else { const thr = Math.max(monitoring ? 0.025 : 0.012, floor * 2.6 + 0.006); if (rms > thr) { if(!onset)onset=now; if(!monitoring || now-onset > 180) { if(monitoring && !heard) { ST.listening=true; Out.pause(); audioMode('play-and-record'); setState('listening'); } heard = true; lastVoice = now; } } else onset=0; }
      if ((heard && now - lastVoice > 1400) || now - t0 > 45000 || (!heard && now - t0 > 9000)) return finish(!heard);
      micRaf = setTimeout(tick, 50);
    };
    tick();
    await new Promise((r) => (recorder.onstop = r)); if (my !== voiceEpoch) return; ST.listening = false; const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }); stopMeter();
    vdbg(`stopped: heard=${heard} cancelled=${cancelled} manual=${manual} blob=${blob.size} max=${maxRms.toFixed(4)}`);
    if (my !== voiceEpoch) return;
    if (cancelled || blob.size < 1500) { if(monitoring) { if(heard)Out.resume(); armInterruption(); return; } if (ST.state === 'listening') setState('idle'); if (!heard && !manual) { if ((ST.voiceConversation || ST.hands) && recWanted) resumeTimer = setTimeout(() => { if (my === voiceEpoch && recWanted) startListening(true); }, 300); else note("I couldn't hear anything (the microphone level stayed at " + maxRms.toFixed(3) + '). Check that the right microphone is selected in System Settings › Sound › Input, then tap the orb to try again.'); } return; }
    setState('thinking');
    try { const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': blob.type || 'audio/webm' }, body: blob }); const j = await r.json(); if (my !== voiceEpoch) return; vdbg('stt -> ' + r.status + ' "' + String(j.text || j.error || '').slice(0, 80) + '"'); if (!r.ok) throw new Error(j.error || 'transcription failed'); if (j.text) { const inp = $$('#jText'); if (inp) inp.value = j.text; send(j.text, true); } else { if(monitoring) {Out.resume();armInterruption();return;} note("I couldn't make out any words. Speak a little closer to the microphone and try again."); setState('idle'); if ((ST.voiceConversation || ST.hands) && recWanted) resumeTimer = setTimeout(() => { if (my === voiceEpoch && recWanted) startListening(true); }, 300); } }
    catch (e) { if (my !== voiceEpoch) return; vdbg('stt error ' + e.message); note('Could not transcribe: ' + escH(e.message)); if(monitoring)Out.resume();else setState('idle'); }
  }
  function startListening(automatic = false) {
    if (ST.listening || listenStarting) return; if(ST.busy)cancel(); ST.voiceConversation=true; voiceSuspended=false; clearVoiceTimers(); const my = ++voiceEpoch; listenStarting = true; Out.stop(); if(!automatic)open(false); recWanted = true; finalHeard = false;
    if (ST.eleven && navigator.mediaDevices && window.MediaRecorder) return void recordWithScribe(my).finally(() => { if (my === voiceEpoch) listenStarting = false; });
    if (!SR) { if (navigator.mediaDevices && window.MediaRecorder) { recordWithScribe(my).finally(() => { if (my === voiceEpoch) listenStarting = false; }); return; } listenStarting = false; recWanted = false; note('This browser cannot record your voice. Use the Jarvis app, Chrome or Safari.'); return; }
    rec = new SR(); rec.lang = ST.lang; rec.interimResults = true; rec.continuous = false;
    rec.onstart = () => { if (my !== voiceEpoch) return; listenStarting = false; ST.listening = true; setState('listening'); };
    rec.onresult = (e) => { if (my !== voiceEpoch) return; let interim = '', fin = ''; for (let i = e.resultIndex; i < e.results.length; i++) { const r = e.results[i]; (r.isFinal ? (fin += r[0].transcript) : (interim += r[0].transcript)); } const inp = $$('#jText'); if (inp) inp.value = fin || interim; if (fin.trim()) { finalHeard = true; stopListening(); send(fin.trim(), true); } };
    rec.onerror = (e) => { if (my !== voiceEpoch) return; listenStarting = false; recWanted = false; ST.listening = false; if (e.error === 'not-allowed' || e.error === 'service-not-allowed') { note('Microphone blocked. Allow the mic for localhost:4777, then try again.'); setState('error'); setTimeout(() => ST.state === 'error' && setState('idle'), 2500); } else if (e.error !== 'no-speech' && e.error !== 'aborted') note('Voice input error: ' + e.error); if (ST.state === 'listening') setState('idle'); };
    rec.onend = () => { if (my !== voiceEpoch) return; if (ST.state !== 'speaking') audioMode('auto'); listenStarting = false; ST.listening = false; if (ST.state === 'listening') setState('idle'); if ((ST.voiceConversation || ST.hands) && !finalHeard && recWanted && !ST.busy) resumeTimer = setTimeout(() => { if (my === voiceEpoch && recWanted) startListening(true); }, 400); };
    try { audioMode('play-and-record'); rec.start(); } catch (e) { audioMode('auto'); listenStarting = false; recWanted = false; setState('idle'); note('Could not start the microphone: ' + e.message); }
  }
  let interruptionTimer = null;
  function armInterruption() {
    clearTimeout(interruptionTimer);
    if(!ST.voiceConversation || ST.playbackPaused || ST.afterGreet || !navigator.mediaDevices || !window.MediaRecorder)return;
    interruptionTimer=setTimeout(()=>{
      if(!ST.voiceConversation || ST.playbackPaused || ST.listening || listenStarting || (recorder && recorder.state!=='inactive') || ST.state!=='speaking')return;
      const my=++voiceEpoch;listenStarting=true;
      recordWithScribe(my,true).catch(e=>{if(my===voiceEpoch){stopMeter();note('Voice interruption unavailable: '+escH(e.message));}}).finally(()=>{if(my===voiceEpoch){listenStarting=false;armInterruption();}});
    },350);
  }
  function stopListening(discard) { clearTimeout(interruptionTimer); recWanted = false; if (discard) { voiceEpoch++; listenStarting = false; } ST.listening = false; emitState(); if (recorder && recorder.stopMicLoop && recorder.state !== 'inactive') recorder.stopMicLoop(!!discard); if (discard) stopMeter(); try { discard ? rec && rec.abort() : rec && rec.stop(); } catch {} }

  /* ================= local voice commands ================= */
  const PAGES = { home: 'home', overview: 'overview', dashboard: 'overview', projects: 'projects', social: 'social', 'key files': 'social', files: 'social', team: 'team', agents: 'team', 'agent team': 'team', skills: 'agents', plugins: 'agents', usage: 'usage', sessions: 'sessions', vault: 'vault', keys: 'vault', 'api keys': 'vault', platforms: 'platforms', integrations: 'platforms', video: 'video', 'video intel': 'video', voice: 'voice', 'voice studio': 'voice' };
  function localCommand(raw, dry) {
    const t = raw.toLowerCase().replace(/[.!?]+$/, '').trim();
    if (/^(stop|cancel|be quiet|quiet|shut up|tyst|sluta|avbryt)$/.test(t)) { if (!dry) cancel(); return 'Okay.'; }
    const nav = t.match(/^(?:open|show|go to|take me to|öppna|visa)\s+(?:the\s+|my\s+)?(.+)$/);
    if (nav) {
      const what = nav[1].replace(/\s+(page|tab|view)$/, ''); const pr = S.projects.find((p) => what === p.name.toLowerCase() || what === 'project ' + p.name.toLowerCase());
      if (pr) { if (!dry) location.hash = '#/project/' + pr.id; return `Opening ${pr.name}.`; }
      if (PAGES[what]) { if (!dry) location.hash = '#/' + PAGES[what]; return `Opening ${what}.`; }
    }
    const ln = t.match(/^(?:start|launch|open)\s+(claude|codex)(?:\s+code)?(?:\s+(?:in|for|on))?\s+(.+)$/);
    if (ln) { const pr = S.projects.find((p) => ln[2].replace(/^the\s+/, '').replace(/\s+project$/, '') === p.name.toLowerCase()); if (pr) { if (!dry) doLaunch(ln[1] + ':' + pr.id); return `Starting ${ln[1]} in ${pr.name}.`; } }
    return null;
  }

  /* ================= chat ================= */
  function addMsg(role, html) { const log = $$('#jLog'); if (!log) return document.createElement('div'); const d = document.createElement('div'); d.className = 'jmsg ' + role; d.innerHTML = html; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; }
  function note(html) { addMsg('note', html); }
  function renderAttach() { try { window.dispatchEvent(new CustomEvent('jarvis:attach-changed', { detail: ST.attach.slice() })); } catch {} const el = $$('#jAttach'); if (!el) return; el.hidden = !ST.attach.length; el.innerHTML = ST.attach.map((f, i) => `<span class="chip2">📎 ${escH(f.split('/').pop())} <button class="ibtn sm" data-unattach="${i}" aria-label="Remove">✕</button></span>`).join(''); el.onclick = (e) => { const b = e.target.closest('[data-unattach]'); if (b) { ST.attach.splice(+b.dataset.unattach, 1); renderAttach(); } }; }
  function addAttach(paths) { for (const f of paths || []) if (f && !ST.attach.includes(f)) ST.attach.push(f); ST.attach = ST.attach.slice(0, 6); renderAttach(); }
  function removeAttach(f) { const i = ST.attach.indexOf(f); if (i >= 0) { ST.attach.splice(i, 1); renderAttach(); } }
  function attach(paths) { ST.attach = (paths || []).slice(0, 4); renderAttach(); const i = $$('#jText'); if (i) { i.value = 'Please help me with this file: '; i.focus(); } }
  function suspendVoice() { clearVoiceTimers(); ST.afterGreet = false; voiceSuspended = true; stopListening(true); stopSpeech(); if (!ST.busy) setState('idle'); }
  // Navigation and app switching do not end an active voice conversation.
  window.addEventListener('pagehide', suspendVoice);
  // Phone: Jarvis keeps talking while @@NAME@@ moves around inside the app, but leaving the app pauses it (desktop keeps talking in the background).
  const onPhone = () => !window.__jarvisDesktop && (!!window.__jarvisNative || /iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden || !onPhone()) return;
    clearVoiceTimers(); stopListening(true);
    if (ST.pending > 0 || ST.busy || ST.state === 'speaking') Out.pause();
    try { if (navigator.mediaSession) { navigator.mediaSession.metadata = null; navigator.mediaSession.playbackState = 'none'; } } catch {}
  });
  function cancel() { ST.voiceConversation=false; requestEpoch++; clearVoiceTimers(); if(ST.activeJournalId){fetch('/api/convos/stop',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ST.activeJournalId})}).catch(()=>{});ST.activeJournalId=null;} if (abort) abort.abort(); stopSpeech(); stopListening(true); ST.listening = false; ST.busy = false; ST.streamDone = true; ST.pending = 0; buf = ''; Orb.level = 0; setState('idle'); window.dispatchEvent(new Event('jarvis:cancel')); }
  // One tap on the orb starts the conversation; tapping it again stops everything (listening, thinking and speaking).
  // Tap the orb: Jarvis greets you out loud ("What is on your mind today?"), then listens by itself.
  const greeting = () => { const h = new Date().getHours(); const g = h < 5 ? 'Hello' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; return `${g} @@NAME@@. What is on your mind today?`; };
  function orbTap() {
    if (ST.playbackPaused) { Out.resume(); armInterruption(); return 'resumed'; }
    if (ST.pending > 0 || ST.busy || ST.state==='speaking') { clearVoiceTimers(); stopListening(true); Out.pause(); return 'paused'; }
    if (isActive()) { cancel(); return 'stopped'; }
    ST.voiceConversation=true;
    voiceSuspended = false; open(false); Out.prime && Out.prime();
    if (window.__jarvisDesktop) { micCount().then((n) => { if (n === 0) { note(noMicMessage()); } }); }
    if (!greeted) {
      greeted = true; try { sessionStorage.setItem('jarvis.voiceGreeted', '1'); } catch {}
      if (ST.speak || ST.listenOnly) {
        ST.afterGreet = true; ST.streamDone = true; ST.busy = false; emitState(); setState('thinking'); say(greeting());
        const my = voiceEpoch;
        greetTimer = setTimeout(() => { if (my === voiceEpoch && ST.afterGreet && !ST.busy && ST.pending === 0 && ST.state !== 'speaking') { ST.afterGreet = false; setState('idle'); startListening(); } }, 9000);
        return 'started';
      }
    }
    startListening(); return 'started';
  }
  const agentMeta = () => (S.team && S.team.agents || []).find((a) => a.id === ST.agentId) || { name: '@@ASSISTANT@@', glyph: '✦' };

  // Listen-only: the reply is spoken, the text stays hidden until @@NAME@@ asks for it.
  function showReply(t) {
    if (!ST.listenOnly) { bubble.innerHTML = md(t); return; }
    bubble.dataset.full = t; bubble.classList.add('listen');
    bubble.innerHTML = '<span class="muted">🔊 Listening…</span> <a class="lo-show" style="cursor:pointer">Show text</a>';
    const a = bubble.querySelector('.lo-show'); if (a) a.onclick = () => { bubble.classList.remove('listen'); bubble.innerHTML = md(bubble.dataset.full); };
  }
  // Typed messages wait in the queue while a reply is streaming or its audio is still playing (and behind messages that already wait).
  const holdMessages = () => !!window.JarvisQueue && (ST.busy || ST.pending > 0 || window.JarvisQueue.holding());
  async function send(text, fromVoice, opts = {}) {
    text = String(text || ''); if (!text.trim()) return; voiceSuspended = false; if (text.length > 8000) { open(); note('Message exceeds 8,000 characters. Split it; nothing was shortened.'); return; } if(!fromVoice || ST.open)open(!fromVoice);
    const inp = $$('#jText'); if (inp) inp.value = '';
    if (!fromVoice && !opts.fromQueue && holdMessages() && !localCommand(text, true)) {
      window.dispatchEvent(new CustomEvent('jarvis:enqueue', { detail: { text, attach: ST.attach.slice(), agentId: ST.agentId, project: ST.project } })); ST.attach = []; renderAttach(); return;
    }
    if (opts.attach) { ST.attach = opts.attach; renderAttach(); }
    const agentId = opts.agentId || ST.agentId, project = opts.project || ST.project;
    addMsg('user', escH(text) + (ST.attach.length ? '<div class="jfiles">' + ST.attach.map((f) => { const m = (window.JarvisFiles && window.JarvisFiles.get(f)) || {}; const n = escH(f.split('/').pop().replace(/^[0-9a-f]{8}-/, '')); return m.thumb ? `<span class="jfile img"><img src="${m.thumb}" alt=""><i>${n}</i></span>` : `<span class="jfile">${m.kind === 'video' ? '🎬' : m.kind === 'audio' ? '🎧' : m.kind === 'pdf' ? '📕' : '📎'} ${n}</span>`; }).join('') + '</div>' : ''));
    window.dispatchEvent(new CustomEvent('jarvis:graph-request',{detail:{query:text,project,agent:agentId}}));
    const local = localCommand(text); if (local) { addMsg('ai', escH(local)); if (ST.speak) say(local); return; }
    if (ST.busy) cancel(); else { clearVoiceTimers(); stopListening(true); }
    if (ST.listenOnly && !ST.speak) { ST.speak = true; const sp = $$('#jSpeak'); if (sp) sp.checked = true; }
    ST.voiceConversation = !!fromVoice || ST.voiceConversation; Out.stop(); if (!fromVoice && (!opts.fromQueue || opts.gesture) && ST.speak) Out.prime(); buf = ''; lastSentence = ''; ST.busy = true; ST.streamDone = false; setState('thinking');
    // Typed messages are spoken once the whole reply is complete; voice conversations keep speaking sentence by sentence for a fast answer.
    const complete = !!ST.speak && !fromVoice && !ST.voiceConversation && !ST.hands && !ST.listenOnly, stream = !!ST.speak && !complete;
    const runEpoch = ++requestEpoch;
    const attachNow = ST.attach; ST.attach = []; renderAttach();
    bubble = addMsg('ai', '<span class="typing"><i></i><i></i><i></i></span>'); const myBubble = bubble; let acc = '';
    const raw = agentId === 'raw-claude' || agentId === 'raw-codex'; const key = agentId + ':' + project; abort = new AbortController();
    const body = raw ? { agent: agentId === 'raw-codex' ? 'codex' : 'claude', project: project === 'all' ? null : project, prompt: text, sessionId: ST.sessions[key] || null, allowEdits: ST.edits, voice: !!(fromVoice || ST.speak) }
      : { agentId, project: project === 'all' ? null : project, prompt: text, sessionId: ST.sessions[key] || null, allowEdits: ST.edits, voice: !!(fromVoice || ST.speak || ST.listenOnly), listenOnly: !!ST.listenOnly, attach: attachNow };
    body.enhancePrompts = store.get('enhancePrompts.' + key, false);
    try {
      const r = await fetch(raw ? '/api/ask' : '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: abort.signal, body: JSON.stringify(body) });
      if (runEpoch !== requestEpoch) return;
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
      const rd = r.body.getReader(), dec = new TextDecoder(); let sb = '', tools = null;
      for (;;) {
        const { value, done } = await rd.read(); if (runEpoch !== requestEpoch) { rd.cancel().catch(()=>{}); return; } if (done) break; sb += dec.decode(value, { stream: true }); let i;
        while ((i = sb.indexOf('\n\n')) >= 0) {
          const line = sb.slice(0, i).replace(/^data: /, ''); sb = sb.slice(i + 2); let ev; try { ev = JSON.parse(line); } catch { continue; }
          if(ev.type==='journal'&&ev.id)ST.activeJournalId=ev.id;
          else if (ev.type === 'session' && ev.id) { ST.sessions[key] = ev.id;storeSessions(); }
          else if (ev.type === 'delta') { acc += ev.text; showReply(acc.trim()); if (stream) feedSpeech(ev.text); }
          else if (ev.type === 'task') { addMsg('task', `<span class="tk-glyph">${(S.team && (S.team.agents.find((a) => a.id === ev.task.agent) || {}).glyph) || '•'}</span><div><b>${escH(ev.agent || ev.task.agent)}</b> was assigned<br><span class="muted">${escH(ev.task.title)}</span></div><a data-go="team">Team ›</a>`); window.dispatchEvent(new Event('jarvis:tasks')); }
          else if (ev.type === 'tool') { if (!tools) { tools = document.createElement('div'); tools.className = 'jtools'; bubble.before(tools); } const c = document.createElement('span'); c.className = 'tag'; c.textContent = ev.name + (ev.input ? ' · ' + String(ev.input).split('/').pop().slice(0, 40) : ''); tools.appendChild(c); }
          else if (ev.type === 'done') { ST.activeJournalId=null; if (ev.text && !acc) { acc = ev.text; showReply(acc); if (stream) feedSpeech(acc); } if (ev.sessionId) {ST.sessions[key] = ev.sessionId;storeSessions();} if (ev.error) bubble.classList.add('err'); }
          else if (ev.type === 'error') throw new Error(ev.message);
          else if (ev.type === 'warn') note(escH(ev.message));
          const lg = $$('#jLog'); if (lg) lg.scrollTop = 1e9;
        }
      }
      if (!acc.trim()) { if (bubble.querySelector('.typing')) bubble.remove(); }
      ST.streamDone = true; ST.busy = false; emitState();
      const finalText = acc.trim(); if (finalText && !myBubble.classList.contains('err')) window.dispatchEvent(new CustomEvent('jarvis:reply', { detail: { bubble: myBubble, text: finalText } }));
      if (ST.speak && complete && finalText) speakReply(finalText, myBubble);
      else if (ST.speak) { feedSpeech('', true); if (ST.pending === 0) afterSpeech(); } else { setState('idle'); settled(); }
    } catch (e) {
      if (runEpoch !== requestEpoch) return;
      ST.busy = false; ST.streamDone = true; emitState();
      if (e.name === 'AbortError') { if (!acc) bubble.remove(); return; }
      bubble.classList.add('err'); bubble.innerHTML = escH(e.message || 'Request failed'); setState('error'); setTimeout(() => ST.state === 'error' && setState('idle'), 3000);
      window.dispatchEvent(new Event('jarvis:failed'));
    }
  }
  // Speak a finished reply from the start (auto-play, or the Play button on a reply). `owner` is the reply's bubble.
  function speakReply(text, owner) {
    if (ST.busy || !String(text || '').trim()) return;
    voiceSuspended = false; ST.streamDone = true; stopSpeech(); ST.audioOwner = owner || null; buf = ''; lastSentence = '';
    window.dispatchEvent(new Event('jarvis:audio')); setState('thinking'); feedSpeech(text, true); if (ST.pending === 0) afterSpeech();
  }
  // The skip-audio button: ends the audio only; a queued message may then go out.
  function stopAudio() { stopSpeech(); if (!ST.busy && (ST.state === 'speaking' || ST.state === 'thinking' || ST.state === 'paused')) setState('idle'); settled(); }
  function setSpeak(on) {
    ST.speak = !!on; store.set('speak', ST.speak); const sp = $$('#jSpeak'); if (sp) sp.checked = ST.speak;
    if (!ST.speak) stopAudio(); window.dispatchEvent(new CustomEvent('jarvis:speak', { detail: { on: ST.speak } }));
  }

  /* ================= UI ================= */
  function fillProjectSelect() { const s = $$('#jProject'); if (!s) return; s.innerHTML = '<option value="all">Whole drive</option>' + S.projects.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''); s.value = S.projects.some((p) => p.id === ST.project) ? ST.project : 'all'; ST.project = s.value; }
  function fillAgentSelect() { const s = $$('#jAgent'); if (!s) return; const ag = (S.team && S.team.agents) || [{ id: 'kim', name: '@@ASSISTANT@@', glyph: '✦' }]; s.innerHTML = ag.map((a) => `<option value="${esc(a.id)}">${esc(a.glyph)} ${esc(a.name)}</option>`).join('') + '<option value="raw-claude">Claude (plain)</option><option value="raw-codex">Codex (plain)</option>'; s.value = ST.agentId; if (s.value !== ST.agentId) { ST.agentId = 'kim'; s.value = 'kim'; } const t = $$('#jTitle'); if (t) t.textContent = agentMeta().name; }
  function open(focusInput = true) { if (ST.open) return; ST.open = true; const p = $$('#jPanel'); p.hidden = false; requestAnimationFrame(() => p.classList.add('in')); fillProjectSelect(); fillAgentSelect(); checkVoice(); document.body.classList.add('j-open'); if (focusInput) setTimeout(() => { if (ST.open && !isActive()) $$('#jText') && $$('#jText').focus(); }, 250); }
  // Moving to another section hides the conversation panel (a voice conversation itself keeps going)
  window.addEventListener('hashchange', () => { if (ST.open) close(); });
  // Open an earlier conversation in the chat panel and carry on where it stopped (same agent, folder and session).
  function resumeConversation(c) {
    if (!c) return; cancel();
    ST.agentId = c.agentId || 'kim'; try { store.set('agentId', ST.agentId); } catch {} ST.project = c.project || 'all';
    open(false);
    const a = $$('#jAgent'); if (a) a.value = ST.agentId; const pr = $$('#jProject'); if (pr) pr.value = ST.project; const ti = $$('#jTitle'); if (ti) ti.textContent = agentMeta().name; try { setModel(); syncEnhance(); } catch {}
    const sid = c.sessions && (c.sessions[c.activeEngine] || Object.values(c.sessions)[0]); const key = ST.agentId + ':' + ST.project; if (sid) { ST.sessions[key] = sid; storeSessions(); }
    const log = $$('#jLog'); if (log) { log.innerHTML = ''; for (const m of (c.messages || []).filter((x) => x.role !== 'note').slice(-40)) addMsg(m.role === 'user' ? 'user' : 'ai', md(m.role === 'user' ? String(m.text || '').replace(/^\[[^\]]{0,400}(driving|Apple Watch|Answer in)[^\]]{0,400}\]\s*/, '') : (m.text || ''))); addMsg('note', 'Earlier conversation: ' + escH(c.title || '') + '. Carry on below.'); log.scrollTop = log.scrollHeight; }
    const pan = $$('#jPanel'); if (pan) pan.scrollTop = 0; const inp = $$('#jText'); if (inp) setTimeout(() => { inp.focus({ preventScroll: true }); if (pan) pan.scrollTop = 0; }, 150);
  }
  function close() { ST.open = false; const p = $$('#jPanel'); p.classList.remove('in'); document.body.classList.remove('j-open'); if (!ST.busy && ST.pending === 0) setState('idle'); setTimeout(() => { if (!ST.open) p.hidden = true; }, 320); }
  function toggle() { ST.open ? close() : open(); }
  function build() {
    const fab = document.createElement('button'); fab.id = 'jFab'; fab.className = 'fab'; fab.title = 'Talk to @@ASSISTANT@@ (J)'; fab.innerHTML = '<canvas></canvas><span id="jBadge" class="fab-badge" hidden></span>'; document.body.appendChild(fab);
    const p = document.createElement('section'); p.id = 'jPanel'; p.className = 'jpanel'; p.hidden = true;
    p.innerHTML = `<header><div><b id="jTitle">@@ASSISTANT@@</b><div id="jState" class="muted tiny">Standing by</div></div><div class="jhead"><button id="jOpts" class="ibtn" title="Options" aria-label="Options">⚙</button><button id="jNew" class="ibtn" title="New conversation">↺</button><button id="jClose" class="ibtn" title="Close (Esc)">✕</button></div></header>
    <div class="jorbwrap"><canvas id="jOrb" role="button" tabindex="0" aria-label="Tap the orb to talk" aria-pressed="false"></canvas></div>
    <div class="jset"><select id="jAgent" title="Who you talk to"></select><select id="jProject" title="Working folder"></select>
      <select id="jLang" title="Language for browser speech recognition (ElevenLabs auto-detects)"><option value="en-US">🎙 English</option><option value="sv-SE">🎙 Svenska</option><option value="ar-SA">🎙 العربية</option></select><div id="jEngine" class="tiny muted" style="align-self:center">…</div></div>
    <div class="jtoggles"><label class="sw" title="Add clarification guidance while keeping your full original message"><input type="checkbox" id="jEnhance"><i></i>Enhance prompts</label><label class="sw"><input type="checkbox" id="jSpeak"><i></i>Voice replies</label><label class="sw"><input type="checkbox" id="jListen"><i></i>Listen only</label><label class="sw"><input type="checkbox" id="jHands"><i></i>Hands-free</label><label class="sw warn"><input type="checkbox" id="jEdits"><i></i>Allow file edits</label></div>
    <div id="jLog" class="jlog"><div class="jmsg note">Hi @@NAME@@. I'm your main agent: tell me what you need and I'll hand it to the right specialist: video producer, publisher, analyst, video intel, editor. Press the mic and talk, or type. Posting and spending credits always wait for your approval.</div></div>
    <div id="jAttach" class="jattach" hidden></div>
    <form id="jForm" class="jinput"><button type="button" id="jMic" class="mic" title="Talk (click to start, click again to send)"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg></button><input id="jText" autocomplete="off" placeholder="Ask @@ASSISTANT@@ anything…"><button class="btn primary" id="jSend">Send</button></form>`;
    document.body.appendChild(p);
    new Orb($$('canvas', fab)); new Orb($$('#jOrb'));
    $$('#jLang').value = ST.lang; $$('#jSpeak').checked = ST.speak; $$('#jHands').checked = ST.hands; fillProjectSelect(); fillAgentSelect(); checkVoice();
    fab.onclick = orbTap; $$('#jClose').onclick = close;
    $$('#jNew').onclick = () => { ST.sessions = {};storeSessions(); cancel(); $$('#jLog').innerHTML = '<div class="jmsg note">New conversation.</div>'; };
    $$('#jOpts').onclick = () => p.classList.toggle('opts-open');
    $$('#jOrb').onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!e.repeat) orbTap(); } };
    $$('#jOrb').onclick = orbTap; $$('#jOrb').style.cursor = 'pointer';
    $$('#jMic').onclick = () => (ST.listening ? stopListening() : startListening());
    $$('#jForm').onsubmit = (e) => { e.preventDefault(); send($$('#jText').value, false); };
    const syncEnhance = () => { $$('#jEnhance').checked = store.get('enhancePrompts.' + ST.agentId + ':' + ST.project, false); }; syncEnhance();
    $$('#jEnhance').onchange = (e) => store.set('enhancePrompts.' + ST.agentId + ':' + ST.project, e.target.checked);
    $$('#jAgent').onchange = (e) => { ST.agentId = e.target.value; store.set('agentId', ST.agentId); $$('#jTitle').textContent = agentMeta().name; setModel(); syncEnhance(); };
    $$('#jProject').onchange = (e) => { ST.project = e.target.value; syncEnhance(); };
    $$('#jLang').onchange = (e) => { ST.lang = e.target.value; store.set('lang', ST.lang); };
    $$('#jSpeak').onchange = (e) => setSpeak(e.target.checked);
    $$('#jListen').checked = ST.listenOnly;
    $$('#jListen').onchange = (e) => { ST.listenOnly = e.target.checked; store.set('listenOnly', ST.listenOnly); if (ST.listenOnly) { ST.speak = true; store.set('speak', true); $$('#jSpeak').checked = true; } note(ST.listenOnly ? '🔊 Listen-only is on: @@NAME@@ answers out loud and keeps the text hidden. Tap Show text if you want to read it.' : 'Listen-only is off.'); };
    $$('#jHands').onchange = (e) => { ST.hands = e.target.checked; store.set('hands', ST.hands); if (ST.hands && !ST.busy) startListening(); };
    $$('#jEdits').onchange = (e) => { ST.edits = e.target.checked; p.classList.toggle('danger', ST.edits); note(ST.edits ? '⚠ File edits are <b>on</b> for plain chat — the agent may change files in the selected folder. Team agents have their own permissions.' : 'File edits are off (read-only).'); };
    document.addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
      if (e.key === 'Escape' && ST.open && !document.querySelector('#modal:not([hidden])')) close();
      if ((e.key === 'j' || e.key === 'J') && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggle(); }
    });
    window.addEventListener('jarvis:running', (e) => { const n = e.detail.length; const b = $$('#jBadge'); if (b) { b.hidden = !n; b.textContent = n; } });
    // reports from the agents arrive here too: @@ASSISTANT@@ is the only voice
    let repSince = +store.get('repSince', Date.now());
    const pollReports = async () => { try { const r = await fetch('/api/reports?since=' + repSince); if (!r.ok) return; const d = await r.json(); for (const x of d.reports) { const m = addMsg('ai', x.audio ? `<div class="vn"><b>🎙 Voice note from @@ASSISTANT@@</b><audio controls preload="none" src="/api/voicenote?id=${x.audio}"></audio><a class="vn-show" style="cursor:pointer">Show text</a></div>` : md(x.text) + '<div class="muted tiny" style="margin-top:4px">Report from your agents</div>'); if (x.audio && m) { const sh = m.querySelector('.vn-show'); if (sh) sh.onclick = () => { sh.outerHTML = '<div class="muted" style="margin-top:6px">' + md(x.text) + '</div>'; }; } repSince = Math.max(repSince, x.t); store.set('repSince', repSince); if (!ST.open && typeof toast === 'function') toast('@@ASSISTANT@@: new report from your agents'); } } catch {} };
    setInterval(pollReports, 30000); setTimeout(pollReports, 4000);
    // keep the ElevenLabs voice status fresh (a slow start or a restarted server must never leave Jarvis on the browser voice)
    window.addEventListener('focus', () => { if (!ST.eleven) checkVoice(); }); setInterval(() => { if (!ST.eleven) checkVoice(); }, 60000);
    setState('idle');
  }
  return { state: 'idle', build, open, close, resumeConversation, send, say, speakReply, stopAudio, setSpeak, unblockAudio: () => Out.unblock(), pauseAudio: () => { stopListening(true); Out.pause(); }, resumeAudio: () => { Out.resume(); armInterruption(); }, attach, addAttach, removeAttach, getAttach: () => ST.attach.slice(), startListening, stopListening, stop: stopSpeech, pause:()=>{stopListening(true);Out.pause();}, resume:()=>{Out.resume();armInterruption();}, orbTap, toggleVoice: orbTap, cancel, suspendVoice, isActive, setModel, checkVoice, refreshAgents: fillAgentSelect, setProject(id) { ST.project = id; fillProjectSelect(); }, setAgent(id) { ST.agentId = id; store.set('agentId', id); fillAgentSelect(); setModel(); }, get st() { return ST; } };
})();
window.Jarvis = Jarvis;
Jarvis.build();
