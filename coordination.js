(function(root){
 'use strict';
 const teams=['MEP Engineers','Structural engineer','Lighting','Landscape','AV','AV - Computacenter'];
 const aliases={'mep':'MEP Engineers','mep engineer':'MEP Engineers','mep engineers':'MEP Engineers','structural':'Structural engineer','structural engineer':'Structural engineer','lighting':'Lighting','landscape':'Landscape','av':'AV','av - bugid':'AV','av - computacenter':'AV - Computacenter'};
 function teamFor(value){return aliases[String(value||'').trim().toLowerCase()]||''}
 function workflowLabel(item){
  if(item.manualComplete)return 'Complete · manual override';
  if(item.status==='Returned to GC')return 'Returned to GC';
  if(item.status==='Closed')return 'Closed';
  if(item.consultantRespondedAt)return 'Response received · architect review';
  if(item.status==='Ready to return')return 'Ready to return';
  const team=teamFor(item.consultant);
  return team?(item.status==='Waiting on consultant'?'Waiting on '+team:'Pending forwarding · '+team):'Architect review';
 }
 function assignmentFields(team){
  if(team&&!teams.includes(team))throw new Error('Choose a listed consultant team.');
  return {consultant:team,status:team?'Waiting on consultant':'In review'};
 }
 root.ProjectDeskCoordination={teams,teamFor,workflowLabel,assignmentFields};
})(typeof window==='undefined'?globalThis:window);
