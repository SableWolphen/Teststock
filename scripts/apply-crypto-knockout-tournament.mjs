import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const UNIVERSE='docs/data/crypto-universe.json';
const OUT='docs/data/crypto-tournament.json';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const signal=await read(SIGNAL);
const universe=await read(UNIVERSE);
const ranked=(Array.isArray(universe.ranked)?universe.ranked:[]).filter(x=>String(x.symbol||'').endsWith('/USD'));
const candidates=ranked.map((x,i)=>({rank:i+1,ticker:x.symbol,grade:x.setupGrade||'NO_TRADE',growthQuality:x.growthQuality??null,score:x.score??null,historicalWinRate:x.validation?.winRate??null,historicalSamples:x.validation?.samples??null,rewardRisk:x.rewardRisk2??x.rewardRisk1??null,confirm4h:Boolean(x.confirm4h),rsi4h:x.rsi4h??null,vwap4h:x.vwap4h??null,pullbackToSupportOrVwap:Boolean(x.pullbackToSupportOrVwap),momentumTurnedUp:Boolean(x.momentumTurnedUp),volumeConfirm:Boolean(x.volumeConfirm),btcTrendSupport:x.btcTrendSupport??null,dollarVolume20d:x.dollarVolume20d??null,dollarVolume24hReal:x.dollarVolume24hReal??null,entry:x.entry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null,robinhoodTradable:x.robinhoodTradable??null}));
const qualified=candidates.filter(x=>x.grade==='A+'||x.grade==='A');
const champion=qualified[0]||null;
const brokerExecution={
  status:'CLAUDE_ROBINHOOD_TRADING_MCP',
  lane:'CLAUDE_ROBINHOOD_TRADING_MCP',
  directGitHubOrderSubmissionAllowed:false,
  executableByCurrentClaudeRobinhoodConnection:true,
  executableByDirectRobinhoodCryptoApi:false,
  requiresAuthenticatedRobinhoodTradingMcp:true,
  researchOnly:false,
  requiresClaude:true,
  rule:'Claude is the sole execution agent. Use the Teststock qualified crypto champion first, then already-qualified fallbacks in tournament order. Before any order Claude must use the authenticated Robinhood Trading MCP to independently verify the live quote, tradability, Agentic-account buying power, holdings, open orders, sizing, no-chase limits, duplicate protection and required protection. GitHub research/monitoring must never submit the broker order directly.'
};
const tournament={schemaVersion:4,source:'TESTSTOCK_CRYPTO_KNOCKOUT',generatedAt:new Date().toISOString(),market:'24_7',supportedUsdPairs:Number(universe.supportedUsdPairs||0),objective:'Scan every active tradable USD crypto pair, eliminate weak setups, and select the strongest qualified crypto winner plus qualified fallbacks for Claude to verify and execute through the authenticated Robinhood Trading MCP.',brokerExecution,policy:{scanAllSupportedUsdPairs:true,alwaysProduceResearchChampion:Boolean(candidates.length),buyWhenAtLeastOneFullyQualifiedCandidateExists:true,forcedCryptoBuy:false,noEligibleCandidateAction:'KEEP_SCANNING_24_7',winnerSelection:'A_PLUS_BEFORE_A_THEN_GROWTH_QUALITY_SCORE_LIQUIDITY',btcContextRequiredForAltcoins:true,noLeverage:true,noAverageDown:true},researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbacks:qualified.slice(1,6),ranked:candidates};
signal.cryptoTournament={enabled:true,sourceRef:'docs/data/crypto-tournament.json',market:'24_7',scanAllSupportedUsdPairs:true,supportedUsdPairs:Number(universe.supportedUsdPairs||0),brokerExecution,buyWhenAtLeastOneFullyQualifiedCandidateExists:true,forcedCryptoBuy:false,noEligibleCandidateAction:'KEEP_SCANNING_24_7',researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbackTickers:qualified.slice(1,6).map(x=>x.ticker),instructions:'Claude evaluates only the Teststock qualified champion and already-qualified fallbacks in order through the authenticated Robinhood Trading MCP. Claude must not invent a crypto symbol or bypass any live broker, risk, freshness, no-chase, duplicate-order, sizing or protection check.'};
signal.cryptoPlan={...(signal.cryptoPlan||{}),execution:{...(signal.cryptoPlan?.execution||{}),mode:'CLAUDE_ROBINHOOD_TRADING_MCP',researchOnly:false,requiresClaude:true,directGitHubOrderSubmissionAllowed:false,note:brokerExecution.rule}};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),cryptoKnockoutTournament:true,cryptoBrokerCapabilityGate:true,claudeSoleExecutionAgent:true}};
signal.schemaVersion=Math.max(35,Number(signal.schemaVersion||0));
await fs.writeFile(OUT,JSON.stringify(tournament,null,2));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Crypto knockout research: ${tournament.supportedUsdPairs} supported pairs, ${qualified.length} A/A+ candidate(s), Claude Robinhood Trading MCP execution lane.`);
