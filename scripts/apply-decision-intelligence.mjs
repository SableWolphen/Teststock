import fs from 'node:fs/promises';

const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const finite=(...xs)=>xs.map(Number).find(Number.isFinite);
const norm=s=>String(s??'UNKNOWN').trim().toUpperCase().replace(/\s+/g,'_');

const signal=await read('docs/signal.json');
const tournament=await read('docs/data/stock-tournament.json');
const correlation=await read('docs/data/portfolio-correlation.json',{pairs:[],clusters:[]});
if(!signal||!tournament)throw new Error('signal or stock tournament missing');

const queuePlan=new Map((signal.stockPlan?.stockCandidateQueue||[]).map(x=>[x.ticker||x.symbol,x]));
const pairs=correlation.pairs||[];
const generatedMs=Date.parse(tournament.generatedAt||signal.generatedAt||0);
const scanAgeMinutes=Number.isFinite(generatedMs)?Math.max(0,(Date.now()-generatedMs)/60000):null;

function correlationPenalty(ticker,selected){
  const relevant=pairs.filter(p=>selected.includes(p.a===ticker?p.b:p.b===ticker?p.a:null));
  const max=relevant.reduce((m,p)=>Math.max(m,Number(p.correlation)||0),0);
  return {maxCorrelationToHigherRanked:round(max,3),penalty:round(max>=.85?12:max>=.70?7:max>=.55?3:0),hardGateStillRequired:true};
}
function enrich(row,index,selected){
  const ticker=row.ticker||row.symbol, plan=queuePlan.get(ticker)||{};
  const setup=norm(row.setupType||plan.setupType||'STOCK_TREND');
  const histWin=finite(row.historicalWinRate,plan.historicalWinRate,plan.validation?.winRate);
  const histN=finite(row.historicalSamples,plan.historicalSamples,plan.validation?.samples,0);
  const spread=finite(row.spreadPct,plan.spreadPct);
  const rr=finite(row.rewardRisk,plan.rewardRisk,0);
  const quality=finite(row.growthQuality,row.quality,plan.growthQuality,row.tournamentScore,0);
  const technical=clamp(round(quality*.55+clamp((rr-1)*12,0,25)+(histWin==null?10:clamp((histWin-45)*.5,0,20))),0,100);
  const sampleConfidence=clamp(Number(histN)/30,0,1);
  const patternConfidence=histWin==null?null:round(50+(histWin-50)*sampleConfidence,1);
  const liquidityKnown=spread!=null;
  const liquidityPass=spread==null?null:spread<=Number(signal.executionQuality?.maxStockSpreadPct??.5);
  const fundamental=row.fundamentalEligibility??row.fundamentals?.eligible??plan.fundamentalEligibility??null;
  const screener={fundamentals:fundamental===false?'FAIL':fundamental===true?'PASS':'UNKNOWN',liquidity:liquidityPass===false?'FAIL':liquidityPass===true?'PASS':'UNKNOWN',spreadPct:spread??null,unknownIsNotAnOverride:true};
  const quote=finite(plan.scanPrice,row.scanPrice,row.observedPrice);
  const min=finite(row.minimumEntry,plan.minimumEntry,row.entry),max=finite(row.maximumEntry,plan.maximumEntry,row.entry);
  let proximity=0;
  if(quote!=null&&min!=null&&max!=null){const width=Math.max(Math.abs(max-min),Math.abs(min)*.0025);proximity=quote<min?clamp(1-(min-quote)/(width*3),0,1):quote<=max?1:clamp(1-(quote-max)/(width*2),0,1);}
  const freshness=scanAgeMinutes==null?0:Math.pow(.5,scanAgeMinutes/15);
  const opportunityDecay={scanAgeMinutes:scanAgeMinutes==null?null:round(scanAgeMinutes,1),halfLifeMinutes:15,entryProximity:round(proximity,3),freshnessMultiplier:round(freshness,3),combinedMultiplier:round(freshness*(.6+.4*proximity),3),expired:scanAgeMinutes==null||scanAgeMinutes>30};
  const corr=correlationPenalty(ticker,selected);
  const confidence=patternConfidence==null?technical:technical*.6+patternConfidence*.4;
  const base=finite(row.adaptiveTournamentScore,row.tournamentScore,quality,0);
  const decisionScore=round(base*.7+confidence*.3-corr.penalty-(liquidityPass===false?20:0));
  const admission=row.profitabilityAdmission?.state||'UNKNOWN';
  const upstreamActionAllowed=['AUTO_BUY_ELIGIBLE','WAIT_FOR_TRIGGER'].includes(String(row.action||''));
  const eligible=upstreamActionAllowed&&!['SHADOW_ONLY','LIVE_SUSPENDED'].includes(admission)&&liquidityPass!==false&&!opportunityDecay.expired;
  const eligibleForSeedLane=row.seedLane?.eligible===true;
  const eligibleForDayTradeSeedLane=row.dayTradeSeedLane?.eligible===true;
  const diagnostics={setupType:setup,technicalScore:round(technical,1),patternConfidencePct:patternConfidence,historicalSamples:Number(histN||0),historicalWinRatePct:histWin??null,rewardRisk:rr,backtestStatus:Number(histN)>=30?'SUPPORTED':Number(histN)>=12?'LIMITED':'SPARSE',warnings:[...(Number(histN)<12?['SPARSE_SETUP_BACKTEST']:[]),...(patternConfidence==null?['PATTERN_CONFIDENCE_UNKNOWN']:[]),...(fundamental==null?['FUNDAMENTALS_UNKNOWN']:[]),...(spread==null?['LIQUIDITY_UNKNOWN']:[]) ]};
  return {...row,decisionIntelligence:{decisionScore,rankBeforeOptimization:index+1,eligibleAfterOverlay:eligible,eligibleForSeedLane,eligibleForDayTradeSeedLane,upstreamActionAllowed,setupDiagnostics:diagnostics,screener,opportunityDecay,portfolioOptimization:corr,admissionState:admission,hardGatesRemainAuthoritative:true},decisionScore,action:upstreamActionAllowed&&!eligible?'DECISION_INTELLIGENCE_BLOCK':row.action};
}

const seed=tournament.liveQueue||[];
const selected=[];
const live=seed.map((x,i)=>{const y=enrich(x,i,selected);if(y.decisionIntelligence.eligibleAfterOverlay)selected.push(y.ticker||y.symbol);return y;})
  .sort((a,b)=>Number(b.decisionScore)-Number(a.decisionScore)||Number(a.queueRank||999)-Number(b.queueRank||999))
  .map((x,i)=>({...x,decisionRank:i+1}));
const byTicker=new Map(live.map(x=>[x.ticker||x.symbol,x]));
const finalists=(tournament.researchFinalists||[]).map((x,i)=>byTicker.get(x.ticker||x.symbol)||enrich(x,i,[])).sort((a,b)=>Number(b.decisionScore)-Number(a.decisionScore));
const buyable=live.filter(x=>x.action==='AUTO_BUY_ELIGIBLE'&&x.decisionIntelligence.eligibleAfterOverlay);

tournament.schemaVersion=Math.max(8,Number(tournament.schemaVersion||0));
tournament.decisionIntelligencePolicy={enabled:true,mode:'BOUNDED_DECISION_OVERLAY',inspirations:{TradeIdeas:'real-time multi-stock ranking',TrendSpider:'setup-specific diagnostics and alerts',Tickeron:'pattern confidence with sample shrinkage',TradingView:'technical state and trigger visibility',Finviz:'fundamental and liquidity screening'},portfolioObjective:'Rank already-qualified candidates by setup quality, confidence, freshness, liquidity and correlation while preserving cash and hard portfolio gates.',authority:'May rerank, reduce, expire, or block. Cannot create eligibility outside an explicitly authorized automatic seed lane, raise risk, loosen a hard gate, add an asset class, or exceed the encoded seed-lane cap.'};
tournament.liveQueue=live;tournament.researchFinalists=finalists;tournament.liveBuyChampion=buyable[0]||null;tournament.liveFallbacks=buyable.slice(1);
const q=new Map(live.map(x=>[x.ticker||x.symbol,x]));
signal.stockPlan=signal.stockPlan||{};
signal.stockPlan.stockCandidateQueue=(signal.stockPlan.stockCandidateQueue||[]).map(x=>q.has(x.ticker)?{...x,decisionIntelligence:q.get(x.ticker).decisionIntelligence,decisionScore:q.get(x.ticker).decisionScore,decisionRank:q.get(x.ticker).decisionRank}:x).sort((a,b)=>Number(a.queueRank||999)-Number(b.queueRank||999));
signal.stockTournament={...(signal.stockTournament||{}),decisionIntelligencePolicy:tournament.decisionIntelligencePolicy,liveBuyChampion:tournament.liveBuyChampion,liveFallbackTickers:tournament.liveFallbacks.map(x=>x.ticker)};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),realTimeMultiStockRanking:true,setupBacktestDiagnostics:true,patternConfidence:true,screenerOverlay:true,portfolioOptimization:true,opportunityDecay:true}};
signal.schemaVersion=Math.max(43,Number(signal.schemaVersion||0));
await Promise.all([write('docs/data/stock-tournament.json',tournament),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Decision intelligence: ${live.length} ranked; ${buyable.length} live-eligible; champion=${buyable[0]?.ticker||'none'}; age=${scanAgeMinutes==null?'unknown':round(scanAgeMinutes,1)}m`);
