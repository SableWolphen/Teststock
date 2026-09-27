const minutesBetween=(now,value)=>{
  const stamp=Date.parse(value||'');
  return Number.isFinite(stamp)?Math.max(0,(now-stamp)/60000):Infinity;
};

export function evaluateRunnerHealth({workflowRuns=[],heartbeat=null,now=Date.now()}={}){
  if(heartbeat?.state==='ACTIVE'){
    const ageMinutes=minutesBetween(now,heartbeat.updatedAt);
    if(ageMinutes<=3)return {state:'ACTIVE',healthy:true,source:'PRIVATE_RUNTIME_HEARTBEAT',ageMinutes};
    return {state:'STALE_HEARTBEAT',healthy:false,source:'PRIVATE_RUNTIME_HEARTBEAT',ageMinutes};
  }

  const runs=[...(workflowRuns||[])].sort((a,b)=>Date.parse(b.updated_at||b.created_at||0)-Date.parse(a.updated_at||a.created_at||0));
  const active=runs.find(x=>['queued','in_progress','waiting','requested','pending'].includes(x.status));
  if(active){
    const ageMinutes=minutesBetween(now,active.updated_at||active.created_at);
    if(ageMinutes<=70)return {state:'ACTIVE',healthy:true,source:'GITHUB_ACTIONS',ageMinutes,runId:active.id??null,runUrl:active.html_url??null};
  }

  const completed=runs.find(x=>x.status==='completed');
  if(!completed)return {state:'UNKNOWN',healthy:false,source:'GITHUB_ACTIONS',ageMinutes:null};
  const ageMinutes=minutesBetween(now,completed.updated_at||completed.created_at);
  if(completed.conclusion==='success'&&ageMinutes<=75){
    return {state:'RECENTLY_COMPLETED',healthy:true,source:'GITHUB_ACTIONS',ageMinutes,runId:completed.id??null,runUrl:completed.html_url??null};
  }
  return {
    state:ageMinutes>75?'STALE':String(completed.conclusion||'FAILED').toUpperCase(),
    healthy:false,
    source:'GITHUB_ACTIONS',
    ageMinutes,
    runId:completed.id??null,
    runUrl:completed.html_url??null,
  };
}
