'use strict';
// Graph of every Markdown note across the Jarvis Hub vault and the registered project folders:
// notes are nodes, [[wikilinks]] and Markdown links are edges, unresolved links appear as ghost nodes (like Obsidian's graph).
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');

const SKIP = new Set(['node_modules', 'cache', 'backups', 'dist', 'build', 'vendor', 'venv', 'pods', 'deriveddata', 'trash', 'runtime', 'site-packages', 'dev-caches', 'coverage']);
const LIMIT = { notes: 3500, depth: 9, read: 160 * 1024 };
const WIKI = /!?\[\[([^\]\n|#^]+)(?:[#^][^\]\n|]*)?(?:\|[^\]\n]*)?\]\]/g;
const MDL = /(?<!!)\[[^\]\n]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi;
const TAG = /(?:^|[\s(])#([A-Za-z][\w/-]{1,40})(?![\w/-]*#)/g;

module.exports = function makeObsidianGraph(ctx) {
  const HUB = path.join(ctx.DRIVE || '@@WORKSPACE@@', 'Jarvis Hub');
  let cache = null, pending = null;

  function sources() {
    const out = []; const seen = new Set();
    const add = (id, name, dir, color) => { let real; try { real = fs.realpathSync(dir); if (!fs.statSync(real).isDirectory()) return; } catch { return; } if (seen.has(real)) return; seen.add(real); out.push({ id, name, root: real, color }); };
    add('hub', 'Jarvis Hub', HUB, '#2dd4ee');
    for (const p of (ctx.state.projects || [])) add(p.id, p.name, p.path, p.color);
    return out;
  }
  function walk(root, cb, budget = LIMIT.notes, scan) {
    let n = 0; const seen = new Set();
    (function go(dir, depth) {
      if (depth > LIMIT.depth || n >= budget) return; if (scan.visited >= 15000 || Date.now() > scan.deadline) { scan.truncated = true; return; } let real; try { real = fs.realpathSync(dir); } catch { return; } if (seen.has(real)) return; seen.add(real);
      let ents; try { ents = fs.readdirSync(real, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (++scan.visited > 15000 || Date.now() > scan.deadline) { scan.truncated = true; return; }
        if (e.name.startsWith('.') || SKIP.has(e.name.toLowerCase())) continue; const f = path.join(real, e.name);
        if (e.isDirectory()) go(f, depth + 1);
        else if (e.isFile() && /\.md$/i.test(e.name) && n < budget) { n++; cb(f); }
      }
    })(root, 0);
  }

  function build() {
    const nodes = []; const byKey = new Map(); const byName = new Map(); const edges = []; const raw = []; const seenFiles = new Set(); let capped = false; let anyTruncated = false;
    for (const src of sources()) {
      if (nodes.length >= LIMIT.notes) { capped = true; break; }
      const scan = {visited:0,deadline:Date.now()+1200,truncated:false};
      walk(src.root, (f) => {
        if (seenFiles.has(f)) return; seenFiles.add(f);
        let st; try { st = fs.statSync(f); } catch { return; } let text = ''; try { const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(Math.min(st.size, LIMIT.read)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd); text = buf.toString('utf8'); } catch {}
        const rel = path.relative(src.root, f).split(path.sep).join('/'); const parts = rel.split('/'); const id = src.id + ':' + rel; const name = path.basename(f, '.md');
        const tags = new Set(); const fm = text.startsWith('---') ? text.slice(3, text.indexOf('\n---', 3) > 0 ? text.indexOf('\n---', 3) : 0) : '';
        for (const m of fm.matchAll(/^tags:\s*\[?([^\]\n]*)\]?\s*$/gim)) m[1].split(/[,\s]+/).filter(Boolean).forEach((t) => tags.add(t.replace(/^#/, '').slice(0, 40)));
        const body = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
        for (const m of body.matchAll(TAG)) if (tags.size < 8 && !/^[0-9a-f]{3,8}$/i.test(m[1]) && !/^\d/.test(m[1])) tags.add(m[1]);
        const links = []; for (const m of body.matchAll(WIKI)) links.push(['w', m[1].trim()]); for (const m of body.matchAll(MDL)) { let target=m[1]; try { target=decodeURIComponent(target); } catch {} links.push(['m', target]); }
        const h1 = (body.match(/^#\s+(.+)$/m) || [])[1];
        const node = { id, name, title: h1 ? h1.slice(0, 80) : name, path: rel, source: src.id, sourceName: src.name, color: src.color, folder: parts.length > 1 ? parts[0] : '(root)', words: Math.round(text.split(/\s+/).length * Math.max(1, st.size / Math.max(1, text.length))), mtime: Math.round(st.mtimeMs), tags: [...tags], deg: 0, abs: f };
        nodes.push(node); byKey.set(id.toLowerCase(), node); const k = src.id + '|' + name.toLowerCase(); if (!byName.has(k)) byName.set(k, node); else byName.set(k, null); const g = '*|' + name.toLowerCase(); if (!byName.has(g)) byName.set(g, node); else byName.set(g, null);
        raw.push({ node, links, dir: path.posix.dirname(rel), src: src.id });
      }, Math.min(700,LIMIT.notes - nodes.length), scan);
      anyTruncated = anyTruncated || scan.truncated;
    }
    const ghosts = new Map(); const eset = new Set();
    for (const r of raw) for (const [kind, t] of r.links) {
      let target = null;
      if (kind === 'm') { const p = path.posix.normalize(path.posix.join(r.dir, t)); target = byKey.get((r.src + ':' + p).toLowerCase()); }
      else { const nm = path.posix.basename(t).replace(/\.md$/i, '').toLowerCase(); target = (t.includes('/') && (byKey.get((r.src + ':' + path.posix.normalize(path.posix.join(r.dir,t.replace(/\.md$/i,'')+'.md'))).toLowerCase()) || byKey.get((r.src + ':' + t.replace(/\.md$/i, '') + '.md').toLowerCase()))) || byName.get(r.src + '|' + nm) || byName.get('*|' + nm); if (!target) { const ghostKey = r.src + ':' + t.toLowerCase(); let gh = ghosts.get(ghostKey); if (!gh) { gh = { id: 'ghost:' + ghostKey, name: path.posix.basename(t), title: path.posix.basename(t), path: '', source: 'ghost', sourceName: 'Not created yet', color: '#8fa0b8', folder: '', words: 0, mtime: 0, tags: [], deg: 0, ghost: true }; ghosts.set(ghostKey, gh); } target = gh; } }
      if (!target || target === r.node) continue; const key = r.node.id < target.id ? r.node.id + '>' + target.id : target.id + '>' + r.node.id; if (eset.has(key)) continue; eset.add(key);
      edges.push({ s: r.node.id, t: target.id }); r.node.deg++; target.deg++;
    }
    const all = [...nodes, ...ghosts.values()].map(({ abs, ...n }) => n);
    const srcs = sources().map((s) => ({ id: s.id, name: s.name, color: s.color, notes: nodes.filter((n) => n.source === s.id).length }));
    const tagCount = {}; for (const n of all) for (const t of n.tags) tagCount[t] = (tagCount[t] || 0) + 1;
    return { at: Date.now(), nodes: all, edges, sources: srcs, tags: Object.entries(tagCount).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([t, c]) => ({ tag: t, count: c })), stats: { notes: nodes.length, links: edges.length, ghosts: ghosts.size, orphans: all.filter((n) => !n.deg && !n.ghost).length, capped: capped || anyTruncated || nodes.length >= LIMIT.notes } };
  }

  function rebuild() {
    if (pending) return pending;
    pending = new Promise((resolve,reject) => {
      const projects=(ctx.state.projects||[]).map(({id,name,path,color,parent})=>({id,name,path,color,parent}));
      const worker=new Worker(__filename,{workerData:{jarvisGraph:true,drive:ctx.DRIVE,projects}}); let settled=false;
      const timer=setTimeout(()=>finish(new Error('Graph indexing timed out. Try a smaller set of project folders.')),18000);
      function finish(err,data){if(settled)return;settled=true;clearTimeout(timer);worker.terminate();err?reject(err):resolve(data);}
      worker.once('message',data=>finish(null,data));worker.once('error',()=>finish(new Error('Graph indexing could not finish.')));worker.once('exit',()=>{if(!settled)finish(new Error('Graph indexing stopped before completion.'));});
    }).then(data=>(cache=data)).finally(()=>{pending=null;});
    return pending;
  }
  return {
    build,
    async handle(req, res, url) {
      if (!url.pathname.startsWith('/api/obsidian/graph')) return false; const S = (c, b) => (ctx.send(res, c, b), true);
      try {
        if (url.pathname === '/api/obsidian/graph' && req.method === 'GET') { if (!cache || Date.now() - cache.at > 30000 || url.searchParams.get('fresh')) await rebuild(); return S(200, cache); }
        if (url.pathname === '/api/obsidian/graph/preview' && req.method === 'GET') {
          const g = cache || await rebuild(); const n = g.nodes.find((x) => x.id === url.searchParams.get('id')); if (!n || n.ghost) return S(404, { error: 'Note not found' });
          const src = sources().find((s) => s.id === n.source); if (!src) return S(404, {error:'Vault is no longer available'}); const f = path.join(src.root, n.path); const real = fs.realpathSync(f); if (!real.startsWith(src.root + path.sep)) return S(403, { error: 'outside vault' });
          const fd = fs.openSync(real, 'r'); let text; try { const buf=Buffer.alloc(Math.min(fs.fstatSync(fd).size,24000)); const size=fs.readSync(fd,buf,0,buf.length,0); text=buf.subarray(0,size).toString('utf8').slice(0,6000); } finally { fs.closeSync(fd); } return S(200, { id: n.id, title: n.title, path: n.path, text, uri: 'obsidian://open?path=' + encodeURIComponent(real), abs: real });
        }
      } catch (e) { return S(400, { error: String(e.message || e) }); }
      return false;
    },
  };
};

if (!isMainThread && workerData && workerData.jarvisGraph) { const api=module.exports({DRIVE:workerData.drive,state:{projects:workerData.projects}}); parentPort.postMessage(api.build()); }
