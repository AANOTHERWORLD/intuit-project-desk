import {createZapierSdk} from '@zapier/zapier-sdk';
import {createHash} from 'node:crypto';
// Consultant delivery helpers. Recipient addresses belong in private config_json, never this repository.
const CONSULTANT_TEAMS=['MEP Engineers','Structural engineer','Lighting','Landscape','AV','AV - Computacenter'];
function normalizeConsultant(value){
 const aliases={'mep':'MEP Engineers','mep engineer':'MEP Engineers','structural':'Structural engineer','av - bugid':'AV'};
 const text=String(value||'').trim();return CONSULTANT_TEAMS.find(t=>t.toLowerCase()===text.toLowerCase())||aliases[text.toLowerCase()]||'';
}
function routeFor(cfg,project,team){
 const route=cfg.consultantRoutes?.[project]?.[team];
 if(!route||route.verified!==true||!Array.isArray(route.to)||!route.to.length)throw new Error('Consultant recipient route is not verified for this project');
 const all=[...route.to,...(route.cc||[])];
 if(all.length>12||all.some(v=>typeof v!=='string'||!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)))throw new Error('Invalid consultant recipient configuration');
 return {to:[...new Set(route.to)],cc:[...new Set(route.cc||[])]};
}
function buildReviewEmail({item,team,route,pdfs,eventKey,sender}){
 if(!pdfs.length)throw new Error('No current PDF attached; email is held');
 if(typeof item.question!=='string'||!item.question.trim())throw new Error('Question text is missing; email is held');
 const enc=v=>Buffer.from(v).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'';
 const boundary='project-desk-'+eventKey;
 const subject='INTUIT CA | '+item.project+' | '+item.type+' '+item.number+' | '+item.subject;
 const body=['Hello '+team+' team,','','A submission has been shared for your review. Please review the attached '+item.type.toLowerCase()+'.','','REVIEW DUE: '+(item.due||'Please confirm with Rapt'),'If you need more time for your review, please let us know as soon as possible so we can coordinate the response schedule.','','Project: '+item.project,'Reference: '+item.type+' '+item.number,'Subject: '+item.subject,'','Question / request:',item.question,'','Please reply to this email with your review. Rapt will coordinate the formal response in Smartsheet.','','Rapt Studio | Intuit Project Desk'].join('\n');
 const question=Buffer.from(['Project: '+item.project,'Reference: '+item.type+' '+item.number,'Subject: '+item.subject,'Response required by: '+(item.due||'Not set'),'','Question / request:',item.question].join('\n'));
 const files=[{name:'Question-and-review-request.txt',bytes:question,type:'text/plain'},...pdfs.map(f=>({...f,type:'application/pdf'}))];
 if(files.reduce((n,f)=>n+f.bytes.length,0)>18*1024*1024)throw new Error('Attachments exceed 18 MiB; split or reduce the PDFs before sending');
 const lines=['From: '+sender,'To: '+route.to.join(', '),...(route.cc.length?['Cc: '+route.cc.join(', ')]:[]),'Reply-To: '+sender,'Message-ID: <'+eventKey+'@project-desk.raptstudio.com>','Subject: =?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?=','MIME-Version: 1.0','Content-Type: multipart/mixed; boundary="'+boundary+'"','','--'+boundary,'Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',enc(body)];
 for(const file of files){
  const name=String(file.name||'Review.pdf').replace(/[^A-Za-z0-9._ ()-]/g,'_').slice(0,160);
  lines.push('--'+boundary,'Content-Type: '+file.type+'; name="'+name+'"','Content-Disposition: attachment; filename="'+name+'"','Content-Transfer-Encoding: base64','',enc(file.bytes));
 }
 lines.push('--'+boundary+'--','');
 return Buffer.from(lines.join('\r\n')).toString('base64url');
}
async function processConsultantAssignments({items,rows,cfg,zapier,ledger,save,now,start}){
 const summary={enabled:cfg.consultantEmailEnabled===true,sent:0,held:0,manualVerification:0};
 if(!summary.enabled||cfg.dryRun)return summary;
 if(!cfg.gmail||cfg.mailSender!=='jwilliams@raptstudio.com')return {...summary,error:'Work Gmail connection is not configured'};
 const repo='https://api.github.com/repos/AANOTHERWORLD/intuit-project-desk';
 const read=async(url,connection)=>{const r=await zapier.fetch(url,{connection,headers:{Accept:'application/json'}});if(!r.ok)throw new Error('Read failed '+r.status);return r.json()};
 const profile=await read('https://gmail.googleapis.com/gmail/v1/users/me/profile',cfg.gmail);
 if(profile.emailAddress?.toLowerCase()!==cfg.mailSender)throw new Error('Connected Gmail account is not the approved Work sender');
 let attempted=0;
 for(const item of items){
  if(Date.now()-start>190000||attempted>=2)break;
  const stateKey='consultant/'+item.id,prior=ledger.get(stateKey)?.v;
  if(['Closed','Returned to GC','Ready to return'].includes(item.status))continue;
  const team=normalizeConsultant(item.consultant);
  if(!team){if(!item.consultant&&prior?.team)await save(stateKey,{team:'',generation:prior.generation||1,state:'architect-review',at:now});continue;}
  if(item.forwardedAt||prior?.team===team&&prior.state==='sent'){if(!item.consultantRespondedAt)item.status='Waiting on consultant';continue;}
  if(prior?.team===team&&['sending','uncertain'].includes(prior.state)){summary.manualVerification++;continue;}
  attempted++;
  const generation=prior?.team===team?(prior.generation||1):(prior?.generation||0)+1;
  const eventKey=createHash('sha256').update(item.id+':'+team+':'+generation).digest('hex');
  const base={team,generation,eventKey,at:now};
  let claimed=false;
  try{
   const route=routeFor(cfg,item.project,team);
   const row=rows.find(r=>r.item.id===item.id);if(!row?.pdfs?.length)throw new Error('No current PDF attached; email is held');
   const pdfs=[];let total=0;
   for(const attachment of row.pdfs){
    const info=await read('https://api.smartsheet.com/2.0/sheets/'+row.sheet+'/attachments/'+attachment.id,cfg.smartsheet);
    if(!info.url||new URL(info.url).protocol!=='https:'||info.attachmentType!=='FILE')throw new Error('PDF download is unavailable');
    const response=await fetch(info.url);if(!response.ok)throw new Error('PDF download failed');
    if(Number(response.headers.get('content-length')||0)>18*1024*1024-total)throw new Error('PDF attachments exceed email limit');
    const bytes=Buffer.from(await response.arrayBuffer());total+=bytes.length;
    if(total>18*1024*1024||!bytes.length||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('Invalid or oversized PDF attachment');
    pdfs.push({name:info.name||attachment.name,bytes});
   }
   const raw=buildReviewEmail({item,team,route,pdfs,eventKey,sender:cfg.mailSender});
   // Atomic GitHub create prevents overlapping Zap runs from sending the same event twice.
   const claim=await zapier.fetch(repo+'/contents/data/notification-claims/'+eventKey+'.json',{connection:cfg.github,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch:'main',message:'Claim consultant assignment notification',content:Buffer.from(JSON.stringify({state:'claimed',at:now})).toString('base64')})});
   if(claim.status===422||claim.status===409){await save(stateKey,{...base,state:'uncertain',reason:'Notification already claimed; check Sent mail before retrying'});summary.manualVerification++;continue;}
   if(!claim.ok)throw new Error('Could not claim notification '+claim.status);
   const claimResult=await claim.json();if(!claimResult.commit?.sha)throw new Error('Notification claim not confirmed');
   claimed=true;
   await save(stateKey,{...base,state:'sending'});
   const confirmation=await uploadReviewMime({raw,zapier,connection:cfg.gmail});
   await save(stateKey,{...base,state:'sent',messageId:confirmation.id});summary.sent++;item.status='Waiting on consultant';
  }catch(error){
   await save(stateKey,{...base,state:claimed?'uncertain':'held',reason:String(error.message).slice(0,160)});
   if(claimed)summary.manualVerification++;else summary.held++;
  }
 }
 return summary;
}

// Keep each authenticated request small while preserving the complete MIME message.
// On ambiguous failures, the caller retains its notification claim for manual review.
async function uploadReviewMime({raw,zapier,connection,resource='messages/send',uploadFetch=fetch}){
 if(!['messages/send','drafts'].includes(resource))throw new Error('Unsupported Gmail upload resource');
 const mime=Buffer.from(raw,'base64url');
 const init=await zapier.fetch('https://www.googleapis.com/upload/gmail/v1/users/me/'+resource+'?uploadType=resumable',{connection,method:'POST',headers:{'Content-Type':'application/json','X-Upload-Content-Type':'message/rfc822','X-Upload-Content-Length':String(mime.length)},body:'{}'});
 if(!init.ok)throw new Error('Email upload initialization failed '+init.status);
 const session=init.headers.get('location');
 let url;try{url=new URL(session)}catch{throw new Error('Email upload session missing')}
 if(url.protocol!=='https:'||!['www.googleapis.com','gmail.googleapis.com'].includes(url.hostname)||!url.pathname.startsWith('/upload/gmail/'))throw new Error('Unexpected Gmail upload destination');
 const chunkSize=512*1024;
 let offset=0;
 while(offset<mime.length){
  const end=Math.min(offset+chunkSize,mime.length);
  const part=mime.subarray(offset,end);
  // This MIME builder encodes every body and subject, so transport bytes are ASCII.
  const body=part.toString('ascii');if(!Buffer.from(body,'ascii').equals(part))throw new Error('MIME transport must be ASCII');
  const response=await uploadFetch(session,{method:'PUT',redirect:'manual',headers:{'Content-Type':'message/rfc822','Content-Length':String(part.length),'Content-Range':'bytes '+offset+'-'+(end-1)+'/'+mime.length},body});
  if(response.status===308){
   const match=/^(?:bytes=)?0-(\d+)$/.exec(response.headers.get('range')||'');
   const next=match?Number(match[1])+1:0;
   if(next<=offset||next>end||next>=mime.length)throw new Error('Email upload acknowledgement invalid');
   offset=next;continue;
  }
  if(!response.ok)throw new Error('Email upload unconfirmed '+response.status);
  if(end!==mime.length)throw new Error('Premature email upload completion');
  const result=await response.json();if(!result.id)throw new Error('Email upload did not return an id');
  return result;
 }
 throw new Error('Email upload completion unconfirmed');
}




const isComplete=item=>['Closed','Returned to GC'].includes(item.status);
function sourceWorkflow(c,s,old={}){
 const checked=c[s.closed]===true||String(c[s.closed]).toLowerCase()==='true';
 const date=String(c[s.returned]||'').trim();
 const response=String(c['Submittal Response']||'').trim().toUpperCase();
 // Explicit dispositions represent a returned review, not necessarily approval.
 const returned=s.type==='Submittal'&&['RNR','RR','AN','A','APPROVED','APPROVED AS NOTED','REVIEWED','REVIEWED AS NOTED','REVISE AND RESUBMIT','REJECTED','NO EXCEPTIONS TAKEN'].includes(response);
 const status=checked?'Closed':date||returned?'Returned to GC':['In review','Waiting on consultant','Ready to return'].includes(old.status)?old.status:old.owner?'In review':'To assign';
 return {status,completionMethod:checked?'Smartsheet approval/closed':date?'Smartsheet response date':returned?'Smartsheet response disposition':''};
}
function applyCompletion(item,override){
 item.manualComplete=override?.complete===true;
 if(item.manualComplete){item.status='Closed';item.completionMethod='Manual override';item.completedAt=override.at;}
 if(isComplete(item))item.nextAction='';
 return item;
}
const repo='https://api.github.com/repos/AANOTHERWORLD/intuit-project-desk/contents/';
async function readOverrides(zapier,cfg){
 const r=await zapier.fetch(repo+'data/completion-overrides.json?ref=main',{connection:cfg.github});
 if(!r.ok)throw new Error('Completion overrides unavailable '+r.status);
 const file=await r.json(),data=JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString());
 if(data.schemaVersion!==1||!data.items||Array.isArray(data.items))throw new Error('Invalid completion overrides');
 return {file,data};
}
async function writeCompletion({zapier,cfg,itemId,complete,now}){
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
function matchesItem(subject,item,allItems){
 const text=norm(subject),project=item.project==='Santa Monica'?/\b(santa monica|intuit sm|store 34)\b/:/\b(chicago|tribune|store 39)\b/;
 if(!project.test(text))return false;
 const number=norm(item.number).replace(/^rfi /,'');
 if(item.type==='RFI'&&/^\d+(?: \d+)*$/.test(number))return new RegExp('\\brfi '+number+'\\b(?! \\d)').test(text);
 // Row numbers / N/A are not source submittal identifiers. Require a unique subject.
 const title=norm(item.subject);
 return title.length>=8&&(' '+text+' ').includes(' '+title+' ')&&allItems.filter(x=>x.project===item.project&&x.type===item.type&&norm(x.subject)===title).length===1;
}
async function reviewMailbox({items,cfg,zapier,ledger,save,now}){
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
function closureTransition(previous,item,now){
 const complete=isComplete(item);
 if(!previous)return {complete,generation:0}; // Baseline: no historical mail.
 if(previous.complete===complete)return previous;
 return {complete,generation:(previous.generation||0)+(complete?1:0),...(complete?{pending:true,at:now,method:item.completionMethod||'Smartsheet'}:{})};
}
async function notifyClosures({items,cfg,zapier,ledger,save,now}){
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

const zapier=createZapierSdk();
const sources=[{id:'5052138748071812',type:'RFI',question:'Question:',subject:'RFI Subject',number:'RFI #',discipline:'Questions for:',due:'Response Required by:',closed:'RFI Closed',returned:'Arch. Response Submitted Date'},{id:'2468986770902916',type:'Submittal',question:'Question/Comment/Request:',subject:'Submittal Name',number:"Submittal Reference (ie. R1 to 'Submittal Name')",discipline:'Submittal Review for:',due:'Response Required By Date',closed:'Submittal Approved',returned:'Date of Response'}];
const folders={'Chicago':{RFI:'425238666442',Submittal:'425239435132'},'Santa Monica':{RFI:'388984137557',Submittal:'388985111314'}};
export default async function main({inputData}){
 const cfg=JSON.parse(inputData.config_json||'{}');for(const k of ['smartsheet','github','box','ledger'])if(!cfg[k])throw new Error('Missing config '+k);
 const completionAction=['Mark complete','Remove completion override'].includes(String(inputData.consultant_team||'').trim());
 const requestedId=String(inputData.item_id||'').trim(),requestedChoice=String(inputData.consultant_team||'').trim(),requestedTeam=requestedChoice==='Architect review only'?'':normalizeConsultant(requestedChoice);if(!/^item-[a-f0-9]{24}$/.test(requestedId))throw new Error('Select a valid item from Project Desk');if(!completionAction&&requestedChoice!=='Architect review only'&&!requestedTeam)throw new Error('Choose a listed consultant team');function applyAssignment(item){if(completionAction)return;if(['Closed','Returned to GC'].includes(item.status))throw new Error('This item is closed; no assignment was saved');if(requestedTeam)routeFor(cfg,item.project,requestedTeam);item.consultant=requestedTeam;item.status='In review';item.forwardedAt='';item.consultantRespondedAt=''}
 const start=Date.now(),now=new Date().toISOString(),base='https://api.github.com/repos/AANOTHERWORLD/intuit-project-desk/contents/data/register.json';
 async function get(url,connection,init={}){const r=await zapier.fetch(url,{...init,connection,headers:{Accept:'application/json',...(init.headers||{})}});if(!r.ok)throw new Error(new URL(url).hostname+' returned '+r.status);return r.json()}
 const priorFile=await get(base+'?ref=main',cfg.github),prior=JSON.parse(Buffer.from(priorFile.content.replace(/\s/g,''),'base64').toString('utf8'));
 const sheets=await Promise.all(sources.map(s=>get('https://api.smartsheet.com/2.0/sheets/'+s.id+'?include=attachments',cfg.smartsheet)));
 const items=[],rows=[];
 for(let i=0;i<sources.length;i++){
  const s=sources[i],sheet=sheets[i];if(String(sheet.id)!==s.id||!Array.isArray(sheet.rows)||Number(sheet.totalRowCount??sheet.rows.length)>sheet.rows.length)throw new Error('Incomplete or unexpected source');
  const cols=new Map(sheet.columns.map(c=>[String(c.id),c.title.trim()]));for(const title of ['Location Number & Name',s.subject,s.question,s.closed,s.returned,s.due,s.discipline,...(s.type==='Submittal'?['Submittal Response']:[])])if(![...cols.values()].includes(title))throw new Error('Missing source field '+title);
  for(const row of sheet.rows){const c=Object.fromEntries(row.cells.map(v=>[cols.get(String(v.columnId)),v.displayValue??v.value??'']));const location=String(c['Location Number & Name']||'');const project=/^34\s/.test(location)&&/Santa Monica/i.test(location)?'Santa Monica':/^39\s/.test(location)&&/Tribune/i.test(location)?'Chicago':null;if(!project||!c[s.subject])continue;
   const id='item-'+createHash('sha256').update(s.id+':'+row.id).digest('hex').slice(0,24),subject=String(c[s.subject]),number=String(c[s.number]||'').trim()||(s.type==='Submittal'?'Row '+row.rowNumber:'');if(!number)throw new Error('Missing RFI number');
   const old=prior.items?.find(x=>x.id===id||x.id==='ss-'+s.id+'-'+row.id)||prior.items?.find(x=>x.project===project&&x.type===s.type&&x.subject===subject);
   const closed=c[s.closed]===true||String(c[s.closed]).toLowerCase()==='true',owner=String(old?.owner||'');
   const sourceState=sourceWorkflow(c,s,old||{}),status=sourceState.status;
   const pdfs=(row.attachments||[]).filter(a=>a.attachmentType==='FILE'&&(/\.pdf$/i.test(a.name)||a.mimeType==='application/pdf'));
   const item={...sourceState,forwardedAt:old?.forwardedAt||'',consultantRespondedAt:old?.consultantRespondedAt||'',id,project,type:s.type,number,subject,question:String(c[s.question]??''),discipline:String(c[s.discipline]||''),due:String(c[s.due]||'').slice(0,10),received:String(c['Form Date Field']||row.createdAt||'').slice(0,10),status,priority:String(c.Priority||'Medium'),owner,consultant:String(old?.consultant||''),nextAction:closed?'':old?.nextAction||'Assign a reviewer and record the next action.',sourceDate:row.modifiedAt||row.createdAt||now,detectedAt:old?.detectedAt||now,triagedAt:old?.triagedAt||'',importedBaseline:old?.importedBaseline??!prior.lastSuccessfulSyncAt,pdfTotal:pdfs.length,pdfFiled:0,pdfStatus:pdfs.length?'Pending verification':'No PDF attached'};
   items.push(item);rows.push({item,row,sheet:s.id,version:String(sheet.version),pdfs});
  }
 }
 if(!items.length)throw new Error('Refusing to publish an empty register');const requestedItem=items.find(x=>x.id===requestedId);if(!requestedItem)throw new Error('Item not found in current Smartsheet register');if(completionAction&&!cfg.dryRun)await writeCompletion({zapier,cfg,itemId:requestedId,complete:requestedChoice==='Mark complete',now});applyAssignment(requestedItem);
 const ledger=new Map();for await(const page of zapier.listTableRecords({table:cfg.ledger,keyMode:'names',pageSize:1000,maxItems:10000}).pages()){for(const r of page.data)if(r.data.sourceKey&&r.data.payload){let value;try{value=JSON.parse(r.data.payload)}catch{if(!String(r.data.sourceKey).startsWith('root/'))throw new Error('Filing verification ledger is invalid');value=null}ledger.set(r.data.sourceKey,{id:r.id,v:value})};if(page.nextCursor&&ledger.size>=10000)throw new Error('Ledger read incomplete')}
 async function save(key,v){if(JSON.stringify(v).length>10000)throw new Error('Ledger record exceeds safe field capacity');const old=ledger.get(key),record={data:{sourceKey:key,payload:JSON.stringify(v)}};const r=old?await zapier.updateTableRecords({table:cfg.ledger,records:[{id:old.id,...record}]}):await zapier.createTableRecords({table:cfg.ledger,records:[record]});if(!r.data?.[0]?.id)throw new Error('Ledger write not confirmed');ledger.set(key,{id:r.data[0].id,v})}
 const initialOverrides=await readOverrides(zapier,cfg);
 for(const item of items)applyCompletion(item,initialOverrides.data.items[item.id]);
 let emailReview;
 try{emailReview=await reviewMailbox({items,cfg,zapier,ledger,save,now})}catch(e){emailReview={error:String(e.message).slice(0,160)}}
 async function list(folder){let marker='',all=[];do{const q=new URLSearchParams({usemarker:'true',limit:'1000',fields:'id,type,name,sha1,size'});if(marker)q.set('marker',marker);const r=await get('https://api.box.com/2.0/folders/'+folder+'/items?'+q,cfg.box);all.push(...r.entries);marker=r.next_marker||'';if(all.length>5000)throw new Error('Folder read bound exceeded')}while(marker);return all}
 const clean=s=>String(s).replace(/[\/\\\x00-\x1f]/g,' ').trim().replace(/[. ]+$/,'').slice(0,220)||'Untitled';
 async function folder(parent,name){let matches=(await list(parent)).filter(f=>f.type==='folder'&&f.name===name);if(matches.length>1)throw new Error('Ambiguous folder');if(matches.length)return matches[0].id;const r=await zapier.fetch('https://api.box.com/2.0/folders',{connection:cfg.box,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,parent:{id:String(parent)}})});if(r.status===409){const f=(await list(parent)).find(f=>f.type==='folder'&&f.name===name);if(f)return f.id}if(!r.ok)throw new Error('Folder creation failed '+r.status);return (await r.json()).id}
 let copied=0,duplicates=0,failed=0,backlog=false,attempted=0;const failures=[];
 if(cfg.copyPDFs&&!cfg.dryRun){
  const ordered=[...rows].sort((a,b)=>Number(a.item.status==='Closed')-Number(b.item.status==='Closed')||b.item.sourceDate.localeCompare(a.item.sourceDate));
  outer:for(const entry of ordered){for(const a of entry.pdfs){if(attempted>=Number(cfg.maxCopies??6)||Date.now()-start>240000){backlog=true;break outer}const rootKey='root/'+entry.sheet+'/'+entry.row.id+'/'+a.id;
   try{const previous=ledger.get(rootKey)?.v;let versions=previous?.sheetVersion===entry.version?previous.versions:null;
    if(!versions){const v=await get('https://api.smartsheet.com/2.0/sheets/'+entry.sheet+'/attachments/'+a.id+'/versions?includeAll=true',cfg.smartsheet);if(!Array.isArray(v.data)||!v.data.length||v.data.length>100)throw new Error('Invalid version list');versions=v.data.map(v=>({id:String(v.id),name:v.name||a.name,createdAt:v.createdAt||''}))}
    for(const v of versions){const key='pdf/'+entry.sheet+'/'+entry.row.id+'/'+v.id;if(ledger.get(key)?.v?.boxFile)continue;if(attempted>=Number(cfg.maxCopies??6)||Date.now()-start>240000){backlog=true;break}
     if(prior.lastSuccessfulSyncAt&&v.createdAt>prior.lastSuccessfulSyncAt&&entry.item.status!=='Closed'){entry.retriage=true;entry.item.triagedAt=''}
     attempted++;const info=await get('https://api.smartsheet.com/2.0/sheets/'+entry.sheet+'/attachments/'+v.id,cfg.smartsheet);if(!info.url||info.attachmentType!=='FILE'||new URL(info.url).protocol!=='https:')throw new Error('No downloadable PDF');
     const download=await fetch(info.url);if(!download.ok)throw new Error('PDF download failed');if(Number(download.headers.get('content-length')||0)>31457280)throw new Error('PDF exceeds size bound');const bytes=Buffer.from(await download.arrayBuffer());if(!bytes.length||bytes.length>31457280||!bytes.subarray(0,1024).includes(Buffer.from('%PDF-')))throw new Error('Invalid PDF bytes');const hash=createHash('sha1').update(bytes).digest('hex'),root=folders[entry.item.project][entry.item.type];
     const search=new URLSearchParams({query:String(info.name||v.name),ancestor_folder_ids:root,type:'file',file_extensions:'pdf',content_types:'name',fields:'id,name,sha1,size,parent',limit:'100'});const found=await get('https://api.box.com/2.0/search?'+search,cfg.box);if(Number(found.total_count)>100)throw new Error('Duplicate search requires manual review');let boxFile=found.entries?.find(f=>f.sha1===hash&&Number(f.size)===bytes.length)?.id;
     if(boxFile){const matched=found.entries.find(f=>String(f.id)===String(boxFile));const originalName=clean(info.name||v.name);if(matched.name===originalName+'.pdf'&&matched.parent?.name===v.id+'-'+hash.slice(0,12))await get('https://api.box.com/2.0/files/'+boxFile,cfg.box,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:originalName})});duplicates++}else{const ref=entry.item.type==='RFI'?entry.item.number.replace(/\s+/g,''):'SUB-'+entry.row.id;const itemName=clean(ref+' '+entry.item.subject);const matching=(await list(root)).filter(f=>f.type==='folder'&&(f.name===itemName||entry.item.type==='RFI'&&f.name.toUpperCase().startsWith(ref.toUpperCase()+' ')));if(matching.length>1)throw new Error('Ambiguous item folder');const itemFolder=matching[0]?.id||await folder(root,itemName),incoming=await folder(itemFolder,'01 Incoming'),capture=await folder(incoming,v.id+'-'+hash.slice(0,12)),name=clean(info.name||v.name);let file=(await list(capture)).find(f=>f.type==='file'&&(f.name===name||f.sha1===hash&&Number(f.size)===bytes.length));
      if(file){if(file.sha1!==hash||Number(file.size)!==bytes.length)throw new Error('Capture content conflict');if(file.name!==name)await get('https://api.box.com/2.0/files/'+file.id,cfg.box,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});duplicates++}else{const fresh=await get('https://api.smartsheet.com/2.0/sheets/'+entry.sheet+'/attachments/'+v.id,cfg.smartsheet);await zapier.runAction({app:'box',actionType:'write',action:'file',connection:cfg.box,inputs:{folder:String(capture),file:fresh.url,name:name.replace(/\.pdf$/i,''),share:'none'},timeoutSeconds:120});file=(await list(capture)).find(f=>f.type==='file'&&(f.name===name||f.sha1===hash&&Number(f.size)===bytes.length));if(!file||file.sha1!==hash||Number(file.size)!==bytes.length)throw new Error('Upload verification failed');if(file.name!==name)await get('https://api.box.com/2.0/files/'+file.id,cfg.box,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});copied++}boxFile=file.id;
     }
     await save(key,{hash,boxFile:String(boxFile),at:now});
    }
    if(previous?.sheetVersion!==entry.version||JSON.stringify(previous.versions)!==JSON.stringify(versions))await save(rootKey,{sheetVersion:entry.version,versions});
   }catch(e){failed++;failures.push({rowId:String(entry.row.id),attachmentId:String(a.id),error:String(e.message).slice(0,160)})}
  }}
 }
 for(const entry of rows){entry.item.pdfFiled=entry.pdfs.filter(a=>{const s=ledger.get('root/'+entry.sheet+'/'+entry.row.id+'/'+a.id)?.v;return s?.sheetVersion===entry.version&&s.versions?.length&&s.versions.every(v=>ledger.get('pdf/'+entry.sheet+'/'+entry.row.id+'/'+v.id)?.v?.boxFile)}).length;entry.item.pdfStatus=!entry.pdfs.length?'No PDF attached':entry.item.pdfFiled===entry.pdfs.length?'Verified in Box':'Pending filing or verification'}
 const payload={schemaVersion:1,source:'Smartsheet API',syncConnected:cfg.automationEnabled===true,sourceUpdatedAt:now,lastSuccessfulSyncAt:now,refreshIntervalMinutes:60,filing:{connected:cfg.copyPDFs===true&&!cfg.dryRun,backfillPending:items.some(x=>x.pdfFiled<x.pdfTotal),failedThisRun:failed},items:items.sort((a,b)=>a.project.localeCompare(b.project)||a.type.localeCompare(b.type)||a.number.localeCompare(b.number,undefined,{numeric:true}))};
 const allowed=new Set(['completionMethod','manualComplete','completedAt','forwardedAt','consultantRespondedAt','id','project','type','number','subject','question','discipline','due','received','status','priority','owner','consultant','nextAction','sourceDate','detectedAt','triagedAt','importedBaseline','pdfTotal','pdfFiled','pdfStatus']);
 function validate(){const ids=new Set();for(const item of payload.items){if(ids.has(item.id))throw new Error('Duplicate row id');ids.add(item.id);for(const key of Object.keys(item))if(!allowed.has(key))throw new Error('Private field rejected');if(/https?:\/\//i.test([item.owner,item.consultant,item.nextAction].join(' ')))throw new Error('Private links cannot be published in coordination fields')}}
 let consultantEmail;
 if(!cfg.dryRun)try{consultantEmail=await processConsultantAssignments({items:completionAction?[]:items.filter(x=>x.id===requestedId),rows,cfg,zapier,ledger,save,now,start})}catch(e){consultantEmail={error:String(e.message).slice(0,160)}}
 validate();
 if(cfg.dryRun)return {published:false,dryRun:true,assignment:{itemId:requestedId,team:requestedTeam||'Architect review'},records:items.length,questionsWithText:items.filter(x=>x.question.trim()).length,active:items.filter(x=>!isComplete(x)).length,pdfs:rows.reduce((n,r)=>n+r.pdfs.length,0),counts:items.reduce((c,x)=>(c[x.project+' '+x.type]=(c[x.project+' '+x.type]||0)+1,c),{})};
 for(let attempt=0;attempt<3;attempt++){const file=await get(base+'?ref=main',cfg.github),current=JSON.parse(Buffer.from(file.content.replace(/\s/g,''),'base64').toString('utf8'));const freshOverrides=await readOverrides(zapier,cfg);for(const item of payload.items){applyCompletion(item,freshOverrides.data.items[item.id]);const old=current.items?.find(x=>x.id===item.id);if(old)for(const k of (item.id===requestedId&&!completionAction?['owner','triagedAt']:item.forwardedAt?['owner','triagedAt']:['owner','consultant','nextAction','triagedAt']))if(Object.hasOwn(old,k))item[k]=String(old[k]||'');if(isComplete(item))item.nextAction='';if(!item.owner||!item.nextAction||rows.find(r=>r.item.id===item.id)?.retriage)item.triagedAt=''}validate();const r=await zapier.fetch(base,{connection:cfg.github,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch:'main',sha:file.sha,message:'Sync Intuit register from Smartsheet',content:Buffer.from(JSON.stringify(payload,null,2)+'\n').toString('base64')})});if((r.status===409||r.status===422)&&attempt<2)continue;if(!r.ok)throw new Error('Publishing failed '+r.status);const confirm=await r.json();if(!confirm.commit?.sha)throw new Error('Publish unconfirmed');let closureEmail;try{closureEmail=await notifyClosures({items:payload.items,cfg,zapier,ledger,save,now})}catch(e){closureEmail={error:String(e.message).slice(0,160)}}return {published:true,consultantEmail,closureEmail,emailReview,commit:confirm.commit.sha,records:items.length,questionsWithText:items.filter(x=>x.question.trim()).length,active:items.filter(x=>!isComplete(x)).length,copied,duplicates,failed,backfillPending:payload.filing.backfillPending,failures}}
}
