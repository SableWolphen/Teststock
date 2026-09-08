import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [signal,stocks,crypto,market]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json','docs/data/crypto-tournament.json','docs/data/market-intelligence.json'].map(read));
const DAY_TRADER_EFFECTIVE_AT='2026-09-06T15:00:00.000Z';

const commonRotation={
  allowImmediateRotationAfterConfirmedExit:true,
  fixedDailyEntryCountLimit:null,
  fixedConcurrentPositionCountLimit:null,
  fixedPerExecutorRunEntryCountLimit:null,
  capacityMode:'DYNAMIC_RISK_CASH_AND_BROKER_LIMITED',
  cooldownAfterStopMinutes:5,
  consecutiveStopLossPause:{count:3,pauseMinutes:20},
  stopNewEntriesAfterStopLossExitsPerNyDay:null,
  existingDailyLossCapRemainsAuthoritative:true,
  brokerAccountRestrictionsRemainAuthoritative:true,
  portfolioHeatRemainsAuthoritative:true,
  correlationLimitsRemainAuthoritative:true,
  buyingPowerAndSettledFundsRemainAuthoritative:true,
  orderExecution:{
    entryPreference:'MARKETABLE_LIMIT_WHEN_SUPPORTED',
    exitPreference:'FASTEST_SUPPORTED_RISK_APPROPRIATE_ORDER',
    stalePassiveOrderSeconds:45,
    allowCancelReplaceAfterBrokerReconciliation:true,
    neverBlindRetry:true
  }
};
const stockRotation={...commonRotation,sameSymbolReentryCooldownMinutes:null,maximumEntriesPerSymbolPerNyDay:1,sameDayStockReentryAllowed:false,distinctStockRotationRequired:true,partialFillTopUpAsNewEntryAllowed:false};
const cryptoRotation={...commonRotation,sameSymbolReentryCooldownMinutes:10};

function stockPolicy(x){return {
  classification:'DAY_TRADE',classificationIsAdvisory:false,liveExecutionStyle:'ACTIVE_DAY_TRADER',dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,
  mayNotCreateEligibility:true,existingHardStopAndRiskRemainAuthoritative:true,holdingWindow:'MINUTES_TO_SAME_SESSION',
  entryEvidence:['authoritative regular NYSE session is open','at least 20 minutes remain before the actual New York close','fresh live liquidity and spread pass','current price is inside the encoded entry zone and does not chase','intraday VWAP/support/resistance and momentum context remain valid','no prior Teststock buy fill for this ticker in the current New York trading day'],
  profitExit:{method:'INTRADAY_FAST_EXIT_OR_BRACKET_WHEN_SUPPORTED',targetRule:'Use validated targets, but protect or take profit sooner when momentum fades or resistance is reached.',target1:x.target1??null,target2:x.target2??null},
  lossExit:{method:'FAST_SUPPORTED_PROTECTED_EXIT',level:x.stop??null,placementRule:'Never widen the encoded stop. Tightening is allowed only when it reduces risk and remains technically valid.'},
  timeExit:{rule:'Every Teststock stock position opened on or after dayTraderModeEffectiveAt is a same-session trade and must be flat before the authoritative regular-session close.',softReviewAfterMinutes:20,maximumHoldingMinutes:120,forcedExitMinutesBeforeClose:10,newEntryCutoffMinutesBeforeClose:20,stalledTradeRule:'Exit a stalled or invalidated intraday setup quickly rather than waiting for a distant target; never convert a losing day trade into an overnight swing.'},
  rotation:{...stockRotation},
  risk:{accountRiskRule:'Existing Teststock cap remains authoritative; easier execution never increases risk.',bracketRequired:true,overnightRiskAllowed:false,noMargin:true,noAverageDown:true,noChasing:true,unprotectedPositionAllowed:false}
};}

function cryptoPolicy(x){return {
  classification:'DAY_TRADE',classificationIsAdvisory:false,liveExecutionStyle:'ACTIVE_DAY_TRADER_24_7',dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,
  mayNotCreateEligibility:true,existingHardStopAndRiskRemainAuthoritative:true,holdingWindow:'INTRADAY_MAX_3_HOURS',
  entryEvidence:['fresh crypto tournament generation','A or A+ qualification or separately authorized seed lane','current price inside encoded entry zone with no chase','fresh Robinhood MCP tradability, spread, buying power, position and duplicate-order checks'],
  profitExit:{method:'FAST_INTRADAY_LIMIT_OR_MARKETABLE_EXIT_WHEN_SUPPORTED',target1:x.target1??null,target2:x.target2??null,momentumRule:'Protect or take profit promptly when short-horizon momentum fails.'},
  lossExit:{method:'FAST_SUPPORTED_PROTECTED_EXIT',level:x.stop??null},
  timeExit:{rule:'Every Teststock crypto position opened on or after dayTraderModeEffectiveAt is an intraday trade and must be revalidated continuously.',softReviewAfterMinutes:20,maximumHoldingMinutes:180,maximumHoldingHours:3,expiredSetupRule:'Exit when the short-horizon thesis expires; never turn a failed intraday crypto trade into a multi-day hold.'},
  rotation:{...cryptoRotation},
  risk:{noLeverage:true,noAverageDown:true,noChasing:true,unprotectedPositionAllowed:false}
};}

const attach=(x,fn)=>({...x,timeHorizonPolicy:fn(x)});
stocks.liveQueue=(stocks.liveQueue||[]).map(x=>attach(x,stockPolicy));stocks.researchFinalists=(stocks.researchFinalists||[]).map(x=>attach(x,stockPolicy));if(stocks.researchChampion)stocks.researchChampion=attach(stocks.researchChampion,stockPolicy);if(stocks.liveBuyChampion)stocks.liveBuyChampion=attach(stocks.liveBuyChampion,stockPolicy);stocks.liveFallbacks=(stocks.liveFallbacks||[]).map(x=>attach(x,stockPolicy));
crypto.ranked=(crypto.ranked||[]).map(x=>attach(x,cryptoPolicy));if(crypto.researchChampion)crypto.researchChampion=attach(crypto.researchChampion,cryptoPolicy);if(crypto.qualifiedChampion)crypto.qualifiedChampion=attach(crypto.qualifiedChampion,cryptoPolicy);

const source=(id,name,role,status,liveInfluence)=>({id,name,assetClasses:['STOCK','CRYPTO'],role,status,lastCheckedAt:new Date().toISOString(),liveInfluence});
const additions=[source('YAHOO_FINANCE','Yahoo Finance','SECONDARY_RESEARCH_AND_MANUAL_RECONCILIATION','REFERENCE_ONLY_NO_OFFICIAL_EXECUTION_FEED','ZERO'),source('GOOGLE_FINANCE','Google Finance','SECONDARY_QUOTE_AND_NEWS_RECONCILIATION','REFERENCE_ONLY_NO_SUPPORTED_TRADING_API','ZERO'),source('WEBULL','Webull','OPTIONAL_AUTHORIZED_MARKET_DATA_OR_BROKER_RECONCILIATION',process.env.WEBULL_APP_KEY?'CONFIGURED_SHADOW':'OPENAPI_CREDENTIALS_NOT_CONFIGURED','SHADOW_UNTIL_FORWARD_ADMISSION'),source('TRADINGVIEW','TradingView','CHART_TECHNICAL_AND_ALERT_VISUALIZATION','VISUALIZATION_REFERENCE_ALPACA_REMAINS_DATAFEED','ZERO'),source('FINVIZ','Finviz','SCREENER_FUNDAMENTAL_AND_LIQUIDITY_RECONCILIATION',process.env.FINVIZ_API_KEY?'CONFIGURED_SHADOW':'LICENSED_EXPORT_NOT_CONFIGURED','SHADOW_UNTIL_FORWARD_ADMISSION')];
const ids=new Set((market.providers||[]).map(x=>x.id));for(const p of additions)if(!ids.has(p.id))market.providers.push(p);
market.generatedAt=new Date().toISOString();
market.timeHorizonPolicy={enabled:true,liveExecutionStyle:'ACTIVE_DAY_TRADER',dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,classes:['DAY_TRADE'],selection:'Every new live Teststock position is intraday. There is no fixed stock or crypto trade-count quota; entries and exits should be easy to execute while hard risk, cash, broker, freshness and protection constraints remain authoritative.',stocks:{regularSessionOnly:true,newEntryCutoffMinutesBeforeClose:20,forcedExitMinutesBeforeClose:10,softReviewAfterMinutes:20,maximumHoldingMinutes:120,defaultFlatBySessionEnd:true,overnightNewPositionsAllowed:false,bracketOrOcoRequired:true,fixedDailyEntryCountLimit:null,fixedConcurrentPositionCountLimit:null,fixedPerExecutorRunEntryCountLimit:null,capacityMode:'DYNAMIC_RISK_CASH_AND_BROKER_LIMITED',cooldownAfterStopMinutes:5,sameSymbolReentryCooldownMinutes:null,maximumEntriesPerSymbolPerNyDay:1,sameDayStockReentryAllowed:false,distinctStockRotationRequired:true,partialFillTopUpAsNewEntryAllowed:false,consecutiveStopLossPause:{count:3,pauseMinutes:20},stopNewEntriesAfterStopLossExitsPerNyDay:null,orderExecution:commonRotation.orderExecution,maximumAccountRisk:'Existing Teststock cap; never increased for day trading.'},crypto:{market:'24_7',softReviewAfterMinutes:20,maximumHoldingMinutes:180,maximumHoldingHours:3,fixedDailyEntryCountLimit:null,fixedConcurrentPositionCountLimit:null,fixedPerExecutorRunEntryCountLimit:null,capacityMode:'DYNAMIC_RISK_CASH_AND_BROKER_LIMITED',cooldownAfterStopMinutes:5,sameSymbolReentryCooldownMinutes:10,consecutiveStopLossPause:{count:3,pauseMinutes:20},stopNewEntriesAfterStopLossExitsPerNyDay:null,orderExecution:commonRotation.orderExecution,revalidateContinuously:true,noMultiDayConversion:true,noLeverage:true,noAverageDown:true,noChasing:true},rotationSafety:{allowImmediateRotationAfterConfirmedExit:true,existingDailyLossCapRemainsAuthoritative:true,brokerAccountRestrictionsRemainAuthoritative:true,portfolioHeatRemainsAuthoritative:true,correlationLimitsRemainAuthoritative:true,buyingPowerAndSettledFundsRemainAuthoritative:true,noForcedTrades:true}};
signal.timeHorizonPolicy=market.timeHorizonPolicy;signal.unifiedMarketIntelligence=market;
await Promise.all([write('docs/data/market-intelligence.json',market),write('docs/data/stock-tournament.json',stocks),write('docs/data/crypto-tournament.json',crypto),write('docs/signal.json',signal),write('docs/data/claude-signal.json',signal)]);
console.log(`Active day-trader policy synchronized: stocks=${stocks.liveQueue.length+stocks.researchFinalists.length}; crypto=${crypto.ranked.length}; stock same-day reentry disabled; dynamic capacity preserved`);