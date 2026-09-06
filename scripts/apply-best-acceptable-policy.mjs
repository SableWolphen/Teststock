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
  return {...x,entryTier:tier,entryTierLabel:row.entryTierLabel||(tier==='B'?'BEST_ACCEPTABLE':'ELITE'),entryTierSizeMultiplier:(tier==='B'?Math.min(.25,Number(row.entryTierSizeMultiplier??.25)):Number(row.entryTierSizeMultiplier??1)),bestAcceptableFallback:tier==='B'};
};
signal.stockPlan=signal.stockPlan||{};
signal.stockPlan.stockOrders=(signal.stockPlan.stockOrders||[]).map(decorate);
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(decorate).sort((a,b)=>(a.entryTier==='A'?0:1)-(b.entryTier==='A'?0:1)||Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockPlan.bestAcceptableEntryPolicy={
  enabled:true,
  priority:['A','B'],
  aTier:{label:'ELITE',sizeMultiplier:1,rule:'Use the existing strict regime profile and normal permitted sizing.'},
  bTier:{label:'BEST_ACCEPTABLE',sizeMultiplier:.25,rule:'Consider after A-tier candidates whenever live capacity remains, including after an A-tier fill. B must still satisfy the encoded positive-expectancy/history/R:R floors and every hard account, pricing, spread, gap, correlation and protection guard.'},
  executionRule:'Process qualified A candidates first, then qualified B candidates at no more than 25% encoded normal size while live capacity remains, including after an A fill. If the selected candidate fails before order submission, continue through the same-tier fallbacks, then B fallbacks, in the same execution run. Hold cash only when no A or B candidate survives every hard guard.',
  neverRelax:['funding lock','account floor','daily/weekly loss brakes','live price and maximumEntry','spread cap','gap/chase guard','correlation/portfolio heat','protective exit requirements','fractional monitoring requirement','no margin or leverage','no averaging down','no widened stops']
};
signal.stockPlan.candidateQueuePolicy={...(signal.stockPlan.candidateQueuePolicy||{}),tierPriority:['A','B'],bestAcceptableFallbackEnabled:true,rule:'Try A-tier candidates first, then B-tier candidates at no more than 25% encoded normal size while live capacity remains, including after an A fill. Never turn a failed hard guard into a pass just to create a trade.'};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),bestAcceptableStockTier:true}};
signal.schemaVersion=Math.max(31,Number(signal.schemaVersion||0));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Best-acceptable policy applied: A=${signal.stockPlan.stockCandidateQueue.filter(x=>x.entryTier==='A').length} B=${signal.stockPlan.stockCandidateQueue.filter(x=>x.entryTier==='B').length}`);
