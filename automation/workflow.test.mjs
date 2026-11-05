import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sourceWorkflow,applyCompletion,matchesItem,closureTransition,notifyClosures,writeCompletion,reviewMailbox} from './workflow.mjs';
const source={type:'Submittal',closed:'Approved',returned:'Date'};
test('returned RNR review clears queue without claiming approval',()=>{
 assert.equal(sourceWorkflow({'Submittal Response':'RNR'},source).status,'Returned to GC');
 assert.equal(sourceWorkflow({'Submittal Response':'Please review'},source).status,'To assign');
 assert.equal(sourceWorkflow({Date:'2026-11-02'},source).status,'Returned to GC');
 assert.equal(sourceWorkflow({Approved:true},source).status,'Closed');
});
test('manual override survives repeated source refresh and can be removed',()=>{
 const override={complete:true,at:'2026-11-05T20:00:00Z'};
 for(let i=0;i<3;i++)assert.equal(applyCompletion({...sourceWorkflow({},source)},override).status,'Closed');
 assert.equal(applyCompletion({...sourceWorkflow({},source)},{complete:false}).status,'To assign');
 assert.equal(applyCompletion({...sourceWorkflow({Date:'2026-11-02'},source)},{complete:false}).status,'Returned to GC');
});
test('mail matching requires project and exact RFI boundary or unique submittal subject',()=>{
 const item={project:'Santa Monica',type:'RFI',number:'72'};
 assert.equal(matchesItem('Intuit SM RFI 72 - urgent',item,[item]),true);
 assert.equal(matchesItem('Chicago RFI 72',item,[item]),false);
 assert.equal(matchesItem('Intuit SM RFI 720',item,[item]),false);
 const sub={project:'Santa Monica',type:'Submittal',number:'N/A',subject:'Fire Alarm Plans'};
 assert.equal(matchesItem('Santa Monica Fire Alarm Plans',sub,[sub]),true);
 assert.equal(matchesItem('Santa Monica Fire Alarm Plans',sub,[sub,{...sub}]),false);
});
test('closure baseline suppresses history, duplicate syncs and returned-to-closed transition',()=>{
 const baseline=closureTransition(null,{status:'Returned to GC'},'now');
 assert.equal(baseline.pending,undefined);
 assert.deepEqual(closureTransition(baseline,{status:'Closed'},'later'),baseline);
 const open=closureTransition(baseline,{status:'In review'},'later');
 const closed=closureTransition(open,{status:'Closed'},'later');
 assert.equal(closed.pending,true);assert.equal(closed.generation,1);
 assert.deepEqual(closureTransition(closed,{status:'Closed'},'later'),closed);
});
const response=(body,status=200)=>({ok:status<300,status,json:async()=>body});
test('closure sends once; failed confirmation cannot trigger blind resend',async()=>{
 for(const uncertain of [false,true]){
  const ledger=new Map([['closure/item-1',{v:{complete:false,generation:0}}]]);let claimed=false,sends=0;
  const save=async(k,v)=>ledger.set(k,{v});
  const zapier={fetch:async(url)=>{
   if(url.includes('notification-claims')){if(claimed)return response({},422);claimed=true;return response({commit:{sha:'ok'}});}
   sends++;return uncertain?response({},503):response({id:'sent'});
  }};
  const cfg={closureEmailEnabled:true,closureRecipientsVerified:true,closureRecipients:['one@raptstudio.com','two@raptstudio.com','three@raptstudio.com','four@raptstudio.com'],mailSender:'sender@raptstudio.com'};
  const args={items:[{id:'item-1',status:'Closed',subject:'Test'}],cfg,zapier,ledger,save,now:'2026-11-05'};
  await notifyClosures(args);await notifyClosures(args);assert.equal(sends,1);
 }
});
test('completion writes use latest SHA and preserve other users overrides on conflict',async()=>{
 let reads=0,writes=0;
 const itemId='item-'+'a'.repeat(24);
 const zapier={fetch:async(url,options)=>{
  if(options.method==='PUT'){writes++;const body=JSON.parse(options.body),data=JSON.parse(Buffer.from(body.content,'base64'));if(writes===1)return response({},409);assert.equal(body.sha,'sha2');assert.equal(data.items.other.complete,true);assert.equal(data.items[itemId].complete,true);return response({commit:{sha:'saved'}});}
  reads++;return response({sha:'sha'+reads,content:Buffer.from(JSON.stringify({schemaVersion:1,items:reads===1?{}:{other:{complete:true}}})).toString('base64')});
 }};
 await writeCompletion({zapier,cfg:{},itemId,complete:true,now:'now'});assert.equal(writes,2);
});
test('dry run cannot send closure emails',async()=>{
 await notifyClosures({items:[],cfg:{closureEmailEnabled:true,dryRun:true},zapier:{fetch:()=>assert.fail('write')}});
});
test('manual forwards and replies change status, while completed items remain untouched',async()=>{
 const item={id:'item-1',project:'Santa Monica',type:'RFI',number:'72',received:'2026-11-01',status:'To assign'};
 const closed={...item,id:'item-2',status:'Closed'};
 const cfg={emailReviewEnabled:true,mailSender:'sender@raptstudio.com',consultantRoutes:{'Santa Monica':{Structural:{verified:true,to:['engineer@example.com']}}}};
 const zapier={fetch:async url=>response(url.endsWith('profile')?{emailAddress:cfg.mailSender}:url.includes('messages?')?{messages:[{id:'sent'}]}:url.includes('messages/sent')?{id:'sent',threadId:'thread',internalDate:'1793894400000',labelIds:['SENT'],payload:{headers:[{name:'Subject',value:'Intuit SM RFI 72'},{name:'To',value:'engineer@example.com'}]}}:{messages:[{id:'reply',internalDate:'1793980800000',payload:{headers:[{name:'From',value:'Engineer <engineer@example.com>'}]}}]})};
 await reviewMailbox({items:[item,closed],cfg,zapier,ledger:new Map(),save:async()=>{},now:'now'});
 assert.equal(item.status,'In review');assert.ok(item.consultantRespondedAt);assert.equal(closed.status,'Closed');
});

