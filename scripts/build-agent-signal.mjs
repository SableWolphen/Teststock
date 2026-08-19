import fs from 'node:fs/promises';
import path from 'node:path';

const REFERENCE_BUDGET=500;
const outDir=path.resolve('docs');
const dataDir=path.join(outDir,'data');
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));

function freshness(plan){
  const asOf=new Date(plan?.asOf||0).getTime();
  const ageMinutes=Number.isFinite(asOf)?Math.max(0,Math.round((Date.now()-asOf)/60000)):null;
  const crypto=plan?.assetClass==='CRYPTO';
  const marketOpen=crypto?true:Boolean(plan?.session?.isOpen||plan?.market==='OPEN');
  const maxAgeMinutes=crypto?30:marketOpen?45:2160;
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
const pctOfReference=n=>round((Number(n||0)/REFERENCE_BUDGET)*100,2);

function buildStock(plan){
  if(plan?.error)return{assetClass:'STOCK',overallAction:'DO_NOT_TRADE',reason:plan.error};
  const f=freshness(plan);
  const stocks=(plan.allocations||[]).map((r,i)=>({
    assetClass:'STOCK',rank:i+1,ticker:r.symbol,sector:r.sector||null,action:stockState(r,f),
    allocationPctOfRobinhoodBuyingPower:pctOfReference(r.allocationDollars),
    scanPrice:round(r.price),minimumEntry:round(r.entry),maximumEntry:round(Number(r.entry||0)*1.02),stop:round(r.stop),target1:round(r.target1),target2:round(r.target2),
    plannedStopRiskPctOfRobinhoodBuyingPower:pctOfReference(r.estimatedLossAtStop),rewardRisk:r.rewardRisk,growthQuality:r.growthQuality,historicalWinRate:r.validation?.winRate??null,historicalSamples:r.validation?.samples??null
  }));
  const ready=stocks.filter(x=>x.action==='AUTO_BUY_ELIGIBLE');
  const elite=plan.eliteOption||{};
  const option=elite.passed?{
    assetClass:'OPTION',action:f.stale?'STALE_DO_NOT_TRADE':!f.marketOpen?'MARKET_CLOSED_RECHECK':ready.length?'AUTO_BUY_ELIGIBLE':'WAIT_FOR_UNDERLYING_TRIGGER',
    ticker:plan.allocations?.[0]?.symbol||plan.ranked?.[0]?.symbol||null,
    maxRiskPctOfRobinhoodBuyingPower:round(Math.min(Number(plan.policy?.maxOptionPremiumPct||12),pctOfReference(elite.contract?.maxRisk)),2),
    contractReferenceMaxRiskDollars:round(elite.contract?.maxRisk),kind:elite.contract?.kind||null,side:elite.contract?.side||null,expiry:elite.contract?.expiry||null,
    longStrike:elite.contract?.longStrike??elite.contract?.strike??null,shortStrike:elite.contract?.shortStrike??null,dte:elite.dte,checks:elite.checks
  }:null;
  let overallAction='DO_NOT_TRADE',reason='Cash is the selected position.';
  if(f.stale){reason='Signal is stale.';}
  else if(!f.marketOpen){overallAction='WAIT_FOR_MARKET_OPEN';reason='Market is closed.';}
  else if(option?.action==='AUTO_BUY_ELIGIBLE'){overallAction='AUTO_BUY_OPTION_ELIGIBLE';reason='An elite defined-risk option passed every growth gate; size it only from cash already present in the dedicated Robinhood Agentic account and verify live pricing before execution.';}
  else if(ready.length){overallAction='AUTO_BUY_STOCK_ELIGIBLE';reason='One or more high-quality stock allocations are inside the allowed entry range; size them only from cash already present in the dedicated Robinhood Agentic account.';}
  else if(stocks.length){overallAction='WAIT_FOR_TRIGGER';reason='Qualified stock ideas exist but are not inside the valid entry range.';}
  return {
    assetClass:'STOCK',overallAction,reason,confidence:plan.confidence,signalAsOf:plan.asOf,
    expiresAt:plan.asOf?new Date(new Date(plan.asOf).getTime()+(f.marketOpen?45:2160)*60000).toISOString():null,
    policy:{...plan.policy,sizingMode:'ROBINHOOD_EXISTING_CASH_ONLY'},outcomeGuard:plan.outcomeGuard,stockOrders:stocks,eliteOption:option
  };
}
function buildCrypto(plan){
  if(plan?.error)return{assetClass:'CRYPTO',overallAction:'DO_NOT_TRADE',reason:plan.error};
  const f=freshness(plan);
  const orders=(plan.allocations||[]).map((r,i)=>{
    let action='SIGNAL_ONLY_WAIT';const px=Number(r.price||0),entry=Number(r.entry||0);
    if(f.stale)action='STALE_DO_NOT_TRADE';else if(px>=entry*.998&&px<=entry*1.02)action='SIGNAL_ONLY_BUY_ZONE';else if(px>entry*1.02)action='DO_NOT_CHASE';
    return{assetClass:'CRYPTO',rank:i+1,ticker:r.symbol,action,allocationPctOfRobinhoodBuyingPower:pctOfReference(r.allocationDollars),scanPrice:round(r.price,6),minimumEntry:round(r.entry,6),maximumEntry:round(Number(r.entry||0)*1.02,6),stop:round(r.stop,6),target1:round(r.target1,6),target2:round(r.target2,6),plannedStopRiskPctOfRobinhoodBuyingPower:pctOfReference(r.estimatedLossAtStop),rewardRisk:r.rewardRisk1,growthQuality:r.growthQuality,confirm4h:r.confirm4h,historicalWinRate:r.validation?.winRate??null,historicalSamples:r.validation?.samples??null};
  });
  const buyZone=orders.filter(x=>x.action==='SIGNAL_ONLY_BUY_ZONE');
  return{assetClass:'CRYPTO',overallAction:f.stale?'DO_NOT_TRADE':buyZone.length?'CRYPTO_BUY_ZONE':'WAIT_FOR_CRYPTO_TRIGGER',reason:f.stale?'Crypto signal is stale.':buyZone.length?'A high-conviction crypto setup is in its buy zone.':'No high-conviction crypto is currently in its allowed buy zone.',confidence:plan.confidence,signalAsOf:plan.asOf,expiresAt:plan.asOf?new Date(new Date(plan.asOf).getTime()+30*60000).toISOString():null,policy:{...plan.policy,sizingMode:'ROBINHOOD_EXISTING_CASH_ONLY'},execution:{mode:'USE_ONLY_IF_CONNECTED_ROBINHOOD_TOOLS_SUPPORT_CRYPTO',note:'At runtime, use crypto order tools only if the connected Robinhood MCP actually exposes them.'},cryptoOrders:orders};
}

let stockPlan,cryptoPlan;
try{stockPlan=buildStock(await read(path.join(dataDir,`growth-plan-${REFERENCE_BUDGET}.json`)));}catch(error){stockPlan={assetClass:'STOCK',overallAction:'DO_NOT_TRADE',reason:`Growth plan unavailable: ${error.message}`};}
try{cryptoPlan=buildCrypto(await read(path.join(dataDir,`crypto-plan-${REFERENCE_BUDGET}.json`)));}catch(error){cryptoPlan={assetClass:'CRYPTO',overallAction:'DO_NOT_TRADE',reason:`Crypto plan unavailable: ${error.message}`};}

const signal={
  schemaVersion:8,source:'Teststock',purpose:'Account-aware growth autopilot with explicit asset-class routing and a user-only funding lock.',generatedAt:new Date().toISOString(),
  funding:{mode:'USER_DEPOSITS_ONLY',initialUserFundingIntentDollars:100,agentMayInitiateDeposits:false,agentMayInitiateWithdrawals:false,agentMayInitiateBankTransfers:false,instructions:'Use only cash and proceeds already inside the dedicated Robinhood Agentic account. Never pull money from Chase, Crew, Citi, Capital One, any bank, debit card, credit line, or any external account. Only the user may manually add more money. If the user adds more later, the agent may use the newly available non-margin cash under the normal risk rules.'},
  sizing:{mode:'ROBINHOOD_EXISTING_CASH_ONLY',fixedWebsiteBudgets:false,instructions:'Read the dedicated Robinhood Agentic account on every run. Use only current non-margin cash buying power already present there. Convert allocation percentages into dollar amounts at execution time. Never initiate funding or infer external money is available.'},
  autopilot:{enabled:true,requiresPerOrderApproval:false,scope:'Dedicated Robinhood Agentic account only.'},
  assetClassRouting:{STOCK:'Use only stockPlan.stockOrders.',OPTION:'Use only stockPlan.eliteOption and only when its action is AUTO_BUY_ELIGIBLE.',CRYPTO:'Use only cryptoPlan.cryptoOrders. Never treat a crypto symbol as a stock or option.'},
  hardRules:[
    'FUNDING LOCK: the agent must never initiate a deposit, ACH transfer, debit-card transfer, bank transfer, wire, internal transfer, or any other movement of money into the Robinhood Agentic account.',
    'Only the user may manually add capital. If the user initially deposits $100, that is the only outside principal available until the user personally adds more. Trading profits may remain and be reused inside the Agentic account.',
    'The agent must never withdraw money from, charge, borrow against, or otherwise access Chase, Crew, Citi, Capital One, any linked bank, debit card, credit line, retirement account, or any external financial account.',
    'The dedicated Robinhood Agentic account is the only source of truth for cash buying power, positions, and open orders.',
    'Never use a fixed website dollar budget. Re-read existing Robinhood non-margin cash buying power immediately before sizing a new trade.',
    'Never confuse asset classes: STOCK orders come only from stockPlan.stockOrders, OPTION orders come only from stockPlan.eliteOption, and CRYPTO orders come only from cryptoPlan.cryptoOrders.',
    'Use only non-margin cash already inside the dedicated Agentic account. Never use margin, borrowed funds, naked options, short stock, leveraged crypto, or undefined-risk option positions.',
    'Never add to a losing position and never move a stop farther away from the entry.',
    'For stocks and crypto, allocationPctOfRobinhoodBuyingPower is the maximum allocation. For options, maxRiskPctOfRobinhoodBuyingPower is the maximum premium/risk allocation.',
    'Before every supported trade, verify Robinhood market status when applicable, live executable price, spread, current Agentic-account buying power, existing position, open orders, and signal expiration.',
    'Do not buy below minimumEntry or above maximumEntry. If price is outside the range, wait.',
    'Options are allowed only when eliteOption exists, every elite check is true, the exact contract is available, and live Robinhood pricing remains acceptable.',
    'Crypto may be executed only if the connected Robinhood tools explicitly expose crypto order placement at runtime; otherwise crypto remains signal-only.',
    'If outcomeGuard.optionsLocked is true, do not open a new option position.',
    'If Teststock and Robinhood materially disagree, do not trade.',
    'Unused capital stays in cash; never force a trade to chase a return target.',
    'For an open position, exit when the saved invalidation is breached; never widen risk to avoid realizing a loss.',
    'At target1, protect gains by reducing risk or taking partial profit; at target2, prioritize profit capture.',
    'No model or stop can guarantee against loss, gaps, slippage, or option decay.'
  ],
  stockPlan,cryptoPlan
};
await fs.writeFile(path.join(outDir,'signal.json'),JSON.stringify(signal,null,2));
await fs.writeFile(path.join(dataDir,'claude-signal.json'),JSON.stringify(signal,null,2));
await fs.writeFile(path.join(dataDir,'crypto-signal.json'),JSON.stringify({schemaVersion:4,generatedAt:signal.generatedAt,funding:signal.funding,sizing:signal.sizing,cryptoPlan},null,2));
console.log('Generated Teststock agent signal schema v8 with user-only funding lock');