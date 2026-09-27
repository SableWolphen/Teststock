import fs from 'node:fs';

const requiredFiles=[
  '.mcp.json','scripts/run-live-intraday-cycle.sh','scripts/run-background-learning.sh',
  'scripts/build-daytrader-intelligence.mjs','scripts/validate-daytrader-intelligence.mjs',
  'scripts/build-real-fill-scorecard.mjs','scripts/build-trade-quality-engine.mjs',
  'scripts/apply-model-drift.mjs','scripts/validate-trade-quality-engine.mjs',
  'scripts/build-live-trading-health.mjs','scripts/claude-trade-quality-rules.md',
  'scripts/claude-stock-rotation-rules.md','scripts/daytrader-profit-discipline.md',
  'scripts/claude-executor-prompt.md','scripts/claude-options-rules.md',
  'scripts/options-monitor-candidates.mjs','scripts/validate-options-policy.mjs',
  'scripts/write-runner-heartbeat.mjs',
];
const requiredText=[
  ['scripts/run-live-intraday-cycle.sh','learning-output'],
  ['scripts/run-background-learning.sh','BACKGROUND_LEARNING_REFRESHED'],
  ['scripts/claude-trade-quality-rules.md','real-fill-scorecard.json'],
  ['scripts/run-live-intraday-cycle.sh','daytrader-profit-discipline.md'],
  ['scripts/daytrader-profit-discipline.md','OPEN_DRIVE'],
  ['scripts/daytrader-profit-discipline.md','MIDDAY'],
  ['scripts/daytrader-profit-discipline.md','POWER_HOUR'],
];
const failures=[];
for(const file of requiredFiles)if(!fs.existsSync(file))failures.push(`missing file: ${file}`);
for(const [file,marker] of requiredText){
  if(!fs.existsSync(file))continue;
  if(!fs.readFileSync(file,'utf8').includes(marker))failures.push(`missing marker ${JSON.stringify(marker)} in ${file}`);
}
if(failures.length){
  for(const failure of failures)console.error(`::error::Runtime prerequisite failed: ${failure}`);
  process.exit(1);
}
console.log(`Runtime prerequisites passed: ${requiredFiles.length} files and ${requiredText.length} integration markers.`);
