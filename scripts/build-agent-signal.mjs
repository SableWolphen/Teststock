import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const outDir=path.resolve('docs');
const dataDir=path.join(outDir,'data');
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));

function freshness(plan){
  const asOf=new Date(plan?.asOf||0).getTime();
  const ageMinutes=Number.isFinite(asOf)?Math.max(0,Math.round((Date.now()-asOf)/60000)):null;
  const marketOpen=Boolean(plan?.session?.isOpen||plan?.market==='OPEN');
  const maxAgeMinutes=marketOpen?45:2160;
  return {marketOpen,ageMinutes,maxAgeMinutes,stale:ageMinutes==null||ageMinutes>maxAgeMinutes};
}
function stockState(r,f){
  if(f.stale)return'STALE_DO_NOT_TRADE';
  if(!f.marketOpen)return'MARKET_CLOSED_RECHECK';
  const px=Number(r.price||0),entry=Number(r.entry||0),max=entry*1.02;
  if(!px||!entry)return'MISSING_PRICE_DO_NOT_TRADE';
  if(px<entry*.998)return'WAIT_FOR_TRIGGER';
  if(px>max)return'DO_NOT_CHASE';
  return'AUTO_BUY_ELIGIBLE';
}
function build(plan){
  if(plan?.error)return{budget:plan.budget,overallAction:'DO_NOT_TRADE',reason:plan.error};
  const f=freshness(plan);
  const stocks=(plan.allocations||[]).map((r,i)=>({
    rank:i+1,ticker:r.symbol,sector:r.sector||null,action:stockState(r,f),allocationDollars:round(r.allocationDollars),estimatedSharesAtEntry:r.estimatedSharesAtEntry,
    scanPrice:round(r.price),minimumEntry:round(r.entry),maximumEntry:round(Number(r.entry||0)*1.02),stop:round(r.stop),target1:round(r.target1),target2:round(r.target2),
    estimatedLossAtStop:round(r.estimatedLossAtStop),rewardRisk:r.rewardRisk,growthQuality:r.growthQuality,historicalWinRate:r.validation?.winRate??null,historicalSamples:r.validation?.samples??null
  }));
  const ready=stocks.filter(x=>x.action==='AUTO_BUY_ELIGIBLE');
  const elite=plan.eliteOption||{};
  const option=elite.passed?{
    action:f.stale?'STALE_DO_NOT_TRADE':!f.marketOpen?'MARKET_CLOSED_RECHECK':ready.length?'AUTO_BUY_ELIGIBLE':'WAIT_FOR_UNDERLYING_TRIGGER',
    ticker:plan.allocations?.[0]?.symbol||plan.ranked?.[0]?.symbol||null,
    maxRiskDollars:round(elite.contract?.maxRisk),kind:elite.contract?.kind||null,side:elite.contract?.side||null,expiry:elite.contract?.expiry||null,
    longStrike:elite.contract?.longStrike??elite.contract?.strike??null,shortStrike:elite.contract?.shortStrike??null,dte:elite.dte,checks:elite.checks
  }:null;
  let overallAction='DO_NOT_TRADE',reason='Cash is the selected position.';
  if(f.stale){reason='Signal is stale.';}
  else if(!f.marketOpen){overallAction='WAIT_FOR_MARKET_OPEN';reason='Market is closed.';}
  else if(option?.action==='AUTO_BUY_ELIGIBLE'){overallAction='AUTO_BUY_OPTION_ELIGIBLE';reason='An elite defined-risk option passed every growth gate; verify live Robinhood pricing before execution.';}
  else if(ready.length){overallAction='AUTO_BUY_STOCK_ELIGIBLE';reason='One or more high-quality stock allocations are inside the allowed entry range.';}
  else if(stocks.length){overallAction='WAIT_FOR_TRIGGER';reason='Qualified ideas exist but are not inside the valid entry range.';}
  return {
    budget:plan.budget,overallAction,reason,confidence:plan.confidence,signalAsOf:plan.asOf,expiresAt:plan.asOf?new Date(new Date(plan.asOf).getTime()+(f.marketOpen?45:2160)*60000).toISOString():null,
    keepCashDollars:plan.keepCashDollars,estimatedPortfolioStopLoss:plan.estimatedPortfolioStopLoss,policy:plan.policy,outcomeGuard:plan.outcomeGuard,stockOrders:stocks,eliteOption:option
  };
}

const plans=[];
for(const budget of budgets){
  try{plans.push(build(await read(path.join(dataDir,`growth-plan-${budget}.json`))));}
  catch(error){plans.push({budget,overallAction:'DO_NOT_TRADE',reason:`Growth plan unavailable: ${error.message}`});}
}

const signal={
  schemaVersion:4,source:'Teststock',purpose:'Strict machine-readable growth-autopilot policy for an AI agent using Robinhood Agentic Trading.',generatedAt:new Date().toISOString(),defaultBudget:50,
  autopilot:{enabled:true,requiresPerOrderApproval:false,scope:'Dedicated Robinhood Agentic account only'},
  hardRules:[
    'Never use margin, borrowed funds, naked options, short stock, or undefined-risk option positions.',
    'Never add to a losing position and never move a stop farther away from the entry.',
    'Never exceed allocationDollars for a stock or maxRiskDollars for an option.',
    'Before every trade, verify Robinhood market status, live executable price, spread, buying power, existing position, open orders, and signal expiration.',
    'Do not buy a stock below minimumEntry or above maximumEntry. If price is outside the range, wait.',
    'Options are allowed only when eliteOption exists, every elite check is true, and live Robinhood pricing remains acceptable.',
    'If outcomeGuard.optionsLocked is true, do not open a new option position.',
    'If Teststock and Robinhood materially disagree, do not trade.',
    'Unused capital stays in cash; never force a trade to chase a return target.',
    'For an open position, exit when the saved invalidation is breached; never widen risk to avoid realizing a loss.',
    'At target1, protect gains by reducing risk or taking partial profit; at target2, prioritize profit capture.',
    'No model or stop can guarantee against loss or slippage.'
  ],
  plans
};
await fs.writeFile(path.join(outDir,'signal.json'),JSON.stringify(signal,null,2));
await fs.writeFile(path.join(dataDir,'claude-signal.json'),JSON.stringify(signal,null,2));
console.log('Generated Teststock agent signal schema v4');
