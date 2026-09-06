import fs from 'node:fs/promises';
const p='docs/data/trigger-board.json';
const board=JSON.parse(await fs.readFile(p,'utf8'));
const actionable=new Set(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_FORCED_EXIT','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
const events=(board.items||[]).filter(x=>actionable.has(x.status)).map(x=>({
  id:x.id,assetClass:x.assetClass,ticker:x.ticker,trigger:x.status,
  entryTier:x.entryTier??null,entryTierLabel:x.entryTierLabel??null,entryTierSizeMultiplier:x.entryTierSizeMultiplier??null,
  setupGrade:x.setupGrade??null,queueRank:x.queueRank??null,opportunityScore:x.opportunityScore??null,growthQuality:x.growthQuality??null,rewardRisk:x.rewardRisk??null,
  profitabilityAdmission:x.profitabilityAdmission??null,qualificationSource:x.qualificationSource??null,tournamentGeneratedAt:x.tournamentGeneratedAt??null,
  decisionIntelligenceEligible:x.decisionIntelligenceEligible??null,seedLane:x.seedLane??null,dayTradeSeedLane:x.dayTradeSeedLane??null,
  marketSession:x.marketSession??null,minimumEntry:x.minimumEntry??null,maximumEntry:x.maximumEntry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null,
  observedPrice:x.observedPrice??null,stateChangedAt:x.stateChangedAt??null,intradayEdge:x.intradayEdge??null,reason:x.reason??null
}));
const buys=events.filter(x=>x.trigger==='BUY_TRIGGER').sort((a,b)=>((a.assetClass==='STOCK'&&a.entryTier==='A')?0:(a.assetClass==='STOCK'&&a.entryTier==='B')?1:2)-((b.assetClass==='STOCK'&&b.entryTier==='A')?0:(b.assetClass==='STOCK'&&b.entryTier==='B')?1:2)||Number(b.intradayEdge?.costAdjustedEdge??-999)-Number(a.intradayEdge?.costAdjustedEdge??-999)||Number(b.intradayEdge?.adjustedScore??-999)-Number(a.intradayEdge?.adjustedScore??-999)||Number(a.queueRank||999)-Number(b.queueRank||999));
for(const [i,e] of buys.entries())e.queueRole=i===0?'CURRENT_BEST_BUY':'FALLBACK_BUY';
board.events=events;board.executionNeeded=events.length>0;
board.buyCompetition={...(board.buyCompetition||{}),eligibleNow:buys.length,best:buys[0]||null,fallbacks:buys.slice(1),tierPriority:['A','B'],rule:'Already-qualified A stocks rank before B; within tier, fresh cost-adjusted intraday edge and adjusted score break ties. Intraday intelligence may block/reorder/reduce size but never create eligibility or raise risk.'};
await fs.writeFile(p,JSON.stringify(board,null,2));
console.log(`Rebuilt intraday trigger state: ${events.length} actionable, ${buys.length} normal stock buys.`);
