'use strict';
/* Deliberately small primary navigation; existing deep links remain supported. */
(() => {
  const PRIMARY = [
    ['home', 'home', 'Home'], ['projects', 'projects', 'Projects'], ['obsidian', 'notes', 'Obsidian'],
    ['video', 'video', 'Video input'], ['social', 'social', 'Social'], ['team', 'agents', 'Agents'], ['usage', 'usage', 'Usage'], ['settings', 'settings', 'Settings'],
  ];
  const PATHS = {
    home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    projects:'M3 7h7l2 2h9v11H3Zm0 0V4h7l2 3', notes:'m12 3 8 5v9l-8 4-8-4V8Zm0 0v18M4 8l8 5 8-5',
    social:'M7 15 17 9M7 9l10 6M7 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm16 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM7 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm16 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    video:'M3 5h13v14H3Zm13 5 5-3v10l-5-3',
    agents:'M5 8h14v12H5Zm7-5v5M9 12v2m6-2v2M9 17h6M2 12v5m20-5v5',
    usage:'M4 20V10m5 10V4m6 16v-7m5 7V7', settings:'m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3Zm6 9a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  };
  Object.assign(PATHS,{models:'M4 7h16v10H4ZM8 3v4m8-4v4M8 17v4m8-4v4M8 11h2m4 0h2',council:'M12 3v18M3 7h18M6 7l-3 7h6Zm12 0-3 7h6Z',vault:'M6 10V7a6 6 0 0 1 12 0v3M4 10h16v11H4Zm8 4v3',tools:'m4 20 8-8M14 3a6 6 0 0 0-3 9l7 7 3-3-7-7a6 6 0 0 0 1-6',mobile:'M7 2h10v20H7Zm4 17h2',health:'m2 12 5 0 3-8 4 16 3-8h5',sessions:'M4 7a9 9 0 1 1-1 8M4 3v5h5m3-2v6l4 2',voice:'M9 3h6v11H9ZM5 11v2a7 7 0 0 0 14 0v-2m-7 9v3m-4 0h8',control:'M4 5h16M4 12h16M4 19h16M8 3v4m8 3v4m-5 3v4',overview:'M3 3h7v7H3Zm11 0h7v7h-7ZM3 14h7v7H3Zm11 0h7v7h-7Z'});
  const icon = key => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${PATHS[key] || PATHS.settings}"/></svg>`;
  const TOOLS = [
    ['models','AI models','Choose providers, models and default settings.','AI & agents','model provider claude codex gemini'],
    ['agents','Skills & plugins','Inspect capabilities, edit skills and manage duplicates.','AI & agents','skill plugin combine duplicate'],
    ['council','Council','Compare independent AI perspectives on a decision.','AI & agents','review opinion decision'],
    ['vault','Keys & access','Manage encrypted credentials and service access.','Connections','api key token credential vault'],
    ['tools','Tools & integrations','Connect the services and tools your projects use.','Connections','server mcp integration notebooklm'],
    ['platforms','Social connections','Manage connected social platforms.','Connections','instagram facebook youtube tiktok'],
    ['mobile','Remote access','Use Jarvis on your phone and other devices.','Connections','iphone phone remote'],
    ['health','System & connection health','Check availability and resolve connection issues.','System','health monitor status server update'],
    ['queue','Posting & comments','Manage publishing queues and social conversations.','Workspace','post publishing comment queue'],
    ['glasses-history','Glasses conversations','Read saved glasses questions and answers, separated by course.','Workspace','even g2 glasses history study'],
    ['sessions','Conversation archive','Find and resume previous Claude and Codex conversations.','Workspace','session history archive conversation'],
    ['voice','Voice studio','Create, manage and listen to voice content.','Workspace','voice audio speech'],
    ['video','Video intelligence','Research and work with video references.','Workspace','video analyze reference'],
    ['control','Control center','Review work, activity and available actions.','Workspace','control action dashboard'],
    ['overview','Project overview','See files, projects and activity at a glance.','Workspace','dashboard overview'],
  ];
  const SETTINGS_ROUTES = new Set(TOOLS.map(t => t[0]));
  function current() { return location.hash.slice(2).split('/')[0] || 'home'; }
  function nav() {
    const target = document.getElementById('nav'); if (!target) return;
    const cur = current(), active = cur === 'project' ? 'projects' : cur === 'graph' ? 'obsidian' : cur === 'queue' ? 'social' : cur !== 'video' && SETTINGS_ROUTES.has(cur) ? 'settings' : cur;
    const link = ([r, ic, label]) => `<a href="#/${r}" data-r="${r}" class="${active === r ? 'on' : ''}" ${active === r ? 'aria-current="page"' : ''}><span class="ic">${icon(ic)}</span><span>${label}</span></a>`;
    target.setAttribute('aria-label', 'Main navigation');
    target.innerHTML = `<div class="nav-primary">${PRIMARY.map(link).join('')}</div>`;
    target.onclick = e => { const a = e.target.closest('[data-r]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return; e.preventDefault(); location.hash = '#/' + a.dataset.r; document.body.classList.remove('side-open'); };
    mobileState(active);
  }
  function mobileState(active) {
    const bar = document.getElementById('mnav'); if (!bar) return;
    bar.setAttribute('aria-label', 'Mobile navigation');
    const team = bar.querySelector('[data-mr="team"]'); if (team && team.dataset.refined !== 'true') { team.innerHTML = '<span>' + icon('agents') + '</span>Agents'; team.dataset.refined = 'true'; }
    bar.querySelectorAll('[data-mr]').forEach(a => { a.setAttribute('href', '#/' + a.dataset.mr); a.classList.toggle('on', a.dataset.mr === active); if (a.dataset.mr === active) a.setAttribute('aria-current','page'); else a.removeAttribute('aria-current'); });
    const more = bar.querySelector('#mMore');
    if (more) { more.setAttribute('href','#navigation'); more.setAttribute('role','button'); more.setAttribute('aria-label','Open navigation menu'); more.setAttribute('aria-controls','nav'); more.setAttribute('aria-expanded', String(document.body.classList.contains('side-open'))); }
  }
  window.renderNav = nav;
  window.PAGES = window.PAGES || {};
  window.PAGES.settings = async v => {
    document.getElementById('crumb').innerHTML = '<span class="crumb-p">Jarvis › </span><b>Settings & tools</b>';
    v.innerHTML = `<section class="settings-hub"><div class="settings-heading"><div><div class="settings-eyebrow">YOUR WORKSPACE</div><h1>Settings & tools</h1><p>Everything behind your projects, in one place.</p></div><a class="settings-health-link" href="#/health">${icon('settings')} System health <span aria-hidden="true">↗</span></a></div><div class="settings-search-wrap"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></svg><input id="settingsSearch" type="search" aria-label="Find settings and tools" placeholder="Find models, skills, connections…" autocomplete="off"><span class="settings-count">${TOOLS.length} tools</span></div><div class="settings-filters" role="group" aria-label="Filter tools">${['All','AI & agents','Connections','System','Workspace'].map((c,i) => `<button type="button" data-settings-group="${esc(c)}" class="${i === 0 ? 'on' : ''}" aria-pressed="${i === 0}">${esc(c)}</button>`).join('')}</div><div id="settingsResults" aria-live="polite"></div></section>`;
    let group = 'All'; const input = v.querySelector('#settingsSearch'), results = v.querySelector('#settingsResults');
    function draw() {
      const q = input.value.toLowerCase().trim(), rows = TOOLS.filter(t => (group === 'All' || t[3] === group) && t.join(' ').toLowerCase().includes(q));
      results.innerHTML = rows.length ? ['AI & agents','Connections','System','Workspace'].map(c => {
        const items = rows.filter(t => t[3] === c); if (!items.length) return '';
        return `<section class="settings-group"><h2>${esc(c)}</h2><div class="settings-grid">${items.map(t => `<a class="settings-tool" href="#/${t[0]}"><span class="settings-tool-icon">${icon(t[0] === 'platforms' || t[0] === 'queue' ? 'social' : t[0])}</span><div><h3>${esc(t[1])}</h3><p>${esc(t[2])}</p></div><span class="settings-arrow" aria-hidden="true">›</span></a>`).join('')}</div></section>`;
      }).join('') : '<div class="settings-empty"><b>No matching tools</b><p>Try “models”, “keys” or “health”, or choose another category.</p></div>';
      v.querySelector('.settings-count').textContent = `${rows.length} ${rows.length === 1 ? 'tool' : 'tools'}`;
    }
    input.oninput = draw;
    v.querySelector('.settings-filters').onclick = e => { const b = e.target.closest('[data-settings-group]'); if (!b) return; group = b.dataset.settingsGroup; v.querySelectorAll('[data-settings-group]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }); draw(); };
    draw();
  };
  // Keep the existing command palette useful even though the sidebar is shorter.
  if (!NAV.some(n => n[0] === 'settings')) NAV.push(['settings', '⚙', 'Settings & tools']);
  document.body.classList.add('jarvis-refined');
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && document.body.classList.contains('side-open')) { document.body.classList.remove('side-open'); const more = document.getElementById('mMore'); if (more) more.focus(); }
  });
  const more = document.getElementById('mMore');
  if (more) {
    more.addEventListener('click', e => { e.preventDefault(); requestAnimationFrame(() => { mobileState(current()); if (e.detail === 0 && document.body.classList.contains('side-open')) { const first = document.querySelector('#nav a'); if (first) first.focus(); } }); });
    more.addEventListener('keydown', e => { if (e.key === ' ') { e.preventDefault(); more.click(); } });
  }
  new MutationObserver(() => mobileState(current())).observe(document.body, {attributes:true, attributeFilter:['class']});
  nav();
})();
