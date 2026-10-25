'use strict';
// Social accounts: automatic updates, every account opens its real profile, and a details view with all the numbers.
(() => {
const SRC = (l) => (!l ? 'no numbers yet' : l.source === 'api' ? 'live from the platform API' : l.source === 'public' ? 'read from the public profile' : 'entered by hand');
const SRC_CLS = (l) => (!l ? 'warn' : l.source === 'api' ? 'good' : l.source === 'public' ? 'good' : '');
const fdate = (t) => { const d = new Date(t); return isNaN(d) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); };
const sign = (n) => (n == null ? '' : (n > 0 ? '+' : '') + fmtN(n));

function lineChart(points, color) {
  const pts = points.filter((p) => p.v != null); if (pts.length < 2) return '<div class="muted tiny" style="padding:18px 0">The chart appears after the second update. Jarvis adds a new point automatically.</div>';
  const W = 600, H = 150, pad = 6; const min = Math.min(...pts.map((p) => p.v)), max = Math.max(...pts.map((p) => p.v)); const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2), y = (v) => H - pad - ((v - min) / span) * (H - pad * 2 - 14) - 4;
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${H}" class="acc-line"><path d="${d} L${x(pts.length - 1)},${H} L${x(0)},${H} Z" fill="${color}" opacity=".12"/><path d="${d}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linejoin="round"/>${pts.map((p, i) => `<circle cx="${x(i).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="3.2" fill="${color}"><title>${fdate(p.t)}: ${fmtN(p.v)}</title></circle>`).join('')}<text x="${pad}" y="12" fill="currentColor" opacity=".55" font-size="11">${fmtN(max)}</text><text x="${pad}" y="${H - 8}" fill="currentColor" opacity=".55" font-size="11">${fmtN(min)}</text></svg><div class="muted tiny" style="display:flex;justify-content:space-between"><span>${fdate(pts[0].t)}</span><span>${fdate(pts[pts.length - 1].t)}</span></div>`;
}

window.accCard = function (a) {
  const p = PL[a.platform] || { n: a.platform, c: '#8793a8', g: '?' }; const l = a.latest; const hist = (a.history || []).map((x) => x.followers).filter((x) => x != null);
  const k = (lab, val, dl) => `<div class="kpi"><span>${lab}</span><b>${val == null ? '—' : fmtN(val)}</b>${delta(dl)}</div>`;
  const link = a.profileUrl; const can = a.api.ready || a.api.public;
  return `<div class="card acc" style="--c:${p.c}"><div class="acc-h">${link ? `<a class="acc-id" href="${esc(link)}" target="_blank" rel="noopener" title="Open ${esc(p.n)} in the browser">` : '<span class="acc-id">'}<span class="pl-chip big" style="--c:${p.c}">${esc(p.g)}</span><span class="acc-name"><b>${esc(p.n)}</b><span class="muted tiny t">${a.handle ? esc(a.handle) : 'No profile link yet'}${link ? ' ↗' : ''}</span></span>${link ? '</a>' : '</span>'}<span class="grow"></span><span class="chip2 ${SRC_CLS(l)}">${SRC(l)}</span></div>
    ${l ? `<div class="kpis">${k('Followers', l.followers, a.deltas.followers)}${k('Following', l.following)}${k('Views', l.views, a.deltas.views)}${k('Likes', l.likes, a.deltas.likes)}${k('Comments', l.comments, a.deltas.comments)}${k('Posts', l.posts)}</div><div class="acc-spark">${sparkHtml(hist, p.c)}<span class="muted tiny">followers over time · updated ${ago(l.t)}</span></div>${l.best ? `<div class="best">🏆 Best recent: ${esc(String(l.best.title).slice(0, 60))}${l.best.views ? ' · ' + fmtN(l.best.views) + ' views' : l.best.likes ? ' · ' + fmtN(l.best.likes) + ' likes' : ''}</div>` : ''}` : `<div class="acc-empty">${a.api.public ? 'Jarvis will read the public profile automatically. Press Update to do it now.' : a.api.ready ? 'Press Update to pull the numbers.' : esc(a.api.need)}${!link ? ' Add the profile link with ✎ first.' : ''}</div>`}
    <div class="acc-meta"><span>🗓 ${a.scheduled} scheduled</span><span>🚀 ${a.published} posted</span>${a.nextPost ? `<span>Next: ${new Date(a.nextPost.when).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>` : ''}</div>
    <div class="pill-row" style="margin-top:10px"><button class="btn sm primary" data-acc2="detail|${esc(a.id)}">Details</button>${link ? `<a class="btn sm" href="${esc(link)}" target="_blank" rel="noopener">Open ${esc(p.n)} ↗</a>` : ''}${can ? `<button class="btn sm" data-acc="refresh|${esc(a.id)}">↻ Update</button>` : ''}<button class="btn sm" data-acc="num|${esc(a.id)}">Type numbers</button><button class="btn sm ghost" data-acc="edit|${esc(a.id)}" title="Edit profile link">✎</button></div></div>`;
};

async function accDetail(cur, a) {
  const p = PL[a.platform] || { n: a.platform, c: '#8793a8', g: '?' }; const l = a.latest || {}; const hist = a.history || [];
  const link = a.profileUrl; const kp = (lab, val, dl, sub) => `<div class="kpi"><span>${lab}</span><b>${val == null ? '—' : fmtN(val)}</b>${dl != null ? delta(dl) : ''}${sub ? `<span class="muted tiny">${sub}</span>` : ''}</div>`;
  const rows = hist.slice(-12).reverse().map((x, i, arr) => { const prev = arr[i + 1]; const ch = prev && x.followers != null && prev.followers != null ? x.followers - prev.followers : null; return `<tr><td class="muted tiny">${esc(fdate(x.t))}</td><td><b>${x.followers != null ? fmtN(x.followers) : '—'}</b> ${ch ? `<span class="dl ${ch > 0 ? 'up' : 'down'}">${sign(ch)}</span>` : ''}</td><td>${x.likes != null ? fmtN(x.likes) : '—'}</td><td>${x.views != null ? fmtN(x.views) : '—'}</td><td>${x.posts != null ? fmtN(x.posts) : '—'}</td><td class="muted tiny">${x.source === 'public' ? 'public page' : x.source === 'api' ? 'API' : 'by hand'}</td></tr>`; }).join('');
  modal(`<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px"><span class="pl-chip big" style="--c:${p.c}">${esc(p.g)}</span><div class="grow"><h2 style="font-size:20px;margin:0">${esc(p.n)}</h2><div class="muted tiny">${esc(a.handle || '')} · ${esc(cur.name || '')}</div></div>${link ? `<a class="btn primary" href="${esc(link)}" target="_blank" rel="noopener">Open on ${esc(p.n)} ↗</a>` : ''}<button class="btn sm" id="adX">✕</button></div>
    <div class="kpis acc-big">${kp('Followers', l.followers, a.deltas.followers, '30-day change')}${kp('Following', l.following)}${kp('Total views', l.views, a.deltas.views)}${kp('Likes', l.likes, a.deltas.likes)}${kp('Comments', l.comments, a.deltas.comments)}${kp('Posts on the platform', l.posts)}${a.engagementRate != null ? `<div class="kpi"><span>Engagement per post</span><b>${(a.engagementRate * 100).toFixed(1)}%</b></div>` : ''}</div>
    <div class="cn-lbl" style="margin-top:14px">Followers over time</div>${lineChart(hist.map((x) => ({ t: x.t, v: x.followers })), p.c)}
    <div class="muted tiny" style="margin:6px 0 10px">${a.updatedAt ? `Last updated ${esc(fdate(a.updatedAt))} · ${SRC(l)}` : 'No numbers yet'}</div>
    <div class="grid g2"><div><div class="cn-lbl">In Jarvis</div><div class="row"><div class="grow t">Scheduled posts</div><b>${a.scheduled}</b></div><div class="row"><div class="grow t">Posted</div><b>${a.published}</b></div>${a.nextPost ? `<div class="row"><div class="grow t">Next post</div><span class="muted tiny">${esc(fdate(a.nextPost.when))}</span></div>` : ''}</div>
      <div><div class="cn-lbl">How it updates</div><div class="muted tiny" style="line-height:1.5">${a.api.ready ? 'Through the platform API (exact numbers).' : a.api.public ? 'Jarvis reads the public profile page automatically.' : (a.platform === 'facebook' ? 'Facebook hides numbers from visitors. Add the META_ACCESS_TOKEN in Vault & keys, or type the numbers in.' : 'This platform does not show numbers publicly. Type them in or connect its API.')}</div></div></div>
    ${rows ? `<div class="cn-lbl" style="margin-top:14px">History</div><div style="overflow-x:auto"><table class="acc-tbl"><tr><th>When</th><th>Followers</th><th>Likes</th><th>Views</th><th>Posts</th><th>Source</th></tr>${rows}</table></div>` : ''}
    <div class="cn-lbl" style="margin-top:14px">Recent posts on ${esc(p.n)}</div><div id="adPosts"><div class="skeleton" style="height:60px"></div></div>
    <div class="pill-row" style="margin-top:14px">${a.api.ready || a.api.public ? '<button class="btn" id="adRef">↻ Update now</button>' : ''}<button class="btn" id="adNum">Type numbers</button><button class="btn" id="adEdit">✎ Profile link</button><button class="btn" id="adAna">📊 Ask the analyst</button></div>`, true);
  $('#adX').onclick = closeModal; $('#adNum').onclick = () => snapModal(cur, a); $('#adEdit').onclick = () => accountModal(cur, a);
  const r = $('#adRef'); if (r) r.onclick = async () => { r.disabled = true; r.textContent = 'Updating…'; try { const x = await post('/api/social/refresh', { project: cur.project, accountId: a.id }); toast(x.results[0] && x.results[0].ok ? 'Updated' : (x.results[0] && x.results[0].error) || 'Nothing to update'); } catch (e) { toast(e.message); } closeModal(); vSocialHub($('#view')); };
  $('#adAna').onclick = async () => { try { await post('/api/social/analyse', { project: cur.project }); await loadTeam(); toast('The Social Analyst is on it. See the Agent team page.'); } catch (e) { toast(e.message); } };
  try { const d = await api(`/api/social/stage?project=${encodeURIComponent(cur.project)}&stage=posted`); const box = document.getElementById('adPosts'); if (!box) return; const list = d.posts.filter((x) => x.platform === a.platform).slice(0, 10); box.innerHTML = list.map((x) => `<div class="row"><div class="grow"><div class="t">${esc(x.title || x.base || 'Post')}</div><div class="muted tiny">${esc(fdate(x.when))}</div></div><b>${x.views != null ? fmtN(x.views) + ' views' : '—'}</b>${x.url ? `<a class="btn sm ghost" href="${esc(x.url)}" target="_blank" rel="noopener">↗</a>` : ''}</div>`).join('') || '<div class="muted tiny">No posts yet.</div>'; } catch {}
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-acc2]'); if (!b) return; const [k, id] = b.dataset.acc2.split('|'); const pid = S.soc.pid; const d = S.soc['a_' + pid]; const a = d && d.accounts.find((x) => x.id === id); const cur = (S.socSum && S.socSum.projects.find((x) => x.project === pid)) || { project: pid, name: '' };
  if (k === 'detail' && a) { e.stopPropagation(); accDetail(cur, a); }
}, true);

// automatic-update strip above the accounts
const _accountsTab = window.accountsTab;
window.accountsTab = async function (body, cur) {
  await _accountsTab(body, cur); const d = S.soc['a_' + cur.project]; if (!d || !d.auto || body.querySelector('#autoStrip')) return; const A = d.auto;
  const strip = document.createElement('div'); strip.id = 'autoStrip'; strip.className = 'auto-strip';
  strip.innerHTML = `<label class="sw"><input type="checkbox" id="auOn" ${A.on ? 'checked' : ''}><i></i>Update automatically</label><select class="mini" id="auHrs">${[1, 3, 6, 12, 24].map((h) => `<option value="${h}" ${h === A.hours ? 'selected' : ''}>every ${h} h</option>`).join('')}</select><span class="muted tiny grow">${A.running ? '<span class="live-pulse"></span>updating now…' : A.lastRun ? `last update ${ago(A.lastRun)}${A.on ? ` · next ${new Date(A.next).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'no update yet'}</span><button class="btn sm primary" id="auNow">↻ Update everything now</button>`;
  const grid = body.querySelector('.pill-row'); (grid || body.firstChild).before(strip);
  const save = async (extra) => { try { await post('/api/social/auto', { on: strip.querySelector('#auOn').checked, hours: +strip.querySelector('#auHrs').value, ...extra }); if (extra && extra.now) { toast('Updating all accounts…'); setTimeout(() => accountsTab(body, cur), 20000); } } catch (e) { toast(e.message); } };
  strip.querySelector('#auOn').onchange = () => save(); strip.querySelector('#auHrs').onchange = () => save(); strip.querySelector('#auNow').onclick = () => save({ now: true });
};
})();
