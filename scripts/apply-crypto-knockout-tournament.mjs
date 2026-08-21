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
  status:'DIRECT_ROBINHOOD_CRYPTO_API',
  lane:'GITHUB_ACTIONS_ROBINHOOD_CRYPTO_API',
  executableByCurrentClaudeRobinhoodConnection:false,
  executableByDirectRobinhoodCryptoApi:true,
  researchOnly:false,
  requiresClaude:false,
  rule:'Use the Teststock qualified crypto champion first, then already-qualified fallbacks in tournament order. The direct Robinhood Crypto API must independently verify the live quote, account, holdings, open orders, sizing and protection before execution.'
};
const tournament={schemaVersion:3,source:'TESTSTOCK_CRYPTO_KNOCKOUT',generatedAt:new Date().toISOString(),market:'24_7',supportedUsdPairs:Number(universe.supportedUsdPairs||0),objective:'Scan every active tradable Alpaca USD crypto pair, eliminate weak setups, and select the strongest qualified crypto winner plus qualified fallbacks for direct Robinhood Crypto API verification.',brokerExecution,policy:{scanAllSupportedUsdPairs:true,alwaysProduceResearchChampion:Boolean(candidates.length),buyWhenAtLeastOneFullyQualifiedCandidateExists:true,forcedCryptoBuy:false,noEligibleCandidateAction:'KEEP_SCANNING_24_7',winnerSelection:'A_PLUS_BEFORE_A_THEN_GROWTH_QUALITY_SCORE_LIQUIDITY',btcContextRequiredForAltcoins:true,noLeverage:true,noAverageDown:true},researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbacks:qualified.slice(1,6),ranked:candidates};
signal.cryptoTournament={enabled:true,sourceRef:'docs/data/crypto-tournament.json',market:'24_7',scanAllSupportedUsdPairs:true,supportedUsdPairs:Number(universe.supportedUsdPairs||0),brokerExecution,buyWhenAtLeastOneFullyQualifiedCandidateExists:true,forcedCryptoBuy:false,noEligibleCandidateAction:'KEEP_SCANNING_24_7',researchChampion:candidates[0]||null,qualifiedChampion:champion,fallbackTickers:qualified.slice(1,6).map(x=>x.ticker),instructions:'The direct Robinhood Crypto API lane evaluates only the Teststock qualified champion and already-qualified fallbacks in order. It must not invent a crypto symbol or bypass any live broker/risk/protection check.'};
signal.cryptoPlan={...(signal.cryptoPlan||{}),execution:{...(signal.cryptoPlan?.execution||{}),mode:'DIRECT_ROBINHOOD_CRYPTO_API',researchOnly:false,requiresClaude:false,note:brokerExecution.rule}};
signal.generatorIntegrity={...(signal.generatorIntegrity||{}),traceableFeatures:{...(signal.generatorIntegrity?.traceableFeatures||{}),cryptoKnockoutTournament:true,cryptoBrokerCapabilityGate:true}};
signal.schemaVersion=Math.max(35,Number(signal.schemaVersion||0));
await fs.writeFile(OUT,JSON.stringify(tournament,null,2));
await fs.writeFile(SIGNAL,JSON.stringify(signal,null,2));
await fs.writeFile('docs/data/claude-signal.json',JSON.stringify(signal,null,2));
console.log(`Crypto knockout research: ${tournament.supportedUsdPairs} supported pairs, ${qualified.length} A/A+ candidate(s), direct Robinhood Crypto API lane.`);
