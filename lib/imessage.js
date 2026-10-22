'use strict';
// iMessage control: text Jarvis from your iPhone and it answers. It reads the Messages database on this Mac (needs Full Disk Access
// for the Jarvis process) and replies through the Messages app (needs Automation permission). Only messages from handles @@NAME@@ lists are accepted;
// everything else is ignored. Anything that costs money or goes public still waits for an explicit "approve <id>".
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const DB = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');
const BOT = '🤖 ';
const run = (cmd, args, ms = 20000) => new Promise((res) => execFile(cmd, args, { timeout: ms, encoding: 'utf8', maxBuffer: 20e6 }, (e, out, err) => res({ ok: !e, out: out || '', timedOut: !!(e && e.killed), err: (err || (e && (e.killed ? 'timed out' : e.message)) || '').trim() })));
const normHandle = (h) => { h = String(h || '').trim(); if (/@/.test(h)) return h.toLowerCase(); const d = h.replace(/[^\d+]/g, ''); return d.startsWith('+') ? d : d ? '+' + d : ''; };
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

// newer macOS keeps the message text inside a binary blob (attributedBody); pull the plain string out of it
function textFromBlob(hex) {
  if (!hex) return ''; let buf; try { buf = Buffer.from(hex, 'hex'); } catch { return ''; }
  const i = buf.indexOf('NSString'); if (i < 0) return ''; let p = buf.indexOf(Buffer.from([0x01, 0x2b]), i); if (p < 0) return ''; p += 2; let len = buf[p++]; if (len === 0x81) { len = buf.readUInt16LE(p); p += 2; } else if (len === 0x82) { len = buf.readUInt32LE(p); p += 4; }
  return buf.slice(p, p + len).toString('utf8');
}

module.exports = function makeImessage(ctx, deps) {
  const FILE = path.join(ctx.DATA, 'imessage.json'); let st = { enabled: false, handles: [], lastRow: 0, log: [], sent: 0, mode: 'own', kimSession: null, lastChat: null, reports: true, voice: false, approveByText: true };
  try { st = { ...st, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(st)); } catch {} };
  const base = () => 'http://127.0.0.1:' + (process.env.JARVIS_PORT || 4777);
  const api = async (u, body) => { const r = await fetch(base() + u, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) } : { signal: AbortSignal.timeout(30000) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || r.statusText); return j; };
  const log = (dir, text, extra) => { st.log.push({ t: Date.now(), dir, text: String(text).slice(0, 300), ...(extra || {}) }); if (st.log.length > 60) st.log.splice(0, st.log.length - 60); save(); };

  /* ---------- reading ---------- */
  async function sql(query) { const r = await run('/usr/bin/sqlite3', ['-readonly', '-json', DB, query]); if (!r.ok) throw Object.assign(new Error(r.err || 'cannot read'), { perm: /authorization denied|not permitted|unable to open/i.test(r.err) }); try { return JSON.parse(r.out || '[]'); } catch { return []; } }
  async function canRead() { try { await sql('select 1 as ok limit 1'); return { ok: true }; } catch (e) { return { ok: false, perm: !!e.perm, error: e.message.slice(0, 160) }; } }
  async function maxRow() { const r = await sql('select max(ROWID) as m from message'); return (r[0] && r[0].m) || 0; }
  async function newMessages() {
    const hs = st.handles.map(normHandle).filter(Boolean); if (!hs.length) return [];
    const rows = await sql(`select m.ROWID as id, m.text as text, hex(m.attributedBody) as blob, m.is_from_me as mine, c.chat_identifier as chat, m.date as date from message m join chat_message_join j on j.message_id = m.ROWID join chat c on c.ROWID = j.chat_id where m.ROWID > ${+st.lastRow || 0}${st.mode === 'own' ? ' and m.is_from_me = 0' : ''} and c.chat_identifier in (${hs.map(q).join(',')}) order by m.ROWID limit 20`);
    return rows.map((r) => ({ ...r, body: (r.text || textFromBlob(r.blob) || '').trim() }));
  }

  /* ---------- sending ---------- */
  async function send(handle, text) {
    const h = normHandle(handle); if (!h) throw new Error('no recipient'); const body = BOT + String(text).slice(0, 1400);
    const script = 'on run argv\n tell application "Messages"\n  set svc to 1st service whose service type = iMessage\n  set bud to buddy (item 1 of argv) of svc\n  send (item 2 of argv) to bud\n end tell\nend run';
    let r; for (let i = 0; i < 3; i++) { r = await run('/usr/bin/osascript', ['-e', script, h, body], 45000); if (r.ok) break; if (/not allowed|not authorized|-1743/i.test(r.err)) break; await new Promise((s) => setTimeout(s, 2500)); }
    if (!r.ok) throw new Error(/not allowed|not authorized|-1743/i.test(r.err) ? 'Jarvis is not allowed to control Messages yet (System Settings › Privacy & Security › Automation).' : r.timedOut ? 'Messages did not answer in time (it may be waiting on a permission pop-up on the Mac).' : r.err.slice(0, 160));
    st.sent++; log('out', text, { to: h }); return true;
  }
  // Send a real file. Messages only reads some folders, so the file is copied to Pictures first. Afterwards the Messages database is checked:
  // the outgoing attachment message must exist and carry no error (otherwise the caller falls back to a link).
  async function sendFile(handle, file) {
    const h = normHandle(handle); if (!h) throw new Error('no recipient'); if (!fs.existsSync(file)) throw new Error('The file does not exist any more.');
    const size = fs.statSync(file).size; if (size > 98e6) throw new Error(`The file is ${Math.round(size / 1e6)} MB, more than iMessage allows (about 100 MB).`);
    const copy = file; // Messages can read the file where it is; a copy in the Pictures folder arrives empty (Pictures is privacy-protected)
    const before = await maxRow();
    const script = 'on run argv\n tell application "Messages"\n  set svc to 1st service whose service type = iMessage\n  set bud to buddy (item 1 of argv) of svc\n  send (POSIX file (item 2 of argv)) to bud\n end tell\nend run';
    const r = await run('/usr/bin/osascript', ['-e', script, h, copy], 60000);
    if (!r.ok) throw new Error(/not allowed|not authorized|-1743/i.test(r.err) ? 'Jarvis is not allowed to control Messages yet.' : r.timedOut ? 'Messages did not answer in time.' : r.err.slice(0, 160));
    let row = null; for (let i = 0; i < 14 && !row; i++) { await new Promise((s) => setTimeout(s, 1500)); try { const rows = await sql(`select ROWID as id, is_sent as sent, is_delivered as delivered, error as err from message where ROWID > ${before} and is_from_me = 1 and (cache_has_attachments = 1 or exists (select 1 from message_attachment_join j where j.message_id = message.ROWID)) order by ROWID desc limit 1`); if (rows.length) row = rows[0]; } catch {} }
    if (!row) throw new Error('Messages did not create the attachment.'); if (row.err) throw new Error('Messages could not send the file (error ' + row.err + ').');
    st.sent++; log('out', '📎 ' + path.basename(file) + (row.delivered ? ' (delivered)' : ' (sent)'), { to: h }); return true;
  }
  const MEDIA = /\.(mp4|mov|m4v|png|jpe?g|gif|heic|webp|m4a|mp3|wav|aac)$/i;
  // Real attachments cannot be sent from this Mac: Messages accepts the file but creates an EMPTY message (verified several times, nothing reaches the phone).
  // So every file goes as a private link that opens (and can be saved) on the phone.
  async function deliverFile(handle, file) {
    const l = deps.share.create(file); const kind = /\.(mp4|mov|m4v)$/i.test(file) ? 'video' : /\.(png|jpe?g|gif|heic|webp)$/i.test(file) ? 'image' : /\.(m4a|mp3|wav|aac)$/i.test(file) ? 'audio' : 'file';
    await send(handle, `${path.basename(file)}\n${l.url}\n(Tap the link to ${kind === 'video' || kind === 'audio' ? 'play' : 'open'} it. To keep it: tap and hold${kind === 'image' || kind === 'video' ? ', then Save to Photos' : ', then Save to Files'}. Works for 48 hours${l.local ? ', but only on this Mac because remote access is off' : ''}.)`); return { as: 'link' };
  }
  // a voice note when speech works, plain text otherwise
  // a message with a private link to a file (used for the Jarvis profile picture); goes to the chat Jarvis already uses with its owner
  async function sendLink(text, file) {
    if (!st.enabled) return { sent: false, reason: 'iMessage control is off' };
    const to = st.lastChat || st.handles[0]; if (!to) return { sent: false, reason: 'No iMessage address is set up' };
    const l = deps.share.create(file);
    await send(to, text.split('{link}').join(l.url) + (l.local ? '\n(Remote access is off, so this link only opens on this Mac. Turn it on under iPhone & remote.)' : ''));
    return { sent: true, to, url: l.url, local: l.local };
  }
  async function sendVoice(handle, text, extraText, preId, force) {
    if ((st.voice || force) && deps.voicenotes && deps.share) { const v = (preId && deps.voicenotes.find(preId)) || await deps.voicenotes.make(text); if (v) { try { const d = await deliverFile(handle, v.file); if (d.as === 'file' && extraText) await send(handle, extraText); return { voice: true, id: v.id }; } catch (e) { log('err', e.message); } } }
    await send(handle, text + (extraText ? '\n' + extraText : '')); return { voice: false };
  }

  /* ---------- commands ---------- */
  const short = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const HELP = ['Jarvis commands:', 'status: what is going on', 'waiting: plans that need your OK', 'plan <id>: read a plan', 'approve <id> [note] / reject <id>', 'assign <agent> <task>: give a task (plan first)', 'posts: next social posts', 'agents: who is working', 'anything else: I ask @@ASSISTANT@@'].join('\n');
  async function team() { return api('/api/team'); }
  const findAgent = (agents, key) => { key = key.toLowerCase(); return agents.find((a) => a.id === key) || agents.find((a) => a.name.toLowerCase().includes(key)) || agents.find((a) => a.id.includes(key)); };
  const QUICK = /^(help|\?|status|waiting|tasks|agents|plan|approve|yes|ok|okay|go|approved|reject|cancel|no|stop|posts)[:,.!]*$/i;
  // text is the default. A voice note or a video only when @@NAME@@ asks for it.
  const wantsVoice = (t) => /\b(voice ?(note|message|memo)?|audio|say (it|that)|speak|read (it )?(out|aloud)|out loud|talk to me)\b/i.test(t);
  const KINDS = { video: /\.(mp4|mov|m4v)$/i, image: /\.(png|jpe?g|gif|heic|webp)$/i, audio: /\.(m4a|mp3|wav|aac)$/i, doc: /\.(pdf|docx?|xlsx?|pptx?|zip|md|txt|csv)$/i };
  function fileKind(t) {
    if (!/\b(send|show|give|share|attach|forward|text)\b/i.test(t)) return null;
    if (/\bvideos?\b/i.test(t)) return 'video'; if (/\b(images?|photos?|pictures?|screenshots?|logo|poster)\b/i.test(t)) return 'image';
    if (/\b(audio file|recording|mp3|song)\b/i.test(t)) return 'audio'; if (/\b(pdf|document|report|spreadsheet|file)\b/i.test(t)) return 'doc'; return null;
  }
  function findFile(text, kind) {
    const stop = new Set(['send', 'me', 'the', 'and', 'video', 'videos', 'image', 'images', 'photo', 'photos', 'picture', 'pictures', 'screenshot', 'screenshots', 'please', 'can', 'you', 'could', 'give', 'show', 'share', 'attach', 'latest', 'newest', 'last', 'new', 'that', 'for', 'want', 'need', 'file', 'files', 'clip', 'mp4', 'from', 'forward', 'text', 'also', 'audio', 'recording', 'pdf', 'document', 'report']);
    const toks = String(text).toLowerCase().replace(/[^a-z0-9åäö ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !stop.has(w)); let best = null;
    for (const p of ctx.state.projects) { const sc = ctx.getScan(p); const d = sc && sc.data; if (!d) continue; for (const f of d.all) { if (!KINDS[kind].test(f.path)) continue; const n = f.path.toLowerCase(); const hits = toks.filter((x) => n.includes(x)).length; if (toks.length && !hits) continue; const score = hits * 1e14 + f.mtime; if (!best || score > best.score) best = { path: f.path, size: f.size, score }; } }
    return best;
  }
  async function handleCommand(text, opts) {
    const t = text.trim(); const [w0, ...rest] = t.split(/\s+/); const w = w0.toLowerCase().replace(/[:,.!]+$/, ''); const arg = rest.join(' ');
    if (w === 'help' || w === '?') return HELP;
    if (w === 'status') { const d = await team(); const wait = d.tasks.filter((x) => x.status === 'awaiting_approval'), run_ = d.tasks.filter((x) => ['running', 'planning'].includes(x.status)); const lines = [`${wait.length} waiting for you, ${run_.length} running.`]; for (const p of ctx.state.projects.filter((x) => x.workspace && x.workspace.social)) { try { const l = await api('/api/social/live?project=' + p.id); lines.push(`${p.name}: next post ${l.nextInMin == null ? 'none queued' : l.nextInMin < 90 ? 'in ' + l.nextInMin + ' min' : 'in ' + Math.round(l.nextInMin / 60) + ' h'}, ${l.totals.published} posted, ${l.totals.scheduled} queued`); } catch {} } return lines.join('\n'); }
    if (w === 'waiting' || w === 'tasks') { const d = await team(); const wait = d.tasks.filter((x) => x.status === 'awaiting_approval'); return wait.length ? wait.slice(0, 6).map((x) => `${x.id}: ${short(x.title, 60)} (${x.agent})`).join('\n') + '\nReply "plan <id>" to read one, "approve <id>" to start it.' : 'Nothing is waiting for you.'; }
    if (w === 'agents') { const d = await team(); return d.agents.filter((a) => a.id !== 'kim').map((a) => `${a.glyph} ${a.name}: ${(a.status || {}).state || 'idle'}${a.status && a.status.current ? ' - ' + short(a.status.current.title, 40) : ''}`).slice(0, 14).join('\n'); }
    if (w === 'plan') { const d = await team(); const x = d.tasks.find((y) => y.id === rest[0]); if (!x) return 'No task with that id.'; return `${x.title} (${x.status})\n${short(x.plan || x.output || 'No plan yet.', 900)}`; }
    if (!st.approveByText && ['approve', 'yes', 'ok', 'okay', 'go', 'approved'].includes(w) && (rest.length === 0 || w === 'approve')) return 'Approving by text is switched off. Open Jarvis and approve the plan there (Control center › Needs your OK).';
    if (['approve', 'yes', 'ok', 'okay', 'go', 'approved'].includes(w) && (rest.length === 0 || w === 'approve')) { let id = w === 'approve' && /^t[a-z0-9]{5,}$/i.test(rest[0] || '') ? rest[0] : null; let note = id ? rest.slice(1).join(' ') : rest.join(' '); if (!id) { const wait = (await team()).tasks.filter((x) => x.status === 'awaiting_approval'); if (wait.length === 1) id = wait[0].id; else return wait.length ? 'Several plans are waiting. Say "approve <id>":\n' + wait.slice(0, 6).map((x) => `${x.id}: ${short(x.title, 50)}`).join('\n') : 'Nothing is waiting for your OK.'; } await api('/api/tasks/approve', { id, note }); return 'Approved. The agent is working now.'; }
    if (['reject', 'cancel', 'no', 'stop'].includes(w) && rest.length <= 1) { let id = /^t[a-z0-9]{5,}$/i.test(rest[0] || '') ? rest[0] : null; if (!id) { const wait = (await team()).tasks.filter((x) => x.status === 'awaiting_approval'); if (wait.length === 1) id = wait[0].id; else return wait.length ? 'Several plans are waiting. Say "reject <id>".' : 'Nothing is waiting.'; } await api('/api/tasks/cancel', { id }); return 'Cancelled.'; }
    if (w === 'posts') { const lines = []; for (const p of ctx.state.projects.filter((x) => x.workspace && x.workspace.social)) { try { const l = await api('/api/social/live?project=' + p.id); lines.push(`${p.name}:`); for (const x of l.upcoming.slice(0, 4)) lines.push(` ${new Date(x.when).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ${x.platform}: ${short(x.title, 36)}`); } catch {} } return lines.join('\n') || 'No posts queued.'; }
    if (w === 'assign') { const d = await team(); const [key, ...tt] = rest; const a = key && findAgent(d.agents.filter((x) => x.id !== 'kim'), key); if (!a || !tt.length) return 'Use: assign <agent> <what to do>. Say "agents" to see names.'; const r = await api('/api/tasks', { agent: a.id, title: short(tt.join(' '), 80), prompt: tt.join(' ') }); return `Asked ${a.name} to plan it${r && r.id ? ` (task ${r.id})` : ''}. I will not start before you say approve.`; }
    // free text goes to @@ASSISTANT@@ (she can hand work to specialists; those still plan first and wait for approval)
    if (opts && opts.noChat) return null;
    const fk = fileKind(t); if (fk) { const v = findFile(t, fk); if (!v) return `I could not find a matching ${fk}. Say part of its name, for example: send me the ${fk} about the blue stain.`; if (v.size > 98e6 && KINDS.video.test(v.path)) { /* too big to attach: link instead */ } return { file: v.path, text: path.basename(v.path) }; }
    const voice = wantsVoice(t); const reply = await askKim(arg && w === 'ask' ? arg : t, voice); return { text: reply, voice };
  }
  async function askKim(prompt, voice) {
    const ctxTxt = deps.reportsContext ? deps.reportsContext() : ''; const full = (ctxTxt ? ctxTxt + '\n\n' : '') + prompt;
    const r = await fetch(base() + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: 'kim', prompt: full, voice: !!voice, listenOnly: !!voice, sessionId: st.kimSession || undefined }), signal: AbortSignal.timeout(180000) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); const txt = await r.text(); let out = '', tasks = [];
    for (const blk of txt.split('\n\n')) { const l = blk.replace(/^data: /, ''); try { const e = JSON.parse(l); if (e.type === 'delta') out += e.text; else if (e.type === 'session' && e.id) { st.kimSession = e.id; save(); } else if (e.type === 'done') { if (e.sessionId) { st.kimSession = e.sessionId; save(); } if (e.text && !out) out = e.text; } else if (e.type === 'task') tasks.push(e.task); else if (e.type === 'error') throw new Error(e.message); } catch (er) { if (er.message && !/JSON/.test(er.message)) throw er; } }
    return (out.trim() || 'Done.') + (tasks.length ? '\n' + tasks.map((t) => `Plan started: ${t.title} (id ${t.id}). Say "plan ${t.id}" later, then "approve ${t.id}".`).join('\n') : '');
  }
  // proactive message to @@NAME@@ (reports from her agents, written by @@ASSISTANT@@)
  async function notify(text, extraText, preId) { if (!st.enabled || !st.reports) return false; const to = st.lastChat || st.handles[0]; if (!to) return false; await sendVoice(to, text, extraText, preId); return true; }
  // which Apple ID is signed in to Messages on this Mac (asks Messages, so macOS may show a one-time "allow" prompt)
  async function accounts() {
    const script = 'tell application "Messages"\n set out to ""\n repeat with a in accounts\n  try\n   set out to out & (service type of a as string) & "|" & (description of a) & "|" & (enabled of a as string) & "|" & (connection status of a as string) & linefeed\n  end try\n end repeat\n return out\nend tell';
    const r = await run('/usr/bin/osascript', ['-e', script], 40000); if (!r.ok) throw new Error(/not allowed|not authorized|-1743/i.test(r.err) ? 'Allow Jarvis to control Messages (System Settings › Privacy & Security › Automation), then try again.' : r.err.slice(0, 160));
    return r.out.split('\n').filter(Boolean).map((l) => { const [type, desc, enabled, conn] = l.split('|'); return { type, description: desc, enabled: enabled === 'true', connection: conn }; });
  }

  /* ---------- loop ---------- */
  let busy = false, rate = [], recent = [];
  async function tick() {
    if (!st.enabled || busy || !st.handles.length) return; busy = true;
    try {
      if (!st.lastRow) { st.lastRow = await maxRow(); save(); return; }
      for (const m of await newMessages()) {
        st.lastRow = Math.max(st.lastRow, m.id); save(); const text = m.body; if (!text || text.startsWith(BOT.trim())) continue;
        // an attachment (like Jarvis' own voice note coming back as a received copy) is only a placeholder character: never treat it as a message
        if (!text.replace(/[\uFFFC\uFFFD\s]/g, '')) { log('skip', 'attachment'); continue; }
        if (st.mode === 'self' || st.mode === 'contact') { recent = recent.filter((x) => Date.now() - x.t < 25000); if (recent.some((x) => x.text === text)) continue; recent.push({ t: Date.now(), text }); }
        rate = rate.filter((x) => Date.now() - x < 3600e3); if (rate.length >= 40) { log('in', text, { skipped: 'rate limit' }); continue; } rate.push(Date.now());
        st.lastChat = m.chat; save(); log('in', text);
        // instant 'got it' so you know it arrived (iMessage cannot show a typing indicator from here): for anything that needs real work
        if (!(QUICK.test(text.trim().split(/\s+/)[0] || '') && text.trim().split(/\s+/).length <= 2)) { try { await send(m.chat, fileKind(text) ? '👀 Got it, looking for the file…' : '👀 Got it, working on it…'); } catch (e) { log('err', e.message); } }
        let reply; try { reply = await handleCommand(text); } catch (e) { reply = 'That did not work: ' + short(e.message, 200); }
        try {
          if (reply && reply.file) { await deliverFile(m.chat, reply.file, reply.text); }
          else if (reply && reply.voice) await sendVoice(m.chat, reply.text, null, null, true);
          else await send(m.chat, reply && reply.text ? reply.text : reply);
        } catch (e) { log('err', e.message); }
      }
    } catch (e) { log('err', e.message); if (e.perm) { st.enabled = false; st.needsPermission = true; save(); } } finally { busy = false; }
  }
  setInterval(() => tick().catch(() => {}), 7000).unref();

  async function status() {
    const read = await canRead(); const msgApp = (await run('/usr/bin/pgrep', ['-x', 'Messages'])).ok;
    return { enabled: st.enabled, handles: st.handles, canRead: read.ok, needsPermission: !read.ok && read.perm, readError: read.error || null, messagesRunning: msgApp, nodePath: process.execPath, sent: st.sent, mode: st.mode, reports: st.reports, voice: st.voice, approveByText: st.approveByText, lastChat: st.lastChat, sessionKept: !!st.kimSession, log: st.log.slice(-25).reverse(), help: HELP };
  }
  return {
    status, notify, accounts, sendVoice, sendLink, command: (t) => handleCommand(t, { noChat: true }),
    async handle(req, res, url, p) {
      if (!p.startsWith('/api/imessage')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (p === '/api/imessage') return S(200, await status());
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/imessage/handles' && req.method === 'POST') { const hs = [...new Set((Array.isArray(b.handles) ? b.handles : []).map(normHandle).filter(Boolean))].slice(0, 5); st.handles = hs; if (!hs.length) st.enabled = false; save(); return S(200, await status()); }
        if (p === '/api/imessage/enable' && req.method === 'POST') { if (b.on) { if (!st.handles.length) return S(400, { error: 'Add your phone number or Apple ID email first.' }); const r = await canRead(); if (!r.ok) return S(400, { error: 'Jarvis cannot read Messages yet. Give it Full Disk Access (see the steps).', needsPermission: true }); st.lastRow = await maxRow(); st.enabled = true; st.needsPermission = false; } else st.enabled = false; save(); return S(200, await status()); }
        if (p === '/api/imessage/test' && req.method === 'POST') { if (!st.handles.length) return S(400, { error: 'Add your number first.' }); await send(st.handles[0], 'Hi @@NAME@@, Jarvis here. Text me "help" to see what I can do.'); return S(200, await status()); }
        if (p === '/api/imessage/accounts' && req.method === 'POST') { const acc = await accounts(); const imsg = acc.filter((a) => /imessage/i.test(a.type)); const mine = st.handles.map(normHandle); const same = imsg.some((a) => mine.some((h) => String(a.description).toLowerCase().includes(h.replace(/^\+/, '').slice(-8)) || String(a.description).toLowerCase().includes(h))); return S(200, { accounts: imsg, sameAsKim: same }); }
        if (p === '/api/imessage/settings' && req.method === 'POST') { if (b.mode && ['own', 'self', 'contact'].includes(b.mode)) { st.mode = b.mode; if (st.enabled) { try { st.lastRow = await maxRow(); } catch {} } } if (typeof b.reports === 'boolean') st.reports = b.reports; if (typeof b.voice === 'boolean') st.voice = b.voice; if (typeof b.approveByText === 'boolean') st.approveByText = b.approveByText; if (b.resetConversation) st.kimSession = null; save(); return S(200, await status()); }
        if (p === '/api/imessage/peek') { const rows = await sql("select m.ROWID as id, m.is_from_me as mine, c.chat_identifier as chat, c.style as style, length(m.text) as tl, length(m.attributedBody) as bl, m.cache_has_attachments as att, (select count(*) from message_attachment_join j2 where j2.message_id = m.ROWID) as ja, m.balloon_bundle_id as bb, m.is_sent as sent, m.is_delivered as dlv, m.error as err, m.service as svc, datetime(m.date/1000000000+978307200,'unixepoch','localtime') as at from message m join chat_message_join j on j.message_id = m.ROWID join chat c on c.ROWID = j.chat_id order by m.ROWID desc limit 8"); return S(200, { watching: st.handles, lastRow: st.lastRow, recent: rows }); }
        if (p === '/api/imessage/test-file' && req.method === 'POST') { return S(400, { error: 'Disabled: attachments cannot be sent from this Mac.' }); }
        if (false) { const f = String(b.file || ''); if (!f.startsWith(ctx.DATA)) return S(400, { error: 'only files inside Jarvis data' }); const to = st.lastChat || st.handles[0]; await sendFile(to, f); return S(200, { ok: true, to }); }
        if (p === '/api/imessage/attachments') { const rows = await sql("select a.ROWID as id, a.filename as file, a.mime_type as mime, a.total_bytes as bytes, a.transfer_state as state, a.is_outgoing as out, a.is_sticker as stk, datetime(a.created_date/1000000000+978307200,'unixepoch','localtime') as at from attachment a order by a.ROWID desc limit 6"); return S(200, { attachments: rows }); }
        if (p === '/api/imessage/clear' && req.method === 'POST') { st.log = []; save(); return S(200, await status()); }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
