import path from 'node:path';
import {pathToFileURL} from 'node:url';
// Node is present on both Windows and Linux runners; gh/jq are not required.
export async function chainSession({fetchImpl=fetch,env=process.env}={}){
  const repo=env.GITHUB_REPOSITORY,token=env.GH_TOKEN||env.GITHUB_TOKEN;
  if(!repo||!token||!env.GITHUB_RUN_ID)throw new Error('Missing GitHub self-chain context');
  const url=`https://api.github.com/repos/${repo}/actions/workflows/live-intraday-runner.yml`;
  const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  const r=await fetchImpl(`${url}/runs?per_page=10`,{headers,signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw new Error(`Self-chain run lookup failed: HTTP ${r.status}`);
  const data=await r.json();
  if(!Array.isArray(data.workflow_runs))throw new Error('Invalid workflow-run response');
  if(data.workflow_runs.some(x=>String(x.id)!==env.GITHUB_RUN_ID&&['queued','in_progress','pending','waiting','requested'].includes(x.status))){console.log('Another live session is queued or active');return false;}
  const d=await fetchImpl(`${url}/dispatches`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({ref:'main'}),signal:AbortSignal.timeout(30000)});
  if(!d.ok)throw new Error(`Self-chain dispatch failed: HTTP ${d.status}`);
  console.log('Next live session dispatched');return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await chainSession();
