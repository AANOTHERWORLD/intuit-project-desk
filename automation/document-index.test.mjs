import {test} from 'node:test';
import assert from 'node:assert/strict';
import {documentIndex,publishDocumentIndex} from './document-index.mjs';
const rows=[{item:{id:'rfi-77'},sheet:'s',row:{id:'r'},pdfs:[{id:'a',name:'Current.pdf'}]}];
const ledger=new Map([['root/s/r/a',{v:{versions:[{id:'v1',name:'Original.pdf'},{id:'v2',name:'Reviewed.pdf'},{id:'v3'},{id:'v4'},{id:'v5'}]}}],['pdf/s/r/v1',{v:{boxFile:'123',hash:'private'}}],['pdf/s/r/v2',{v:{boxFile:'456'}}],['pdf/s/r/v4',{v:{boxFile:'javascript:alert(1)'}}],['pdf/s/r/v5',{v:{boxFile:'123'}}]]);
test('links include only verified IDs, deduplicate versions and exclude private ledger data',()=>{
 const result=documentIndex(rows,ledger,'now');
 assert.deepEqual(result.items['rfi-77'].files,[{id:'123',name:'Current.pdf'},{id:'456',name:'Reviewed.pdf'}]);
 assert.equal(JSON.stringify(result).includes('private'),false);
});
test('removed attachments do not retain old links',()=>{
 assert.deepEqual(documentIndex([{...rows[0],pdfs:[]}],ledger,'now').items['rfi-77'].files,[]);
});
test('index publication retries concurrent writes and sends only document metadata',async()=>{
 let writes=0;const calls=[];
 const zapier={fetch:async(url,init)=>{calls.push(url);if(init.method!=='PUT')return {ok:true,status:200,json:async()=>({sha:'sha'+writes})};const body=JSON.parse(init.body);assert.equal(body.sha,'sha'+writes);assert.equal(JSON.parse(Buffer.from(body.content,'base64')).schemaVersion,1);writes++;return writes===1?{ok:false,status:409}:{ok:true,status:200,json:async()=>({commit:{sha:'new'}})};}};
 const result=await publishDocumentIndex({rows,ledger,now:'now',cfg:{github:'connected'},zapier});
 assert.equal(result.files,2);assert.equal(result.commit,'new');assert.equal(writes,2);assert.ok(calls.every(x=>x.includes('/contents/data/documents.json')));
});
test('unconfirmed writes fail visibly',async()=>{
 const zapier={fetch:async()=>({ok:true,status:200,json:async()=>({sha:'old'})})};
 await assert.rejects(publishDocumentIndex({rows,ledger,now:'now',cfg:{github:'connected'},zapier}),/unconfirmed/);
});

