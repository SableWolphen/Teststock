import fs from 'node:fs/promises';
import path from 'node:path';

const dataDir=path.resolve('docs/data');
const budgets=[50,100,200,500];
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

function stockItem(row){
  const costAdj=Number(row?.expectancy?.costAdjustedConservativeExpectedR??row?.expectancy?.conservativeExpectedR??0);
  return {assetClass:'STOCK',symbol:row.symbol,researchEligible:true,liveChecksRequired:true,score:round(Number(row.portfolioOpportunityScore||row.growthQuality||0),2),growthQuality:Number(row.growthQuality||0),historicalWinRatePct:Number(row.validation?.winRate||0),historicalSamples:Number(row.validation?.samples||0),rewardRiskTarget1:Number(row.rewardRiskTarget1||0),rewardRiskTarget2:Number(row.rewardRiskTarget2||row.rewardRisk||0),costAdjustedConservativeExpectedR:costAdj,plannedAllocationDollars:Number(row.allocationDollars||0),plannedStopLossDollars:Number(row.estimatedLossAtStop||0),notes:['Primary asset class.','Must still pass live entry, spread, gap, cash, correlation, protection, frequency, account-floor, and real-fill learning checks.']};
}
function optionItem(plan){
  const o=plan?.eliteOption;if(!o||(!o.passed&&!String(o.label||'').includes('LIVE EVIDENCE CHECK REQUIRED')))return null;
  const u=plan.allocations?.[0]||plan.ranked?.[0];if(!u)return null;
  const contract=o.contract||{},spread=Number(contract.spreadPct||0),risk=Number(contract.maxRisk||o.maxOptionRiskDollars||0),quality=Number(u.portfolioOpportunityScore||u.growthQuality||0);
  const score=quality+6-Math.min(12,spread*.8)-Math.min(10,risk/10);
  return {assetClass:'OPTION',symbol:u.symbol,contract:contract.contract||null,researchEligible:true,liveChecksRequired:true,score:round(score,2),underlyingGrowthQuality:Number(u.growthQuality||0),underlyingHistoricalWinRatePct:Number(u.validation?.winRate||0),underlyingHistoricalSamples:Number(u.validation?.samples||0),underlyingCostAdjustedConservativeExpectedR:Number(u.expectancy?.costAdjustedConservativeExpectedR??u.expectancy?.conservativeExpectedR??0),maxRiskReferenceDollars:risk,spreadPct:spread,notes:['Exceptional-only path.','Requires live real-fill evidence, whole-contract dollar-risk fit, acceptable live spread/liquidity, tier permission, event permission, broker support, and verified protection.']};
}
function cryptoItem(row){
  const win=Number(row.validation?.winRate||0),samples=Number(row.validation?.samples||0),quality=Number(row.growthQuality||0),atr=Number(row.atrPct||0),grade=row.setupGrade||'A';
  const score=quality+Math.max(0,win-50)*.25+Math.min(6,samples/5)+(grade==='A+'?5:0)-Math.max(0,atr-6)*1.5;
  return {assetClass:'CRYPTO',symbol:row.symbol,researchEligible:true,liveChecksRequired:true,score:round(score,2),setupGrade:grade,growthQuality:quality,historicalWinRatePct:win,historicalSamples:samples,plannedAllocationDollars:Number(row.allocationDollars||0),plannedStopLossDollars:Number(row.estimatedLossAtStop||0),notes:['Optional path.','Requires live real-fill evidence, broker crypto execution support, acceptable spread, BTC context when applicable, one-crypto-position cap, and every account/risk guard.']};
}

for(const budget of budgets){
  const growth=await read(path.join(dataDir,`growth-plan-${budget}.json`),{}),crypto=await read(path.join(dataDir,`crypto-plan-${budget}.json`),{});
  const items=[];
  for(const row of growth.allocations||[])items.push(stockItem(row));
  const option=optionItem(growth);if(option)items.push(option);
  for(const row of crypto.allocations||[])items.push(cryptoItem(row));
  items.sort((a,b)=>b.score-a.score||({STOCK:0,OPTION:1,CRYPTO:2}[a.assetClass]-{STOCK:0,OPTION:1,CRYPTO:2}[b.assetClass]));
  const ranked=items.map((x,i)=>({...x,rank:i+1}));
  const report={schemaVersion:1,generatedAt:new Date().toISOString(),budget,objective:'Rank already-qualified stock, option, and crypto opportunities so live capital goes to the strongest risk-adjusted opportunity first. Ranking never overrides a failed live or safety gate.',rankingPolicy:{stocksPrimaryOnTies:true,noForcedDiversification:true,noForcedTrade:true,liveRiskRulesAlwaysOverride:true,notes:'A higher score is only priority among already-qualified research candidates. Claude must skip any candidate that fails live execution, broker, event, real-fill, protection, frequency, correlation, cash, or account-risk checks.'},opportunities:ranked,preferredResearchOpportunity:ranked[0]||null};
  await fs.writeFile(path.join(dataDir,`opportunity-ranking-${budget}.json`),JSON.stringify(report,null,2));
  console.log(`Cross-asset ranking $${budget}: ${ranked.map(x=>`${x.rank}.${x.assetClass}:${x.symbol}`).join(' | ')||'CASH'}`);
}
