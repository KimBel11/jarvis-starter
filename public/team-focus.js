'use strict';
// Alerts and links like #/team/<agent> take you straight to that agent on the Agent team page:
// the page scrolls to its card, the card lights up, and if the agent has a plan waiting for approval its plan opens with Approve & run / Reject.
(() => {
  let done = '';
  const wrap = () => {
    const base = window.PAGES && window.PAGES.team; if (!base || base.__focus) return;
    const wrapped = async function (v) { const r = await base.call(this, v); try { focus(v); } catch {} return r; }; wrapped.__focus = true; window.PAGES.team = wrapped;
  };
  function focus(v) {
    const id = window.routeArg; if (!id || done === location.hash) return;
    const el = v.querySelector(`[data-agent="${CSS.escape(id)}"]`); if (!el) return; done = location.hash;
    el.scrollIntoView({ block: 'center', behavior: 'auto' }); el.classList.add('ap-focus'); setTimeout(() => el.classList.remove('ap-focus'), 4500);
    const a = ((typeof S !== 'undefined' && S.team && S.team.agents) || []).find((x) => x.id === id);
    const wait = a && a.status && a.status.waiting || [];
    if (wait.length && typeof renderTaskModal === 'function') setTimeout(() => { try { renderTaskModal(wait[0]); } catch {} }, 350);
  }
  window.addEventListener('hashchange', () => { if (!location.hash.startsWith('#/team/')) done = ''; });
  wrap(); window.addEventListener('load', wrap);
})();
