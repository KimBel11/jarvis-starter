'use strict';
// ElevenLabs voice for Jarvis: natural TTS (English / Svenska / العربية) and Scribe speech-to-text.
// The API key is read from the encrypted vault at call time and never sent to the browser.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');

const API = 'https://api.elevenlabs.io';
const KEY_RE = /^(ELEVEN(LABS)?_?API_?KEY|XI_?API_?KEY|ELEVEN(LABS)?_?KEY)$/i;
const PREFER = { en: ['Daniel', 'George', 'Brian', 'Eric', 'Chris', 'Adam', 'Charlie', 'Roger', 'Liam', 'Bill'], sv: [], ar: [] };
const LANG_NAMES = { en: 'English', sv: 'Swedish', ar: 'Arabic' };

module.exports = function makeVoice(ctx, vault) {
  const FILE = path.join(ctx.DATA, 'voice.json');
  const defaults = { model: 'eleven_multilingual_v2', stability: 0.42, similarity: 0.8, style: 0.28, speed: 1.0, voices: {} };
  let cfg = { ...defaults }; try { cfg = { ...defaults, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.mkdirSync(ctx.DATA, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2)); } catch {} };
  let voicesCache = null;

  const key = () => { try { return vault.find(KEY_RE) || vault.findInService('elevenlabs', /KEY|TOKEN|SECRET/i); } catch { return null; } };
  async function xi(pathname, opt = {}) {
    const k = key(); if (!k) { const e = new Error('ElevenLabs key not found. Import it in Vault & keys.'); e.status = 400; throw e; }
    const r = await fetch(API + pathname, { ...opt, headers: { 'xi-api-key': k, ...(opt.headers || {}) } });
    return r;
  }
  async function jsonOrThrow(r) {
    if (r.ok) return r.json();
    let msg = ''; try { const j = await r.json(); msg = (j.detail && (j.detail.message || j.detail)) || j.message || JSON.stringify(j); } catch { msg = r.statusText; }
    const e = new Error(`ElevenLabs ${r.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.slice(0, 300)); e.status = r.status === 401 ? 401 : 502; throw e;
  }
  async function listVoices(force) {
    if (!force && voicesCache && Date.now() - voicesCache.at < 600000) return voicesCache.list;
    const j = await jsonOrThrow(await xi('/v1/voices'));
    const list = (j.voices || []).map((v) => ({ id: v.voice_id, name: v.name, category: v.category, labels: v.labels || {}, preview: v.preview_url, desc: v.description || (v.labels && v.labels.descriptive) || '', langs: (v.verified_languages || []).map((x) => x.language) }));
    voicesCache = { at: Date.now(), list }; autoPick(list); return list;
  }
  function autoPick(list) {
    let changed = false;
    // one consistent voice that is verified in all three languages beats three different voices
    const all3 = list.find((v) => ['en', 'sv', 'ar'].every((l) => v.langs.includes(l)));
    for (const lang of ['en', 'sv', 'ar']) {
      if (cfg.voices[lang] && !cfg.voices[lang].auto) continue; // user-chosen
      let pick = all3;
      if (!pick && lang !== 'en') pick = list.find((v) => v.langs.includes(lang));
      if (!pick) for (const n of PREFER[lang].concat(PREFER.en)) { pick = list.find((v) => v.name.split(/[\s-]/)[0] === n); if (pick) break; }
      if (!pick) pick = list[0];
      if (pick && (!cfg.voices[lang] || cfg.voices[lang].id !== pick.id)) { cfg.voices[lang] = { id: pick.id, name: pick.name, auto: true }; changed = true; }
    }
    if (changed) save();
  }
  const settings = () => ({ stability: cfg.stability, similarity_boost: cfg.similarity, style: cfg.style, use_speaker_boost: true, speed: cfg.speed });
  const turbo = () => /turbo|flash/.test(cfg.model);

  // ElevenLabs allows only a few requests at once: queue them (2 at a time) and retry when it says "too many"
  let active = 0; const waiting = [];
  const slot = () => new Promise((go) => { const t = () => { active++; go(); }; active < 2 ? t() : waiting.push(t); });
  const release = () => { active--; const n = waiting.shift(); if (n) n(); };
  async function speechRequest(path, init) {
    await slot();
    try {
      for (let i = 0; i < 4; i++) { const r = await xi(path, init); if (r.status !== 429 && r.status !== 503 && !(r.status === 502 || r.status === 500)) return r; if (i === 3) return r; await new Promise((s) => setTimeout(s, 600 * (i + 1))); }
    } finally { release(); }
  }
  async function tts(res, text, lang, prev, next) {
    text = String(text || '').trim().slice(0, 2500); if (!text) return ctx.send(res, 400, { error: 'empty text' });
    if (!key()) return ctx.send(res, 400, { error: 'ElevenLabs key not found' });
    if (!cfg.voices[lang] && !cfg.voices.en) await listVoices().catch(() => {});
    const v = cfg.voices[lang] || cfg.voices.en; if (!v) return ctx.send(res, 400, { error: 'No voice selected yet' });
    const body = { text, model_id: cfg.model, voice_settings: settings() };
    if (prev) body.previous_text = String(prev).slice(-400); if (next) body.next_text = String(next).slice(0, 400);
    if (turbo() && lang) body.language_code = lang;
    const r = await speechRequest(`/v1/text-to-speech/${encodeURIComponent(v.id)}/stream?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
    if (!r.ok) { let m = r.statusText; try { const j = await r.json(); m = (j.detail && (j.detail.message || j.detail.status)) || m; } catch {} return ctx.send(res, r.status === 401 ? 401 : 502, { error: `ElevenLabs ${r.status}: ${m}` }); }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store', 'X-Voice': encodeURIComponent(v.name) });
    Readable.fromWeb(r.body).pipe(res);
  }
  const dbg = []; // microphone debug trail from the app (memory only)
  const lastStt = []; // what Jarvis heard recently (kept in memory only), for checking that the microphone works
  async function stt(buf, mime, lang) {
    const fd = new FormData(); fd.append('model_id', 'scribe_v1'); fd.append('tag_audio_events', 'false'); if (lang) fd.append('language_code', lang);
    const ext = /mp4|m4a/.test(mime) ? 'm4a' : /ogg/.test(mime) ? 'ogg' : /wav/.test(mime) ? 'wav' : 'webm';
    fd.append('file', new Blob([buf], { type: mime || 'audio/webm' }), 'speech.' + ext);
    const t0 = Date.now(); const j = await jsonOrThrow(await xi('/v1/speech-to-text', { method: 'POST', body: fd }));
    const out = { text: (j.text || '').trim(), language: j.language_code, probability: j.language_probability };
    lastStt.push({ t: Date.now(), bytes: buf.length, mime, ms: Date.now() - t0, text: out.text.slice(0, 200) }); if (lastStt.length > 12) lastStt.shift();
    return out;
  }

  return {
    key, stt, tts, listVoices,
    status() { return { configured: !!key(), model: cfg.model, voices: cfg.voices, tuning: { stability: cfg.stability, similarity: cfg.similarity, style: cfg.style, speed: cfg.speed } }; },
    async handle(req, res, url, p) {
      if (p === '/api/voice/status') return ctx.send(res, 200, this.status()), true;
      if (p === '/api/voice/voices') { try { const list = await listVoices(url.searchParams.get('refresh') === '1'); return ctx.send(res, 200, { voices: list, selected: cfg.voices }), true; } catch (e) { return ctx.send(res, e.status || 500, { error: e.message }), true; } }
      if (p === '/api/voice/library') {
        const lang = url.searchParams.get('lang') || 'ar'; const q = new URLSearchParams({ page_size: '16', language: lang, sort: 'cloned_by_count' }); const g = url.searchParams.get('gender'); if (g) q.set('gender', g); const s = url.searchParams.get('q'); if (s) q.set('search', s);
        try { const j = await jsonOrThrow(await xi('/v1/shared-voices?' + q)); return ctx.send(res, 200, { voices: (j.voices || []).map((v) => ({ voiceId: v.voice_id, ownerId: v.public_owner_id, name: v.name, preview: v.preview_url, accent: v.accent, gender: v.gender, age: v.age, descriptive: v.descriptive, useCase: v.use_case, language: v.language, category: v.category, free: v.free_users_allowed, used: v.cloned_by_count })) }), true; }
        catch (e) { return ctx.send(res, e.status || 500, { error: e.message }), true; }
      }
      if (p === '/api/voice/add-shared' && req.method === 'POST') {
        const b = await ctx.readBody(req);
        try { const j = await jsonOrThrow(await xi(`/v1/voices/add/${encodeURIComponent(b.ownerId)}/${encodeURIComponent(b.voiceId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ new_name: String(b.name || 'Jarvis voice').slice(0, 60) }) })); voicesCache = null; return ctx.send(res, 200, { voiceId: j.voice_id }), true; }
        catch (e) { return ctx.send(res, e.status || 500, { error: e.message }), true; }
      }
      if (p === '/api/voice/assign' && req.method === 'POST') {
        const b = await ctx.readBody(req); const langs = b.lang === 'all' ? ['en', 'sv', 'ar'] : [b.lang];
        for (const l of langs) if (['en', 'sv', 'ar'].includes(l)) cfg.voices[l] = { id: String(b.voiceId), name: String(b.name || ''), auto: false };
        save(); return ctx.send(res, 200, { voices: cfg.voices }), true;
      }
      if (p === '/api/voice/settings' && req.method === 'POST') {
        const b = await ctx.readBody(req); const n = (x, lo, hi) => Math.min(hi, Math.max(lo, Number(x)));
        if (['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_flash_v2_5', 'eleven_v3'].includes(b.model)) cfg.model = b.model;
        if (b.stability != null) cfg.stability = n(b.stability, 0, 1); if (b.similarity != null) cfg.similarity = n(b.similarity, 0, 1); if (b.style != null) cfg.style = n(b.style, 0, 1); if (b.speed != null) cfg.speed = n(b.speed, 0.7, 1.2);
        save(); return ctx.send(res, 200, this.status()), true;
      }
      if (p === '/api/tts' && req.method === 'POST') { const b = await ctx.readBody(req); const lang = ['en', 'sv', 'ar'].includes(b.lang) ? b.lang : 'en'; try { await tts(res, b.text, lang, b.prev, b.next); } catch (e) { if (!res.headersSent) ctx.send(res, e.status || 500, { error: e.message }); else res.end(); } return true; }
      if (p === '/api/voice/debug' && req.method === 'POST') { try { const b = await ctx.readBody(req); dbg.push({ t: new Date().toLocaleTimeString('en-GB'), m: String(b.m || '').slice(0, 300) }); if (dbg.length > 60) dbg.shift(); } catch {} return ctx.send(res, 200, { ok: true }), true; }
      if (p === '/api/voice/last-stt') return ctx.send(res, 200, { heard: lastStt.slice().reverse(), debug: dbg.slice(-40) }), true;
      if (p === '/api/stt' && req.method === 'POST') {
        try { const buf = await ctx.readRaw(req, 25 * 1024 * 1024); if (buf.length < 800) return ctx.send(res, 200, { text: '' }), true; const lang = url.searchParams.get('lang'); return ctx.send(res, 200, await stt(buf, req.headers['content-type'] || '', lang && lang.length === 2 ? lang : null)), true; }
        catch (e) { return ctx.send(res, e.status || 500, { error: e.message }), true; }
      }
      return false;
    },
  };
};
