import fs from 'node:fs/promises';

const SIGNAL='docs/signal.json';
const UNIVERSE='docs/data/crypto-universe.json';
const OUT='docs/data/crypto-tournament.json';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const signal=await read(SIGNAL);
const universe=await read(UNIVERSE);
const ranked=Array.isArray(universe.ranked)?universe.ranked:[];
const candidates=ranked.map((x,i)=>({rank:i+1,ticker:x.symbol,grade:x.setupGrade||'NO_TRADE',growthQuality:x.growthQuality??null,score:x.score??null,historicalWinRate:x.validation?.winRate??null,historicalSamples:x.validation?.samples??null,rewardRisk:x.rewardRisk2??x.rewardRisk1??null,confirm4h:Boolean(x.confirm4h),btcTrendSupport:x.btcTrendSupport??null,dollarVolume20d:x.dollarVolume20d??null,entry:x.entry??null,stop:x.stop??null,target1:x.target1??null,target2:x.target2??null}));
const qualified=candidates.filter(x=>x.grade==='A+'||x.grade==='A');
const champion=qualified[0]||null;
const brokerExecution={
  status:'BROKER_EXECUTION_UNAVAILABLE',
  executableByCurrentClaudeRobinhoodConnection:false,
  researchOnly:true,
  reason:'The current Robinhood MCP connection exposes equity execution but does not expose the crypto quote/position/order tools required for safe live crypto execution.',
  requiredBeforeEnable:['live crypto quote capability','live crypto position capability','crypto order placement capability'],
  rule:'Continue 24/7 crypto research and ranking, but never emit an executable crypto BUY trigger or wake Claude solely for a crypto entry until the connected Robinhood runtime explicitly exposes all required crypto execution tools.'
};
const tournament={schemaVersion:2,source:'TESTSTOCK_CRYPTO_KNOCKOUT',generatedAt:new Date().toISOString(),market:'24_7',supportedUsdPairs:Number(universe.supportedUsdPairs||0),objective:'Scan every active tradable Alpaca USD crypto pair, eliminate weak setups, and surface the strongest A/A+ crypto candidate while preserving all crypto safety gates.',brokerExecution,policy:{scanAllSupportedUsdPairs:true,alwaysProduceResearchChampion:Boolean(candidates.length),buyWhenAtLeastOneFullyQualifiedCandidateExists:false,forcedCryptoBuy:false,researchContinuesWhileExecutionUnavailable:true,noEligibleCandidateAction:'KEEP_SCANNING_24_7',winnerSelection:'A_PLUS_BEFORE_A_THEN_GROWTH_QUALITY_SCORE_LIQUIDITY',btcContextRequiredForAltcoins:true,noLeverage:true,noAverageDown:true},researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbacks:qualified.slice(1,6),ranked:candidates};
signal.cryptoTournament={enabled:true,sourceRef:'docs/data/crypto-tournament.json',market:'24_7',scanAllSupportedUsdPairs:true,supportedUsdPairs:Number(universe.supportedUsdPairs||0),brokerExecution,buyWhenAtLeastOneFullyQualifiedCandidateExists:false,forcedCryptoBuy:false,researchOnlyUntilBrokerExecutionAvailable:true,noEligibleCandidateAction:'KEEP_SCANNING_24_7',researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbackTickers:qualified.slice(1,6).map(x=>x.ticker),instructions:'Crypto continues to run its 24/7 research tournament, but the current Claude/Robinhood connection cannot safely execute crypto. Do not emit an executable crypto buy or wake Claude solely for a crypto entry until live quote, position, and order-placement tools are explicitly available at runtime.'};
signal.cryptoPlan={...(signal.cryptoPlan||{}),execution:{...(signal.cryptoPlan?.execution||{}),mode:'BROKER_EXECUTION_UNAVAILABLE',researchOnly:true,executableByCurrentClaudeRobinhoodConnection:false,note:brokerExecution.reason},cryptoOrders:[]};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),cryptoKnockoutTournament:true,cryptoBrokerCapabilityGate:true}};
signal.schemaVersion=Math.max(35,Number(signal.schemaVersion||0));
await fs.writeFile(OUT,JSON.stringify(tournament,null,2));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Crypto knockout research: ${tournament.supportedUsdPairs} supported pairs, ${qualified.length} A/A+ candidate(s), execution BROKER_EXECUTION_UNAVAILABLE.`);
