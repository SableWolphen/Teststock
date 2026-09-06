import fs from 'node:fs/promises';
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const write=(f,x)=>fs.writeFile(f,JSON.stringify(x,null,2));
const [q,sj,cj]=await Promise.all([read('docs/data/trade-quality-intelligence.json',{}),read('docs/data/real-trade-journal.json',{}),read('docs/data/crypto-real-trade-journal.json',{})]);
const num=x=>Number(x),finite=x=>Number.isFinite(num(x)),avg=a=>{const x=a.filter(finite).map(num);return x.length?x.reduce((s,v)=>s+v,0)/x.length:null;};
const trades=[...(sj.trades||[]),...(cj.trades||[])].filter(t=>t?.reconciledFromRobinhood===true&&['WIN','LOSS','FLAT'].includes(t.outcome)&&finite(t.realizedR)&&t.finalExitAt).sort((a,b)=>new Date(a.finalExitAt)-new Date(b.finalExitAt));
const setups=[...new Set(trades.map(t=>String(t.setupType||'UNKNOWN').toUpperCase()))];
const rows=[];for(const setup of setups){const xs=trades.filter(t=>String(t.setupType||'UNKNOWN').toUpperCase()===setup);const recent=xs.slice(-10),prior=xs.slice(Math.max(0,xs.length-30),Math.max(0,xs.length-10));const ra=avg(recent.map(t=>t.realizedR)),pa=avg(prior.map(t=>t.realizedR));let state='INSUFFICIENT_EVIDENCE';if(recent.length>=8&&prior.length>=8){const delta=ra-pa;state=delta<=-0.35?'DRIFT_NEGATIVE_BLOCK_OR_SHADOW':delta<=-0.15?'DRIFT_NEGATIVE_REDUCE':'STABLE_OR_IMPROVING';}rows.push({setup,total:xs.length,recentN:recent.length,priorN:prior.length,recentAverageR:ra,priorAverageR:pa,deltaR:finite(ra)&&finite(pa)?Number((ra-pa).toFixed(4)):null,state});}
q.modelDrift={generatedAt:new Date().toISOString(),bySetup:rows,policy:'Negative drift may reduce, pause or shadow a setup after sufficient real evidence. Drift detection may never create eligibility or increase hard risk ceilings.'};
await write('docs/data/trade-quality-intelligence.json',q);console.log(`Model drift: ${rows.length} setup buckets evaluated.`);
