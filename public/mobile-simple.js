/* Full settings on every device, organized into accessible disclosure groups. */
(()=>{
 'use strict';
 const projects=PAGES.projects||vProjects;
 PAGES.projects=async view=>{
  await projects(view);
  view.querySelectorAll('.pcard[data-go]').forEach(card=>{
   card.setAttribute('role','link');card.tabIndex=0;
   card.setAttribute('aria-label','Open '+(card.querySelector('.name')?.textContent||'project'));
   card.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();card.click();}});
  });
 };
 const base=PAGES.settings;
 const glyph=path=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
 PAGES.settings=async view=>{
  await base(view);if(!view.isConnected)return;
  const hub=view.querySelector('.settings-hub');if(!hub)return;
  hub.classList.add('settings-organized');
  hub.querySelector('h1').textContent='Settings';
  const personal=document.createElement('div');personal.className='settings-personal';
  hub.querySelector('.settings-heading').after(personal);
  const entries=[
   ['.appearance-panel','Your Jarvis','Orb, colors & effects','M12 3 15 9l6 3-6 3-3 6-3-6-6-3 6-3','violet'],
   ['.da-settings','Background & atmosphere','Scenes, colors and motion','m3 17 6-7 4 4 3-3 5 6M3 4h18v16H3Z','blue'],
   ['#notificationSettings','Notifications','Delivery, sounds and alerts','M5 17h14l-2-3V9a5 5 0 0 0-10 0v5Zm5 3h4','rose'],
   ['#connectionRepairs','Connection status','Check services and repair connections','m3 12 4 4 4-10 4 12 3-6h3','green']
  ];
  entries.forEach(([selector,title,description,path,color],i)=>{
   const section=hub.querySelector(selector);if(!section)return;
   const drawer=document.createElement('details');drawer.className='settings-drawer'+(i===0?' settings-profile':'');
   const summary=document.createElement('summary');
   summary.innerHTML=`<span class="settings-row-icon ${color}">${glyph(path)}</span><span class="settings-row-label"><strong>${title}</strong><small>${description}</small></span><span class="settings-chevron" aria-hidden="true">›</span>`;
   drawer.append(summary);personal.append(drawer);drawer.append(section);
   if(i===0){const preview=section.querySelector('.appearance-preview');if(preview){summary.querySelector('.settings-row-icon').replaceWith(preview);}}
  });
  const input=hub.querySelector('#settingsSearch');
  input.placeholder='Search settings';
  input.addEventListener('input',()=>{
   const q=input.value.trim().toLowerCase();
   personal.querySelectorAll('.settings-drawer').forEach(drawer=>{drawer.hidden=!!q&&!drawer.textContent.toLowerCase().includes(q);});
  });
 };
})();
