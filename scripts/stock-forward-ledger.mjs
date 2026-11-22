// Forward-only paper observations. No broker transport, balances or order authority.
import {fresh,validSymbol} from './trading-research-policy.mjs';
import {newYorkClock} from './nyse-session.mjs';
import {netShadowResult,sameSessionOutcome} from './stock-shadow-engine.mjs';
import {independentOutcomes} from './performance-evidence.mjs';

export const FORWARD_POLICY=Object.freeze({setupType:'BREAKOUT_VOLUME_V1',maxNewPerSession:2,maxOpen:2,maxSpreadFraction:.003,
  minimumVolumeRatio:2,maxChaseFraction:.015,stopBelowBreakoutFraction:.005,minRiskFraction:.002,maxRiskFraction:.02,
  targetR:2,maxHoldingMinutes:60,entryCutoffMinutes:20,exitCutoffMinutes:10,maxObservationGapMs:600000,
  slippageBpsPerSide:5,version:1});
const positive=x=>typeof x==='number'&&Number.isFinite(x)&&x>0;
const nyDate=t=>newYorkClock(new Date(t)).dateKey;
const stamp=t=>new Date(t).toISOString();
function quote(candidate,now) {
  if(candidate?.asset!=='stock'||candidate.feed!=='iex'||!validSymbol(candidate.symbol,'stock')||!positive(candidate.bid)||!positive(candidate.ask)||candidate.ask<candidate.bid||!fresh(candidate.quoteAsOf,now,120000))return null;
  return {bid:candidate.bid,ask:candidate.ask,asOf:candidate.quoteAsOf,feed:'iex'};
}

export function summarizeForwardTrades(trades) {
  const rows=independentOutcomes(trades.filter(t=>t.status==='RESOLVED'&&t.evidenceEligible===true));
  const gain=rows.reduce((s,t)=>s+Math.max(0,t.realizedR),0),loss=rows.reduce((s,t)=>s+Math.max(0,-t.realizedR),0);
  let equityR=0,peakR=0,maxDrawdownR=0;
  for(const t of [...rows].sort((a,b)=>a.resolvedAt.localeCompare(b.resolvedAt))) {equityR+=t.realizedR;peakR=Math.max(peakR,equityR);maxDrawdownR=Math.max(maxDrawdownR,peakR-equityR);}
  return {independentResolvedTrades:rows.length,distinctTradingDays:new Set(rows.map(t=>t.createdDate)).size,
    winRatePct:rows.length?rows.filter(t=>t.realizedR>0).length/rows.length*100:null,
    afterCostAverageR:rows.length?equityR/rows.length:null,afterCostProfitFactor:loss?gain/loss:gain?999:null,
    maxDrawdownR:rows.length?maxDrawdownR:null,openTrades:trades.filter(t=>t.status==='OPEN').length,
    invalidatedTrades:trades.filter(t=>t.status==='INVALIDATED'||t.evidenceEligible===false).length,
    brokerVerified:false,note:'R statistics for independent hypothetical observations; not an account return or confirmed fill history.'};
}

export function advanceStockForwardLedger(previous,report,now=Date.now()) {
  if(!Number.isFinite(now)||report?.mode!=='RESEARCH_ONLY'||report.liveOrdersEnabled!==false||!fresh(report.generatedAt,now,300000)||!Array.isArray(report.candidates))throw Error('FORWARD_REPORT_INVALID');
  if(previous!==null&&(!previous||previous.schemaVersion!==1||!Array.isArray(previous.trades)))throw Error('FORWARD_LEDGER_INVALID');
  if(previous?.lastReportGeneratedAt) {
    if(!Number.isFinite(Date.parse(previous.lastReportGeneratedAt))||Date.parse(previous.lastReportGeneratedAt)>now)throw Error('FORWARD_LEDGER_CLOCK_INVALID');
    if(Date.parse(report.generatedAt)<=Date.parse(previous.lastReportGeneratedAt))return previous;
  }
  const trades=structuredClone(previous?.trades||[]),ids=new Set();
  for(const t of trades) {
    if(typeof t.id!=='string'||ids.has(t.id)||!['OPEN','RESOLVED','INVALIDATED'].includes(t.status))throw Error('FORWARD_LEDGER_INVALID');
    ids.add(t.id);
    if(t.status==='OPEN'&&(!positive(t.entry)||!positive(t.stop)||!positive(t.target2)||t.stop>=t.entry||t.target2<=t.entry||!Number.isFinite(Date.parse(t.createdAt))||!Number.isFinite(Date.parse(t.closeAt))||!Number.isFinite(Date.parse(t.lastObservedAt))||!Number.isFinite(Date.parse(t.lastQuoteAt))))throw Error('FORWARD_OPEN_TRADE_INVALID');
  }
  const today=nyDate(now),bySymbol=new Map();
  for(const c of report.candidates) {
    if(bySymbol.has(c.symbol)) {bySymbol.set(c.symbol,null);continue;} // conflicting rows are unusable
    bySymbol.set(c.symbol,c);
  }
  for(let i=0;i<trades.length;i++) {
    const t=trades[i];if(t.status!=='OPEN')continue;
    const q=quote(bySymbol.get(t.symbol),now),close=Date.parse(t.closeAt);
    if(t.createdDate!==today||(!q&&now>=close)) {
      trades[i]={...t,status:'INVALIDATED',evidenceEligible:false,realizedR:null,invalidatedAt:stamp(now),reason:'SESSION_EXIT_NOT_OBSERVED'};continue;
    }
    if(now-Date.parse(t.lastObservedAt)>FORWARD_POLICY.maxObservationGapMs)t.evidenceEligible=false;
    if(!q||Date.parse(q.asOf)<=Date.parse(t.lastQuoteAt))continue;
    t.lastObservedAt=stamp(now);t.lastQuoteAt=q.asOf;
    const reason=now>=close-FORWARD_POLICY.exitCutoffMinutes*60000?'SESSION_EXIT':q.bid<=t.stop?'STOP':q.bid>=t.target2?'TARGET':now-Date.parse(t.createdAt)>=FORWARD_POLICY.maxHoldingMinutes*60000?'TIME_EXIT':null;
    if(!reason)continue;
    if(!sameSessionOutcome(t.entryTouchedAt,stamp(now))) {trades[i]={...t,status:'INVALIDATED',evidenceEligible:false,realizedR:null,reason:'INVALID_EXIT_SESSION'};continue;}
    const net=netShadowResult(t.entry,q.bid,t.stop,FORWARD_POLICY.slippageBpsPerSide);
    trades[i]={...t,...net,status:'RESOLVED',outcome:net.realizedR>0?'WIN':net.realizedR<0?'LOSS':'FLAT',resolvedAt:stamp(now),exitReason:reason,modelExitPrice:q.bid,exitQuote:q,
      afterCosts:true,costModel:{version:1,spread:'OBSERVED_ASK_TO_BID',assumedSlippageBpsPerSide:FORWARD_POLICY.slippageBpsPerSide,brokerVerified:false}};
  }
  const close=Date.parse(report.session?.closeAt);
  const sessionValid=report.lanes?.session==='OPEN'&&report.session?.isOpen===true&&report.session.source==='ALPACA_CLOCK'&&fresh(report.session.asOf,now,300000)&&Number.isFinite(close)&&close>now&&close-now<=24*3600000&&nyDate(close)===today;
  const entryAllowed=sessionValid&&close-now>FORWARD_POLICY.entryCutoffMinutes*60000&&report.lanes.stock==='COMPLETE'&&report.macro?.status==='CLEAR';
  if(entryAllowed)for(const c of report.candidates) {
    const openedToday=trades.filter(t=>t.createdDate===today);
    if(openedToday.length>=FORWARD_POLICY.maxNewPerSession||trades.filter(t=>t.status==='OPEN').length>=FORWARD_POLICY.maxOpen)break;
    if(openedToday.some(t=>t.symbol===c.symbol)||bySymbol.get(c.symbol)!==c||c.status!=='WATCH'||c.liveEligible!==false||!c.signal?.confirmed||c.signal.breakout!==true||!fresh(c.signal.barAsOf,now,120000)||!(c.signal.volumeRatio>=FORWARD_POLICY.minimumVolumeRatio))continue;
    const q=quote(c,now),trigger=c.signal.priorHigh;if(!q||!positive(trigger))continue;
    const spread=(q.ask-q.bid)/((q.ask+q.bid)/2),stop=trigger*(1-FORWARD_POLICY.stopBelowBreakoutFraction),risk=q.ask-stop;
    if(spread>FORWARD_POLICY.maxSpreadFraction||q.ask<=trigger||q.ask>trigger*(1+FORWARD_POLICY.maxChaseFraction)||risk/q.ask<FORWARD_POLICY.minRiskFraction||risk/q.ask>FORWARD_POLICY.maxRiskFraction)continue;
    trades.push({id:`${today}|${c.symbol}|${FORWARD_POLICY.setupType}`,symbol:c.symbol,setupType:FORWARD_POLICY.setupType,runtimeRegime:'UNKNOWN',createdDate:today,createdAt:stamp(now),entryTouchedAt:stamp(now),closeAt:stamp(close),lastObservedAt:stamp(now),lastQuoteAt:q.asOf,
      entry:q.ask,stop,target2:q.ask+FORWARD_POLICY.targetR*risk,entryQuote:q,status:'OPEN',decision:'ACCEPTED',realizedR:null,timeHorizon:'INTRADAY',modelOnly:true,evidenceEligible:true,liveEligible:false,brokerVerified:false,policyVersion:FORWARD_POLICY.version});
  }
  const retained=[...trades.filter(t=>t.status!=='OPEN').slice(-10000),...trades.filter(t=>t.status==='OPEN')];
  return {schemaVersion:1,generatedAt:stamp(now),lastReportGeneratedAt:report.generatedAt,mode:'FORWARD_PAPER_ONLY',liveOrdersEnabled:false,policy:FORWARD_POLICY,
    collectionStatus:sessionValid?'SESSION_OBSERVED':'SESSION_UNVERIFIED_OR_CLOSED',trades:retained,summary:summarizeForwardTrades(retained),
    limitations:['Hypothetical ask-entry/bid-exit observations; IEX coverage and scheduled sampling can miss price paths.','Monitoring gaps invalidate admission evidence; missed session exits never become invented fills.','Results apply only to BREAKOUT_VOLUME_V1; no automatic strategy promotion or live order authority.']};
}
