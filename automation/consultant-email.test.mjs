import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {normalizeConsultant,routeFor,buildReviewEmail,processConsultantAssignments} from './consultant-email.mjs';
const item={id:'item-a',project:'Santa Monica',type:'RFI',number:'64',subject:'Support review',question:'Confirm the support.\nPreserve this second line.',due:'2026-11-02',consultant:'MEP Engineers',status:'Waiting on consultant'};
const route={to:['reviewer@example.com'],cc:[]};
test('workflow preserves closure and defaults open items to architect review',()=>{
 const context={};vm.runInNewContext(fs.readFileSync(new URL('../coordination.js',import.meta.url),'utf8'),context);
 const c=context.ProjectDeskCoordination;
 assert.equal(c.workflowLabel({...item,consultant:''}),'Architect review');
 assert.equal(c.workflowLabel(item),'Assigned to MEP Engineers');
 assert.equal(c.workflowLabel({...item,status:'Closed'}),'Closed');
 assert.equal(c.workflowLabel({...item,status:'Returned to GC'}),'Closed');
 assert.throws(()=>c.assignmentFields('unknown'));
});
test('routes require exact project verification; unknown names do not route',()=>{
 assert.equal(normalizeConsultant('mep'),'MEP Engineers');
 assert.equal(normalizeConsultant('not a team'),'');
 assert.throws(()=>routeFor({consultantRoutes:{'Santa Monica':{'Structural engineer':{...route,verified:true}}}},'Chicago','Structural engineer'));
 assert.throws(()=>routeFor({consultantRoutes:{'Santa Monica':{AV:{to:['bad\r\nBcc: other@example.com'],verified:true}}}},'Santa Monica','AV'));
 assert.deepEqual(routeFor({consultantRoutes:{'Santa Monica':{AV:{...route,verified:true}}}},'Santa Monica','AV'),route);
});
test('MIME contains actual PDF and full question attachment with proper line endings',()=>{
 const raw=buildReviewEmail({item,team:'MEP Engineers',route,pdfs:[{name:'support.pdf',bytes:Buffer.from('%PDF-1.7\ncontent')}],eventKey:'abc',sender:'jwilliams@raptstudio.com'});
 const mime=Buffer.from(raw,'base64url').toString();
 assert.ok(mime.includes('\r\nTo: reviewer@example.com\r\n'));
 assert.ok(mime.includes('filename="support.pdf"'));
 assert.ok(mime.includes('filename="Question-and-review-request.txt"'));
 assert.ok(mime.includes(Buffer.from('%PDF-1.7\ncontent').toString('base64')));
 const parts=mime.split('--project-desk-abc');
 assert.ok(parts.map(p=>{const content=p.split('\r\n\r\n')[1];return content?Buffer.from(content.replace(/\s/g,''),'base64').toString():''}).join('\n').includes(item.question));
});
test('missing or oversized PDFs hold mail instead of silently substituting links',()=>{
 const args={item,team:'MEP Engineers',route,eventKey:'abc',sender:'jwilliams@raptstudio.com'};
 assert.throws(()=>buildReviewEmail({...args,pdfs:[]}));
 assert.throws(()=>buildReviewEmail({...args,pdfs:[{name:'large.pdf',bytes:Buffer.alloc(18*1024*1024)}]}));
});
test('disabled delivery makes no calls; sent and uncertain assignments do not resend',async()=>{
 let calls=0;const ledger=new Map();const cfg={consultantEmailEnabled:false};
 const args={items:[item],rows:[],cfg,zapier:{fetch:async()=>{calls++;return {ok:true,json:async()=>({emailAddress:'jwilliams@raptstudio.com'})}}},ledger,save:async()=>{},now:new Date().toISOString(),start:Date.now()};
 await processConsultantAssignments(args);assert.equal(calls,0);
 cfg.consultantEmailEnabled=true;cfg.gmail=1;cfg.mailSender='jwilliams@raptstudio.com';
 ledger.set('consultant/item-a',{v:{team:'MEP Engineers',state:'sent'}});
 assert.equal((await processConsultantAssignments(args)).sent,0);assert.equal(calls,1);
 ledger.set('consultant/item-a',{v:{team:'MEP Engineers',state:'uncertain'}});
 assert.equal((await processConsultantAssignments(args)).manualVerification,1);assert.equal(calls,2);
});
