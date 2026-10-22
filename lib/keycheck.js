'use strict';
// "Check keys": asks each service whether a stored key still works. Only ok/not ok and a short reason leave this module; values never do.
module.exports = function makeKeyCheck(ctx, vault) {
  const get = async (url, headers = {}) => { const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); return { ok: r.ok, status: r.status }; };
  const jwtOk = (t) => { try { const p = JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString()); return p.exp ? (p.exp * 1000 > Date.now() ? { ok: true } : { ok: false, why: 'expired' }) : { ok: true }; } catch { return { ok: false, why: 'not a valid token' }; } };
  const TESTS = {
    ELEVENLABS_API_KEY: (v) => get('https://api.elevenlabs.io/v1/user', { 'xi-api-key': v }),
    OPENAI_API_KEY: (v) => get('https://api.openai.com/v1/models', { Authorization: 'Bearer ' + v }),
    KIE_API_KEY: (v) => get('https://api.kie.ai/api/v1/chat/credit', { Authorization: 'Bearer ' + v }),
    YOUTUBE_API_KEY: (v) => get('https://www.googleapis.com/youtube/v3/channels?part=id&id=UC1vRGrWbxn5Rw1jrVkHvZ_A&key=' + encodeURIComponent(v)),
    KEY: (v, e) => (e.service === 'gemini' ? get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1&key=' + encodeURIComponent(v)) : null),
    VERCEL_OIDC_TOKEN: (v) => jwtOk(v),
    KIMI_MOONSHOT_API_KEY: (v) => get('https://api.moonshot.ai/v1/models', { Authorization: 'Bearer ' + v }),
    POSTIZ_API_KEY: (v) => get('http://127.0.0.1:4007/api/public/v1/integrations', { Authorization: v }),
    MUAPI_API_KEY: null, LLM_API_KEY: null,
  };
  async function run() {
    const out = [];
    for (const e of vault.listRaw()) for (const x of e.vars || []) {
      if (!/KEY|TOKEN|SECRET/i.test(x.k)) continue; const row = { id: e.id, name: e.name, service: e.service, var: x.k };
      if (!x.v) { out.push({ ...row, state: 'empty' }); continue; }
      const t = TESTS[x.k]; if (!t) { out.push({ ...row, state: 'untested' }); continue; }
      try { const r = await t(x.v, e); if (r === null) { out.push({ ...row, state: 'untested' }); continue; } out.push({ ...row, state: r.ok ? 'ok' : 'bad', why: r.ok ? '' : r.why || ('HTTP ' + r.status) }); } catch (er) { out.push({ ...row, state: 'unknown', why: String(er.message || er).slice(0, 60) }); }
    }
    return out;
  }
  return { run, async handle(req, res, url, p) { if (p !== '/api/vault/check') return false; try { ctx.send(res, 200, { results: await run() }); } catch (e) { ctx.send(res, 500, { error: String(e.message || e) }); } return true; } };
};
