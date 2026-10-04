const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const paths={back:'m14 6-6 6 6 6',chevron:'m7 10 5 5 5-5',more:'M5 11v2m7-2v2m7-2v2',expand:'M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5',collapse:'M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5',grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',pulse:'M2 12h5l3-8 4 16 3-8h5',download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',search:'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',refresh:'M20 7v5h-5M4 17v-5h5M5.5 7a8 8 0 0 1 13-1L20 9M4 15l1.5 3a8 8 0 0 0 13-1',external:'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',close:'m6 6 12 12M6 18 18 6',arrow:'M5 12h14m-5-5 5 5-5 5',box:'m12 3 9 5-9 5-9-5Zm-9 5v9l9 5 9-5V8M12 13v9',camera:'M3 7h4l2-3h6l2 3h4v14H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0',chart:'M4 3v18h17M8 16v-5m5 5V6m5 10v-8',globe:'M21 12A9 9 0 1 1 3 12a9 9 0 0 1 18 0M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18',tool:'m14 5 5 5M3 21l6-6M3 3l18 18M16 3l5 5-8 8-5-5Z'};
const icon=n=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[n]||paths.box}"/></svg>`;
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
let data=null,filter='all',active=null,opened=new Map(),installPrompt=null,loading=false,overviewScroll=0;
function read(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback}catch{return fallback}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch{}}
let favorites=new Set(read('harbor-favorites',[]));
Object.assign(paths, {
  server:'M4 3h16v7H4zM4 14h16v7H4zM7 6.5h.01M7 17.5h.01M16 6.5h1M16 17.5h1',
  info:'M12 11v6m0-10h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  plane:'m21 3-6 18-4-8-8-4Zm-10 10L21 3',
  wallet:'M4 6V4h14v4M3 8h18v13H3Zm18 5h-6v4h6m-3-2h.01',
  light:'M9 18h6m-5 3h4M8 13a6 6 0 1 1 8 0c-1 1-1 2-1 3H9c0-1 0-2-1-3M12 1v1M2 7l2 1m16 0 2-1',
  message:'M21 4H3v13h5l4 4v-4h9ZM7 8h10M7 12h6',
  assistant:'M12 3v3M9 3h6M4 8h16v12H4ZM8 12v2m8-2v2m-7 3h6M1 11v5m22-5v5',
  court:'M3 4h18v16H3ZM12 4v16M3 12h18M6 4v16m12-16v16',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Zm-4 9 3 3 5-6',
  archive:'M3 4h18v5H3ZM5 9v12h14V9M9 13h6',
  browser:'M3 4h18v16H3ZM3 9h18M6 6.5h.01m3 0h.01M10 12l-3 3 3 3m4-6 3 3-3 3',
  teams:'M15 10h6v8h-6M3 9h11v12H3Zm2-5a3 3 0 1 0 6 0 3 3 0 0 0-6 0m12 0a2 2 0 1 0 4 0 2 2 0 0 0-4 0M6 13h5m-2.5 0v5',
  layers:'m12 3 9 5-9 5-9-5Zm-9 10 9 5 9-5M3 18l9 5 9-5',
  research:'M5 3h14v18H5ZM9 7h6M9 11h6M9 15h2m3 1 4 4',
});
// Authored, recognisable geometric symbols keep app identities distinct at small sizes.
const palettes=['amber','indigo','rose','violet','gold','mint','teal','pink','blue','olive','slate'];
function projectIcon(p){const requested=p.presentation?.icon;if(Object.hasOwn(paths,requested))return requested;return /camera|photo|vision/.test(p.id)?'camera':/finance|ledger|budget/.test(p.id)?'chart':/travel|crawler/.test(p.id)?'globe':/light|cad|control/.test(p.id)?'tool':/message|chat/.test(p.id)?'message':'box'}
function appSymbol(p,external=false){const requested=p.presentation?.palette,index=[...p.id].reduce((sum,c)=>sum+c.charCodeAt(0),0)%palettes.length,palette=palettes.includes(requested)?requested:palettes[index];return `<span class="app-symbol palette-${palette}">${icon(projectIcon(p))}${external?`<span class="external-mark">${icon('external')}</span>`:''}</span>`}
function description(p){return p.presentation?.description||p.containers.map(c=>c.service).join(' · ')}
function externalLink(p){const url=p.presentation?.externalUrl;if(!url)return null;try{const parsed=new URL(url);return parsed.protocol==='https:'&&!parsed.username&&!parsed.password?{url:parsed.href,label:'Open '+p.name,note:'This app opens on its own secure website to use its normal sign-in.'}:null;}catch{return null}}
function launchEndpoint(p){return externalLink(p)?null:p.endpoints.find(e=>e.kind==='website'||e.status===401)}
function isApp(p){return !!externalLink(p)||!!launchEndpoint(p)}
function status(p){return p.unhealthy?['Needs attention','warn']:!p.running?['Stopped','stopped']:p.running<p.containers.length?['Partly running','warn']:['Running','']}
function statusHtml(p){const st=status(p);return `<span class="status ${st[1]}">${st[0]}</span>`}
function renderApp(p){
  const ep=launchEndpoint(p),external=externalLink(p);
  const content=`${appSymbol(p,!!external)}<span class="tile-title">${esc(p.name)}</span><span class="tile-description">${esc(description(p))}</span>`;
  return `<article class="project app-tile" data-project="${esc(p.id)}">${favorites.has(p.id)?`<span class="favorite-mark" aria-label="Favorite">${icon('star')}</span>`:''}${external?`<a class="tile-launch" href="${external.url}" target="_blank" rel="noopener" aria-label="Open ${esc(p.name)} in browser">${content}</a>`:`<button class="tile-launch" data-open="${ep.id}" aria-label="Open ${esc(p.name)}">${content}</button>`}<div class="tile-meta">${statusHtml(p)}<button class="icon-button tile-info" data-details="${esc(p.id)}" aria-label="Details for ${esc(p.name)}" title="App details and favorites">${icon('more')}</button></div></article>`;
}
function renderService(p){return `<article class="project service-project" data-project="${esc(p.id)}">${icon(projectIcon(p))}<div class="project-text"><button class="project-title" data-details="${esc(p.id)}">${esc(p.name)}</button><p class="project-desc">${esc(p.presentation?.description||'Background services')}</p></div><span class="containers">${p.running} / ${p.containers.length} running</span>${statusHtml(p)}<button class="icon-button star ${favorites.has(p.id)?'saved':''}" data-star="${esc(p.id)}" aria-label="${favorites.has(p.id)?'Unfavorite':'Favorite'} ${esc(p.name)}" aria-pressed="${favorites.has(p.id)}">${icon('star')}</button><button class="icon-button" data-details="${esc(p.id)}" aria-label="Details for ${esc(p.name)}">${icon('more')}</button></article>`}
function render(){
  if(!data)return;
  const focused=document.activeElement,focusProject=focused?.dataset.details,focusStar=focused?.dataset.star;
  const projects=data.projects||[],apps=projects.filter(isApp);
  $('#projectCount').textContent=projects.length;
  $('#favoriteCount').textContent=projects.filter(p=>favorites.has(p.id)).length;
  const attention=projects.filter(p=>p.unhealthy||p.running<p.containers.length).length;
  $('#attentionCount').textContent=attention||'';
  const cs=data.containers||[],running=cs.filter(c=>c.state==='running').length;
  $('#summary').innerHTML=`<span><strong>${apps.length}</strong> apps</span><span><strong>${projects.length-apps.length}</strong> services</span><span class="running-summary"><strong>${running}</strong> containers running</span>`;
  const query=$('#search').value.trim().toLowerCase(),state=$('#statusFilter').value;
  const selected=projects.filter(p=>(filter!=='favorites'||favorites.has(p.id))&&(filter!=='attention'||p.unhealthy||p.running<p.containers.length)&&(state!=='running'||p.running>0)&&(state!=='stopped'||p.running<p.containers.length)&&(state!=='web'||p.endpoints.length||externalLink(p))&&(!query||JSON.stringify([p.id,p.name,description(p),p.containers.map(c=>[c.name,c.image])]).toLowerCase().includes(query))).sort((a,b)=>Number(favorites.has(b.id))-Number(favorites.has(a.id))||a.name.localeCompare(b.name));
  const selectedApps=selected.filter(isApp),services=selected.filter(p=>!isApp(p));
  const empty=filter==='favorites'&&!query&&state==='all'?['star','Make it yours.','Open an app’s details and add it to Favorites.']:filter==='attention'&&!query&&state==='all'?['pulse','Everything is running.','No projects need attention right now.']:['search','No matching projects.','Try another search or change the status filter.'];
  $('#projects').innerHTML=selected.length?`${selectedApps.length?`<div class="app-grid">${selectedApps.map(renderApp).join('')}</div>`:''}${services.length?`<div class="services-heading"><h2>Background services</h2><span>${services.length}</span></div><div class="service-list">${services.map(renderService).join('')}</div>`:''}`:`<div class="empty" role="status">${icon(empty[0])}<strong>${empty[1]}</strong>${empty[2]}</div>`;
  // Inventory polling should not throw away a keyboard user's current location.
  if(focused&&!focused.isConnected){const key=focusProject?'details':focusStar?'star':focused.dataset.open?'open':null,value=focusProject||focusStar||focused.dataset.open;if(key)document.querySelector(`[data-${key}="${CSS.escape(value)}"]`)?.focus({preventScroll:true});}
  $('#hostName').textContent=data.host?.name||'Docker Desktop';
  $('#hostMeta').textContent=data.host?.version?`${data.host.cpus} CPUs · Docker ${data.host.version}`:'Connecting…';
  $('.host').title=$('#hostMeta').textContent;
  $('#updated').textContent=data.updated?'Updated '+new Date(data.updated*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'Waiting for first update';
}
// Icons added to the static shell after the extended icon set is available.
document.querySelectorAll('[data-icon]').forEach(e=>e.innerHTML=icon(e.dataset.icon));
async function refresh(){if(loading)return;loading=true;$('#refresh').disabled=true;try{const r=await fetch('/api/inventory',{cache:'no-store'});if(!r.ok)throw Error();data=await r.json();save('harbor-snapshot',data);const stale=data.error||!data.updated||Date.now()-data.updated*1000>90000;$('#connection').textContent=stale?'Inventory delayed':'Live inventory';$('#connection').classList.toggle('error',!!stale);$('#notice').hidden=!stale;$('#notice').textContent=data.error||'Inventory is delayed. Check the Docker connection; Harbor will retry automatically.';render();}catch{if(!data)data=read('harbor-snapshot',null);$('#connection').textContent='Offline';$('#connection').classList.add('error');$('#notice').hidden=false;$('#notice').textContent='Can’t reach Harbor. Showing the last saved inventory. Check Tailscale and your connection, then refresh.';if(data)render();else $('#projects').innerHTML='<div class="empty"><strong>Harbor is out of reach.</strong>Check Tailscale and refresh to reconnect.</div>';}finally{loading=false;$('#refresh').disabled=false;}}
function epById(id){return data?.endpoints.find(e=>e.id===id)}
function openApp(id){const ep=epById(id);if(!ep)return;const p=data.projects.find(p=>p.id===ep.project);if(!opened.has(id)){const frame=document.createElement('iframe');frame.title=p.name+' · '+ep.name;frame.src=ep.url;frame.dataset.id=id;frame.allow='fullscreen; clipboard-read; clipboard-write';frame.sandbox='allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-downloads allow-modals';frame.referrerPolicy='no-referrer';$('#frames').append(frame);opened.set(id,{...ep,title:p.name});}$('#details').close();selectApp(id);}
function selectApp(id){
  const wasApp=!!active;
  if(id&&!wasApp)overviewScroll=window.scrollY;
  active=id;
  document.body.classList.toggle('app-active',!!id);
  $('#overview').hidden=!!id;
  $('#appView').hidden=!id;
  $('#tabs').hidden=!opened.size;
  $('#appMenu').open=false;
  setFocusMode(false);
  $('#viewName').textContent=id?opened.get(id).title:({all:'App library',favorites:'Favorites',attention:'Needs attention'}[filter]);
  document.querySelectorAll('#frames iframe').forEach(f=>f.hidden=f.dataset.id!==id);
  $('#appSwitcher').innerHTML=[...opened].map(([key,e])=>`<option value="${key}">${esc(e.title)}${[...opened.values()].filter(x=>x.title===e.title).length>1?' / '+esc(e.name):''}</option>`).join('');
  if(id){$('#appSwitcher').value=id;$('#externalApp').href=opened.get(id).url;}
  document.title=id?opened.get(id).title+' · Harbor':'Harbor · Docker workspace';
  renderTabs();
  if(id&&!wasApp)window.scrollTo(0,0);
  if(!id&&wasApp){window.scrollTo(0,overviewScroll);$('#search').focus({preventScroll:true});}
}
function setFocusMode(enabled){
  document.body.classList.toggle('app-focus',enabled&&!!active);
  $('#restoreControls').hidden=!enabled||!active;
  $('#appMenu').open=false;
  if(enabled)$('#restoreControls').focus({preventScroll:true});
}
function closeApp(id){
  document.querySelector(`#frames iframe[data-id="${id}"]`)?.remove();
  const ids=[...opened.keys()],index=ids.indexOf(id);
  opened.delete(id);
  selectApp(active===id?(ids[index+1]||ids[index-1]||null):active);
}
function renderTabs(){$('#tabs').hidden=!opened.size;$('#tabs').innerHTML=`<span class="tabs-label">Open apps</span>`+[...opened].map(([id,e])=>`<div class="tab"><button data-tab="${id}" aria-label="Resume ${esc(e.title)}">${icon('arrow')}${esc(e.title)}</button><button class="close-tab" data-close-tab="${id}" aria-label="Close ${esc(e.title)}">${icon('close')}</button></div>`).join('');}
function details(id){const p=data.projects.find(p=>p.id===id);$('#detailsIcon').innerHTML=appSymbol(p);$('#detailsTitle').textContent=p.name;$('#detailsSubtitle').textContent=`${p.containers.length} containers · ${p.endpoints.length} launch links`;
$('#detailsBody').innerHTML=`${externalLink(p)?`<div class="notice">${esc(externalLink(p).note)}<p><a class="open" href="${externalLink(p).url}" target="_blank" rel="noopener">${externalLink(p).label} ${icon('external')}</a></p></div>`:''}<div class="detail-links">${p.endpoints.length&&!externalLink(p)?`${p.endpoints.map(e=>`<button class="open" data-open="${e.id}">${esc(e.name)} :${e.port} ${icon('arrow')}</button>`).join('')}`:''}<button class="open detail-favorite star ${favorites.has(p.id)?'saved':''}" data-star="${esc(p.id)}" aria-pressed="${favorites.has(p.id)}">${icon('star')}${favorites.has(p.id)?'Remove favorite':'Add to Favorites'}</button></div>${!p.endpoints.length?'<p class="muted">No web interface. These services run in the background.</p>':''}<h3 class="detail-section">Containers</h3>${p.containers.map(c=>`<section class="service"><strong>${esc(c.service)}</strong><span class="status ${c.health==='unhealthy'?'warn':c.state==='running'?'':'stopped'}">${esc(c.status)}</span><p>${esc(c.name)}<br><code>${esc(c.image)}</code></p><p>Networks: ${esc(c.networks.join(', ')||'none')}<br>Ports: ${esc(c.ports.map(x=>`${x.PublicPort?x.PublicPort+' → ':''}${x.PrivatePort}/${x.Type}`).join(', ')||'none')}</p>${c.state==='running'?`<div class="resource"><button data-stats="${c.id}">Check resources</button><span id="stats-${c.id}"></span></div>`:''}</section>`).join('')}${p.containers[0].workingDir?`<h3 class="detail-section">Project directory</h3><p class="muted project-directory">${esc(p.containers[0].workingDir)}</p>`:''}`;$('#details').showModal();}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;setTimeout(()=>$('#toast').hidden=true,3000)}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b)return;if(b.dataset.filter){filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(n=>{n.classList.toggle('active',n===b);n.setAttribute('aria-pressed',n===b);});selectApp(null);render();}if(b.dataset.star){const id=b.dataset.star;favorites.has(id)?favorites.delete(id):favorites.add(id);save('harbor-favorites',[...favorites]);render();if(b.closest('dialog')){b.classList.toggle('saved',favorites.has(id));b.setAttribute('aria-pressed',favorites.has(id));b.innerHTML=icon('star')+(favorites.has(id)?'Remove favorite':'Add to Favorites');}toast(favorites.has(id)?'Added to Favorites':'Removed from Favorites');}if(b.dataset.open)openApp(b.dataset.open);if(b.dataset.details)details(b.dataset.details);if(b.dataset.close)$('#'+b.dataset.close).close();if(b.dataset.tab)selectApp(b.dataset.tab==='home'?null:b.dataset.tab);if(b.dataset.closeTab)closeApp(b.dataset.closeTab);if(b.dataset.stats){b.disabled=true;const out=$('#stats-'+b.dataset.stats);out.textContent='Sampling…';try{const r=await fetch('/api/containers/'+b.dataset.stats+'/stats');if(!r.ok)throw Error();const s=await r.json();out.textContent=`CPU ${s.cpu===null?'—':s.cpu+'%'} · RAM ${(s.memory/1048576).toFixed(0)} MB · ${s.pids} processes`;}catch{out.textContent='Sample unavailable. Try again.';}finally{b.disabled=false;}}});
$('#search').addEventListener('input',render);$('#statusFilter').addEventListener('change',render);$('#refresh').onclick=refresh;$('#reloadApp').onclick=()=>{const f=document.querySelector(`#frames iframe[data-id="${active}"]`);if(f)f.src=opened.get(active).url;$('#appMenu').open=false;};$('.brand').onclick=e=>{e.preventDefault();selectApp(null)};
document.addEventListener('keydown',e=>{if(e.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&!document.querySelector('dialog[open]')){e.preventDefault();selectApp(null);$('#search').focus();}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});$('#install').onclick=async()=>{if(installPrompt){await installPrompt.prompt();installPrompt=null;}else $('#installDialog').showModal();};window.addEventListener('appinstalled',()=>toast('Harbor is installed.'));
$('#date').textContent=new Date().toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'});if('serviceWorker'in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});refresh();setInterval(refresh,30000);window.addEventListener('online',refresh);

$('#backProjects').onclick=()=>selectApp(null);
$('#appSwitcher').onchange=e=>selectApp(e.target.value);
$('#focusApp').onclick=()=>setFocusMode(true);
$('#restoreControls').onclick=()=>{setFocusMode(false);$('#appMenu summary').focus();};
$('#closeApp').onclick=()=>closeApp(active);
$('#externalApp').addEventListener('click',()=>$('#appMenu').open=false);
document.addEventListener('click',e=>{if(!$('#appMenu').contains(e.target))$('#appMenu').open=false;});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){
  if(document.body.classList.contains('app-focus')){$('#restoreControls').click();}
  else if($('#appMenu').open){$('#appMenu').open=false;$('#appMenu summary').focus();}
}});
