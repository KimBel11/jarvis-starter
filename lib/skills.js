'use strict';
// Skill library: every skill for Claude Code and Codex in one place, duplicate detection, REVERSIBLE archive (never deletes),
// and installation of Jarvis' own skills (tools/skills/*) into both tools.
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const STOP = new Set(['when', 'that', 'this', 'with', 'from', 'your', 'user', 'skill', 'using', 'also', 'into', 'their', 'they', 'have', 'will', 'used', 'use', 'for', 'and', 'the', 'kim', 'kims']);
const tok = (s) => new Set((String(s).toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w)));
const NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/;

module.exports = function makeSkills(ctx, deps) {
  const HOME = ctx.HOME;
  const ROOTS = { claude: path.join(HOME, '.claude', 'skills'), codex: path.join(HOME, '.codex', 'skills') };
  const ARCH = { claude: path.join(HOME, '.claude', 'skills-archive'), codex: path.join(HOME, '.codex', 'skills-archive') };
  const OWN = path.join(ctx.ROOT, 'tools', 'skills');

  const frontmatter = (f) => { try { const t = fs.readFileSync(f, 'utf8'); const m = t.match(/^---\n([\s\S]*?)\n---/); const o = {}; if (m) { let key = null; for (const l of m[1].split('\n')) { const k = l.match(/^([A-Za-z_-]+):\s*(.*)$/); if (k) { key = k[1]; o[key] = k[2].replace(/^["']|["']$/g, '').replace(/^[>|]-?$/, ''); } else if (key && /^\s+/.test(l)) o[key] = (o[key] + ' ' + l.trim()).trim(); } } return { fm: o, bytes: t.length }; } catch { return null; } };

  function scanDir(dir, engine, source) {
    const out = []; let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of ents) {
      if (!(e.isDirectory() || e.isSymbolicLink()) || e.name.startsWith('.')) continue;
      const f = path.join(dir, e.name, 'SKILL.md'); if (!fs.existsSync(f)) continue; const r = frontmatter(f); if (!r) continue;
      let extra = 0; try { extra = fs.readdirSync(path.join(dir, e.name)).length; } catch {}
      out.push({ engine, source, dir: e.name, name: r.fm.name || e.name, description: (r.fm.description || '').trim(), bytes: r.bytes, files: extra, path: f, own: fs.existsSync(path.join(OWN, e.name, 'SKILL.md')) });
    }
    return out;
  }
  function inventory() {
    const list = [...scanDir(ROOTS.claude, 'claude', 'user'), ...scanDir(ROOTS.codex, 'codex', 'user')];
    try { const ip = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json'), 'utf8')).plugins || {}; for (const [k, v] of Object.entries(ip)) list.push(...scanDir(path.join(v[0].installPath, 'skills'), 'claude', 'plugin:' + k.split('@')[0])); } catch {}
    list.push(...scanDir(path.join(HOME,'.agents/skills'),'shared','user'));
    list.push(...scanDir(path.join(HOME,'.codex/skills/.system'),'codex','plugin:system'));
    const cache=path.join(HOME,'.codex/plugins/cache'); let roots=0; const discover=(dir,depth)=>{if(depth>6||roots>120)return;let ents=[];try{ents=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}if(path.basename(dir)==='skills'){list.push(...scanDir(dir,'codex','plugin:cached'));roots++;return;}for(const e of ents)if(e.isDirectory()&&!e.name.startsWith('.')&&!['node_modules','assets','scripts','references'].includes(e.name))discover(path.join(dir,e.name),depth+1);};discover(cache,0);
    for(const p of (ctx.state && ctx.state.projects)||[]) for(const [sub,engine] of [['.agents/skills','shared'],['.claude/skills','claude'],['.codex/skills','codex']]) list.push(...scanDir(path.join(p.path,sub),engine,'project:'+p.id));
    const seenPaths=new Set(); for(let i=list.length-1;i>=0;i--){const s=list[i];if(seenPaths.has(s.path)){list.splice(i,1);continue;}seenPaths.add(s.path);s.id=digest(s.path).slice(0,24);s.scope=path.dirname(path.dirname(s.path));s.readOnly=s.source.startsWith('plugin:');try{const parent=fs.realpathSync(s.scope),real=fs.realpathSync(s.path);if(!contained(real,parent)||fs.lstatSync(path.dirname(s.path)).isSymbolicLink()||fs.lstatSync(s.path).isSymbolicLink())s.readOnly=true;s.compatibility=fs.readFileSync(s.path,'utf8').includes('<!-- jarvis-compatibility -->');}catch{s.readOnly=true;}s.consolidationReason=eligibility(s);}
    const used = (ctx.skillUsage && ctx.skillUsage()) || {};
    for (const s of list) s.used = s.engine === 'claude' ? used[s.name] || used[s.dir] || 0 : 0;
    return list;
  }
  function duplicates(list) {
    const groups = []; const seen = new Set(); const mirrored = [];
    const byName = {}; for (const s of list) (byName[s.dir] = byName[s.dir] || []).push(s);
    for (const [n, arr] of Object.entries(byName)) if (arr.length > 1 && arr.some((x) => x.engine === 'claude') && arr.some((x) => x.engine === 'codex')) mirrored.push({ name: n, engines: arr.map((x) => x.engine) });
    const cand = list.filter((s) => !s.source.startsWith('plugin:') && !s.compatibility); const T = new Map(cand.map((s) => [s, tok(s.name + ' ' + s.description)]));
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const a = cand[i], b = cand[j]; if (a.dir === b.dir) continue; // same name in the other engine = deliberate mirror
      const ta = T.get(a), tb = T.get(b); const inter = [...ta].filter((x) => tb.has(x)).length; const jac = ta.size && tb.size ? inter / (ta.size + tb.size - inter) : 0;
      const nameRel = a.dir.startsWith(b.dir) || b.dir.startsWith(a.dir) || a.dir.replace(/-slim$|-lite$|-v\d+$/, '') === b.dir.replace(/-slim$|-lite$|-v\d+$/, '');
      if ((nameRel && jac >= 0.15) || jac >= 0.5) { const key = [a.engine + ':' + a.dir, b.engine + ':' + b.dir].sort().join('|'); if (seen.has(key)) continue; seen.add(key); groups.push({ a, b, similarity: +jac.toFixed(2), nameRelated: nameRel }); }
    }
    const hashes=new Map();const checksum=s=>{if(!hashes.has(s.id))hashes.set(s.id,packageHash(s));return hashes.get(s.id);};
    return {groups:groups.map(g=>({similarity:g.similarity,a:g.a,b:g.b,keep:g.a,drop:g.b,sameScope:g.a.engine===g.b.engine&&g.a.scope===g.b.scope,exact:!!checksum(g.a)&&checksum(g.a)===checksum(g.b),reason:'Text overlap is a review suggestion, not proof of redundancy or quality. Compare complete packages before consolidating.'})).sort((a,b)=>Number(b.exact)-Number(a.exact)||b.similarity-a.similarity),mirrored};
  }

  function archived() {
    const out = []; for (const [engine, root] of Object.entries(ARCH)) { let days = []; try { days = fs.readdirSync(root); } catch {} for (const d of days) { let items = []; try { items = fs.readdirSync(path.join(root, d)); } catch {} for (const i of items) out.push({ engine, day: d, dir: i, path: path.join(root, d, i) }); } }
    return out.sort((a, b) => b.day.localeCompare(a.day));
  }
  function archive(engine, dir) {
    if (!ROOTS[engine] || !NAME_OK.test(dir || '')) throw new Error('bad skill'); const src = path.join(ROOTS[engine], dir); if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('skill not found'); if (fs.existsSync(path.join(OWN, dir))) throw new Error('This is one of Jarvis\' own skills; it is not archived from here.');
    const day = new Date().toLocaleDateString('sv-SE'); const dst = path.join(ARCH[engine], day, dir); fs.mkdirSync(path.dirname(dst), { recursive: true }); if (fs.existsSync(dst)) throw new Error('already archived today'); fs.renameSync(src, dst); return { moved: dst };
  }
  function restore(engine, day, dir) {
    if (!ROOTS[engine] || !/^\d{4}-\d{2}-\d{2}$/.test(day || '') || !NAME_OK.test(dir || '')) throw new Error('bad request'); const src = path.join(ARCH[engine], day, dir); const dst = path.join(ROOTS[engine], dir); if (!fs.existsSync(src)) throw new Error('not in the archive'); if (fs.existsSync(dst)) throw new Error('a skill with that name is already installed'); fs.renameSync(src, dst); return { restored: dst };
  }
  function ownSkills() { let names = []; try { names = fs.readdirSync(OWN).filter((n) => fs.existsSync(path.join(OWN, n, 'SKILL.md'))); } catch {} return names.map((n) => { const r = frontmatter(path.join(OWN, n, 'SKILL.md')); return { dir: n, name: (r && r.fm.name) || n, description: (r && r.fm.description) || '', installed: { claude: fs.existsSync(path.join(ROOTS.claude, n, 'SKILL.md')), codex: fs.existsSync(path.join(ROOTS.codex, n, 'SKILL.md')) } }; }); }
  function installOwn(onlyMissing) {
    let n = 0; for (const s of ownSkills()) for (const eng of ['claude', 'codex']) { const dst = path.join(ROOTS[eng], s.dir); if (onlyMissing && s.installed[eng]) continue; fs.mkdirSync(dst, { recursive: true }); fs.copyFileSync(path.join(OWN, s.dir, 'SKILL.md'), path.join(dst, 'SKILL.md')); n++; } return n;
  }
  const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
  const contained=(f,r)=>{const x=path.relative(r,f);return !x||x!=='..'&&!x.startsWith('..'+path.sep)&&!path.isAbsolute(x);};
  const bad=(message,status=400)=>Object.assign(new Error(message),{status});
  function lookup(id){const s=inventory().find(s=>s.id===id);if(!s)throw bad('Unknown skill',404);return s;}
  function packageFiles(s){const root=fs.realpathSync(path.dirname(s.path)),out=[];let bytes=0;function walk(dir,depth){if(depth>12)throw bad('Skill package exceeds scan depth');for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(e.name.startsWith('.'))continue;const f=path.join(dir,e.name),real=fs.realpathSync(f);if(!contained(real,root)||e.isSymbolicLink())throw bad('Skill package contains a symbolic link');if(e.isDirectory())walk(f,depth+1);else if(e.isFile()){const size=fs.statSync(f).size;bytes+=size;if(bytes>25*1024*1024||out.length>=1000)throw bad('Skill package is too large');out.push({path:path.relative(root,f),size});}}}walk(root,0);return out.sort((a,b)=>a.path.localeCompare(b.path));}
  function packageHash(s){try{const h=crypto.createHash('sha256');for(const f of packageFiles(s)){h.update(f.path);h.update('\0');h.update(fs.readFileSync(path.join(path.dirname(s.path),f.path)));h.update('\0');}return h.digest('hex');}catch{return null;}}
  function readableFile(s,rel){if(typeof rel!=='string'||!rel||path.isAbsolute(rel)||rel.includes('\\')||rel.split('/').some(x=>!x||x==='..'||x==='.'||x.startsWith('.'))||/(^|[._-])(secret|token|credential|password|auth|key)([._-]|$)/i.test(rel)||/\.(env|pem|key|p8|p12|pfx)$/i.test(rel))throw bad('This file is not readable through the skill editor');const root=fs.realpathSync(path.dirname(s.path)),f=fs.realpathSync(path.join(root,rel));if(!contained(f,root))throw bad('File leaves the skill package',403);const st=fs.statSync(f);if(!st.isFile()||st.size>1024*1024)throw bad('File is not text or exceeds 1 MB');const buf=fs.readFileSync(f);if(buf.includes(0))throw bad('Binary files cannot be opened as text');return {file:rel,content:buf.toString('utf8')};}
  function eligibility(s){if(s.readOnly)return 'Plugin or linked skills are read-only';if(s.source!=='user')return 'Only personal skills can be consolidated; project skills may be referenced by instructions';if(s.own)return 'Jarvis built-in skills are protected';if(s.compatibility)return 'This is already a compatibility entrypoint';if(!ROOTS[s.engine]||path.dirname(path.dirname(s.path))!==ROOTS[s.engine])return 'Only same-root Claude/Codex personal skills can be consolidated';return '';}
  function details(id){const s=lookup(id),content=readableFile(s,'SKILL.md').content;let files=[];try{files=packageFiles(s).map(f=>f.path);}catch{}return {skill:s,content,hash:digest(content),files,readOnly:s.readOnly,consolidationReason:eligibility(s)};}
  function backup(s){const dir=path.join(ctx.DATA,'skill-history',Date.now()+'-'+crypto.randomBytes(6).toString('hex'));fs.mkdirSync(dir,{recursive:true});fs.cpSync(path.dirname(s.path),path.join(dir,'package'),{recursive:true,dereference:false,errorOnExist:true,force:false});fs.writeFileSync(path.join(dir,'record.json'),JSON.stringify({original:path.dirname(s.path),id:s.id,at:Date.now()},null,2));return dir;}
  function save(b){const s=lookup(b.id);if(s.readOnly)throw bad('This skill is read-only',403);if(typeof b.content!=='string'||Buffer.byteLength(b.content)>1024*1024)throw bad('Skill content must be text under 1 MB');const current=readableFile(s,'SKILL.md').content;if(typeof b.expectedHash!=='string'||digest(current)!==b.expectedHash)throw bad('Skill changed elsewhere. Reload before saving.',409);const fm=b.content.match(/^---\r?\n([\s\S]*?)\r?\n---/);if(!fm||!/^name:\s*\S.*$/m.test(fm[1])||!/^description:\s*\S.*$/m.test(fm[1]))throw bad('SKILL.md requires name and description frontmatter');packageFiles(s);const archived=backup(s);fs.writeFileSync(s.path,b.content);return {...details(s.id),backup:archived};}
  function consolidate(b){if(!Array.isArray(b.ids)||new Set(b.ids).size<2||b.ids.length>12)throw bad('Choose 2–12 different skills');const list=[...new Set(b.ids)].map(lookup);for(const s of list){const reason=eligibility(s);if(reason)throw bad(reason);}const root=path.dirname(path.dirname(list[0].path));if(list.some(s=>s.engine!==list[0].engine||path.dirname(path.dirname(s.path))!==root))throw bad('Choose skills from the same personal engine and folder');if(!/^[a-z0-9][a-z0-9-]{1,60}$/.test(b.name||''))throw bad('Use a lowercase skill name with letters, digits and hyphens');const dest=path.join(root,b.name);if(fs.existsSync(dest))throw bad('That skill name already exists',409);for(const s of list)packageFiles(s);
    const archives=[];const stage=path.join(root,'.jarvis-consolidate-'+crypto.randomBytes(6).toString('hex'));fs.mkdirSync(stage);try{fs.mkdirSync(path.join(stage,'variants'));for(const s of list)fs.cpSync(path.dirname(s.path),path.join(stage,'variants',s.dir),{recursive:true,errorOnExist:true,force:false});const desc='Routes tasks to preserved guidance from '+list.map(s=>s.name).join(', ');const text='---\nname: '+b.name+'\ndescription: '+JSON.stringify(desc.slice(0,900))+'\n---\n\n# Consolidated skill router\n\nChoose the relevant variant for the task, read its complete SKILL.md, and follow its relative supporting files from that variant directory. Where guidance conflicts, identify the conflict and use the variant relevant to the request. This package preserves all guidance; it is not a semantic rewrite or a quality ranking.\n\n'+list.map(s=>'- '+s.name+': [original instructions](variants/'+s.dir+'/SKILL.md) — '+s.description).join('\n')+'\n';fs.writeFileSync(path.join(stage,'SKILL.md'),text,{flag:'wx'});fs.renameSync(stage,dest);
      // Keep old paths as compatibility entrypoints and preserve their supporting files.
      // Full pre-change packages are recoverable in DATA/skill-history.
      for(const s of list){const record=backup(s);archives.push({id:s.id,path:record,original:path.dirname(s.path)});const original=fs.readFileSync(s.path,'utf8');const header=(original.match(/^---\r?\n[\s\S]*?\r?\n---/)||[])[0];fs.writeFileSync(s.path,(header||'---\nname: '+s.dir+'\ndescription: Compatibility entrypoint\n---')+'\n\n<!-- jarvis-compatibility -->\nRead the consolidated router at [../'+b.name+'/SKILL.md](../'+b.name+'/SKILL.md). Original guidance is preserved at [../'+b.name+'/variants/'+s.dir+'/SKILL.md](../'+b.name+'/variants/'+s.dir+'/SKILL.md). Supporting files remain at their original paths for compatibility.\n');}
      return {ok:true,path:dest,archives,compatibility:list.map(s=>s.path),note:'Preserved full packages and guidance; original skill names remain lightweight compatibility entrypoints. No semantic best-version claim.'};
    }catch(e){for(const a of archives){try{fs.cpSync(path.join(a.path,'package'),a.original,{recursive:true,force:true});}catch{}}try{fs.rmSync(stage,{recursive:true,force:true});}catch{}throw e;}}
  function history(id){const s=lookup(id),root=path.join(ctx.DATA,'skill-history');let dirs=[];try{dirs=fs.readdirSync(root);}catch{}const out=[];for(const dir of dirs){if(!/^[0-9]+-[a-f0-9]+$/.test(dir))continue;try{const rec=JSON.parse(fs.readFileSync(path.join(root,dir,'record.json'),'utf8'));if(rec.id===s.id&&rec.original===path.dirname(s.path))out.push({id:dir,at:rec.at});}catch{}}return {history:out.sort((a,b)=>b.at-a.at)};}
  function restoreHistory(b){const s=lookup(b.id);if(s.readOnly)throw bad('This skill is read-only',403);if(!history(b.id).history.some(v=>v.id===b.version))throw bad('Unknown backup');const f=path.join(ctx.DATA,'skill-history',b.version,'package','SKILL.md');return save({id:b.id,content:fs.readFileSync(f,'utf8'),expectedHash:b.expectedHash});}
  function autoConsolidate(){const groups=new Map();for(const s of inventory()){if(eligibility(s))continue;const h=packageHash(s);if(!h)continue;const key=s.engine+'|'+path.dirname(path.dirname(s.path))+'|'+h;const g=groups.get(key)||[];g.push(s);groups.set(key,g);}const results=[];for(const g of groups.values()){if(g.length<2)continue;const name='combined-'+g[0].dir.slice(0,35)+'-'+crypto.randomBytes(3).toString('hex');results.push(consolidate({ids:g.map(s=>s.id).slice(0,12),name}));}return {results,count:results.length,consolidated:results.length,note:'Only byte-identical full packages in the same personal engine/root were consolidated. Cross-engine mirrors remain intentional.'};}

  return {
    inventory, duplicates, archived, archive, restore, ownSkills, installOwn,
    async handle(req, res, url, p) {
      const S = (c, b) => (ctx.send(res, c, b), true); if (!p.startsWith('/api/skills')) return false;
      try {
        if (p === '/api/skills') { const list = inventory(); const d = duplicates(list); return S(200, { skills: list.map(({ path: _p, ...x }) => x), duplicates: d.groups, mirrored: d.mirrored, archived: archived().map(({ path: _p, ...x }) => x), own: ownSkills() }); }
        const b = req.method === 'POST' ? await ctx.readBody(req) : {};
        if (p === '/api/skills/detail' && req.method === 'GET') return S(200, details(url.searchParams.get('id')));
        if (p === '/api/skills/file' && req.method === 'GET') return S(200, readableFile(lookup(url.searchParams.get('id')),url.searchParams.get('file')));
        if (p === '/api/skills/history' && req.method === 'GET') return S(200, history(url.searchParams.get('id')));
        if (p === '/api/skills/restore-history' && req.method === 'POST') return S(200, restoreHistory(b));
        if (p === '/api/skills/create-copy' && req.method === 'POST') { const original=lookup(b.id);if(!/^[a-z0-9][a-z0-9-]{1,60}$/.test(b.name||''))throw bad('Use a lowercase skill name with letters, digits and hyphens');const engine=['claude','codex'].includes(b.engine)?b.engine:original.engine==='claude'?'claude':'codex';const dest=path.join(ROOTS[engine],b.name);if(fs.existsSync(dest))throw bad('That personal skill already exists',409);packageFiles(original);fs.mkdirSync(ROOTS[engine],{recursive:true});fs.cpSync(path.dirname(original.path),dest,{recursive:true,force:false,errorOnExist:true});const f=path.join(dest,'SKILL.md');let content=fs.readFileSync(f,'utf8');content=content.replace(/(^---\r?\n[\s\S]*?^name:)[^\n]*/m,'$1 '+b.name);fs.writeFileSync(f,content);return S(201,details(digest(f).slice(0,24))); }
        if (p === '/api/skills/save' && req.method === 'POST') return S(200, save(b));
        if (p === '/api/skills/consolidate' && req.method === 'POST') return S(200, consolidate(b));
        if (p === '/api/skills/auto-consolidate' && req.method === 'POST') return S(200, autoConsolidate());
        if (p === '/api/skills/archive' && req.method === 'POST') return S(200, archive(b.engine, b.dir));
        if (p === '/api/skills/restore' && req.method === 'POST') return S(200, restore(b.engine, b.day, b.dir));
        if (p === '/api/skills/install' && req.method === 'POST') return S(200, { installed: installOwn(false) });
      } catch (e) { return S(e.status || 400, { error: String(e.message || e) }); }
      return false;
    },
  };
};
