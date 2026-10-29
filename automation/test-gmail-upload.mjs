import {test} from 'node:test';
import assert from 'node:assert/strict';
import {uploadReviewMime} from './gmail-upload.mjs';
const session='https://www.googleapis.com/upload/gmail/v1/users/me/drafts?upload_id=test';
const response=(status,headers={},body={id:'draft-test'})=>({ok:status>=200&&status<300,status,headers:new Headers(headers),json:async()=>body});
test('large MIME is uploaded in bounded chunks with identical bytes',async()=>{
 const mime=Buffer.from('A'.repeat(6*1024*1024+99));const parts=[];let offset=0;
 const zapier={fetch:async(url,opts)=>{
  if(opts.method==='POST')assert.equal(opts.connection,123);
  if(opts.method==='POST'){assert.ok(url.includes('/drafts?'));assert.equal(opts.headers['X-Upload-Content-Length'],String(mime.length));return response(200,{location:session})}
  assert.equal(url,session);assert.ok(Buffer.byteLength(opts.body)<=512*1024);
  parts.push(Buffer.from(opts.body));offset+=Buffer.byteLength(opts.body);
  return offset<mime.length?response(308,{range:'bytes=0-'+(offset-1)}):response(200);
 }};
 assert.equal((await uploadReviewMime({raw:mime.toString('base64url'),zapier,uploadFetch:zapier.fetch,connection:123,resource:'drafts'})).id,'draft-test');
 assert.deepEqual(Buffer.concat(parts),mime);
});
for(const failure of ['413','missing-range','foreign-session','missing-id'])test('fails safely: '+failure,async()=>{
 let calls=0;const zapier={fetch:async()=>{calls++;if(calls===1)return response(200,{location:failure==='foreign-session'?'https://example.com/upload/gmail/':session});return failure==='413'?response(413):failure==='missing-range'?response(308):response(200,{},{});}};
 await assert.rejects(uploadReviewMime({raw:Buffer.from('abc').toString('base64url'),zapier,uploadFetch:zapier.fetch,connection:123}));assert.ok(calls<=2);
});


