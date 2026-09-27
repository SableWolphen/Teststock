import { stockExecutionPolicyFailures } from './stock-execution-policy-validation.mjs';
import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [s,st]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json'].map(read));
const fail=stockExecutionPolicyFailures(s);

const p=s.robinhoodExecutableUniversePolicy;
if(p?.mode!=='ROBINHOOD_EXECUTABLE_FINALISTS_ONLY'||p?.failClosed!==true||p?.noBrokerConfirmationMeansNoOrder!==true)fail.push('fail-closed policy');
if(p?.executionAgent!=='CLAUDE'||p?.brokerLane!=='ROBINHOOD_TRADING_MCP'||p?.directGitHubBrokerExecutionAllowed!==false)fail.push('Claude MCP policy');
if(p?.stock?.perOrderApprovalStillRequired!==false||p?.stock?.automaticQualifiedBuys!==true||s.autopilot?.stockBuysRequireUserApproval!==false||s.autopilot?.automaticQualifiedStockBuys!==true)fail.push('automatic stock execution');

for(const x of [...(st.liveQueue||[]),...(st.researchFinalists||[])]){
  if(x.brokerEligibility?.broker!=='ROBINHOOD_TRADING_MCP'||x.brokerEligibility?.assetClass!=='STOCK'||x.brokerEligibility?.status!=='CLAUDE_RUNTIME_VERIFICATION_REQUIRED'||x.brokerEligibility?.liveOrderAllowed!==false)fail.push(`${x.ticker}: stock broker gate`);
}
if(p?.crypto?.enabled!==false||p?.crypto?.automaticQualifiedBuys!==false)fail.push('crypto execution not disabled');

if(fail.length)throw new Error(`Robinhood executable-universe validation failed: ${[...new Set(fail)].join(', ')}`);
console.log('Robinhood executable-universe validation passed: automatic stocks require immediate Claude Robinhood Trading MCP verification; no broker confirmation=no order');
