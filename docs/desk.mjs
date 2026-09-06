export const ageMinutes=(value,now=Date.now())=>{
  if(!value)return Infinity;
  const time=Date.parse(value);
  return Number.isFinite(time)&&time<=now+60000?Math.max(0,(now-time)/60000):Infinity;
};
export function entryState(event,{board={},health={}},now=Date.now()){
  if(ageMinutes(board.publishedAt,now)>15||ageMinutes(health.generatedAt,now)>5)return 'Data stale — refresh required';
  if(!['ALLOWED','REDUCED'].includes(health.newRiskPermission))return 'Entry blocked by health checks';
  if(board.monitorHealth!=='OK')return 'Monitor health requires review';
  if(event.assetClass==='STOCK'&&board.marketSession?.entryAllowed!==true)return 'Stock entry window not verified open';
  if(ageMinutes(event.stateChangedAt,now)>10)return 'Trigger expired — waiting for a fresh event';
  return /SEED/.test(event.trigger)?'Small test lane — live checks required':'Live broker checks required';
}
export function loopState(run,jobs){
  if(!run)return {label:'Unavailable',detail:'Workflow status could not be verified.'};
  const job=(jobs||[]).find(x=>x.name==='live');
  const step=job?.steps?.find(x=>x.name==='Run 45-second intraday decision loop');
  if(job?.status==='in_progress'&&step?.status==='in_progress')return {label:'Loop running',detail:'GitHub reports the decision step running. This does not prove a broker connection.'};
  if(run.status==='queued'||run.status==='pending')return {label:'Waiting to start',detail:'A workflow is queued; the trading loop is not yet confirmed running.'};
  if(run.status==='in_progress')return {label:'Starting / checking',detail:'Workflow active; no running trading loop confirmed yet.'};
  if(step?.conclusion==='skipped')return {label:'Verification only',detail:'Latest run skipped the trading loop. No active loop is shown.'};
  return {label:run.conclusion==='failure'?'Last run failed':'No active loop',detail:'Latest workflow: '+(run.conclusion||run.status)+'. Check the workflow for details.'};
}
export function stockState(board,now=Date.now()){
  if(ageMinutes(board?.publishedAt,now)>15)return 'Session data stale';
  const session=board?.marketSession;
  if(!session?.calendarAvailable)return 'Session unverified';
  return session.regularSession?(session.entryAllowed?'Entry window open':'Exits / entry cutoff'):'Market closed';
}
const esc=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const readable=value=>String(value||'Unknown').replaceAll('signalAgeMinutes','research signals').replaceAll('triggerAgeMinutes','entry triggers').replaceAll('intradayAgeMinutes','intraday prices').replaceAll('daytraderAgeMinutes','opportunity research').replaceAll('qualityAgeMinutes','trade quality data').replaceAll('_',' ').toLowerCase();
const price=value=>value!==null&&value!==undefined&&Number.isFinite(Number(value))?'$'+Number(value).toLocaleString('en-US',{maximumFractionDigits:4}):'—';
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Not available';
const age=value=>{const m=ageMinutes(value);return !Number.isFinite(m)?'Unknown':m<1?'Just now':m<60?Math.floor(m)+'m ago':m<1440?Math.floor(m/60)+'h ago':Math.floor(m/1440)+'d ago';};
if(typeof document!=='undefined'){
  const $=id=>document.getElementById(id);
  let data={},filter='ALL',lastWorkflowCheck=0,busy=false;
  const text=(id,value)=>$(id).textContent=value;
  async function json(path){const r=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw new Error('Request failed');return r.json();}
  function render(){
    const {board={},health={},admission={},watchlist={},stocks={},crypto={}}=data;
    const fresh=ageMinutes(health.generatedAt)<=5;
    text('permission',!fresh?'Snapshot stale':health.newRiskPermission==='BLOCKED'?'New entries blocked':health.newRiskPermission==='REDUCED'?'Reduced-risk checks':health.newRiskPermission==='ALLOWED'?'Research checks pass':'Unknown');
    $('permission').className=fresh&&health.newRiskPermission==='ALLOWED'?'green':'amber';
    text('permissiondetail','Health published '+age(health.generatedAt));
    text('updated','Health snapshot: '+date(health.generatedAt));
    text('notice',data.errors?.length?'Some sources are unavailable: '+data.errors.join(', ')+'. Missing evidence is not treated as a pass.':!fresh?'The published health snapshot is stale. Do not read old triggers as current trading permission.':'Showing published research and workflow evidence. Broker state is verified separately at execution.');
    text('stockstate',stockState(board));$('stockstate').className='badge '+(stockState(board)==='Entry window open'?'green':'amber');
    text('stockdetail','Session evidence '+age(board.publishedAt)+'. '+(board.marketSession?.calendarAvailable?'Regular-session calendar available. ':'Authoritative calendar unavailable in this snapshot. ')+'Saved day-trade exits still require position reconciliation.');
    const admitted=['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(admission.state)&&Number(admission.sizeMultiplier)>0;
    text('cryptostate',ageMinutes(admission.generatedAt)>30?'Admission stale':admitted?'Live checks required':'Normal entries blocked');$('cryptostate').className='badge amber';
    text('cryptodetail',(admission.reason||'Admission evidence unavailable.')+' Separately authorized small test lanes may have different eligibility; every broker and protection check still applies.');
    const events=(board.events||[]).filter(x=>/BUY_TRIGGER/.test(x.trigger));
    const shown=events.filter(x=>filter==='ALL'||x.assetClass===filter);
    text('queuecount',shown.length+' published trigger'+(shown.length===1?'':'s'));
    $('entries').innerHTML=shown.map(e=>'<article class="entry"><div class="entrytop"><strong>'+esc(e.ticker)+'</strong><small>'+esc(e.assetClass)+' · '+esc(e.entryTier||e.setupGrade||'Unrated')+'</small></div><p class="amber">'+esc(entryState(e,data))+'</p><p>Observed '+price(e.observedPrice)+' · '+esc(readable(e.trigger))+'</p>'+(e.seedLane?.maxOrderUsd?'<p>Published test-lane ceiling: '+price(e.seedLane.maxOrderUsd)+'</p>':'')+'</article>').join('')||'<p class="empty">No '+(filter==='ALL'?'':filter.toLowerCase()+' ')+'buy triggers in the available snapshot. This does not prove the market has no opportunities.</p>';
    const reasons=[...(health.reasons||[])].map(readable);
    if(!fresh)reasons.unshift('Fresh health snapshot required');
    if(ageMinutes(board.publishedAt)>15)reasons.push('Fresh trigger board required');
    if(!board.marketSession?.entryAllowed)reasons.push('Stock entry window is not verified open');
    if(!admitted)reasons.push('Normal crypto entries: '+readable(admission.state||'admission unknown'));
    reasons.push('Claude authentication, broker access and order protection must be verified at execution');
    $('blockers').innerHTML=[...new Set(reasons)].map(r=>'<li>'+esc(r)+'</li>').join('');
    $('positions').innerHTML=(watchlist.positions||[]).filter(p=>p.status==='ACTIVE').map(p=>{
      const exit=(board.events||[]).find(e=>e.ticker===p.ticker&&!/BUY/.test(e.trigger));
      return '<tr><td><strong>'+esc(p.ticker)+'</strong></td><td>'+price(p.stop)+'</td><td>'+price(p.target1)+'</td><td>'+price(p.target2)+'</td><td class="amber">'+esc(exit?readable(exit.trigger)+' · '+age(board.publishedAt):'No published exit signal')+'</td><td>'+esc(age(p.armedAt))+'</td></tr>';
    }).join('')||'<tr><td colspan="6">No active records available. Verify actual holdings in Robinhood.</td></tr>';
    const closed=[...(stocks.trades||[]),...(crypto.trades||[])].filter(t=>t.reconciledFromRobinhood===true&&['WIN','LOSS','FLAT'].includes(t.outcome));
    text('closed',data.errors?.includes('stock journal')||data.errors?.includes('crypto journal')?'Unavailable':closed.length);
    const q=health.executionQuality||{};
    text('slippage',q.sampleSize>0&&q.averageEntrySlippagePct!=null?Number(q.averageEntrySlippagePct).toFixed(3)+'%':'No evidence');
    text('protection',q.sampleSize>0&&q.protectionVerifiedPct!=null?Number(q.protectionVerifiedPct).toFixed(0)+'%':'No evidence');
    const latest=[stocks.lastReconciledAt,crypto.lastReconciledAt].filter(x=>Number.isFinite(Date.parse(x))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0];
    text('reconciled',latest?date(latest):'Not available');
  }
  async function workflow(){
    lastWorkflowCheck=Date.now();
    try{
      const result=await json('https://api.github.com/repos/SableWolphen/Teststock/actions/workflows/live-intraday-runner.yml/runs?per_page=20');
      const runs=result.workflow_runs||[];
      const run=runs.find(r=>r.status==='in_progress')||runs.find(r=>['queued','pending'].includes(r.status))||runs[0];
      const jobs=run?(await json('https://api.github.com/repos/SableWolphen/Teststock/actions/runs/'+run.id+'/jobs')).jobs:[];
      const state=loopState(run,jobs);text('loop',state.label);text('loopdetail',state.detail+' Checked '+new Date().toLocaleTimeString()+'.');
      $('loop').className=state.label==='Loop running'?'green':'amber';
    }catch{ text('loop','Status unavailable');text('loopdetail','GitHub could not be reached or its public API limit was reached. Use View workflow.');$('loop').className='amber';}
  }
  async function refresh(){
    if(busy)return;busy=true;$('refresh').disabled=true;
    const sources=[['health','health','data/live-trading-health.json'],['board','trigger board','data/trigger-board.json'],['admission','crypto admission','data/crypto-profitability-admission.json'],['watchlist','position records','data/execution-watchlist.json'],['stocks','stock journal','data/real-trade-journal.json'],['crypto','crypto journal','data/crypto-real-trade-journal.json']];
    const results=await Promise.allSettled(sources.map(([, ,p])=>json(p)));data={errors:[]};
    results.forEach((r,i)=>{if(r.status==='fulfilled')data[sources[i][0]]=r.value;else data.errors.push(sources[i][1]);});
    render();if(Date.now()-lastWorkflowCheck>=300000)await workflow();
    busy=false;$('refresh').disabled=false;
  }
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',String(x===b));});render();}));
  $('refresh').addEventListener('click',refresh);
  const clock=()=>text('clock',new Intl.DateTimeFormat('en-US',{timeZone:'America/New_York',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date()));
  clock();setInterval(clock,60000);refresh();setInterval(refresh,30000);
}
