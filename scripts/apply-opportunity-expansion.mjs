import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const dataDir=path.resolve('docs/data');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

const REGIME_PROFILES={
  TRENDING_UP:{minScore:86,minGrowthQuality:90,minWinRate:55,minExpectedR:.60,minSamples:20,maxAtrPct:7,breadthFloor:50,sizeMultiplier:1,label:'TREND_FOLLOW'},
  CALM:{minScore:88,minGrowthQuality:92,minWinRate:55,minExpectedR:.60,minSamples:20,maxAtrPct:4.5,breadthFloor:52,sizeMultiplier:.85,label:'CALM_BREAKOUT'},
  VOLATILE:{minScore:92,minGrowthQuality:94,minWinRate:58,minExpectedR:.70,minSamples:20,maxAtrPct:7,breadthFloor:55,sizeMultiplier:.60,label:'VOLATILE_SELECTIVE'},
  TRENDING_DOWN:{minScore:94,minGrowthQuality:96,minWinRate:60,minExpectedR:.80,minSamples:25,maxAtrPct:6,breadthFloor:60,sizeMultiplier:.35,label:'COUNTERTREND_EXCEPTION_ONLY'},
  MIXED:{minScore:90,minGrowthQuality:93,minWinRate:57,minExpectedR:.65,minSamples:20,maxAtrPct:6,breadthFloor:55,sizeMultiplier:.65,label:'MIXED_SELECTIVE'},
  UNKNOWN:{minScore:96,minGrowthQuality:97,minWinRate:60,minExpectedR:.80,minSamples:25,maxAtrPct:5,breadthFloor:60,sizeMultiplier:.35,label:'UNKNOWN_FAIL_SMALL'}
};

function inferRegime(plan,latest){
  const explicit=plan?.advancedGuards?.runtimeRegime||plan?.policy?.runtimeRegimePolicy?.regime;
  if(explicit)return String(explicit).toUpperCase();
  const label=String(latest?.regime?.label||'').toUpperCase(),bias=String(latest?.regime?.bias||'').toUpperCase(),detail=String(latest?.regime?.detail||'').toUpperCase();
  if(label.includes('RISK OFF')||bias==='BEARISH')return 'TRENDING_DOWN';
  if(detail.includes('VOLAT'))return 'VOLATILE';
  if(label.includes('MIXED'))return 'MIXED';
  if(label.includes('RISK ON')||bias==='BULLISH')return 'TRENDING_UP';
  return 'UNKNOWN';
}
function breadth(latest){
  const b=latest?.learning?.breadth;if(b)return b;
  const rows=latest?.marketSnapshot||[],n=rows.length||1;
  return {symbols:rows.length,above20:Math.round(rows.filter(x=>Number(x.price)>Number(x.ma20)).length/n*100),above50:Math.round(rows.filter(x=>Number(x.price)>Number(x.ma50)).length/n*100),above200:Math.round(rows.filter(x=>Number(x.price)>Number(x.ma200)).length/n*100),bullishSignals:Math.round(rows.filter(x=>x.direction==='BULLISH').length/n*100)};
}
function symbolProbation(row){
  const samples=Number(row?.validation?.samples||0),win=Number(row?.validation?.winRate||0);
  if(samples<20)return {status:'PROBATION',sizeMultiplier:.5,reason:'Fewer than 20 historical validation samples'};
  if(samples<30)return {status:'LIMITED',sizeMultiplier:.75,reason:'20-29 historical samples; use reduced size until evidence deepens'};
  if(win<55)return {status:'WEAK',sizeMultiplier:0,reason:'Historical win rate below probability-first floor'};
  return {status:'ESTABLISHED',sizeMultiplier:1,reason:'Historical sample is established'};
}
function pass(row,profile,b){
  const reasons=[],costAdjusted=Number(row?.expectancy?.costAdjustedConservativeExpectedR??row?.expectancy?.conservativeExpectedR??0);
  if(row?.direction!=='BULLISH')reasons.push('not bullish');
  if(Number(row?.score||0)<profile.minScore)reasons.push(`score < ${profile.minScore}`);
  if(Number(row?.growthQuality||0)<profile.minGrowthQuality)reasons.push(`growthQuality < ${profile.minGrowthQuality}`);
  if(Number(row?.validation?.samples||0)<profile.minSamples)reasons.push(`samples < ${profile.minSamples}`);
  if(Number(row?.validation?.winRate||0)<profile.minWinRate)reasons.push(`win rate < ${profile.minWinRate}%`);
  if(costAdjusted<profile.minExpectedR)reasons.push(`cost-adjusted conservative expected R < ${profile.minExpectedR}`);
  if(Number(row?.rewardRisk||0)<2.5)reasons.push('target2 reward/risk < 2.5');
  if(Number(row?.atrPct||0)>profile.maxAtrPct)reasons.push(`ATR% > ${profile.maxAtrPct}`);
  if(Number(b?.above50||0)<profile.breadthFloor)reasons.push(`breadth above 50-day MA < ${profile.breadthFloor}%`);
  return {ok:!reasons.length,reasons};
}
function rankScore(row){
  if(Number.isFinite(Number(row?.portfolioOpportunityScore)))return Number(row.portfolioOpportunityScore);
  const q=Number(row?.growthQuality||0),e=Number(row?.expectancy?.costAdjustedConservativeExpectedR??row?.expectancy?.conservativeExpectedR??0),rr=Number(row?.rewardRisk||0),win=Number(row?.validation?.winRate||0),samples=Number(row?.validation?.samples||0),dv=Number(row?.dollarVolume||0);
  return q+e*10+Math.min(8,rr*2)+Math.max(0,win-50)*.15+Math.min(6,samples/10)+(dv>0?Math.min(4,Math.log10(Math.max(1,dv))-6):0);
}

for(const budget of budgets){
  const planFile=path.join(dataDir,`growth-plan-${budget}.json`),latestFile=path.join(dataDir,`latest-${budget}.json`);
  const plan=await read(planFile),latest=await read(latestFile);if(!plan||plan.error||!latest)continue;
  const regime=inferRegime(plan,latest),profile=REGIME_PROFILES[regime]||REGIME_PROFILES.UNKNOWN,b=breadth(latest);
  const ranked=[...(plan.ranked||[])].sort((a,b)=>rankScore(b)-rankScore(a));
  const existingBySymbol=new Map((plan.allocations||[]).map(x=>[x.symbol,x]));
  const candidates=[];
  for(const row of ranked){
    const g=pass(row,profile,b),probation=symbolProbation(row);if(!g.ok||probation.sizeMultiplier<=0)continue;
    candidates.push({...row,portfolioOpportunityScore:round(rankScore(row),2),opportunityGuard:{regime,regimeProfile:profile.label,breadth:b,probation,gates:g}});
  }
  const maxPositions=4,maxPortfolioStop=budget*.03;
  let remainingBudget=budget,remainingRisk=maxPortfolioStop;const allocations=[];
  for(const row of candidates){
    if(allocations.length>=maxPositions)break;
    const entry=Number(row.entry||0),stop=Number(row.stop||0),riskPct=entry>stop?(entry-stop)/entry:0;if(!entry||riskPct<=0||riskPct>.15)continue;
    const existing=existingBySymbol.get(row.symbol);
    const baseDesired=existing?Number(existing.allocationDollars||0):budget*(allocations.length===0?.35:.22);
    const probation=Number(row.opportunityGuard?.probation?.sizeMultiplier||1);
    const desired=baseDesired*profile.sizeMultiplier*probation;
    const byRisk=remainingRisk/riskPct,amount=round(Math.max(0,Math.min(remainingBudget,desired,byRisk)));
    if(amount<Math.min(5,budget*.05))continue;
    const loss=round(amount*riskPct);
    allocations.push({...row,allocationDollars:amount,estimatedSharesAtEntry:round(amount/entry,6),estimatedLossAtStop:loss,multiOpportunityEligible:true});
    remainingBudget=round(remainingBudget-amount);remainingRisk=round(remainingRisk-loss);if(remainingBudget<=1||remainingRisk<=.25)break;
  }
  const primarySymbols=new Set(allocations.map(x=>x.symbol));
  const qualifiedCandidateQueue=candidates.slice(0,15).map((row,index)=>({...row,queueRank:index+1,queueRole:primarySymbols.has(row.symbol)?'PRIMARY':'RESERVE'}));
  const next={...plan,schemaVersion:Math.max(9,Number(plan.schemaVersion||0)),ranked,allocations,qualifiedCandidateQueue,keepCashDollars:Math.max(0,round(remainingBudget)),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0)),policy:{...(plan.policy||{}),maxConcurrentNewPositions:4,minimumVisibleCandidateTarget:4,maxQualifiedCandidateQueue:15,regimeSpecificEntries:true,breadthConfirmationRequired:true,symbolProbationEnabled:true,costAdjustedRankingRequired:true,runtimeGapGuard:{enabled:true,maxAbsoluteOpeningGapPct:4,maxGapPctOfPlannedRiskDistance:50,rule:'At runtime compare the current session open with the prior regular-session close when reliable. Skip a new entry after an absolute opening gap above 4%, or when the gap consumes more than 50% of planned entry-to-stop distance, unless the signal explicitly revalidates after the open. Never widen the stop to accommodate a gap.'},runtimeLiquidityRanking:{enabled:true,preferTighterSpread:true,stockHardSpreadCapPct:.35,minimumReliableDollarVolume:'Prefer highly liquid names; when reliable average dollar-volume is exposed, reject clearly illiquid candidates and rank otherwise-equal candidates by tighter spread and higher dollar volume.'}},opportunityExpansion:{regime,profile,breadth:b,maxConcurrentQualifiedStocks:4,minimumVisibleCandidateTarget:4,maxQualifiedCandidateQueue:15,rankingBasis:'portfolioOpportunityScore using quality + cost-adjusted expectancy + target2 reward/risk + validation depth + liquidity, with volatility/probation penalties',qualifiedSymbols:candidates.map(x=>x.symbol),primarySymbols:allocations.map(x=>x.symbol),reserveSymbols:qualifiedCandidateQueue.filter(x=>x.queueRole==='RESERVE').map(x=>x.symbol),rejectedByProfile:ranked.filter(r=>!candidates.some(c=>c.symbol===r.symbol)).slice(0,8).map(r=>({symbol:r.symbol,...pass(r,profile,b),probation:symbolProbation(r)})),note:'Publish up to 15 independently qualified candidates in ranked order. Up to four may be primary allocations; reserves are re-sized and revalidated live. If fewer than four qualify, hold cash rather than weakening a gate.'}};
  await fs.writeFile(planFile,JSON.stringify(next,null,2));
  console.log(`Opportunity expansion $${budget}: ${regime} breadth50=${b.above50} positions=${allocations.length}`);
}
