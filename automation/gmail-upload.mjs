// Keep each authenticated request small while preserving the complete MIME message.
// On ambiguous failures, the caller retains its notification claim for manual review.
export async function uploadReviewMime({raw,zapier,connection,resource='messages/send',uploadFetch=fetch}){
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



