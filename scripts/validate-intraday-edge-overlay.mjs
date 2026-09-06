import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [board,edge]=await Promise.all([read('docs/data/trigger-board.json'),read('docs/data/intraday-edge.json')]);
const fail=[];
if(!board.intradayEngine||board.intradayEngine.schemaVersion!==2)fail.push('engine metadata');
if(!edge.generatedAt||edge.schemaVersion!==2)fail.push('edge snapshot');
if(board.intradayEngine?.policy?.includes('may never create eligibility')!==true)fail.push('eligibility authority');
if(board.intradayEngine?.profitGivebackPolicy?.enabled!==true||Number(board.intradayEngine?.profitGivebackPolicy?.reduceRiskAfterGivebackPct)!==35||Number(board.intradayEngine?.profitGivebackPolicy?.stopNewRiskAfterGivebackPct)!==50)fail.push('profit giveback policy');
for(const k of ['spy','qqq','btc'])if(!(k in (board.intradayEngine?.benchmarks||{})))fail.push(`benchmark ${k}`);
for(const x of board.items||[]){
  if(x.kind!=='ENTRY')continue;
  const e=x.intradayEdge;
  if(!e)fail.push(`${x.ticker}: missing edge`);
  if(e?.status==='FRESH'){
    if(!Number.isFinite(Number(e.score))||!Number.isFinite(Number(e.adjustedScore)))fail.push(`${x.ticker}: score`);
    if(e.adaptiveSizing?.mayNotIncreaseExistingRiskCap!==true)fail.push(`${x.ticker}: sizing authority`);
    if(e.profitProtection?.neverWidenStop!==true||e.profitProtection?.protectWinnerBeforeGiveback!==true)fail.push(`${x.ticker}: profit protection`);
    if(!e.realFillLearning||!e.regimeRouting||e.regimeRouting?.cashAllowed!==true)fail.push(`${x.ticker}: adaptive intelligence`);
    if(!Number.isFinite(Number(e.costAdjustedEdge)))fail.push(`${x.ticker}: expectancy`);
  }
  if(['BUY_TRIGGER','SEED_LANE_BUY_TRIGGER','STOCK_DAY_TRADE_SEED_LANE_BUY_TRIGGER','CRYPTO_SEED_LANE_BUY_TRIGGER'].includes(x.status)&&e?.status!=='FRESH')fail.push(`${x.ticker}: actionable without fresh intraday edge`);
}
if(fail.length)throw new Error(`intraday edge validation failed: ${[...new Set(fail)].join(', ')}`);
console.log('intraday edge validation passed: 1m/5m VWAP, volume, ORB, relative strength, regime, event risk, real-fill expectancy, adaptive sizing and profit protection are fail-closed');
