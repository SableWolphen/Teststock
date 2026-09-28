import fs from 'node:fs/promises';
import {evaluateRunnerHealth} from './runner-health.mjs';
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const age=t=>{const x=new Date(t||0).getTime();return Number.isFinite(x)?(Date.now()-x)/60000:Infinity;};
const [q,d,b,i,w,s,dispatch,runnerRuns,runnerHeartbeat]=await Promise.all([
  read('docs/data/trade-quality-intelligence.json',{}),read('docs/data/daytrader-intelligence.json',{}),
  read('docs/data/trigger-board.json',{}),read('docs/data/intraday-edge.json',{}),
  read('docs/data/execution-watchlist.json',{}),read('docs/signal.json',{}),
  read('docs/data/execution-dispatch.json',{}),
  process.env.TESTSTOCK_RUNNER_RUNS_FILE?read(process.env.TESTSTOCK_RUNNER_RUNS_FILE,{}):{},
  process.env.TESTSTOCK_RUNNER_HEARTBEAT_FILE?read(process.env.TESTSTOCK_RUNNER_HEARTBEAT_FILE,null):null,
]);
const active=(w.positions||[]).filter(x=>x?.status==='ACTIVE');
const actionable=(b.events||[]).filter(Boolean);
const freshness={signalAgeMinutes:age(s.generatedAt),triggerAgeMinutes:age(b.publishedAt),intradayAgeMinutes:age(i.generatedAt),daytraderAgeMinutes:age(d.generatedAt),qualityAgeMinutes:age(q.generatedAt)};
const maxAge={signalAgeMinutes:20,triggerAgeMinutes:15,intradayAgeMinutes:15,daytraderAgeMinutes:10,qualityAgeMinutes:10};
const stale=Object.entries(freshness).filter(([k,v])=>!Number.isFinite(v)||v>maxAge[k]).map(([k])=>k);
const breaker=d?.circuitBreaker?.state||'UNKNOWN',drawdown=q?.drawdownRisk?.state||'UNKNOWN',data=q?.dataWatchdog?.state||'UNKNOWN';
const runner=evaluateRunnerHealth({workflowRuns:runnerRuns.workflow_runs||runnerRuns.runs||[],heartbeat:runnerHeartbeat});
let newRisk='ALLOWED';const reasons=[];
if(stale.length){newRisk='BLOCKED';reasons.push(`stale: ${stale.join(', ')}`);}
if(!runner.healthy){newRisk='BLOCKED';reasons.push(`live runner ${runner.state.toLowerCase()}`);}
if(['STOP_NEW_RISK'].includes(breaker)||drawdown==='STOP_NEW_RISK'||data==='STOP_NEW_RISK'){newRisk='BLOCKED';reasons.push('risk/data circuit breaker');}
else if(newRisk!=='BLOCKED'&&(breaker==='REDUCE_NEW_RISK'||drawdown==='REDUCE_NEW_RISK')){newRisk='REDUCED';reasons.push('reduced-risk regime');}
const out={schemaVersion:4,generatedAt:new Date().toISOString(),status:newRisk==='BLOCKED'?'DEGRADED':'OK',newRiskPermission:newRisk,reasons,freshness,freshnessMaximumAgeMinutes:maxAge,circuitBreaker:breaker,drawdownRisk:drawdown,dataWatchdog:data,coverage:{stocks:{monitoring:'REGULAR_SESSION_ONLY',entryCutoffMinutes:20,forcedExitMinutesBeforeClose:10,rule:'Monitor continuously while the authoritative exchange session is open; never force a buy when the session or data gates fail.'}},brokerMcp:{state:'VERIFY_AT_EXECUTION',note:'Repository cannot prove live Robinhood MCP connectivity; ChatGPT must verify on every execution run.'},runner:{...runner,schedule:'HOURLY_SESSION_WITH_WATCHDOG_RECOVERY',cycleIntervalSeconds:45,note:'New risk is blocked unless a fresh private heartbeat or current/recent successful GitHub Actions session proves that the live monitor is available.'},positions:{activeCount:active.length,symbols:active.map(x=>x.ticker||x.symbol).filter(Boolean)},opportunities:{actionableCount:actionable.length,top:actionable.slice(0,10).map(x=>({ticker:x.ticker,assetClass:x.assetClass,trigger:x.trigger,setupGrade:x.setupGrade??null}))},executionQuality:q.executionScorecard||null,replay:q.maeMfe||null,riskOfRuin:q.riskOfRuin||null};
await write('docs/data/live-trading-health.json',out);console.log(`Trading health: ${out.status}, newRisk=${newRisk}, active=${active.length}, actionable=${actionable.length}`);
