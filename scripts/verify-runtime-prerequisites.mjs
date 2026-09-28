import fs from 'node:fs';

const requiredFiles=[
  '.openai-mcp.json','scripts/run-live-intraday-cycle.sh','scripts/run-background-learning.sh',
  'scripts/build-daytrader-intelligence.mjs','scripts/validate-daytrader-intelligence.mjs',
  'scripts/build-real-fill-scorecard.mjs','scripts/build-trade-quality-engine.mjs',
  'scripts/apply-model-drift.mjs','scripts/validate-trade-quality-engine.mjs',
  'scripts/build-live-trading-health.mjs','scripts/chatgpt-trade-quality-rules.md',
  'scripts/chatgpt-stock-rotation-rules.md','scripts/daytrader-profit-discipline.md',
  'scripts/chatgpt-executor-prompt.md','scripts/chatgpt-options-rules.md',
  'scripts/options-monitor-candidates.mjs','scripts/validate-options-policy.mjs',
  'scripts/write-runner-heartbeat.mjs',
];
const requiredText=[
  ['scripts/run-live-intraday-cycle.sh','learning-output'],
  ['scripts/run-background-learning.sh','BACKGROUND_LEARNING_REFRESHED'],
  ['scripts/chatgpt-trade-quality-rules.md','real-fill-scorecard.json'],
  ['scripts/run-live-intraday-cycle.sh','daytrader-profit-discipline.md'],
  ['scripts/daytrader-profit-discipline.md','OPEN_DRIVE'],
  ['scripts/daytrader-profit-discipline.md','MIDDAY'],
  ['scripts/daytrader-profit-discipline.md','POWER_HOUR'],
];
const failures=[];
const mode=String(process.env.TESTSTOCK_EXECUTION_MODE||'paper').toLowerCase();
if(!['paper','live'].includes(mode))failures.push('TESTSTOCK_EXECUTION_MODE must be paper or live');
if(mode==='live'){
  if(process.env.TESTSTOCK_LIVE_TRADING!=='I_UNDERSTAND_REAL_ORDERS')failures.push('live mode requires explicit TESTSTOCK_LIVE_TRADING sentinel');
  if(!process.env.OPENAI_API_KEY)failures.push('live mode requires OPENAI_API_KEY');
  if(!process.env.ROBINHOOD_MCP_OAUTH_TOKEN)failures.push('live mode requires ROBINHOOD_MCP_OAUTH_TOKEN');
}
for(const file of requiredFiles)if(!fs.existsSync(file))failures.push(`missing file: ${file}`);
for(const [file,marker] of requiredText){
  if(!fs.existsSync(file))continue;
  if(!fs.readFileSync(file,'utf8').includes(marker))failures.push(`missing marker ${JSON.stringify(marker)} in ${file}`);
}
if(failures.length){
  for(const failure of failures)console.error(`::error::Runtime prerequisite failed: ${failure}`);
  process.exit(1);
}
console.log(`Runtime prerequisites passed: ${requiredFiles.length} files and ${requiredText.length} integration markers; executionMode=${mode}.`);
