import {createHash} from 'node:crypto';
// Consultant delivery helpers. Recipient addresses belong in private config_json, never this repository.
export const CONSULTANT_TEAMS=['MEP Engineers','Structural engineer','Lighting','Landscape','AV','AV - Computacenter'];
export function normalizeConsultant(value){
 const aliases={'mep':'MEP Engineers','mep engineer':'MEP Engineers','structural':'Structural engineer','av - bugid':'AV'};
 const text=String(value||'').trim();return CONSULTANT_TEAMS.find(t=>t.toLowerCase()===text.toLowerCase())||aliases[text.toLowerCase()]||'';
}
export function routeFor(cfg,project,team){
 const route=cfg.consultantRoutes?.[project]?.[team];
 if(!route||route.verified!==true||!Array.isArray(route.to)||!route.to.length)throw new Error('Consultant recipient route is not verified for this project');
 const all=[...route.to,...(route.cc||[])];
 if(all.length>12||all.some(v=>typeof v!=='string'||!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)))throw new Error('Invalid consultant recipient configuration');
 return {to:[...new Set(route.to)],cc:[...new Set(route.cc||[])]};
}
export function buildReviewEmail({item,team,route,pdfs,eventKey,sender}){
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
export async function processConsultantAssignments({items,rows,cfg,zapier,ledger,save,now,start}){
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
  if(prior?.team===team&&prior.state==='sent')continue;
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
   const sent=await zapier.fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{connection:cfg.gmail,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({raw})});
   if(!sent.ok)throw new Error('Email send unconfirmed '+sent.status);
   const confirmation=await sent.json();if(!confirmation.id)throw new Error('Email send did not return a message id');
   await save(stateKey,{...base,state:'sent',messageId:confirmation.id});summary.sent++;
  }catch(error){
   await save(stateKey,{...base,state:claimed?'uncertain':'held',reason:String(error.message).slice(0,160)});
   if(claimed)summary.manualVerification++;else summary.held++;
  }
 }
 return summary;
}
