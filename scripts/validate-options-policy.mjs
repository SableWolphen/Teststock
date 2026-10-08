import fs from 'node:fs/promises';

const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const s=await read('docs/signal.json');
const p=s.optionsTradingPolicy||{};
const fail=[];
if(p.enabled!==true) fail.push('options policy disabled');
if(p.executionAgent!=='CHATGPT') fail.push('execution agent');
if(p.transport!=='ROBINHOOD_TRADING_MCP') fail.push('transport');
if(p.allowedStrategies?.join(',')!=='LONG_CALL,LONG_PUT') fail.push('allowed strategies');
if(p.buyToOpenOnly!==true||p.sellToCloseOnly!==true) fail.push('order direction');
if(p.noNakedSelling!==true||p.noExercise!==true||p.noOvernight!==true) fail.push('unsafe strategy guard');
if(p.noMargin!==true||p.noDeposits!==true||p.noBankTransfers!==true) fail.push('funding guard');
if(Number(p.maxPremiumRiskPerTradePct)!==100) fail.push('per-trade cash ceiling');
if(Number(p.maxAggregateOpenPremiumRiskPct)!==100) fail.push('aggregate cash ceiling');
if(Number(p.maxNewPremiumExposurePerNyDayPct)!==100) fail.push('daily cash ceiling');
if(Number(p.minDte)!==3||Number(p.maxDte)!==45||Number(p.expirationSafetyTradingDays)!==5) fail.push('expiration bounds');
if(Number(p.minDelta)!==0.25||Number(p.maxDelta)!==0.80) fail.push('delta bounds');
if(p.underlyingMustBeQualifiedStock!==true) fail.push('underlying qualification');
if(p.liveOptionChainRequired!==true||p.liveBrokerRecheckRequired!==true) fail.push('live option/broker recheck');
if(p.cashOnly!==true||p.accountLossCannotExceedAvailableAccountCapital!==true) fail.push('cash/account-cap rule');
const ip=s.indexOptionsTradingPolicy||{};
if(ip.enabled!==true||ip.researchEnabled!==true) fail.push('index options policy disabled');
if(ip.separateAdmissionRequired!==true) fail.push('index options separate admission');
if(ip.brokerContractResolutionRequired!==true||ip.brokerQuoteRequired!==true||ip.exactContractEvidenceRequired!==true) fail.push('index options live broker resolution');
if(ip.allowedIndexes?.join(',')!=='XND,DJX') fail.push('index options universe');
if(ip.allowedStrategies?.join(',')!=='LONG_CALL,LONG_PUT') fail.push('index options strategies');
if(ip.cashOnly!==true||ip.noMargin!==true||ip.noDeposits!==true||ip.noBankTransfers!==true) fail.push('index options funding guard');
if(ip.noExercise!==true||ip.noOvernight!==true) fail.push('index options expiry guard');
if(ip.proxyResearchOnly!==true||ip.proxyMap?.XND!=='QQQ'||ip.proxyMap?.DJX!=='DIA') fail.push('index options proxy map');
if(ip.settlement?.XND?.cashSettled!==true||ip.settlement?.XND?.exerciseStyle!=='EUROPEAN'||ip.settlement?.XND?.settleOnOpen!==false) fail.push('XND settlement');
if(ip.settlement?.DJX?.cashSettled!==true||ip.settlement?.DJX?.exerciseStyle!=='EUROPEAN'||ip.settlement?.DJX?.settleOnOpen!==true) fail.push('DJX settlement');
if(ip.taxContext?.informationalOnly!==true||ip.taxContext?.affectsEligibility!==false) fail.push('index options tax eligibility guard');
if(ip.executionEnabled===true&&!['LIVE_MICRO_BOOTSTRAP','MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(ip.admissionState)) fail.push('index options execution admission');
if(ip.admissionState==='LIVE_MICRO_BOOTSTRAP'){
  const b=ip.liveBootstrap||{};
  if(b.enabled!==true||b.mode!=='USER_AUTHORIZED_LIVE_MICRO_BOOTSTRAP') fail.push('index options bootstrap policy');
  if(b.maxOrderUsd!==null||b.affordabilityMode!=='LIVE_UNLEVERAGED_CASH'||Number(b.maxNewPositionsPerNyDay)!==1||Number(b.maxConcurrentPositions)!==1) fail.push('index options bootstrap cash policy');
  if(b.requiresExactRobinhoodContract!==true||b.requiresLiveBidAsk!==true||b.requiresLiveLiquidityCheck!==true||b.requiresWholeContractCashCheck!==true) fail.push('index options bootstrap broker checks');
  if(b.cashOnly!==true||b.marginAllowed!==false||b.noDeposits!==true||b.noTransfers!==true||b.noExercise!==true) fail.push('index options bootstrap funding/exercise guard');
}
if(ip.executionEnabled!==true&&s.autopilot?.automaticQualifiedIndexOptionBuys===true) fail.push('index options autopilot enabled before admission');

if(fail.length) throw new Error('options policy validation failed: '+[...new Set(fail)].join(', '));
console.log('options policy valid: stock/ETF options plus separate XND/DJX broker-resolved lane with user-authorized live-cash bootstrap; cash-funded, no exercise/overnight');
