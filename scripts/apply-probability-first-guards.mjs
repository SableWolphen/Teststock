import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir=path.resolve('docs/data');
const budgets=[50,100,200,500];
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const read=async(file,fallback=null)=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}};
const write=async(file,data)=>fs.writeFile(file,JSON.stringify(data,null,2));

const policy={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  objective:'Increase the probability of positive compounding while keeping stocks primary, options exceptional, crypto selective, and cash acceptable. This policy cannot eliminate market loss risk.',
  stocks:{
    minGrowthQuality:92,
    minHistoricalSamples:20,
    minHistoricalWinRatePct:55,
    minConservativeExpectedR:0.6,
    minRewardRisk:2.5,
    maxAtrPct:7,
    reduceSizeAboveAtrPct:5,
    highVolatilitySizeMultiplier:0.5,
    maxSinglePositionPlannedStopPct:1.5,
    maxCombinedNewStockPlannedStopPct:2.5
  },
  options:{
    stocksRemainDefault:true,
    minUnderlyingGrowthQuality:97,
    minHistoricalSamples:25,
    minHistoricalWinRatePct:62,
    minConservativeExpectedR:0.9,
    minRewardRisk:3,
    requireWholeContractRuntimeCheck:true,
    requireLiveRealFillEvidence:true,
    liveEvidenceMinimumResolvedTrades:10,
    liveEvidenceMinimumAverageR:0.25,
    liveEvidenceMinimumWinRatePct:50,
    instructions:'An option may be considered only after the underlying clears these research gates AND Claude confirms the live Teststock real-fill evidence gate. One whole contract must still fit the active capital-tier dollar-risk cap.'
  },
  crypto:{
    minimumHistoricalSamples:15,
    aPlusMinWinRatePct:60,
    aMinWinRatePct:55,
    requirePositiveHistoricalAverageMove:true,
    altcoinsRequirePositiveBitcoinTrend:true,
    aPlusMaxPlannedStopPct:2,
    aMaxPlannedStopPct:1,
    aPlusMaxAllocationPct:40,
    aMaxAllocationPct:20,
    requireLiveRealFillEvidence:true,
    liveEvidenceMinimumResolvedTrades:10,
    liveEvidenceMinimumAverageR:0.25,
    liveEvidenceMinimumWinRatePct:50,
    instructions:'Crypto remains optional. A/A+ research qualification is not enough by itself; live real-fill evidence must also be positive before Claude can execute if broker crypto tools exist.'
  },
  common:{
    noMargin:true,
    noLeverage:true,
    noAverageDown:true,
    noWiderStops:true,
    noChasing:true,
    cashIsValid:true,
    riskCanOnlyBeReducedByThisOverlay:true
  }
};

for(const budget of budgets){
  const file=path.join(dataDir,`growth-plan-${budget}.json`);
  const plan=await read(file);
  if(!plan||plan.error)continue;
  const original=Array.isArray(plan.allocations)?plan.allocations:[];
  const kept=[];
  for(const row of original){
    const checks={
      growthQuality:Number(row.growthQuality||0)>=policy.stocks.minGrowthQuality,
      samples:Number(row.validation?.samples||0)>=policy.stocks.minHistoricalSamples,
      winRate:Number(row.validation?.winRate||0)>=policy.stocks.minHistoricalWinRatePct,
      expectancy:Number(row.expectancy?.conservativeExpectedR||0)>=policy.stocks.minConservativeExpectedR,
      rewardRisk:Number(row.rewardRisk||0)>=policy.stocks.minRewardRisk,
      volatility:Number(row.atrPct??row.technicals?.atrPct??0)<=policy.stocks.maxAtrPct
    };
    if(!Object.values(checks).every(Boolean))continue;
    const baseAmount=Number(row.allocationDollars||0);
    const entry=Number(row.entry||0),stop=Number(row.stop||0);
    if(!(entry>stop&&baseAmount>0))continue;
    const stopPct=(entry-stop)/entry;
    const highVol=Number(row.atrPct??row.technicals?.atrPct??0)>policy.stocks.reduceSizeAboveAtrPct;
    const volatilityMultiplier=highVol?policy.stocks.highVolatilitySizeMultiplier:1;
    const maxAmountBySingleStop=(budget*(policy.stocks.maxSinglePositionPlannedStopPct/100))/stopPct;
    const amount=round(Math.min(baseAmount*volatilityMultiplier,maxAmountBySingleStop));
    if(amount<=0)continue;
    kept.push({...row,allocationDollars:amount,estimatedSharesAtEntry:round(amount/entry,6),estimatedLossAtStop:round(amount*stopPct),probabilityFirstChecks:checks,probabilityFirstSizeMultiplier:volatilityMultiplier});
  }
  let remainingCombinedRisk=budget*(policy.stocks.maxCombinedNewStockPlannedStopPct/100);
  const final=[];
  for(const row of kept.sort((a,b)=>Number(b.growthQuality||0)-Number(a.growthQuality||0))){
    const risk=Number(row.estimatedLossAtStop||0);
    if(risk<=0||risk>remainingCombinedRisk)continue;
    final.push(row);remainingCombinedRisk=round(remainingCombinedRisk-risk);
  }
  plan.allocations=final;
  plan.keepCashDollars=round(Math.max(0,budget-final.reduce((s,x)=>s+Number(x.allocationDollars||0),0)));
  plan.estimatedPortfolioStopLoss=round(final.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0));
  plan.confidence=final.length?(final[0].growthQuality>=97?'A_PLUS':'A'):'CASH';
  plan.probabilityFirstGuard={applied:true,stockPolicy:policy.stocks,removedAllocationCount:Math.max(0,original.length-final.length)};

  const option=plan.eliteOption;
  if(option){
    const underlying=final[0]||plan.ranked?.[0]||null;
    const researchChecks={
      underlyingGrowthQuality:Number(underlying?.growthQuality||0)>=policy.options.minUnderlyingGrowthQuality,
      samples:Number(underlying?.validation?.samples||0)>=policy.options.minHistoricalSamples,
      winRate:Number(underlying?.validation?.winRate||0)>=policy.options.minHistoricalWinRatePct,
      expectancy:Number(underlying?.expectancy?.conservativeExpectedR||0)>=policy.options.minConservativeExpectedR,
      rewardRisk:Number(underlying?.rewardRisk||0)>=policy.options.minRewardRisk
    };
    const researchPass=Object.values(researchChecks).every(Boolean)&&option.passed===true;
    option.probabilityFirstResearchChecks=researchChecks;
    option.liveEvidenceGate={required:true,minimumResolvedTrades:policy.options.liveEvidenceMinimumResolvedTrades,minimumAverageRealizedR:policy.options.liveEvidenceMinimumAverageR,minimumWinRatePct:policy.options.liveEvidenceMinimumWinRatePct};
    if(!researchPass){option.passed=false;option.label='NO OPTION';option.contract=null;}
    else option.label='ELITE OPTION - LIVE EVIDENCE CHECK REQUIRED';
  }
  await write(file,plan);
}

for(const budget of budgets){
  const file=path.join(dataDir,`crypto-plan-${budget}.json`);
  const plan=await read(file);
  if(!plan||plan.error)continue;
  const btc=(plan.ranked||[]).find(x=>x.symbol==='BTC/USD');
  const btcPositive=!!btc&&Number(btc.m20||0)>0&&Number(btc.price||0)>Number(btc.ma50||Infinity);
  const original=Array.isArray(plan.allocations)?plan.allocations:[];
  const final=[];
  for(const row of original){
    const samples=Number(row.validation?.samples||0),win=Number(row.validation?.winRate||0),avgMove=Number(row.validation?.avg20dMove||0);
    const grade=row.setupGrade;
    const checks={
      samples:samples>=policy.crypto.minimumHistoricalSamples,
      winRate:grade==='A+'?win>=policy.crypto.aPlusMinWinRatePct:win>=policy.crypto.aMinWinRatePct,
      positiveHistoricalMove:!policy.crypto.requirePositiveHistoricalAverageMove||avgMove>0,
      bitcoinContext:row.symbol==='BTC/USD'||!policy.crypto.altcoinsRequirePositiveBitcoinTrend||btcPositive
    };
    if(!Object.values(checks).every(Boolean))continue;
    const entry=Number(row.entry||0),stop=Number(row.stop||0);if(!(entry>stop))continue;
    const stopPct=(entry-stop)/entry;
    const maxStopPct=grade==='A+'?policy.crypto.aPlusMaxPlannedStopPct:policy.crypto.aMaxPlannedStopPct;
    const maxAllocationPct=grade==='A+'?policy.crypto.aPlusMaxAllocationPct:policy.crypto.aMaxAllocationPct;
    const byAllocation=budget*(maxAllocationPct/100);
    const byStop=(budget*(maxStopPct/100))/stopPct;
    const amount=round(Math.min(Number(row.allocationDollars||0),byAllocation,byStop));
    if(amount<=0)continue;
    final.push({...row,allocationDollars:amount,estimatedUnitsAtEntry:round(amount/entry,8),estimatedLossAtStop:round(amount*stopPct),probabilityFirstChecks:checks});
  }
  plan.allocations=final.slice(0,1);
  plan.keepCashDollars=round(Math.max(0,budget-plan.allocations.reduce((s,x)=>s+Number(x.allocationDollars||0),0)));
  plan.estimatedPortfolioStopLoss=round(plan.allocations.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0));
  plan.selectedGrade=plan.allocations[0]?.setupGrade||'NO_TRADE';
  plan.confidence=plan.allocations[0]?.setupGrade==='A+'?'ELITE':plan.allocations.length?'STRONG':'CASH';
  plan.action=plan.allocations.length?'QUALIFIED_CRYPTO':'CASH';
  plan.probabilityFirstGuard={applied:true,cryptoPolicy:policy.crypto,bitcoinTrendPositive:btcPositive,liveEvidenceGate:{required:true,minimumResolvedTrades:policy.crypto.liveEvidenceMinimumResolvedTrades,minimumAverageRealizedR:policy.crypto.liveEvidenceMinimumAverageR,minimumWinRatePct:policy.crypto.liveEvidenceMinimumWinRatePct}};
  await write(file,plan);
}

await write(path.join(dataDir,'probability-first-policy.json'),policy);
console.log('Applied probability-first stock/options/crypto overlay.');
