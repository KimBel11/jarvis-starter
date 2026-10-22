'use strict';
// One voice to @@NAME@@: every agent reports to @@ASSISTANT@@, and @@ASSISTANT@@ sends @@NAME@@ ONE short message (iMessage and the Jarvis chat).
// When agents finish, fail or need approval, those events are collected for a moment, summarised by @@NAME@@ in plain words, and delivered.
const fs = require('fs');
const path = require('path');

const WATCH = ['awaiting_approval', 'done', 'failed'];

module.exports = function makeReports(ctx, deps) {
  const FILE = path.join(ctx.DATA, 'reports.json'); let st = { seen: {}, feed: [], init: false };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify({ ...st, feed: st.feed.slice(-80) })); } catch {} };
  let pending = [], timer = null, firstAt = 0, composing = false;
  const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const sig = (t) => `${t.status}:${t.finishedAt || t.updatedAt || ''}`;

  function scan() {
    const tasks = deps.agents.tasks(); if (!st.init) { for (const t of tasks) st.seen[t.id] = sig(t); st.init = true; save(); return; }
    for (const t of tasks) {
      if (!WATCH.includes(t.status) || st.seen[t.id] === sig(t)) continue; st.seen[t.id] = sig(t);
      const a = deps.agents.agentById(t.agent); pending.push({ id: t.id, agent: (a && a.name) || t.agent, title: short(t.title, 90), status: t.status, text: short(t.status === 'awaiting_approval' ? t.plan || t.output : t.status === 'failed' ? t.error || t.output : t.output, 700) });
      if (!firstAt) firstAt = Date.now(); clearTimeout(timer); timer = setTimeout(flush, Math.max(5000, Math.min(25000, 180000 - (Date.now() - firstAt))));
    }
    // forget old ids so the file stays small
    const ids = new Set(tasks.map((t) => t.id)); for (const k of Object.keys(st.seen)) if (!ids.has(k)) delete st.seen[k]; save();
  }
  async function compose(events) {
    const lines = events.map((e) => `- ${e.agent} (${e.status === 'awaiting_approval' ? 'plan ready, id ' + e.id : e.status === 'done' ? 'finished, id ' + e.id : 'FAILED, id ' + e.id}): ${e.title}. ${e.text}`).join('\n');
    const input = `Your agents just reported to you:\n${lines}\n\nWrite ONE message to @@NAME@@. Rules: at most 90 words; plain spoken language; no markdown, no lists, no symbols; the most important result first; say exactly what @@NAME@@ must decide; when a plan is waiting say it as: reply approve to start it (never read out any id or code); mention failures honestly and what you suggest.`;
    const r = await deps.runner.runOnce({ agent: 'claude', model: 'claude-haiku-5-5', maxBudget: 0.15, cwd: ctx.DRIVE, input, system: 'You are @@ASSISTANT@@, @@NAME@@\'s chief of staff. Your agents report to you; you report to @@NAME@@ in one short, warm, clear message.', tools: 'Read', timeoutMs: 120000 });
    return r.text.trim() || lines.slice(0, 400);
  }
  async function flush() {
    if (composing || !pending.length) return; composing = true; const events = pending; pending = []; firstAt = 0; clearTimeout(timer);
    try {
      let text; try { text = await compose(events); } catch { text = events.map((e) => `${e.agent}: ${e.title} (${e.status.replace('_', ' ')})`).join('. '); }
      const waiting = events.filter((e) => e.status === 'awaiting_approval'); let audio = null; try { const v = deps.voicenotes && await deps.voicenotes.make(text); if (v) audio = v.id; } catch {}
      const item = { id: 'r' + Date.now().toString(36), t: Date.now(), text, audio, tasks: events.map((e) => ({ id: e.id, agent: e.agent, status: e.status })) }; st.feed.push(item); save();
      // several plans waiting: the voice note says so, a short text lists the ids you reply with
      try { if (deps.imessage) await deps.imessage.notify(text, waiting.length > 1 ? 'Plans waiting:\n' + waiting.map((e) => `${e.id}: ${e.title}`).join('\n') + '\nReply "approve <id>".' : '', audio); } catch {}
    } finally { composing = false; if (pending.length) setTimeout(flush, 3000); }
  }
  setInterval(scan, 15000).unref(); setTimeout(scan, 5000).unref();
  const context = () => { const last = st.feed.filter((x) => !x.test).slice(-3).filter((x) => Date.now() - x.t < 6 * 3600e3); return last.length ? '[For your memory: you recently reported this to @@NAME@@: ' + last.map((x) => x.text).join(' | ').slice(0, 900) + ']' : ''; };

  return {
    context,
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/reports')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/reports') { const since = +url.searchParams.get('since') || 0; return S(200, { reports: st.feed.filter((x) => x.t > since).slice(-30), now: Date.now(), pending: pending.length }); }
        if (p === '/api/reports/test' && req.method === 'POST') { const text = await compose([{ id: 'tdemo1', agent: 'Social Publisher', title: 'Plan the next 3 posts', status: 'awaiting_approval', text: 'Plan: post the Ready-to-post reel on TikTok and Instagram tomorrow 12:00, then two more on Friday. Needs your approval before anything is posted.' }, { id: 'tdemo2', agent: 'Social Analyst', title: 'Weekly analysis', status: 'done', text: 'TikTok grew by 6 followers, Instagram is flat, best post was The Unequal Keys.' }]); let audio = null; try { const v = deps.voicenotes && await deps.voicenotes.make(text); if (v) audio = v.id; } catch {} const item = { id: 'r' + Date.now().toString(36), t: Date.now(), text, audio, tasks: [], test: true }; st.feed.push(item); save(); return S(200, item); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
