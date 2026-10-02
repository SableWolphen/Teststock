import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';
const src=await fs.readFile(new URL('./chatgpt-trade-quality-rules.md',import.meta.url),'utf8');
const engine=await fs.readFile(new URL('./build-trade-quality-engine.mjs',import.meta.url),'utf8');
const replay=await fs.readFile(new URL('./build-trade-replay.mjs',import.meta.url),'utf8');
const executor=await fs.readFile(new URL('./chatgpt-executor-prompt.md',import.meta.url),'utf8');
const liveCycle=await fs.readFile(new URL('./run-live-intraday-cycle.sh',import.meta.url),'utf8');
test('new risk fails closed on stale or broker mismatch',()=>{assert.match(src,/STOP_NEW_RISK/);assert.match(src,/brokerWatchdog/);assert.match(src,/mismatch between repository state and Robinhood/);});
test('hypothetical outcomes never become real PnL',()=>{assert.match(src,/Never count hypothetical trades as fills or PnL/);assert.match(replay,/RESEARCH_ONLY/);assert.match(replay,/do not rewrite real broker fills or PnL/);});
test('learning cannot increase hard risk ceiling',()=>{assert.match(engine,/never increase hard risk ceilings/i);assert.match(src,/never create eligibility, increase hard risk ceilings/i);});
test('chaos conditions include broker ambiguity and partial fills',()=>{assert.match(engine,/ambiguous order submission/);assert.match(engine,/partial fill/);assert.match(engine,/runner restart mid-order/);});
test('trade count is not the optimization target',()=>{assert.match(engine,/not trade count/);assert.match(src,/not number of trades/);});
test('qualified stock and evidence-gated option entries are automatic under the scheduled authorization',()=>{assert.match(executor,/Qualified stock entries/);assert.match(executor,/Stock options/);assert.match(executor,/automatic/);assert.match(executor,/This scheduled run is authorized to perform only the broker actions described below/);});
test('risk-reducing and profit-taking exits are automatic',()=>{assert.match(executor,/Risk-reducing Teststock exits and validated profit-taking are execution instructions for OpenAI executor/);assert.match(executor,/broker\/tool-required review or confirmation/);assert.match(executor,/Stops\/exits outrank entries/);});
test('live cycle invokes the paper-first OpenAI executor only for actionable dispatches',()=>{assert.match(liveCycle,/FAST_CYCLE_OPENAI_EXECUTOR/);assert.match(liveCycle,/TESTSTOCK_EXECUTION_MODE/);assert.match(liveCycle,/chatgpt-executor\.mjs/);assert.match(liveCycle,/FAST_CYCLE_NO_ACTION/);});
test('dispatch fingerprints persist outside the git worktree',()=>{assert.match(liveCycle,/\.teststock-runtime/);assert.match(liveCycle,/RUNTIME_DISPATCH_STATE/);assert.match(liveCycle,/cp docs\/data\/execution-dispatch\.json/);});

const executorSource=await fs.readFile(new URL('./chatgpt-executor.mjs',import.meta.url),'utf8');
test('real broker writes are opt-in and paper is the default',()=>{assert.match(executorSource,/config\(\)\.default_execution_mode\|\|'paper'/);assert.match(executorSource,/TESTSTOCK_EXECUTION_MODE\|\|configuredDefault/);assert.match(executorSource,/I_UNDERSTAND_REAL_ORDERS/);assert.match(executorSource,/CLAIMED_BEFORE_SUBMIT/);assert.match(executorSource,/ROBINHOOD_MCP_OAUTH_TOKEN/);});
