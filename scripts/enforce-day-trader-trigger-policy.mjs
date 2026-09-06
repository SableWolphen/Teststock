import fs from 'node:fs/promises';
import {newYorkClock} from './nyse-session.mjs';

const path='docs/data/trigger-board.json';
const board=JSON.parse(await fs.readFile(path,'utf8'));
const now=new Date();
const nyNow=newYorkClock(now);
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_FORCED_EXIT','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
const entryTriggers=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER']);

function nyDateKey(value){
  const d=new Date(value||0);
  if(!Number.isFinite(d.getTime()))return null;
  return newYorkClock(d).dateKey;
}

let blockedLateEntries=0,forcedExits=0;
const items=(board.items||[]).map(item=>{
  if(item.assetClass==='STOCK'&&item.kind==='ENTRY'&&entryTriggers.has(item.status)){
    const s=item.marketSession||{};
    if(s.calendarAvailable!==true||s.regularSession!==true){
      blockedLateEntries++;
      return {...item,status:'DAY_TRADE_MARKET_CLOSED',reason:'Day-trader mode permits new stock entries only during the authoritative regular NYSE session.'};
    }
    if(s.entryAllowed!==true||Number(s.minutesToClose)<30){
      blockedLateEntries++;
      return {...item,status:'DAY_TRADE_ENTRY_CUTOFF',reason:'Day-trader mode requires at least 30 minutes before the authoritative New York close for every new stock entry.'};
    }
    return {...item,dayTraderMode:true,overnightAllowed:false};
  }

  if(item.assetClass==='STOCK'&&item.kind==='POSITION'){
    const s=item.marketSession||{};
    const openedToday=nyDateKey(item.armedAt)===nyNow.dateKey;
    const explicitlyDayTrade=item.dayTradeSeedLane===true||item.dayTraderMode===true||item.timeHorizonPolicy?.classification==='DAY_TRADE';
    if((openedToday||explicitlyDayTrade)&&s.forcedExitDue===true&&!['TRIGGER_1_STOP','STOCK_DAY_TRADE_FORCED_EXIT'].includes(item.status)){
      forcedExits++;
      return {...item,status:'STOCK_DAY_TRADE_FORCED_EXIT',dayTraderMode:true,reason:s.sessionEnded?'Day-trader stock position remains open after the regular session; reconcile and flatten Teststock-attributable quantity.':`Day-trader forced-exit window is active with ${s.minutesToClose} minutes to close; flatten Teststock-attributable quantity and verify broker-confirmed flat.`};
    }
  }
  return item;
});

const oldEvents=new Map((board.events||[]).map(e=>[e.id,e]));
const events=items.filter(x=>actionable.has(x.status)).map(x=>{
  const old=oldEvents.get(x.id)||{};
  return {
    ...old,
    id:x.id,
    assetClass:x.assetClass,
    ticker:x.ticker,
    trigger:x.status,
    entryTier:x.entryTier??old.entryTier??null,
    entryTierLabel:x.entryTierLabel??old.entryTierLabel??null,
    entryTierSizeMultiplier:x.entryTierSizeMultiplier??old.entryTierSizeMultiplier??null,
    setupGrade:x.setupGrade??old.setupGrade??null,
    queueRank:x.queueRank??old.queueRank??null,
    opportunityScore:x.opportunityScore??old.opportunityScore??null,
    growthQuality:x.growthQuality??old.growthQuality??null,
    rewardRisk:x.rewardRisk??old.rewardRisk??null,
    profitabilityAdmission:x.profitabilityAdmission??old.profitabilityAdmission??null,
    seedLane:x.seedLane??old.seedLane??null,
    dayTradeSeedLane:x.dayTradeSeedLane??old.dayTradeSeedLane??null,
    marketSession:x.marketSession??old.marketSession??null,
    observedPrice:x.observedPrice??old.observedPrice??null,
    stop:x.stop??old.stop??null,
    target1:x.target1??old.target1??null,
    target2:x.target2??old.target2??null,
    dayTraderMode:x.assetClass==='STOCK'?true:(old.dayTraderMode??null),
    overnightAllowed:x.assetClass==='STOCK'?false:(old.overnightAllowed??null)
  };
});

board.items=items;
board.events=events;
board.dayTraderPolicy={
  enabled:true,
  stocks:{regularSessionOnly:true,newEntryCutoffMinutesBeforeClose:30,forcedExitMinutesBeforeClose:15,overnightAllowed:false},
  crypto:{intradayOnly:true,maximumHoldingHours:8},
  enforcedAt:new Date().toISOString()
};
await fs.writeFile(path,JSON.stringify(board,null,2));
console.log(`Day-trader trigger policy enforced: blockedLateEntries=${blockedLateEntries}; forcedExits=${forcedExits}; actionableEvents=${events.length}`);
