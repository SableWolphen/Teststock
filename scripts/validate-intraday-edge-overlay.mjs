import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [board,edge]=await Promise.all([read('docs/data/trigger-board.json'),read('docs/data/intraday-edge.json')]);
const fail=[];
if(!board.intradayEngine||board.intradayEngine.schemaVersion!==1)fail.push('engine metadata');
if(!edge.generatedAt||edge.schemaVersion!==1)fail.push('edge snapshot');
if(board.intradayEngine?.policy?.includes('may never create eligibility')!==true)fail.push('eligibility authority');
for(const x of board.items||[]){if(x.kind!=='ENTRY')continue;const e=x.intradayEdge;if(!e)fail.push(`${x.ticker}: missing edge`);if(e?.status==='FRESH'){if(!Number.isFinite(Number(e.score)))fail.push(`${x.ticker}: score`);if(e.adaptiveSizing?.mayNotIncreaseExistingRiskCap!==true)fail.push(`${x.ticker}: sizing authority`);if(e.profitProtection?.neverWidenStop!==true)fail.push(`${x.ticker}: stop authority`);}if(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER'].includes(x.status)&&e?.status!=='FRESH')fail.push(`${x.ticker}: actionable without fresh intraday edge`);}
if(fail.length)throw new Error(`intraday edge validation failed: ${[...new Set(fail)].join(', ')}`);
console.log('intraday edge validation passed: 1m/5m context is fresh for actionable entries, never creates eligibility, and cannot widen risk');
