
'use strict';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const statuses=['Needs verification','To assign','In review','Waiting on consultant','Ready to return','Returned to GC','Closed'];
const projects=['Chicago','Santa Monica'];
let items=[],filter='All active',section='Overview',visible=[],currentItem=null,loading=false,loaded=false;
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
const active=x=>x.status!=='Closed';
const late=x=>active(x)&&x.due&&x.due<today();
function dueSoon(x){const start=today(),end=new Date(start+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);return active(x)&&x.due>=start&&x.due<=end.toISOString().slice(0,10)}
function fmt(d){return d?new Date(d.slice(0,10)+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'Not set'}
function render(){
 const scoped=items.filter(x=>$('project').value==='All projects'||x.project===$('project').value);
 const metrics=[['Active in tracker',scoped.filter(active).length,'Includes unverified source snapshots','All active'],['Past source due date',scoped.filter(late).length,'Verify before escalating','Overdue'],['Due in next 7 days',scoped.filter(dueSoon).length,'Based on published due dates','Due in 7 days'],['Needs an owner',scoped.filter(x=>active(x)&&!x.owner).length,'Assign the next responsible person','Unassigned']];
 $('stats').innerHTML=metrics.map((m,i)=>'<button class="stat '+(filter===m[3]?'selected-stat':'')+'" data-filter="'+m[3]+'"><div>'+m[0]+'</div><strong class="'+(i===1?'red':'')+'">'+(loaded?String(m[1]).padStart(2,'0'):'—')+'</strong><p>'+m[2]+'</p></button>').join('');
 $('projects').innerHTML=projects.map((p,i)=>'<button class="project-card '+($('project').value===p?'picked':'')+'" data-project="'+p+'"><span class="project-monogram '+(i?'purple-bg':'orange-bg')+'">'+(i?'SM':'CH')+'</span><div><h3>'+p+' ↗</h3><p>'+(i?'Third Street Promenade':'Tribune Tower')+'</p></div><div class="project-count"><strong>'+(loaded?items.filter(x=>x.project===p&&active(x)).length:'—')+'</strong><span>active in tracker</span></div></button>').join('');
 const q=$('search').value.toLowerCase().trim();
 visible=scoped.filter(x=>($('type').value==='All types'||x.type===$('type').value)&&($('owner').value==='All owners'||($('owner').value==='Unassigned'?!x.owner:x.owner===$('owner').value))&&(!q||[x.subject,x.number,x.owner,x.discipline,x.consultant,x.nextAction].join(' ').toLowerCase().includes(q))&&(filter==='All items'||filter==='New incoming'&&!x.triagedAt&&active(x)||filter==='All active'&&active(x)||filter==='Overdue'&&late(x)||filter==='Due in 7 days'&&dueSoon(x)||filter==='Unassigned'&&active(x)&&!x.owner||filter==='Needs verification'&&x.status===filter||filter==='Closed'&&!active(x))).sort((a,b)=>(a.due||'9999').localeCompare(b.due||'9999'));
 $('tabs').innerHTML=['New incoming','All active','Overdue','Due in 7 days','Unassigned','Needs verification','Closed','All items'].map(t=>'<button class="tab '+(filter===t?'chosen-tab':'')+'" data-filter="'+t+'">'+t+'</button>').join('');
 function row(x){return '<tr><td></td><td><button class="item-title" data-id="'+esc(x.id)+'"><span class="item-meta">'+esc(x.type.toUpperCase())+' · '+esc(x.number)+'</span><strong>'+esc(x.subject)+'</strong><span class="item-desc">'+esc(x.nextAction||x.discipline)+'</span></button></td><td><span class="project-cell"><span class="dot '+(x.project==='Chicago'?'orange':'purple')+'"></span>'+esc(x.project)+'</span></td><td><button data-id="'+esc(x.id)+'" class="owner '+(x.owner?'':'unassigned')+'">'+esc(x.owner||'Unassigned')+'</button><span class="discipline">'+esc(x.discipline)+'</span></td><td><span class="tag '+(x.status==='Needs verification'?'amber':x.status==='Closed'?'green':'')+'">'+esc(x.status)+'</span></td><td><span class="due '+(late(x)?'red':'')+'">'+fmt(x.due)+'</span>'+(late(x)?'<span class="due-note">Past date · verify</span>':'')+'</td><td><button data-id="'+esc(x.id)+'" class="icon-btn" aria-label="Open '+esc(x.type+' '+x.number)+'">↗</button></td></tr>'}
 const head=document.querySelector('#mixedTable thead').innerHTML;
 for(const [kind,register,rows,count,thead]of [['RFI','rfiRegister','rfiRows','rfiCount','rfiHead'],['Submittal','submittalRegister','subRows','subCount','subHead']]){
   const subset=visible.filter(x=>x.type===kind);$(thead).innerHTML=head;$(count).textContent=subset.length;
   $(register).hidden=section==='RFIs'&&kind!=='RFI'||section==='Submittals'&&kind!=='Submittal';
   $(rows).innerHTML=subset.map(row).join('')||'<tr><td colspan="7" style="padding:25px;color:#929b87">'+(loaded?'No '+(kind==='RFI'?'RFIs':'submittals')+' match this view.':'Waiting for shared register.')+'</td></tr>';
 }
 const incoming=scoped.filter(x=>!x.triagedAt&&active(x)&&(section==='RFIs'?x.type==='RFI':section==='Submittals'?x.type==='Submittal':true));
 $('incomingCount').textContent=loaded?incoming.length:'—';
 $('incomingList').innerHTML=[['RFI','RFIs'],['Submittal','Submittals']].map(([kind,title])=>{const records=incoming.filter(x=>x.type===kind);return '<button class="incoming-tile" data-intake-kind="'+kind+'"><div><span class="register-code '+(kind==='Submittal'?'sub-code':'')+'">'+(kind==='RFI'?'RFI':'SUB')+'</span><h3>'+title+'</h3><strong>'+(loaded?String(records.length).padStart(2,'0'):'—')+'</strong></div><p>'+records.filter(x=>!x.owner).length+' need a reviewer · '+records.filter(x=>!x.detectedAt).length+' initial snapshots</p><span class="intake-open">Review incoming '+title.toLowerCase()+' →</span></button>'}).join('');
 document.querySelector('.tracker').hidden=section==='Incoming';
 $('empty').hidden=!loaded||!!visible.length;$('count').textContent=visible.length;$('totals').textContent=visible.length+' of '+items.length+' published records';
 document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;render()});
 document.querySelectorAll('[data-project]').forEach(b=>b.onclick=()=>{$('project').value=$('project').value===b.dataset.project?'All projects':b.dataset.project;render()});
 document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>openItem(items.find(x=>x.id===b.dataset.id)));
 document.querySelectorAll('[data-intake-kind]').forEach(b=>b.onclick=()=>{section=b.dataset.intakeKind==='RFI'?'RFIs':'Submittals';$('type').value=b.dataset.intakeKind;filter='New incoming';render();document.querySelector('.tracker').scrollIntoView({behavior:'smooth',block:'start'})});
 document.querySelectorAll('[data-view]').forEach(b=>{b.classList.remove('active');b.classList.toggle('active-nav',b.dataset.view===section)});
}
let lastFocus=null;
function openItem(x){if(!x)return;currentItem=x.id;lastFocus=document.activeElement;$('overlay').hidden=false;$('detailProject').textContent=x.project+' / '+x.type+' '+x.number;for(const k of ['subject','number','due','discipline','consultant','nextAction'])$(k).value=x[k]||'';$('editProject').value=x.project;$('editType').value=x.type;$('editOwner').value=x.owner||'';$('status').innerHTML=statuses.map(s=>'<option>'+s+'</option>').join('');$('status').value=x.status;$('triaged').checked=!!x.triagedAt;$('sourceDate').textContent='Source updated '+fmt(x.sourceDate)+(x.triagedAt?' · Triaged '+fmt(x.triagedAt):' · Awaiting triage');$('pdfDetails').textContent=x.pdfTotal?String(x.pdfFiled||0)+' of '+x.pdfTotal+' PDF attachments verified in Box. '+(x.pdfStatus||'Pending verification'):'No PDF attachment listed in the source.';$('close').focus()}
function closeItem(){$('overlay').hidden=true;currentItem=null;lastFocus?.focus()}
$('close').onclick=closeItem;$('overlay').onclick=e=>{if(e.target===$('overlay'))closeItem()};
$('form').onsubmit=e=>e.preventDefault();
document.querySelectorAll('#form input,#form textarea').forEach(el=>el.readOnly=true);
document.querySelectorAll('#form select,#form input[type=checkbox]').forEach(el=>el.disabled=true);
document.addEventListener('keydown',e=>{if($('overlay').hidden)return;if(e.key==='Escape')closeItem();if(e.key==='Tab'){const focusables=[...$('overlay').querySelectorAll('button,a[href],input:not([disabled]),textarea')];const first=focusables[0],last=focusables.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}}});
function toggleSources(){$('sourceInfo').hidden=!$('sourceInfo').hidden}
$('sources').onclick=toggleSources;
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{if(b.dataset.view==='Sources'){toggleSources();return}section=b.dataset.view;$('type').value=section==='RFIs'?'RFI':section==='Submittals'?'Submittal':'All types';filter=section==='All items'?'All items':'All active';render()});
for(const id of ['project','owner'])$(id).onchange=render;
$('type').onchange=()=>{section='Overview';render()};
$('search').oninput=render;
$('reset').onclick=()=>{$('project').value='All projects';$('type').value=section==='RFIs'?'RFI':section==='Submittals'?'Submittal':'All types';$('owner').value='All owners';$('search').value='';filter='All active';render()};
$('export').onclick=()=>{const cols=['project','type','number','subject','discipline','due','status','owner','consultant','nextAction'];const safeCSV=s=>{const raw=String(s??'');return /^[\s]*[=+@\-\t\r]/.test(raw)?"'"+raw:raw};const csv=[cols,...visible.map(x=>cols.map(c=>x[c]||''))].map(r=>r.map(s=>'"'+safeCSV(s).replace(/"/g,'""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='intuit-project-desk.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};
async function refresh(){
 if(loading)return;loading=true;$('refresh').disabled=true;
 try{
  const response=await fetch('./data/register.json',{cache:'no-store'});
  if(!response.ok)throw new Error('The shared register could not be retrieved ('+response.status+').');
  const data=await response.json();
  if(data.schemaVersion!==1||!Array.isArray(data.items)||data.items.length>10000)throw new Error('The register format is invalid.');
  const ids=new Set();
  for(const item of data.items){if(!item||typeof item.id!=='string'||ids.has(item.id)||!projects.includes(item.project)||!['RFI','Submittal'].includes(item.type)||!statuses.includes(item.status)||typeof item.subject!=='string')throw new Error('A published record is invalid.');ids.add(item.id)}
  items=data.items;loaded=true;
  const prev=$('owner').value;$('owner').innerHTML='<option>All owners</option><option>Unassigned</option>'+[...new Set(items.map(x=>x.owner).filter(Boolean))].sort().map(o=>'<option>'+esc(o)+'</option>').join('');if([...$('owner').options].some(o=>o.value===prev))$('owner').value=prev;
  const lastPull=data.lastSuccessfulSyncAt||data.sourceUpdatedAt, lastTime=lastPull?new Date(lastPull):null, stale=data.syncConnected&&(!lastTime||Date.now()-lastTime.getTime()>Math.max(120,2*(data.refreshIntervalMinutes||60))*60000);
  const stamp=lastTime&&!Number.isNaN(lastTime.getTime())?lastTime.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'not yet available';
  $('dataStatus').textContent=stale?'Source refresh overdue · showing last successful pull':data.syncConnected?'Live source feed · hourly sync':data.lastSuccessfulSyncAt?'Source pull verified · scheduled activation pending':'Published snapshot · Smartsheet sync not connected';
  $('dataDetail').textContent=items.length+' records · last source pull '+stamp+'. Page checks for published updates every minute.';
  $('syncDetails').textContent=$('dataStatus').textContent+'. Last successful source pull: '+stamp+'.';
  const total=items.reduce((n,x)=>n+(Number(x.pdfTotal)||0),0),filed=items.reduce((n,x)=>n+(Number(x.pdfFiled)||0),0),errors=Number(data.filing?.failedThisRun)||0;
  $('filingDetails').textContent=(data.filing?.connected?'PDF filing connected. ':'PDF filing has not been activated. ')+filed+' of '+total+' current PDF attachments verified in Box.'+(errors?' '+errors+' transfer checks failed in the latest run.':'')+(data.filing?.backfillPending?' Initial filing or verification remains in progress.':'');
  $('incomingNote').textContent=items.some(x=>x.importedBaseline)?'Imported source records are included until triaged. New arrivals and revisions return to this queue; closed items are excluded.':'Source records awaiting triage. Closed items are excluded.';
  $('loadError').hidden=true;render();
  if(currentItem&&!$('overlay').hidden){const updated=items.find(x=>x.id===currentItem);if(updated)openItem(updated);else closeItem()}
 }catch(err){$('loadError').hidden=false;$('loadError').textContent=(loaded?'Refresh failed. Showing the last loaded data. ':'Data unavailable. Counts are not yet known. ')+err.message;$('dataStatus').textContent=loaded?'Data may be stale · refresh failed':'Shared register unavailable'}
 finally{loading=false;$('refresh').disabled=false}
}
$('refresh').onclick=refresh;document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh()});setInterval(()=>{if(!document.hidden)refresh()},60000);render();refresh();
