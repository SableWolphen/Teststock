import fs from 'node:fs/promises';

const file=process.argv[2]||'docs/data/execution-dispatch.json';
const dispatch=JSON.parse(await fs.readFile(file,'utf8'));
const fail=message=>{throw new Error(`Invalid execution dispatch: ${message}`);};

if(![1,2,3].includes(dispatch.schemaVersion)) fail('unsupported schemaVersion');
if(!['OK','FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD'].includes(dispatch.dispatchHealth)) fail('unknown dispatchHealth');
if(dispatch.claudeShouldPollMarket!==false) fail('Claude market polling must remain disabled');
if(dispatch.claudeShouldRun){
  const action=dispatch.pendingAction;
  if(dispatch.dispatchHealth!=='OK') fail('cannot run Claude on an unhealthy dispatch');
  if(action){
    if(!action.fingerprint) fail('actionable dispatch lacks fingerprint');
    if(action.isNew!==true||action.isActionable!==true) fail('actionable dispatch must be new and actionable');
    if(action.trigger==='BUY_TRIGGER'&&(!action.expiresAt||Date.parse(action.expiresAt)<=Date.parse(dispatch.generatedAt))) fail('entry is expired');
  }else if(!(dispatch.seedLaneCandidates||[]).some(x=>x?.fingerprint)) fail('actionable dispatch lacks a normal or seed fingerprint');
}
if(dispatch.pendingAction?.isNew===false&&dispatch.claudeShouldRun) fail('duplicate fingerprint would invoke Claude');
if((dispatch.fallbackActions||[]).some(action=>action.trigger!=='BUY_TRIGGER')) fail('fallback sequence may contain only buy actions');
if(dispatch.pendingAction?.trigger!=='BUY_TRIGGER'&&(dispatch.fallbackActions||[]).length) fail('exit dispatch cannot contain buy fallbacks');

const automaticStockCandidates=dispatch.automaticStockCandidates||[];
if(automaticStockCandidates.some(action=>action.trigger!=='BUY_TRIGGER')) fail('automaticStockCandidates may contain only BUY_TRIGGER actions');
if(automaticStockCandidates.some(action=>action.assetClass!=='STOCK')) fail('automaticStockCandidates may contain only stocks');
if(automaticStockCandidates.some(action=>['SHADOW_ONLY','LIVE_SUSPENDED','UNKNOWN',undefined,null].includes(action.profitabilityAdmission))) fail('automatic stock candidate lacks profitability admission');
if(automaticStockCandidates.some(action=>action.decisionIntelligenceEligible!==true)) fail('automatic stock candidate lacks decision-intelligence pass');
if(dispatch.pendingAction?.trigger!=='BUY_TRIGGER'&&automaticStockCandidates.length) fail('exit dispatch cannot contain automatic stock candidates');

if((dispatch.approvalCandidates||[]).length) fail('approvalCandidates must be empty in automatic mode');
if(dispatch.approvalBatchId!==null) fail('approvalBatchId must be null in automatic mode');
if(dispatch.stockApprovalNotification?.needed!==false) fail('stock approval notification must be disabled');

const uniqueWithin=(rows,label)=>{const ids=rows.filter(Boolean).map(x=>x.fingerprint);if(new Set(ids).size!==ids.length)fail(`${label} contains duplicate fingerprints`);};
uniqueWithin(automaticStockCandidates,'automaticStockCandidates');
uniqueWithin(dispatch.fallbackActions||[],'fallbackActions');
for(let i=1;i<automaticStockCandidates.length;i++)if(Number(automaticStockCandidates[i-1].queueRank||999)>Number(automaticStockCandidates[i].queueRank||999))fail('automatic stock queue is not rank ordered');

const max=Number(dispatch.consumerContract?.maximumNewBuysPerDispatch??1);
if(!Number.isInteger(max)||max<1||max>4) fail('maximumNewBuysPerDispatch must be an integer from 1 to 4');
if(automaticStockCandidates.length>max) fail('automaticStockCandidates exceeds maximumNewBuysPerDispatch');
if(dispatch.consumerContract?.approvalMode!=='NONE_AUTOMATIC') fail('approvalMode must be NONE_AUTOMATIC');
if(dispatch.consumerContract?.userApprovalRequired!==false) fail('user approval must be false');
if(dispatch.consumerContract?.automaticQualifiedStocks!==true) fail('automaticQualifiedStocks must be true');
if(dispatch.consumerContract?.multipleConcurrentStocksAllowed!==true) fail('multi-stock capability must be explicit');
if(dispatch.multiStockPolicy?.enabled!==true) fail('multiStockPolicy must be enabled');
if(dispatch.multiStockPolicy?.automaticQualifiedEntries!==true) fail('automatic stock policy must be enabled');
if(dispatch.multiStockPolicy?.userApprovalRequired!==false) fail('multiStockPolicy still requires approval');
if(dispatch.pendingAction?.trigger==='BUY_TRIGGER'&&automaticStockCandidates.length&&automaticStockCandidates[0].fingerprint!==dispatch.pendingAction.fingerprint) fail('pendingAction must match first automatic stock candidate');

const seeds=dispatch.seedLaneCandidates||[];
if(seeds.some(x=>!((x.assetClass==='STOCK'&&['SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER'].includes(x.trigger))||(x.assetClass==='CRYPTO'&&x.trigger==='CRYPTO_SEED_LANE_BUY_TRIGGER')))) fail('invalid seed-lane candidate');
if(seeds.some(x=>x.requiresPerOrderApproval!==false)) fail('seed-lane approval must be disabled in automatic mode');
if(seeds.some(x=>Number(x.maxOrderUsd)!==(x.assetClass==='CRYPTO'?5:20)||x.existingRobinhoodCashOnly!==true||x.agentMayInitiateDeposits!==false||x.agentMayInitiateBankTransfers!==false||x.marginAllowed!==false||x.requiresBrokerResidentStop!==true)) fail('seed-lane funding or protection bounds');
if(seeds.some(x=>x.trigger==='STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER'&&(x.mustBeFlatBeforeMarketClose!==true||Number(x.entryCutoffMinutesBeforeClose)!==30||Number(x.forcedExitStartMinutesBeforeClose)!==15)))fail('day-trade seed timing bounds');
if(dispatch.pendingAction?.trigger==='STOCK_DAY_TRADE_FORCED_EXIT'&&Number(dispatch.pendingAction.priority)!==100)fail('day-trade forced exit priority');
if((dispatch.priorityOrder||[]).indexOf('STOCK_DAY_TRADE_FORCED_EXIT')<0||(dispatch.priorityOrder||[]).indexOf('STOCK_DAY_TRADE_FORCED_EXIT')>1)fail('day-trade forced exit priority order');
if(dispatch.pendingAction?.trigger==='STOCK_DAY_TRADE_FORCED_EXIT'&&(automaticStockCandidates.length||seeds.length))fail('day-trade forced exit must block buys');

console.log(`Execution dispatch valid: ${dispatch.claudeShouldRun?'actionable':'idle'}; automatic stock candidates ${automaticStockCandidates.length}; seed candidates ${seeds.length}; max new buys ${max}.`);
