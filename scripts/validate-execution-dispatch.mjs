import fs from 'node:fs/promises';

const file=process.argv[2]||'docs/data/execution-dispatch.json';
const dispatch=JSON.parse(await fs.readFile(file,'utf8'));
const fail=message=>{throw new Error(`Invalid execution dispatch: ${message}`);};

if(dispatch.schemaVersion!==1) fail('unsupported schemaVersion');
if(!['OK','FAIL_CLOSED_STALE_OR_UNHEALTHY_BOARD'].includes(dispatch.dispatchHealth)) fail('unknown dispatchHealth');
if(dispatch.claudeShouldPollMarket!==false) fail('Claude market polling must remain disabled');
if(dispatch.claudeShouldRun){
  const action=dispatch.pendingAction;
  if(dispatch.dispatchHealth!=='OK') fail('cannot run Claude on an unhealthy dispatch');
  if(!action?.fingerprint) fail('actionable dispatch lacks fingerprint');
  if(action.isNew!==true||action.isActionable!==true) fail('actionable dispatch must be new and actionable');
  if(action.trigger==='BUY_TRIGGER'){
    if(!action.expiresAt||Date.parse(action.expiresAt)<=Date.parse(dispatch.generatedAt)) fail('entry is expired');
  }
}
if(dispatch.pendingAction?.isNew===false&&dispatch.claudeShouldRun) fail('duplicate fingerprint would invoke Claude');
if((dispatch.fallbackActions||[]).some(action=>action.trigger!=='BUY_TRIGGER')) fail('fallback sequence may contain only buy actions');
if(dispatch.pendingAction?.trigger!=='BUY_TRIGGER'&&(dispatch.fallbackActions||[]).length) fail('exit dispatch cannot contain buy fallbacks');
const fingerprints=[dispatch.pendingAction,...(dispatch.fallbackActions||[])].filter(Boolean).map(x=>x.fingerprint);
if(new Set(fingerprints).size!==fingerprints.length) fail('candidate fingerprints must be unique');
if(dispatch.consumerContract?.maximumNewBuysPerDispatch!==1) fail('dispatch must cap new buys at one');
console.log(`Execution dispatch valid: ${dispatch.claudeShouldRun?'one new Claude action':'no Claude action'}.`);
