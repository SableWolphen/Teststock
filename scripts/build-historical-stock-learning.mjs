import fs from 'node:fs/promises';

const input='docs/data/trade-history.json';
const output='docs/data/historical-stock-learning.json';
const rows=JSON.parse(await fs.readFile(input,'utf8'));
const finite=x=>Number.isFinite(Number(x));
const round=(x,d=3)=>Number(Number(x).toFixed(d));
const terminal=new Set(['STOP','TARGET1','TARGET2','MATURED_WIN','MATURED_LOSS','EXPIRED_UNTRIGGERED']);
const resolved=rows.filter(x=>terminal.has(String(x.status||'').toUpperCase()));
const symbols=[...new Set(rows.map(x=>x.symbol).filter(Boolean))].sort();

function classify(x){
  const s=String(x.status||'').toUpperCase();
  if(['TARGET1','TARGET2','MATURED_WIN'].includes(s))return 'WIN';
  if(['STOP','MATURED_LOSS'].includes(s))return 'LOSS';
  if(s==='EXPIRED_UNTRIGGERED')return 'NO_ENTRY';
  return 'OPEN';
}
function realizedR(x){
  const outcome=classify(x);
  if(outcome==='NO_ENTRY'||outcome==='OPEN')return null;
  const e=Number(x.actualEntryPrice??x.entryStock??x.trigger), stop=Number(x.stop);
  if(!finite(e)||!finite(stop)||Math.abs(e-stop)<1e-9)return null;
  const risk=Math.abs(e-stop);
  if(outcome==='LOSS')return -1;
  const exit=Number(x.estimatedExit??(String(x.status).toUpperCase()==='TARGET2'?x.target2:x.target1));
  return finite(exit)?round((exit-e)/risk,3):null;
}
function summarize(xs){
  const outcomes=xs.map(x=>({...x,_outcome:classify(x),_r:realizedR(x)}));
  const entered=outcomes.filter(x=>['WIN','LOSS'].includes(x._outcome));
  const wins=entered.filter(x=>x._outcome==='WIN').length, losses=entered.filter(x=>x._outcome==='LOSS').length;
  const rs=entered.map(x=>x._r).filter(finite).map(Number);
  const pfDen=Math.abs(rs.filter(x=>x<0).reduce((s,x)=>s+x,0));
  const pfNum=rs.filter(x=>x>0).reduce((s,x)=>s+x,0);
  return {
    records:xs.length,
    enteredResolved:entered.length,
    wins,losses,
    winRatePct:entered.length?round(wins/entered.length*100,1):null,
    averageEstimatedR:rs.length?round(rs.reduce((s,x)=>s+x,0)/rs.length,3):null,
    estimatedProfitFactor:pfDen?round(pfNum/pfDen,3):(pfNum>0?null:0),
    noEntry:outcomes.filter(x=>x._outcome==='NO_ENTRY').length,
    stillOpen:outcomes.filter(x=>x._outcome==='OPEN').length
  };
}
const bySymbol=Object.fromEntries(symbols.map(s=>[s,summarize(rows.filter(x=>x.symbol===s))]));
const byStatus=Object.fromEntries([...new Set(rows.map(x=>x.status))].sort().map(s=>[s,rows.filter(x=>x.status===s).length]));
const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  source:'TESTSTOCK_TRADE_HISTORY',
  sourceFile:input,
  authority:'RESEARCH_ONLY',
  coverage:{records:rows.length,uniqueSymbols:symbols.length,symbols,firstDecisionDate:rows.map(x=>x.date).filter(Boolean).sort()[0]||null,lastDecisionDate:rows.map(x=>x.date).filter(Boolean).sort().at(-1)||null},
  overall:summarize(rows),
  bySymbol,
  byStatus,
  limitations:[
    'This report learns from Teststock historical candidate records, not confirmed broker fills.',
    'Repeated budget/strategy variants for the same symbol/date are not independent observations; do not treat raw record count as statistical sample size.',
    'estimated R uses recorded Teststock entry/stop/exit fields and is diagnostic, not realized PnL.',
    'PENDING_ENTRY and ACTIVE records are not scored as wins or losses.',
    'EXPIRED_UNTRIGGERED records are tracked as no-entry outcomes, not losses.',
    'Historical learning may suggest hypotheses and ranking changes but cannot loosen live-money safety or profitability-admission gates without forward/real-fill evidence.'
  ]
};
await fs.writeFile(output,JSON.stringify(out,null,2));
console.log(`Historical stock learning: ${rows.length} records, ${symbols.length} symbols, ${out.overall.enteredResolved} resolved entries`);
