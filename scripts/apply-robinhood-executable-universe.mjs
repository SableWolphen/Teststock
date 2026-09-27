import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [s,st]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json'].map(read));

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
  rule:'ChatGPT must verify the exact candidate through the authenticated Robinhood Trading MCP immediately before submission. If any live broker, freshness, sizing, no-chase, duplicate-order or protection check fails, reject the candidate; never substitute an unranked symbol.'
}});

st.liveQueue=(st.liveQueue||[]).map(stockGate);
st.researchFinalists=(st.researchFinalists||[]).map(stockGate);
if(st.researchChampion)st.researchChampion=stockGate(st.researchChampion);
if(st.liveBuyChampion)st.liveBuyChampion=stockGate(st.liveBuyChampion);
st.liveFallbacks=(st.liveFallbacks||[]).map(stockGate);

const policy={
  enabled:true,
  mode:'ROBINHOOD_EXECUTABLE_FINALISTS_ONLY',
  executionAgent:'CHATGPT',
  brokerLane:'ROBINHOOD_TRADING_MCP',
  discoveryScope:'BROAD_GLOBAL_INFORMATION_WITH_US_BROKER_EXECUTION',
  discoveryRule:'Global news, catalysts and research may influence ranking, but live capital is restricted to exact securities and contracts independently verified as tradable in the authenticated Robinhood Agentic account.',
  discoveryVsExecution:'Research sources may discover candidates; only exact candidates independently verified through the authenticated Robinhood Trading MCP immediately before submission may be ordered.',
  stock:{gate:'CHATGPT_ROBINHOOD_TRADING_MCP_EXACT_SYMBOL_CHECK',perOrderApprovalStillRequired:false,automaticQualifiedBuys:true,scanBroadlyTradeOnlyBrokerSupported:true},
  crypto:{enabled:false,automaticQualifiedBuys:false},
  directGitHubBrokerExecutionAllowed:false,
  failClosed:true,
  noBrokerConfirmationMeansNoOrder:true
};

s.robinhoodExecutableUniversePolicy=policy;
s.generatorIntegrity={...(s.generatorIntegrity||{}),traceableFeatures:{...(s.generatorIntegrity?.traceableFeatures||{}),robinhoodExecutableFinalistsOnly:true,exactStockRuntimeSymbolCheck:true,exactCryptoRuntimePairCheck:false,chatgptRobinhoodTradingMcpExecution:true}};
await Promise.all([
  write('docs/data/stock-tournament.json',st),
  write('docs/signal.json',s),
  write('docs/data/claude-signal.json',s)
]);
console.log(`Robinhood executable gate attached for ChatGPT Trading MCP: stocks=${st.liveQueue.length+st.researchFinalists.length}; crypto execution disabled; no broker confirmation=no order`);
