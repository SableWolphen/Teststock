export const INDEX_OPTION_DEFINITIONS = Object.freeze([
  Object.freeze({
    indexSymbol:'XND',
    proxySymbol:'QQQ',
    marketExposure:'NASDAQ_100',
    contractMultiplier:100,
    cashSettled:true,
    exerciseStyle:'EUROPEAN',
    earlyAssignmentRisk:false,
    settleOnOpen:false,
    settlementWindow:'PM',
  }),
  Object.freeze({
    indexSymbol:'DJX',
    proxySymbol:'DIA',
    marketExposure:'DOW_JONES_INDUSTRIAL_AVERAGE',
    contractMultiplier:100,
    cashSettled:true,
    exerciseStyle:'EUROPEAN',
    earlyAssignmentRisk:false,
    settleOnOpen:true,
    settlementWindow:'AM',
  }),
]);

const finite=n=>Number.isFinite(Number(n));
const pickProxyRow=(optionsScan,proxySymbol)=>{
  const explicit=(optionsScan?.indexEtfResearch||[]).find(x=>x?.symbol===proxySymbol);
  if(explicit)return explicit;
  const candidates=(optionsScan?.candidates||[])
    .filter(x=>x?.underlying===proxySymbol&&['BULLISH','BEARISH'].includes(x?.underlyingBias))
    .sort((a,b)=>Number(b?.score||0)-Number(a?.score||0));
  const best=candidates[0];
  if(!best)return null;
  return {
    symbol:proxySymbol,
    price:best.underlyingPrice??null,
    optionBias:best.underlyingBias,
    direction:best.underlyingBias,
    score:best.underlyingScore??best.score??null,
    source:'ETF_OPTION_CANDIDATE_FALLBACK',
  };
};

export function buildIndexOptionsResearch({optionsScan={},generatedAt=new Date().toISOString()}={}){
  const rows=INDEX_OPTION_DEFINITIONS.map(def=>{
    const proxy=pickProxyRow(optionsScan,def.proxySymbol);
    const bias=proxy?.optionBias||proxy?.direction||'UNKNOWN';
    const directionQualified=['BULLISH','BEARISH'].includes(bias);
    const allowedKinds=bias==='BULLISH'?['LONG_CALL']:bias==='BEARISH'?['LONG_PUT']:[];
    return {
      indexSymbol:def.indexSymbol,
      underlyingType:'INDEX_OPTION',
      proxySymbol:def.proxySymbol,
      marketExposure:def.marketExposure,
      proxyBias:bias,
      proxyPrice:finite(proxy?.price)?Number(proxy.price):null,
      proxyScore:finite(proxy?.score)?Number(proxy.score):null,
      researchStatus:directionQualified?'BROKER_SHADOW_SAMPLE_READY':'WAIT_PROXY_DIRECTION',
      liveExecutionEligible:false,
      admissionStateRequired:['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'],
      brokerContractResolutionRequired:true,
      brokerResolution:{
        chainSymbol:def.indexSymbol,
        allowedKinds,
        minDte:3,
        maxDte:45,
        requiresLiveTradability:true,
        requiresLiveBidAsk:true,
        requiresLiveLiquidityCheck:true,
        requiresWholeContractCashCheck:true,
      },
      contractMultiplier:def.contractMultiplier,
      settlement:{
        cashSettled:def.cashSettled,
        exerciseStyle:def.exerciseStyle,
        earlyAssignmentRisk:def.earlyAssignmentRisk,
        settleOnOpen:def.settleOnOpen,
        settlementWindow:def.settlementWindow,
      },
      taxContext:{
        potentialSection1256Treatment:true,
        generalRule:'Qualifying Section 1256 contracts are generally treated 60% long-term and 40% short-term and may be subject to year-end mark-to-market.',
        informationalOnly:true,
        affectsEligibility:false,
        verifyWithTaxProfessional:true,
      },
      evidenceRule:'QQQ/DIA establishes research direction only. A shadow or live result counts only from the exact Robinhood-resolved XND/DJX contract using executable ask at entry and executable bid at exit.',
      proxyReference:proxy||null,
    };
  });
  return {
    schemaVersion:1,
    generatedAt,
    source:'TESTSTOCK_INDEX_OPTIONS_RESEARCH',
    sourceOptionsScanGeneratedAt:optionsScan?.generatedAt||null,
    mode:'SEPARATE_BROKER_RESOLVED_SHADOW_FIRST',
    indexes:INDEX_OPTION_DEFINITIONS.map(x=>x.indexSymbol),
    candidates:rows,
    rules:[
      'XND and DJX use QQQ and DIA only as directional/regime research proxies; ETF option fills never count as index-option evidence.',
      'The exact index option contract must be resolved from Robinhood immediately before any broker shadow sample or future live order.',
      'Index options have a separate profitability-admission ledger and may never borrow stock-option admission.',
      'Tax treatment is informational only and can never create or increase trade eligibility.',
      'Cash settlement and European exercise remove early-assignment risk but do not remove premium, liquidity, settlement, or expiration risk.',
    ],
  };
}
