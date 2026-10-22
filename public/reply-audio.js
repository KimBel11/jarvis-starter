'use strict';
// Reply audio for the @@ASSISTANT@@ chat: play / pause / stop on every reply, the Auto-play switch,
// and the "Tap to play" prompt for when the browser blocks audio that was not started by a tap.
// The speaking itself lives in jarvis.js (Jarvis.speakReply, pauseAudio, resumeAudio, stopAudio, setSpeak).
(() => {
  const J = () => window.Jarvis;
  const ICON = {
    play: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1"/><rect x="13.5" y="5" width="4" height="14" rx="1"/></svg>',
    stop: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  };

  // One polite live region for the whole chat (the queue uses it too).
  let region = null;
  function live(msg) {
    if (!region) { region = document.createElement('div'); region.id = 'qLive'; region.className = 'q-live'; region.setAttribute('role', 'status'); region.setAttribute('aria-live', 'polite'); region.setAttribute('aria-atomic', 'true'); document.body.appendChild(region); }
    region.textContent = ''; setTimeout(() => { region.textContent = msg; }, 40);
  }
  window.JarvisLive = live;

  /* ---------- play / pause / stop under each reply ---------- */
  let list = [];
  function build(bubble, text) {
    if (!bubble || !bubble.isConnected) return;
    const el = document.createElement('div'); el.className = 'jaudio'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Reply audio');
    el.innerHTML = `<button type="button" class="ja-btn" data-a="play">${ICON.play}</button><button type="button" class="ja-btn" data-a="pause" aria-label="Pause reply audio">${ICON.pause}</button><button type="button" class="ja-btn" data-a="stop" aria-label="Stop reply audio">${ICON.stop}</button>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-a]'); if (!b || b.disabled) return; const j = J(), a = b.dataset.a, mine = j.st.audioOwner === bubble;
      if (a === 'play') { if (mine && j.st.playbackPaused) j.resumeAudio(); else j.speakReply(text, bubble); }
      else if (a === 'pause' && mine) j.pauseAudio();
      else if (a === 'stop' && mine) j.stopAudio();
    });
    bubble.after(el); list.push({ bubble, el }); refresh();
  }
  function refresh() {
    const j = J(); if (!j) return; list = list.filter((x) => x.el.isConnected);
    for (const { bubble, el } of list) {
      const mine = j.st.audioOwner === bubble, paused = mine && !!j.st.playbackPaused, mode = !mine ? 'idle' : paused ? 'paused' : 'playing';
      el.dataset.mode = mode;
      const [play, pause, stop] = el.querySelectorAll('button');
      play.setAttribute('aria-label', paused ? 'Resume reply audio' : mine ? 'Replay reply audio' : 'Play reply audio'); play.title = play.getAttribute('aria-label');
      play.disabled = !!j.st.busy || mode === 'playing'; pause.disabled = mode !== 'playing'; stop.disabled = !mine;
      pause.title = 'Pause'; stop.title = 'Stop';
    }
  }

  /* ---------- Auto-play switch ---------- */
  const toggles = new Set();
  function syncToggle(b) { const on = !!(J() && J().st.speak); b.setAttribute('aria-checked', String(on)); b.dataset.on = on ? '1' : '0'; }
  function makeToggle() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'q-switch'; b.setAttribute('role', 'switch');
    b.innerHTML = '<i class="q-knob" aria-hidden="true"></i><span>Auto-play replies</span>';
    b.addEventListener('click', () => { const on = !J().st.speak; J().setSpeak(on); live(on ? 'Auto-play on' : 'Auto-play off'); });
    toggles.add(b); syncToggle(b); return b;
  }

  /* ---------- "Tap to play" when the browser blocks audio ---------- */
  const prompts = new Set();
  function makePrompt() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'q-tap'; b.hidden = !(J() && J().st.audioBlocked);
    b.innerHTML = `${ICON.play}<span>Tap to play the reply</span>`;
    b.addEventListener('click', () => J().unblockAudio());
    prompts.add(b); return b;
  }
  window.addEventListener('jarvis:audio-blocked', (e) => {
    const on = !!(e.detail && e.detail.blocked);
    for (const b of prompts) { b.hidden = !on; }
    if (on) live('Your browser blocked the audio. Use the Tap to play button to hear the reply.');
  });

  for (const ev of ['jarvis:state', 'jarvis:audio']) window.addEventListener(ev, refresh);
  window.addEventListener('jarvis:speak', () => { for (const b of toggles) { if (!b.isConnected) toggles.delete(b); else syncToggle(b); } });
  window.addEventListener('jarvis:state', () => { for (const b of toggles) { if (!b.isConnected) toggles.delete(b); else syncToggle(b); } for (const b of prompts) { if (!b.isConnected) prompts.delete(b); } });
  window.addEventListener('jarvis:reply', (e) => build(e.detail.bubble, e.detail.text));

  window.JarvisReplyAudio = { makeToggle, makePrompt };
})();
