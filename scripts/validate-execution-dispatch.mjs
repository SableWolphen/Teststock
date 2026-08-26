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
  if(!action?.fingerprint) fail('actionable dispatch lacks fingerprint');
  if(action.isNew!==true||action.isActionable!==true) fail('actionable dispatch must be new and actionable');
  if(action.trigger==='BUY_TRIGGER'&&(!action.expiresAt||Date.parse(action.expiresAt)<=Date.parse(dispatch.generatedAt))) fail('entry is expired');
}
if(dispatch.pendingAction?.isNew===false&&dispatch.claudeShouldRun) fail('duplicate fingerprint would invoke Claude');
if((dispatch.fallbackActions||[]).some(action=>action.trigger!=='BUY_TRIGGER')) fail('fallback sequence may contain only buy actions');
if(dispatch.pendingAction?.trigger!=='BUY_TRIGGER'&&(dispatch.fallbackActions||[]).length) fail('exit dispatch cannot contain buy fallbacks');
const approvalCandidates=dispatch.approvalCandidates||[];
if(approvalCandidates.some(action=>action.trigger!=='BUY_TRIGGER')) fail('approvalCandidates may contain only buys');
if(approvalCandidates.some(action=>action.assetClass!=='STOCK')) fail('Claude approvalCandidates may contain only stocks');
if(approvalCandidates.some(action=>!['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(action.profitabilityAdmission))) fail('stock approval candidate lacks profitability admission');
if(approvalCandidates.some(action=>action.decisionIntelligenceEligible!==true)) fail('stock approval candidate lacks decision-intelligence pass');
if(dispatch.pendingAction?.trigger!=='BUY_TRIGGER'&&approvalCandidates.length) fail('exit dispatch cannot contain approval candidates');
const uniqueWithin=(rows,label)=>{const ids=rows.filter(Boolean).map(x=>x.fingerprint);if(new Set(ids).size!==ids.length)fail(`${label} contains duplicate fingerprints`);};
uniqueWithin(approvalCandidates,'approvalCandidates');
uniqueWithin(dispatch.fallbackActions||[],'fallbackActions');
const ordered=approvalCandidates.length?approvalCandidates:[dispatch.pendingAction,...(dispatch.fallbackActions||[])].filter(x=>x?.trigger==='BUY_TRIGGER');
for(let i=1;i<ordered.length;i++)if(Number(ordered[i-1].queueRank||999)>Number(ordered[i].queueRank||999))fail('buy approval queue is not rank ordered');
const max=Number(dispatch.consumerContract?.maximumNewBuysPerDispatch??1);
if(!Number.isInteger(max)||max<1||max>4) fail('maximumNewBuysPerDispatch must be an integer from 1 to 4');
if(approvalCandidates.length>max) fail('approvalCandidates exceeds maximumNewBuysPerDispatch');
if(dispatch.schemaVersion===2){
  if(dispatch.consumerContract?.perOrderApprovalRequired!==true) fail('per-order approval must remain required');
  if(dispatch.consumerContract?.multipleConcurrentStocksAllowed!==true) fail('multi-stock capability must be explicit');
  if(dispatch.multiStockPolicy?.enabled!==true) fail('multiStockPolicy must be enabled');
}
if(dispatch.schemaVersion>=3){
  if(dispatch.consumerContract?.approvalMode!=='EXACT_CURRENT_BATCH') fail('approvalMode must be EXACT_CURRENT_BATCH');
  if(dispatch.consumerContract?.exactBatchApprovalAllowed!==true) fail('exact batch approval must be enabled');
  if(dispatch.consumerContract?.blanketFutureApprovalAllowed!==false) fail('blanket future approval must remain disabled');
  if(dispatch.consumerContract?.multipleConcurrentStocksAllowed!==true) fail('multi-stock capability must be explicit');
  if(dispatch.multiStockPolicy?.enabled!==true) fail('multiStockPolicy must be enabled');
  if(dispatch.multiStockPolicy?.exactBatchApprovalAllowed!==true) fail('multiStockPolicy must permit exact batch approval');
  if(dispatch.multiStockPolicy?.blanketFutureApprovalAllowed!==false) fail('multiStockPolicy must forbid blanket future approval');
  if(approvalCandidates.length&&!dispatch.approvalBatchId) fail('approval batch lacks batch id');
  if(!approvalCandidates.length&&dispatch.approvalBatchId!==null) fail('idle dispatch must not carry approval batch id');
  if(Boolean(dispatch.stockApprovalNotification?.needed)!==Boolean(approvalCandidates.length)) fail('notification needed flag does not match approval candidates');
  if(dispatch.stockApprovalNotification?.batchId!==dispatch.approvalBatchId) fail('notification batch id mismatch');
}
if(dispatch.pendingAction?.trigger==='BUY_TRIGGER'&&approvalCandidates.length&&approvalCandidates[0].fingerprint!==dispatch.pendingAction.fingerprint) fail('pendingAction must match first approval candidate');
console.log(`Execution dispatch valid: ${dispatch.claudeShouldRun?'actionable':'idle'}; max new buys ${max}; approval candidates ${approvalCandidates.length}; batch ${dispatch.approvalBatchId||'NONE'}.`);
