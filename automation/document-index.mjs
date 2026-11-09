// Build links from the same verified ledger used for the PDF filing count.
function documentIndex(rows,ledger,now){
 const index={schemaVersion:1,indexedAt:now,items:{}};
 for(const entry of rows){
  const files=new Map();
  for(const attachment of entry.pdfs){
   const root=ledger.get('root/'+entry.sheet+'/'+entry.row.id+'/'+attachment.id)?.v;
   for(const version of root?.versions||[]){
    const id=String(ledger.get('pdf/'+entry.sheet+'/'+entry.row.id+'/'+version.id)?.v?.boxFile||'');
    if(/^\d+$/.test(id))files.set(id,{id,name:String(version.name||attachment.name||'PDF attachment')});
   }
  }
  index.items[entry.item.id]={files:[...files.values()]};
 }
 return index;
}
async function publishDocumentIndex({rows,ledger,now,cfg,zapier}){
 const index=documentIndex(rows,ledger,now);
 const url='https://api.github.com/repos/AANOTHERWORLD/intuit-project-desk/contents/data/documents.json';
 for(let attempt=0;attempt<3;attempt++){
  const response=await zapier.fetch(url+'?ref=main',{connection:cfg.github});
  if(!response.ok&&response.status!==404)throw new Error('Document index read failed '+response.status);
  const prior=response.status===404?{}:await response.json();
  const result=await zapier.fetch(url,{connection:cfg.github,method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branch:'main',...(prior.sha?{sha:prior.sha}:{}),message:'Sync verified Box PDF links',content:Buffer.from(JSON.stringify(index,null,2)+'\n').toString('base64')})});
  if([409,422].includes(result.status)&&attempt<2)continue;
  if(!result.ok)throw new Error('Document index publish failed '+result.status);
  const saved=await result.json();if(!saved.commit?.sha)throw new Error('Document index publish unconfirmed');
  return {published:true,records:Object.keys(index.items).length,files:Object.values(index.items).reduce((n,x)=>n+x.files.length,0),commit:saved.commit.sha};
 }
}

export {documentIndex,publishDocumentIndex};
