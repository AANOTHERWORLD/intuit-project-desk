import {createHash} from 'node:crypto';

export const isComplete=item=>['Closed','Returned to GC'].includes(item.status);
export function sourceWorkflow(c,s,old={}){
 const checked=c[s.closed]===true||String(c[s.closed]).toLowerCase()==='true';
 const date=String(c[s.returned]||'').trim();
 const response=String(c['Submittal Response']||'').trim().toUpperCase();
 // Explicit dispositions represent a returned review, not necessarily approval.
 const returned=s.type==='Submittal'&&['RNR','RR','AN','A','APPROVED','APPROVED AS NOTED','REVIEWED','REVIEWED AS NOTED','REVISE AND RESUBMIT','REJECTED','NO EXCEPTIONS TAKEN'].includes(response);
 const status=checked?'Closed':date||returned?'Returned to GC':['In review','Waiting on consultant','Ready to return'].includes(old.status)?old.status:old.owner?'In review':'To assign';
 return {status,completionMethod:checked?'Smartsheet approval/closed':date?'Smartsheet response date':returned?'Smartsheet response disposition':''};
}
export function applyCompletion(item,override){
 item.manualComplete=override?.complete===true;
 if(item.manualComplete){item.status='Closed';item.completionMethod='Manual override';item.completedAt=override.at;}
 if(isComplete(item))item.nextAction='';
 return item;
}
const repo='https://api.github.com/repos/AANOTHERWORLD/intuit-project-desk/contents/';
export async function readOverrides(zapier,cfg){
 const r=await zapier.fetch(repo+'data/completion-overrides.json?ref=main',{connection:cfg.github});
 if(!r.ok)throw new Error('Completion overrides unavailable '+r.status);
 const file=await r.json(),data=JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString());
 if(data.schemaVersion!==1||!data.items||Array.isArray(data.items))throw new Error('Invalid completion overrides');
 return {file,data};
}
export async function writeCompletion({zapier,cfg,itemId,complete,now}){
 if(!/^item-[a-f0-9]{24}$/.test(itemId))throw new Error('Invalid record ID');
 for(let attempt=0;attempt<3;attempt++){
  const {file,data}=await readOverrides(zapier,cfg);
  if(data.items[itemId]?.complete===complete)return data.items[itemId];
  data.items[itemId]={complete,at:now};
  const r=await zapier.fetch(repo+'data/completion-overrides.json',{connection:cfg.github,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch:'main',sha:file.sha,message:complete?'Mark dashboard item complete':'Remove dashboard completion override',content:Buffer.from(JSON.stringify(data,null,2)+'\n').toString('base64')})});
  if([409,422].includes(r.status)&&attempt<2)continue;
  if(!r.ok||!(await r.json()).commit?.sha)throw new Error('Completion save not confirmed');
  return data.items[itemId];
 }
}
const addresses=value=>(String(value||'').toLowerCase().match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g)||[]);
const header=(m,name)=>m.payload?.headers?.find(h=>h.name.toLowerCase()===name.toLowerCase())?.value||'';
const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
export function matchesItem(subject,item,allItems){
 const text=norm(subject),project=item.project==='Santa Monica'?/\b(santa monica|intuit sm|store 34)\b/:/\b(chicago|tribune|store 39)\b/;
 if(!project.test(text))return false;
 const number=norm(item.number).replace(/^rfi /,'');
 if(item.type==='RFI'&&/^\d+(?: \d+)*$/.test(number))return new RegExp('\\brfi '+number+'\\b(?! \\d)').test(text);
 // Row numbers / N/A are not source submittal identifiers. Require a unique subject.
 const title=norm(item.subject);
 return title.length>=8&&(' '+text+' ').includes(' '+title+' ')&&allItems.filter(x=>x.project===item.project&&x.type===item.type&&norm(x.subject)===title).length===1;
}
export async function reviewMailbox({items,cfg,zapier,ledger,save,now}){
 const summary={enabled:cfg.emailReviewEnabled===true,matched:0,ambiguous:0};
 if(!summary.enabled)return summary;
 const read=async path=>{const r=await zapier.fetch('https://gmail.googleapis.com/gmail/v1/users/me/'+path,{connection:cfg.gmail});if(!r.ok)throw new Error('Mailbox read failed '+r.status);return r.json()};
 const profile=await read('profile');
 if(profile.emailAddress?.toLowerCase()!==String(cfg.mailSender).toLowerCase())throw new Error('Mailbox does not match configured sender');
 const eligible=items.filter(x=>!isComplete(x));
 for(const item of eligible){
  const key='mail-review/'+item.id,previous=ledger.get(key)?.v||{},routes=cfg.consultantRoutes?.[item.project]||{};
  const projectQuery=item.project==='Santa Monica'?' {"Santa Monica" "Intuit SM" "Store 34"} ':' {Chicago Tribune "Store 39"} ';
  const q=projectQuery+'in:sent after:'+String(item.received||'2026-01-01').replaceAll('-','/')+' '+(item.type==='RFI'?'"RFI" "'+String(item.number).replace(/^RFI\s*/i,'').replace(/["\\]/g,' ')+'"':'"'+String(item.subject).replace(/["\\]/g,' ')+'"');
  const list=await read('messages?'+new URLSearchParams({q,maxResults:'50'}));
  if(list.nextPageToken){summary.ambiguous++;continue;}
  const candidates=[];
  for(const ref of list.messages||[]){
   const message=await read('messages/'+ref.id+'?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Cc');
   if(!message.labelIds?.includes('SENT')||!matchesItem(header(message,'Subject'),item,items))continue;
   const recipients=addresses(header(message,'To')+','+header(message,'Cc'));
   const teams=Object.entries(routes).filter(([,r])=>r.verified===true&&r.to?.some(a=>recipients.includes(a.toLowerCase()))).map(([team])=>team);
   if(teams.length!==1){if(teams.length)summary.ambiguous++;continue;}
   candidates.push({team:teams[0],messageId:message.id,threadId:message.threadId,at:new Date(Number(message.internalDate)).toISOString()});
  }
  const latest=candidates.sort((a,b)=>b.at.localeCompare(a.at))[0]||previous.forward;
  if(!latest)continue;
  const thread=await read('threads/'+latest.threadId+'?format=metadata&metadataHeaders=From');
  const consultantAddresses=(routes[latest.team]?.to||[]).map(a=>a.toLowerCase());
  const reply=(thread.messages||[]).filter(m=>!m.labelIds?.includes('SENT')&&Number(m.internalDate)>Date.parse(latest.at)&&addresses(header(m,'From')).some(a=>consultantAddresses.includes(a))).sort((a,b)=>Number(b.internalDate)-Number(a.internalDate))[0];
  const evidence={forward:latest,replyAt:reply?new Date(Number(reply.internalDate)).toISOString():'',checkedAt:now};
  if(!cfg.dryRun)await save(key,evidence);
  item.consultant=latest.team;item.forwardedAt=latest.at;item.consultantRespondedAt=evidence.replyAt;
  item.status=evidence.replyAt?'In review':'Waiting on consultant';
  item.nextAction=evidence.replyAt?'Consultant response received; architect review needed.':'Await consultant review.';
  summary.matched++;
 }
 return summary;
}
export function closureTransition(previous,item,now){
 const complete=isComplete(item);
 if(!previous)return {complete,generation:0}; // Baseline: no historical mail.
 if(previous.complete===complete)return previous;
 return {complete,generation:(previous.generation||0)+(complete?1:0),...(complete?{pending:true,at:now,method:item.completionMethod||'Smartsheet'}:{})};
}
export async function notifyClosures({items,cfg,zapier,ledger,save,now}){
 const summary={enabled:cfg.closureEmailEnabled===true,sent:0,uncertain:0};
 if(!summary.enabled||cfg.dryRun)return summary;
 const to=cfg.closureRecipients;
 if(cfg.closureRecipientsVerified!==true||!Array.isArray(to)||to.length!==4||new Set(to.map(a=>a.toLowerCase())).size!==4||to.some(a=>!/^[-a-z0-9._]+@raptstudio\.com$/i.test(a)))throw new Error('Verify the four Rapt closure recipients in private configuration');
 if(!/^[a-z0-9._+-]+@raptstudio\.com$/i.test(cfg.mailSender))throw new Error('Invalid sender');
 for(const item of items){
  const key='closure/'+item.id,previous=ledger.get(key)?.v;
  let state=closureTransition(previous,item,now);
  if(JSON.stringify(state)!==JSON.stringify(previous))await save(key,state);
  if(!state.pending)continue;
  const event=createHash('sha256').update(key+':'+state.generation).digest('hex');
  const claim=await zapier.fetch(repo+'data/notification-claims/closure-'+event+'.json',{connection:cfg.github,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch:'main',message:'Claim closure notification',content:Buffer.from(JSON.stringify({state:'claimed',at:now})).toString('base64')})});
  if([409,422].includes(claim.status)){summary.uncertain++;continue;}
  if(!claim.ok||!(await claim.json()).commit?.sha)throw new Error('Closure claim failed');
  const title='Completed: '+item.project+' '+item.type+' '+item.number+' - '+item.subject;
  const body=[item.project+' | '+item.type+' '+item.number,item.subject,'','Completion: '+state.method,'Recorded: '+state.at,'','https://aanotherworld.github.io/intuit-project-desk/?item='+item.id,'','Dashboard completion does not replace the formal Smartsheet response.'].join('\n');
  const mime=['From: '+cfg.mailSender,'To: '+to.join(', '),'Subject: =?UTF-8?B?'+Buffer.from(title).toString('base64')+'?=','Message-ID: <closure-'+event+'@raptstudio.com>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(body).toString('base64')].join('\r\n');
  try{
   const sent=await zapier.fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{connection:cfg.gmail,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(mime).toString('base64url')})});
   if(!sent.ok)throw new Error('Closure email unconfirmed');
   const result=await sent.json();if(!result.id)throw new Error('Closure confirmation missing');
   await save(key,{...state,pending:false,messageId:result.id});summary.sent++;
  }catch{summary.uncertain++;} // Keep claim; never blindly resend after ambiguous delivery.
 }
 return summary;
}

