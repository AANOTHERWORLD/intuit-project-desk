import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const code=readFileSync(new URL('../app.js',import.meta.url),'utf8');
function setup(fetch){
 const target={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}};
 const context=vm.createContext({fetch,currentItem:'rfi',items:[{id:'rfi',project:'Santa Monica',type:'RFI',pdfTotal:1}],$:id=>id==='documentLinks'?target:{hidden:false},document:{createElement:tag=>({tag,style:{},setAttribute(){}})}});
 vm.runInContext(code.slice(code.indexOf('let documents='),code.indexOf('function renderIssueContext')),context);
 return {target,context};
}
test('verified PDFs render direct Box links',async()=>{
 const {target,context}=setup(async()=>({ok:true,json:async()=>({schemaVersion:1,items:{rfi:{files:[{id:'123',name:'Door hardware.pdf'}]}}})}));
 await vm.runInContext('loadDocuments()',context);
 assert.ok(target.children.some(x=>x.href==='https://app.box.com/file/123'));
 assert.ok(target.children.some(x=>x.href==='https://app.box.com/folder/388984137557'));
});
test('missing index entry provides a working folder fallback',async()=>{
 const {target,context}=setup(async()=>({ok:true,json:async()=>({schemaVersion:1,items:{}})}));
 await vm.runInContext('loadDocuments()',context);
 assert.match(target.children[0].textContent,/syncing/);
 assert.ok(target.children.some(x=>x.href==='https://app.box.com/folder/388984137557'));
});
test('network failures are distinguishable from pending indexing',async()=>{
 const {target,context}=setup(async()=>({ok:false}));
 await vm.runInContext('loadDocuments()',context);
 assert.match(target.children[0].textContent,/could not be loaded/);
 assert.ok(target.children.some(x=>x.href==='https://app.box.com/folder/388984137557'));
});
test('invalid file IDs are never rendered as links',async()=>{
 const {target,context}=setup(async()=>({ok:true,json:async()=>({schemaVersion:1,items:{rfi:{files:[{id:'123/../../bad',name:'bad'}]}}})}));
 await vm.runInContext('loadDocuments()',context);
 assert.equal(target.children.filter(x=>x.href?.includes('/file/')).length,0);
});

