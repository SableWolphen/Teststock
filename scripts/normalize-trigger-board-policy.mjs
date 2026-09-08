import fs from 'node:fs/promises';

const path='docs/data/trigger-board.json';
const board=JSON.parse(await fs.readFile(path,'utf8'));
const STOCK_ENTRY_CUTOFF_MINUTES=20;
const STOCK_FORCED_EXIT_MINUTES=10;
let bTierAdjusted=0,dayLaneAdjusted=0;

for(const item of board.items||[]){
  if(item?.assetClass==='STOCK'&&item?.entryTier==='B'){
    const current=Number(item.entryTierSizeMultiplier);
    if(!Number.isFinite(current)||current>0.25){item.entryTierSizeMultiplier=0.25;bTierAdjusted++;}
  }
  if(item?.assetClass==='STOCK'&&item?.dayTradeSeedLane?.eligible===true){
    item.dayTradeSeedLane={...item.dayTradeSeedLane,entryCutoffMinutesBeforeClose:STOCK_ENTRY_CUTOFF_MINUTES,forcedExitStartMinutesBeforeClose:STOCK_FORCED_EXIT_MINUTES,mustBeFlatBeforeMarketClose:true};
    dayLaneAdjusted++;
  }
}

for(const event of board.events||[]){
  if(event?.assetClass==='STOCK'&&event?.entryTier==='B'){
    const current=Number(event.entryTierSizeMultiplier);
    if(!Number.isFinite(current)||current>0.25)event.entryTierSizeMultiplier=0.25;
  }
  if(event?.assetClass==='STOCK'&&event?.dayTradeSeedLane?.eligible===true){
    event.dayTradeSeedLane={...event.dayTradeSeedLane,entryCutoffMinutesBeforeClose:STOCK_ENTRY_CUTOFF_MINUTES,forcedExitStartMinutesBeforeClose:STOCK_FORCED_EXIT_MINUTES,mustBeFlatBeforeMarketClose:true};
  }
}

board.stockSessionRule=`Same-day stock entries require an authoritative regular session and at least ${STOCK_ENTRY_CUTOFF_MINUTES} minutes to close. Day-trader stock positions enter forced-exit handling from ${STOCK_FORCED_EXIT_MINUTES} minutes before close and remain there until broker-confirmed flat.`;
board.dayTraderPolicy={...(board.dayTraderPolicy||{}),enabled:true,stocks:{...(board.dayTraderPolicy?.stocks||{}),regularSessionOnly:true,newEntryCutoffMinutesBeforeClose:STOCK_ENTRY_CUTOFF_MINUTES,forcedExitMinutesBeforeClose:STOCK_FORCED_EXIT_MINUTES,overnightAllowed:false}};
await fs.writeFile(path,JSON.stringify(board,null,2));
console.log(`Trigger-board policy normalized: B-tier<=25% adjusted=${bTierAdjusted}; day-lane timing adjusted=${dayLaneAdjusted}; stock timing=${STOCK_ENTRY_CUTOFF_MINUTES}/${STOCK_FORCED_EXIT_MINUTES}.`);
