import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8')),write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [signal,stocks,crypto,market]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json','docs/data/crypto-tournament.json','docs/data/market-intelligence.json'].map(read));
const DAY_TRADER_EFFECTIVE_AT='2026-09-06T15:00:00.000Z';

const commonRotation={
  allowImmediateRotationAfterConfirmedExit:true,
  cooldownAfterStopMinutes:20,
  sameSymbolReentryCooldownMinutes:30,
  consecutiveStopLossPause:{count:2,pauseMinutes:60},
  stopNewEntriesAfterStopLossExitsPerNyDay:3,
  existingDailyLossCapRemainsAuthoritative:true,
  brokerAccountRestrictionsRemainAuthoritative:true
};

function stockPolicy(x){
  return {
    classification:'DAY_TRADE',
    classificationIsAdvisory:false,
    liveExecutionStyle:'ACTIVE_DAY_TRADER',
    dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,
    mayNotCreateEligibility:true,
    existingHardStopAndRiskRemainAuthoritative:true,
    holdingWindow:'MINUTES_TO_SAME_SESSION',
    entryEvidence:[
      'authoritative regular NYSE session is open',
      'at least 30 minutes remain before the actual New York close',
      'fresh live liquidity and spread pass',
      'current price is inside the encoded entry zone and does not chase',
      'intraday VWAP/support/resistance and momentum context remain valid'
    ],
    profitExit:{
      method:'INTRADAY_BRACKET_OR_OCO_WHEN_SUPPORTED',
      targetRule:'Use validated targets, but protect or take profit sooner when the intraday setup loses momentum or confirmed resistance is reached.',
      target1:x.target1??null,
      target2:x.target2??null
    },
    lossExit:{
      method:'SUPPORTED_BROKER_PROTECTED_STOP',
      level:x.stop??null,
      placementRule:'Never widen the encoded stop. Tightening is allowed only when it reduces risk and remains technically valid.'
    },
    timeExit:{
      rule:'Every Teststock stock position opened on or after dayTraderModeEffectiveAt is a same-session trade and must be flat before the authoritative regular-session close.',
      softReviewAfterMinutes:45,
      maximumHoldingMinutes:180,
      forcedExitMinutesBeforeClose:15,
      newEntryCutoffMinutesBeforeClose:30,
      stalledTradeRule:'Exit a stalled or invalidated intraday setup rather than waiting for a distant target; never convert a losing day trade into an overnight swing.'
    },
    rotation:{
      ...commonRotation,
      maxNewEntriesPerNyDay:6,
      maxConcurrentPositions:2,
      maxNewEntriesPerExecutorRun:2
    },
    risk:{
      accountRiskRule:'Existing Teststock cap remains authoritative; active day-trader mode never increases it.',
      bracketRequired:true,
      overnightRiskAllowed:false,
      noMargin:true,
      noAverageDown:true,
      noChasing:true,
      unprotectedPositionAllowed:false
    }
  };
}

function cryptoPolicy(x){
  return {
    classification:'DAY_TRADE',
    classificationIsAdvisory:false,
    liveExecutionStyle:'ACTIVE_DAY_TRADER_24_7',
    dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,
    mayNotCreateEligibility:true,
    existingHardStopAndRiskRemainAuthoritative:true,
    holdingWindow:'INTRADAY_MAX_4_HOURS',
    entryEvidence:[
      'fresh crypto tournament generation',
      'A or A+ qualification or separately authorized seed lane',
      'current price inside encoded entry zone with no chase',
      'fresh Robinhood MCP tradability, spread, buying power, position and duplicate-order checks'
    ],
    profitExit:{
      method:'INTRADAY_LIMIT_TARGETS_WHEN_SUPPORTED',
      target1:x.target1??null,
      target2:x.target2??null,
      momentumRule:'Protect or take profit when short-horizon momentum fails even if a distant target has not printed.'
    },
    lossExit:{method:'SUPPORTED_BROKER_PROTECTED_STOP',level:x.stop??null},
    timeExit:{
      rule:'Every Teststock crypto position opened on or after dayTraderModeEffectiveAt is an intraday trade and must be revalidated continuously.',
      softReviewAfterMinutes:45,
      maximumHoldingMinutes:240,
      maximumHoldingHours:4,
      expiredSetupRule:'Exit when the short-horizon thesis expires; never turn a failed intraday crypto trade into a multi-day hold.'
    },
    rotation:{
      ...commonRotation,
      maxNewEntriesPerNyDay:4,
      maxConcurrentPositions:1,
      maxNewEntriesPerExecutorRun:1
    },
    risk:{
      noLeverage:true,
      noAverageDown:true,
      noChasing:true,
      unprotectedPositionAllowed:false
    }
  };
}

const attach=(x,fn)=>({...x,timeHorizonPolicy:fn(x)});
stocks.liveQueue=(stocks.liveQueue||[]).map(x=>attach(x,stockPolicy));
stocks.researchFinalists=(stocks.researchFinalists||[]).map(x=>attach(x,stockPolicy));
if(stocks.researchChampion)stocks.researchChampion=attach(stocks.researchChampion,stockPolicy);
if(stocks.liveBuyChampion)stocks.liveBuyChampion=attach(stocks.liveBuyChampion,stockPolicy);
stocks.liveFallbacks=(stocks.liveFallbacks||[]).map(x=>attach(x,stockPolicy));
crypto.ranked=(crypto.ranked||[]).map(x=>attach(x,cryptoPolicy));
if(crypto.researchChampion)crypto.researchChampion=attach(crypto.researchChampion,cryptoPolicy);
if(crypto.qualifiedChampion)crypto.qualifiedChampion=attach(crypto.qualifiedChampion,cryptoPolicy);

const source=(id,name,role,status,liveInfluence)=>({id,name,assetClasses:['STOCK','CRYPTO'],role,status,lastCheckedAt:new Date().toISOString(),liveInfluence});
const additions=[
  source('YAHOO_FINANCE','Yahoo Finance','SECONDARY_RESEARCH_AND_MANUAL_RECONCILIATION','REFERENCE_ONLY_NO_OFFICIAL_EXECUTION_FEED','ZERO'),
  source('GOOGLE_FINANCE','Google Finance','SECONDARY_QUOTE_AND_NEWS_RECONCILIATION','REFERENCE_ONLY_NO_SUPPORTED_TRADING_API','ZERO'),
  source('WEBULL','Webull','OPTIONAL_AUTHORIZED_MARKET_DATA_OR_BROKER_RECONCILIATION',process.env.WEBULL_APP_KEY?'CONFIGURED_SHADOW':'OPENAPI_CREDENTIALS_NOT_CONFIGURED','SHADOW_UNTIL_FORWARD_ADMISSION'),
  source('TRADINGVIEW','TradingView','CHART_TECHNICAL_AND_ALERT_VISUALIZATION','VISUALIZATION_REFERENCE_ALPACA_REMAINS_DATAFEED','ZERO'),
  source('FINVIZ','Finviz','SCREENER_FUNDAMENTAL_AND_LIQUIDITY_RECONCILIATION',process.env.FINVIZ_API_KEY?'CONFIGURED_SHADOW':'LICENSED_EXPORT_NOT_CONFIGURED','SHADOW_UNTIL_FORWARD_ADMISSION')
];
const ids=new Set((market.providers||[]).map(x=>x.id));for(const p of additions)if(!ids.has(p.id))market.providers.push(p);
market.generatedAt=new Date().toISOString();
market.timeHorizonPolicy={
  enabled:true,
  liveExecutionStyle:'ACTIVE_DAY_TRADER',
  dayTraderModeEffectiveAt:DAY_TRADER_EFFECTIVE_AT,
  classes:['DAY_TRADE'],
  selection:'Every new live Teststock position is intraday. The system may rotate into another qualified setup after a broker-confirmed exit; it never trades merely to stay busy.',
  stocks:{
    regularSessionOnly:true,
    newEntryCutoffMinutesBeforeClose:30,
    forcedExitMinutesBeforeClose:15,
    softReviewAfterMinutes:45,
    maximumHoldingMinutes:180,
    defaultFlatBySessionEnd:true,
    overnightNewPositionsAllowed:false,
    bracketOrOcoRequired:true,
    maxNewEntriesPerNyDay:6,
    maxConcurrentPositions:2,
    maxNewEntriesPerExecutorRun:2,
    cooldownAfterStopMinutes:20,
    sameSymbolReentryCooldownMinutes:30,
    consecutiveStopLossPause:{count:2,pauseMinutes:60},
    stopNewEntriesAfterStopLossExitsPerNyDay:3,
    maximumAccountRisk:'Existing Teststock cap; never increased for day trading.'
  },
  crypto:{
    market:'24_7',
    softReviewAfterMinutes:45,
    maximumHoldingMinutes:240,
    maximumHoldingHours:4,
    maxNewEntriesPerNyDay:4,
    maxConcurrentPositions:1,
    maxNewEntriesPerExecutorRun:1,
    cooldownAfterStopMinutes:20,
    sameSymbolReentryCooldownMinutes:30,
    consecutiveStopLossPause:{count:2,pauseMinutes:60},
    stopNewEntriesAfterStopLossExitsPerNyDay:3,
    revalidateContinuously:true,
    noMultiDayConversion:true,
    noLeverage:true,
    noAverageDown:true,
    noChasing:true
  },
  rotationSafety:{
    allowImmediateRotationAfterConfirmedExit:true,
    existingDailyLossCapRemainsAuthoritative:true,
    brokerAccountRestrictionsRemainAuthoritative:true,
    noForcedTrades:true
  }
};
signal.timeHorizonPolicy=market.timeHorizonPolicy;
signal.unifiedMarketIntelligence=market;
await Promise.all([
  write('docs/data/market-intelligence.json',market),
  write('docs/data/stock-tournament.json',stocks),
  write('docs/data/crypto-tournament.json',crypto),
  write('docs/signal.json',signal),
  write('docs/data/claude-signal.json',signal)
]);
console.log(`Active day-trader mode applied: stocks=${stocks.liveQueue.length+stocks.researchFinalists.length}; crypto=${crypto.ranked.length}; stock max/day=6; crypto max/day=4`);
