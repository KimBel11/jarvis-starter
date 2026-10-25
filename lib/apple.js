'use strict';
// Apple review status per project: reads App Store Connect (read-only) with the API key @@NAME@@ imported into the vault.
// Needs: an AuthKey_<KEYID>.p8 file entry for service "apple" + the Issuer ID (a variable APP_STORE_CONNECT_ISSUER_ID in the same service).
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');

const STATE = {
  PREPARE_FOR_SUBMISSION: ['Preparing', 'info'], READY_FOR_REVIEW: ['Ready to submit', 'info'], WAITING_FOR_REVIEW: ['Waiting for review', 'warn'], IN_REVIEW: ['In review now', 'warn'],
  PENDING_DEVELOPER_RELEASE: ['Approved: waiting for you to release', 'good'], PENDING_APPLE_RELEASE: ['Approved: Apple is releasing', 'good'], PROCESSING_FOR_APP_STORE: ['Processing', 'warn'],
  READY_FOR_SALE: ['Live on the App Store', 'good'], REPLACED_WITH_NEW_VERSION: ['Replaced by a newer version', 'info'], REJECTED: ['Rejected: open Resolution Center', 'bad'], METADATA_REJECTED: ['Metadata rejected: open Resolution Center', 'bad'],
  DEVELOPER_REJECTED: ['Removed by you', 'info'], DEVELOPER_REMOVED_FROM_SALE: ['Removed from sale', 'bad'], REMOVED_FROM_SALE: ['Removed from sale', 'bad'], INVALID_BINARY: ['Invalid binary', 'bad'], ACCEPTED: ['Accepted', 'good'], COMPLETE: ['Complete', 'good'],
  UNRESOLVED_ISSUES: ['Has unresolved issues', 'bad'], SUBMITTING: ['Submitting', 'warn'], CANCELING: ['Cancelling', 'info'], PROCESSING: ['Processing', 'warn'], FAILED: ['Failed', 'bad'], VALID: ['Ready', 'good'], INVALID: ['Invalid', 'bad'],
  APPROVED: ['Approved', 'good'], BETA_APPROVED: ['TestFlight review approved', 'good'], BETA_REJECTED: ['TestFlight review rejected', 'bad'], IN_BETA_REVIEW: ['In TestFlight review', 'warn'], WAITING_FOR_BETA_REVIEW: ['Waiting for TestFlight review', 'warn'],
  READY_FOR_BETA_SUBMISSION: ['Ready for TestFlight', 'info'], READY_FOR_BETA_TESTING: ['Ready for testers', 'good'], MISSING_EXPORT_COMPLIANCE: ['Missing export compliance', 'bad'], IN_EXPORT_COMPLIANCE_REVIEW: ['Export compliance review', 'warn'],
};
const friendly = (s) => { const f = STATE[String(s || '')]; return f ? { code: s, text: f[0], level: f[1] } : { code: s || '', text: s ? String(s).replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()) : 'Unknown', level: 'info' }; };
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
const PLACEHOLDER = /X{6,}|ABC123|EXAMPLE|YOUR/i;

module.exports = function makeApple(ctx, deps) {
  const vault = deps.vault; const cache = new Map();
  const project = (id) => ctx.state.projects.find((p) => p.id === id);

  function credsFor(pr) {
    const ents = vault.listRaw().filter((e) => e.service === 'apple');
    let issuer = null; for (const e of ents) for (const v of e.vars || []) if (/ISSUER/i.test(v.k) && v.v) issuer = v.v.trim();
    const keys = ents.filter((e) => e.file && /^AuthKey_([A-Z0-9]+)\.p8$/i.test(e.file.name) && !PLACEHOLDER.test(e.file.name));
    const mine = keys.find((e) => new RegExp(pr.name, 'i').test(e.name)) || (keys.length === 1 ? keys[0] : null) || keys[0];
    const kid = mine ? mine.file.name.match(/^AuthKey_([A-Z0-9]+)\.p8$/i)[1] : null;
    return { issuer, keyId: kid, pem: mine ? Buffer.from(mine.file.b64, 'base64').toString('utf8') : null, entryName: mine && mine.name };
  }
  function token(c) {
    const now = Math.floor(Date.now() / 1000); const head = b64u(JSON.stringify({ alg: 'ES256', kid: c.keyId, typ: 'JWT' })); const pay = b64u(JSON.stringify({ iss: c.issuer, iat: now, exp: now + 1000, aud: 'appstoreconnect-v1' }));
    const sig = crypto.sign('sha256', Buffer.from(head + '.' + pay), { key: c.pem, dsaEncoding: 'ieee-p1363' });
    return head + '.' + pay + '.' + b64u(sig);
  }
  const get = (tok, pathq) => new Promise((resolve, reject) => {
    const req = https.get({ host: 'api.appstoreconnect.apple.com', path: pathq, headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json' }, timeout: 20000 }, (r) => {
      let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} if (r.statusCode >= 200 && r.statusCode < 300) resolve(j || {}); else reject(Object.assign(new Error((j && j.errors && j.errors[0] && (j.errors[0].detail || j.errors[0].title)) || 'Apple returned ' + r.statusCode), { status: r.statusCode })); });
    });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Apple did not answer in time')));
  });
  const attr = (x) => (x && x.attributes) || {};

  async function appStatus(tok, app) {
    const out = { id: app.id, name: app.name, bundleId: app.bundleId, platforms: app.platforms, versions: [], builds: [], submissions: [], error: null };
    const find = await get(tok, `/v1/apps?filter[bundleId]=${encodeURIComponent(app.bundleId)}&limit=1`);
    const a = find.data && find.data[0]; if (!a) { out.error = `No app with bundle id ${app.bundleId} in this Apple account.`; return out; }
    out.appleId = a.id; out.storeName = attr(a).name;
    try { const v = await get(tok, `/v1/apps/${a.id}/appStoreVersions?limit=6`); out.versions = (v.data || []).map((x) => ({ version: attr(x).versionString, platform: attr(x).platform, state: friendly(attr(x).appVersionState || attr(x).appStoreState), created: attr(x).createdDate })).sort((p, q) => String(q.created).localeCompare(String(p.created))); } catch (e) { out.versionsError = e.message; }
    try { const s = await get(tok, `/v1/apps/${a.id}/reviewSubmissions?limit=5`); out.submissions = (s.data || []).map((x) => ({ state: friendly(attr(x).state), submitted: attr(x).submittedDate, platform: attr(x).platform })).sort((p, q) => String(q.submitted).localeCompare(String(p.submitted))); } catch (e) { out.submissionsError = e.message; }
    try {
      const b = await get(tok, `/v1/builds?filter[app]=${a.id}&sort=-uploadedDate&limit=5`);
      out.builds = (b.data || []).map((x) => ({ id: x.id, build: attr(x).version, uploaded: attr(x).uploadedDate, processing: friendly(attr(x).processingState), expired: !!attr(x).expired }));
      if (out.builds[0]) { try { const t = await get(tok, `/v1/builds/${out.builds[0].id}/betaAppReviewSubmission`); out.builds[0].testflight = friendly(attr(t.data).betaReviewState); } catch {} }
    } catch (e) { out.buildsError = e.message; }
    return out;
  }


  // raw (gzip TSV) download for sales reports
  const getRaw = (tok, pathq) => new Promise((resolve, reject) => {
    const req = https.get({ host: 'api.appstoreconnect.apple.com', path: pathq, headers: { Authorization: 'Bearer ' + tok, Accept: 'application/a-gzip, application/json' }, timeout: 30000 }, (r) => {
      const chunks = []; r.on('data', (x) => chunks.push(x)); r.on('end', () => { const buf = Buffer.concat(chunks); if (r.statusCode === 404) return resolve(''); if (r.statusCode < 200 || r.statusCode >= 300) { let m = 'Apple returned ' + r.statusCode; try { m = JSON.parse(buf.toString()).errors[0].detail || m; } catch {} return reject(Object.assign(new Error(m), { status: r.statusCode })); } try { resolve(zlib.gunzipSync(buf).toString('utf8')); } catch { resolve(buf.toString('utf8')); } });
    }); req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Apple did not answer in time')));
  });
  const vendorOf = () => { for (const e of vault.listRaw()) if (e.service === 'apple') for (const v of e.vars || []) if (/VENDOR/i.test(v.k) && v.v) return v.v.trim(); return null; };
  async function salesFor(tok, vendor, appleId) {
    const days = []; for (let i = 1; i <= 14; i++) days.push(new Date(Date.now() - i * 864e5).toISOString().slice(0, 10)); const out = [];
    await Promise.all(days.map(async (d) => { try { const t = await getRaw(tok, `/v1/salesReports?filter[frequency]=DAILY&filter[reportSubType]=SUMMARY&filter[reportType]=SALES&filter[vendorNumber]=${encodeURIComponent(vendor)}&filter[reportDate]=${d}&filter[version]=1_1`); const lines = t.split('\n').filter(Boolean); if (lines.length < 2) return out.push({ d, downloads: 0, updates: 0, proceeds: 0 }); const h = lines[0].split('\t'); const ix = (n) => h.indexOf(n); let dl = 0, up = 0, pr = 0; for (const l of lines.slice(1)) { const c = l.split('\t'); if (c[ix('Apple Identifier')] !== String(appleId)) continue; const ty = c[ix('Product Type Identifier')]; const u = +c[ix('Units')] || 0; if (/^(1|1F|1T|F1)$/.test(ty)) dl += u; else if (/^(7|7F|7T|F7)$/.test(ty)) up += u; pr += (+c[ix('Developer Proceeds')] || 0) * u; } out.push({ d, downloads: dl, updates: up, proceeds: +pr.toFixed(2) }); } catch (e) { out.push({ d, error: e.message }); } }));
    return out.sort((a, b) => a.d.localeCompare(b.d));
  }
  async function insights(pid, force) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); const apps = ((pr.workspace && pr.workspace.apps) || []).filter((a) => a.bundleId); if (!apps.length) return { ok: false, reason: 'no-apps' };
    const c = credsFor(pr); if (!c.pem || !c.issuer) return { ok: false, reason: 'not-connected', message: 'Connect Apple first (Apple review tab).' };
    const ck = 'ins:' + pid; const hit = cache.get(ck); if (!force && hit && Date.now() - hit.t < 600000) return hit.v;
    const tok = token(c); const vendor = vendorOf(); const out = { ok: true, vendor: !!vendor, apps: [], checkedAt: Date.now() };
    for (const a of apps) {
      const o = { name: a.name, bundleId: a.bundleId, live: false, liveVersion: null, rating: null, ratingCount: 0, stars: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }, reviews: [], sales: null };
      try {
        const f = await get(tok, `/v1/apps?filter[bundleId]=${encodeURIComponent(a.bundleId)}&limit=1`); const app = f.data && f.data[0]; if (!app) { o.error = 'App not found in this Apple account'; out.apps.push(o); continue; } o.appleId = app.id;
        const v = await get(tok, `/v1/apps/${app.id}/appStoreVersions?limit=10`); const live = (v.data || []).find((x) => (attr(x).appVersionState || attr(x).appStoreState) === 'READY_FOR_SALE'); o.live = !!live; o.liveVersion = live ? attr(live).versionString : null;
        try { const r = await get(tok, `/v1/apps/${app.id}/customerReviews?limit=50&sort=-createdDate`); const list = r.data || []; o.reviews = list.slice(0, 8).map((x) => ({ rating: attr(x).rating, title: attr(x).title, body: String(attr(x).body || '').slice(0, 240), who: attr(x).reviewerNickname, when: attr(x).createdDate, country: attr(x).territory })); for (const x of list) { const s = attr(x).rating; if (s >= 1 && s <= 5) { o.stars[s]++; o.ratingCount++; } } o.rating = o.ratingCount ? +(Object.entries(o.stars).reduce((s, [k, n]) => s + k * n, 0) / o.ratingCount).toFixed(2) : null; } catch (e) { o.reviewsError = e.message; }
        if (vendor) { try { o.sales = await salesFor(tok, vendor, app.id); } catch (e) { o.salesError = e.message; } }
      } catch (e) { o.error = e.message; }
      out.apps.push(o);
    }
    cache.set(ck, { t: Date.now(), v: out }); return out;
  }
  async function checkBundle(pid, bundleId) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); if (!/^[A-Za-z0-9.-]{3,120}$/.test(bundleId || '')) throw new Error('bad bundle id'); const c = credsFor(pr); if (!c.pem || !c.issuer) throw new Error('Connect Apple first');
    const tok = token(c); const out = { bundleId };
    try { const b = await get(tok, `/v1/bundleIds?filter[identifier]=${encodeURIComponent(bundleId)}&limit=5`); out.registered = (b.data || []).some((x) => attr(x).identifier === bundleId); } catch (e) { out.registered = null; out.error = e.message; }
    try { const a = await get(tok, `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}&limit=1`); out.appRecord = !!(a.data && a.data[0]); if (out.appRecord) out.appName = attr(a.data[0]).name; } catch (e) { out.appRecord = null; }
    return out;
  }
  // The only write this module can do: register an explicit App ID (bundle identifier) that @@NAME@@’s own apps use. Identifiers can be removed again in the Apple developer portal.
  const post = (tok, pathq, body) => new Promise((resolve, reject) => {
    const data = JSON.stringify(body); const req = https.request({ host: 'api.appstoreconnect.apple.com', path: pathq, method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }, timeout: 20000 }, (r) => { let d = ''; r.on('data', (x) => (d += x)); r.on('end', () => { let j = null; try { j = JSON.parse(d); } catch {} if (r.statusCode >= 200 && r.statusCode < 300) resolve(j || {}); else reject(new Error((j && j.errors && (j.errors[0].detail || j.errors[0].title)) || 'Apple returned ' + r.statusCode)); }); });
    req.on('error', reject); req.on('timeout', () => req.destroy(new Error('Apple did not answer in time'))); req.end(data);
  });
  async function registerBundle(pid, bundleId, name) {
    const pr = project(pid); if (!pr) throw new Error('unknown project'); if (!/^[A-Za-z0-9-]+\.[A-Za-z0-9.-]{2,60}$/.test(bundleId || '')) throw new Error('Enter a valid bundle identifier, for example com.yourname.myapp'); const c = credsFor(pr); if (!c.pem || !c.issuer) throw new Error('Connect Apple first');
    const tok = token(c); const cur = await checkBundle(pid, bundleId); if (cur.registered) return { ...cur, already: true };
    await post(tok, '/v1/bundleIds', { data: { type: 'bundleIds', attributes: { identifier: bundleId, name: String(name || bundleId).slice(0, 60), platform: 'IOS' } } }); return { ...(await checkBundle(pid, bundleId)), created: true };
  }
  async function status(pid, force) {
    const pr = project(pid); if (!pr) throw new Error('unknown project');
    const apps = ((pr.workspace && pr.workspace.apps) || []).filter((a) => a.bundleId);
    if (!apps.length) return { ok: false, reason: 'no-apps', message: 'No app with a bundle id is set up for this project yet.', apps: [] };
    const c = credsFor(pr);
    if (!c.pem) return { ok: false, reason: 'no-key', message: `Import the App Store Connect key (AuthKey_….p8) for ${pr.name} in Vault & keys.`, apps: apps.map((a) => ({ name: a.name, bundleId: a.bundleId })) };
    if (!c.issuer) return { ok: false, reason: 'no-issuer', message: 'Paste your App Store Connect Issuer ID (a UUID shown above the keys list in App Store Connect › Users and Access › Integrations).', keyId: c.keyId, apps: apps.map((a) => ({ name: a.name, bundleId: a.bundleId })) };
    const ck = pid; const hit = cache.get(ck); if (!force && hit && Date.now() - hit.t < 120000) return hit.v;
    let tok; try { tok = token(c); } catch (e) { return { ok: false, reason: 'bad-key', message: 'The saved key could not be used: ' + e.message, keyId: c.keyId, apps: [] }; }
    const out = { ok: true, keyId: c.keyId, key: c.entryName, checkedAt: Date.now(), apps: [] };
    for (const a of apps) { try { out.apps.push(await appStatus(tok, a)); } catch (e) { if (e.status === 401 || e.status === 403) return { ok: false, reason: 'denied', message: 'Apple refused the key (' + e.message + '). Check that the Issuer ID is right and the key has App Manager or Admin access.', keyId: c.keyId, apps: [] }; out.apps.push({ name: a.name, bundleId: a.bundleId, versions: [], builds: [], submissions: [], error: e.message }); } }
    cache.set(ck, { t: Date.now(), v: out }); return out;
  }
  return {
    status, insights, friendly,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/apple')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try { if (p === '/api/apple/register-bundle' && req.method === 'POST') { const b = await ctx.readBody(req); return S(200, await registerBundle(b.project, b.id, b.name)); } if (p === '/api/apple/check-bundle') return S(200, await checkBundle(url.searchParams.get('project'), url.searchParams.get('id'))); if (p === '/api/apple/insights') return S(200, await insights(url.searchParams.get('project'), url.searchParams.get('force') === '1')); if (p === '/api/apple/status') return S(200, await status(url.searchParams.get('project'), url.searchParams.get('force') === '1')); } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
