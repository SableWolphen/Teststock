import fs from 'node:fs/promises';
const board=JSON.parse(await fs.readFile('docs/data/trigger-board.json','utf8'));
const fail=[];
if(board.schemaVersion!==4)fail.push('schemaVersion');
if(board.source!=='TESTSTOCK_NON_LLM_TRIGGER_MONITOR')fail.push('source');
if(board.monitorCadenceMinutes!==5)fail.push('monitor cadence');
if(board.claudeMarketPollingRequired!==false)fail.push('Claude polling lock');
if(board.siteAvailability!=='24_7_PUBLIC_DASHBOARD')fail.push('24/7 site availability metadata');
if(!['ACTIVE','REFRESHING'].includes(board.researchState))fail.push('research state');
if(!Array.isArray(board.items)||!Array.isArray(board.events))fail.push('arrays');
const allowed=new Set(['BUY_TRIGGER','TRIGGER_1_STOP','TRIGGER_2_TARGET1','TRIGGER_3_TARGET2']);
for(const e of board.events||[])if(!allowed.has(e.trigger))fail.push(`unknown trigger ${e.trigger}`);
if(Boolean(board.executionNeeded)!==Boolean((board.events||[]).length))fail.push('executionNeeded mismatch');
const buys=(board.events||[]).filter(e=>e.trigger==='BUY_TRIGGER');
if(Number(board.buyCompetition?.eligibleNow||0)!==buys.length)fail.push('buy competition count');
if(buys.length&&board.buyCompetition?.best?.queueRole!=='CURRENT_BEST_BUY')fail.push('best buy role');
if(JSON.stringify(board.buyCompetition?.tierPriority)!==JSON.stringify(['A','B']))fail.push('A/B tier priority');
for(const e of buys){
  if(!Number.isFinite(Number(e.queueRank))||Number(e.queueRank)<1)fail.push('buy queue rank');
  if(e.assetClass==='STOCK'&&!['A','B'].includes(e.entryTier))fail.push(`stock buy missing A/B tier ${e.ticker}`);
}
const firstA=buys.findIndex(e=>e.assetClass==='STOCK'&&e.entryTier==='A'),firstB=buys.findIndex(e=>e.assetClass==='STOCK'&&e.entryTier==='B');
if(firstA>=0&&firstB>=0&&firstB<firstA)fail.push('B ranked before A');
if(board.researchState==='REFRESHING'&&buys.length)fail.push('refreshing research must not emit buy triggers');
for(const x of board.items||[])if(x.status==='STALE_SIGNAL')fail.push('legacy stale label');
const text=JSON.stringify(board).toLowerCase();
for(const banned of ['account_number','accountnumber','routing_number','routingnumber','ssn','social security','api_secret','api key','password'])if(text.includes(banned))fail.push(`possible secret/private field: ${banned}`);
if(fail.length)throw new Error(`trigger-board validation failed: ${[...new Set(fail)].join(', ')}`);
console.log(`trigger-board validation passed: research ${board.researchState}, ${board.events.length} actionable event(s), ${buys.length} competing buy(s), A-first then B`);
