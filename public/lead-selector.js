'use strict';
(() => {
  let config = null, saving = false, loading = null, error = '';
  const roots = new Set();
  let version = 0;
  function sync() {
    for (const root of roots) {
      if (!root.isConnected) { roots.delete(root); continue; }
      root.querySelectorAll('[data-lead]').forEach(button => {
        button.setAttribute('aria-pressed', String(config?.lead === button.dataset.lead));
        button.disabled = saving || !config || !!Jarvis.st.busy;
      });
      const status = root.querySelector('.lead-status');
      status.textContent = error || (saving ? 'Saving your lead…' : config ? 'Opus 5.5 + Astra · medium' : 'Loading model settings…');
      status.classList.toggle('lead-error', !!error);
      root.querySelector('[data-lead-retry]').hidden = !error;
    }
    const panel = document.querySelector('#jPanel > .lead-control');
    if (panel) panel.hidden = Jarvis.st.agentId !== 'kim';
  }
  function accept(value) {
    if (!['claude','codex'].includes(value?.lead)) throw new Error('Model settings could not be loaded.');
    config = value; error = '';
    const kim = S.team?.agents?.find(a => a.id === 'kim');
    if (kim) Object.assign(kim, { engine:'both',primary:value.lead,models:value.models,effort:value.effort,routing:{mode:'manual'} });
    Jarvis.setModel(); sync();
  }
  async function refresh() {
    if (saving) return;
    if (loading) return loading;
    const current = ++version;
    loading = api('/api/team/lead').then(value => { if (current === version) accept(value); }).catch(e => { error = e.message || 'Could not load model settings.'; sync(); }).finally(() => { loading = null; });
    return loading;
  }
  async function choose(lead) {
    if (saving || Jarvis.st.busy || lead === config?.lead) return;
    version++; saving = true; error = ''; sync();
    try { accept(await post('/api/team/lead', {lead})); }
    catch (e) { error = 'Not saved: ' + (e.message || 'Connection unavailable.'); }
    finally { saving = false; sync(); }
  }
  function mount(host) {
    const root = document.createElement('div'); root.className = 'lead-control';
    root.innerHTML = '<div class="lead-row"><span class="lead-label">Lead <span>Always both</span></span><div class="lead-options" role="group" aria-label="Choose which AI leads @@ASSISTANT@@"><button type="button" data-lead="claude" aria-pressed="false" disabled>Claude</button><button type="button" data-lead="codex" aria-pressed="false" disabled>Codex</button></div></div><div class="lead-caption"><span class="lead-status" role="status">Loading model settings…</span><button type="button" data-lead-retry hidden>Retry</button></div>';
    root.title = 'Shared by Jarvis and @@ASSISTANT@@. The lead handles your request; the other model reviews. Changes apply to future requests.';
    root.addEventListener('click', e => { const b = e.target.closest('[data-lead]'); if (b) choose(b.dataset.lead); else if (e.target.closest('[data-lead-retry]')) refresh(); });
    host.prepend(root); roots.add(root); sync(); refresh(); return root;
  }
  window.JarvisLead = {mount,refresh,get:()=>config};
  const home = PAGES.home;
  PAGES.home = async v => { await home(v); const hero = v.querySelector('.home-graph-hero'); if (hero) mount(hero); };
  function panelControl() { const panel = document.getElementById('jPanel'); if (panel && !panel.querySelector(':scope > .lead-control')) { const root = mount(panel); panel.querySelector('header').after(root); } }
  new MutationObserver(panelControl).observe(document.body,{childList:true}); panelControl();
  window.addEventListener('jarvis:state', sync);
  window.addEventListener('jarvis:agent', sync);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  refresh();
})();
