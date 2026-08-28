import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [s,st,c]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json','docs/data/crypto-tournament.json'].map(read));

const stockGate=x=>({...x,brokerEligibility:{
  broker:'ROBINHOOD_TRADING_MCP',
  assetClass:'STOCK',
  status:'CLAUDE_RUNTIME_VERIFICATION_REQUIRED',
  researchEligible:true,
  liveOrderAllowed:false,
  verificationMoment:'IMMEDIATELY_BEFORE_SUBMISSION',
  requirements:[
    'exact symbol searchable and buyable in the authenticated Robinhood Agentic account',
    'asset not restricted, halted, closing-only or unsupported',
    'quantity and order type supported',
    'non-margin buying power sufficient',
    'current quote remains inside Teststock no-chase limits',
    'no duplicate or conflicting open order exists',
    'required protective exit path is supported'
  ],
  rule:'Claude must verify the exact candidate through the authenticated Robinhood Trading MCP immediately before submission. If any live broker, freshness, sizing, no-chase, duplicate-order or protection check fails, reject the candidate; never substitute an unranked symbol.'
}});

st.liveQueue=(st.liveQueue||[]).map(stockGate);
st.researchFinalists=(st.researchFinalists||[]).map(stockGate);
if(st.researchChampion)st.researchChampion=stockGate(st.researchChampion);
if(st.liveBuyChampion)st.liveBuyChampion=stockGate(st.liveBuyChampion);
st.liveFallbacks=(st.liveFallbacks||[]).map(stockGate);

const cryptoGate=x=>({...x,brokerEligibility:{
  broker:'ROBINHOOD_TRADING_MCP',
  assetClass:'CRYPTO',
  status:'CLAUDE_RUNTIME_VERIFICATION_REQUIRED',
  researchEligible:true,
  liveOrderAllowed:false,
  verificationMoment:'IMMEDIATELY_BEFORE_SUBMISSION',
  requirements:[
    'exact pair tradable in the authenticated Robinhood Agentic account',
    'live Robinhood quote available',
    'account buying power and order increments valid',
    'current quote remains inside Teststock no-chase limits',
    'no duplicate or conflicting open order exists',
    'required protection is supported'
  ],
  rule:'Claude must verify the exact crypto candidate through the authenticated Robinhood Trading MCP immediately before submission. Missing or non-tradable pairs, stale data, sizing conflicts, duplicate-order risk or unavailable protection mean no order.'
}});

c.ranked=(c.ranked||[]).map(cryptoGate);
if(c.researchChampion)c.researchChampion=cryptoGate(c.researchChampion);
if(c.qualifiedChampion)c.qualifiedChampion=cryptoGate(c.qualifiedChampion);
c.fallbacks=(c.fallbacks||[]).map(cryptoGate);

const policy={
  enabled:true,
  mode:'ROBINHOOD_EXECUTABLE_FINALISTS_ONLY',
  executionAgent:'CLAUDE',
  brokerLane:'ROBINHOOD_TRADING_MCP',
  discoveryVsExecution:'Research sources may discover candidates; only exact candidates independently verified through the authenticated Robinhood Trading MCP immediately before submission may be ordered.',
  stock:{gate:'CLAUDE_ROBINHOOD_TRADING_MCP_EXACT_SYMBOL_CHECK',perOrderApprovalStillRequired:false,automaticQualifiedBuys:true},
  crypto:{gate:'CLAUDE_ROBINHOOD_TRADING_MCP_EXACT_PAIR_CHECK',automaticQualifiedBuys:true},
  directGitHubBrokerExecutionAllowed:false,
  failClosed:true,
  noBrokerConfirmationMeansNoOrder:true
};

s.robinhoodExecutableUniversePolicy=policy;
s.generatorIntegrity={...(s.generatorIntegrity||{}),traceableFeatures:{...(s.generatorIntegrity?.traceableFeatures||{}),robinhoodExecutableFinalistsOnly:true,exactStockRuntimeSymbolCheck:true,exactCryptoRuntimePairCheck:true,claudeRobinhoodTradingMcpExecution:true}};
await Promise.all([
  write('docs/data/stock-tournament.json',st),
  write('docs/data/crypto-tournament.json',c),
  write('docs/signal.json',s),
  write('docs/data/claude-signal.json',s)
]);
console.log(`Robinhood executable gate attached for Claude Trading MCP: stocks=${st.liveQueue.length+st.researchFinalists.length}; crypto=${c.ranked.length}; no broker confirmation=no order`);
