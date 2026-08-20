import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const PLAN='docs/data/growth-plan-500.json';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const signal=await read(SIGNAL),plan=await read(PLAN);
const rows=[...(plan.qualifiedCandidateQueue||plan.allocations||[])];
const byTicker=new Map(rows.map(x=>[x.symbol,x]));
const decorate=x=>{
  const row=byTicker.get(x.ticker)||{};
  const tier=row.entryTier||'A';
  return {...x,entryTier:tier,entryTierLabel:row.entryTierLabel||(tier==='B'?'BEST_ACCEPTABLE':'ELITE'),entryTierSizeMultiplier:Number(row.entryTierSizeMultiplier??(tier==='B'?.5:1)),bestAcceptableFallback:tier==='B'};
};
signal.stockPlan=signal.stockPlan||{};
signal.stockPlan.stockOrders=(signal.stockPlan.stockOrders||[]).map(decorate);
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(decorate).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockPlan.bestAcceptableEntryPolicy={
  enabled:true,
  priority:['A','B'],
  aTier:{label:'ELITE',sizeMultiplier:1,rule:'Use the existing strict regime profile and normal permitted sizing.'},
  bTier:{label:'BEST_ACCEPTABLE',sizeMultiplier:.5,rule:'Use only when no A-tier candidate survives the current live entry checks. B must still satisfy the encoded positive-expectancy/history/R:R floors and every hard account, pricing, spread, gap, correlation and protection guard.'},
  executionRule:'If at least one A candidate is live and valid, buy the highest-ranked A. Otherwise buy the highest-ranked live B candidate at reduced size. If the selected candidate fails before order submission, continue through the same-tier fallbacks, then B fallbacks, in the same execution run. Hold cash only when no A or B candidate survives every hard guard.',
  neverRelax:['funding lock','account floor','daily/weekly loss brakes','live price and maximumEntry','spread cap','gap/chase guard','correlation/portfolio heat','protective exit requirements','fractional monitoring requirement','no margin or leverage','no averaging down','no widened stops']
};
signal.stockPlan.candidateQueuePolicy={...(signal.stockPlan.candidateQueuePolicy||{}),tierPriority:['A','B'],bestAcceptableFallbackEnabled:true,rule:'Try A-tier candidates first. If none survive, try B-tier candidates at their reduced encoded size. Never turn a failed hard guard into a pass just to create a trade.'};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),bestAcceptableStockTier:true}};
signal.schemaVersion=Math.max(31,Number(signal.schemaVersion||0));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Best-acceptable policy applied: A=${signal.stockPlan.stockCandidateQueue.filter(x=>x.entryTier==='A').length} B=${signal.stockPlan.stockCandidateQueue.filter(x=>x.entryTier==='B').length}`);
