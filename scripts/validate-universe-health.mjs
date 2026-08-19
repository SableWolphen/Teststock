import fs from 'node:fs/promises';

const file='docs/data/broad-stock-universe.json';
const raw=JSON.parse(await fs.readFile(file,'utf8'));
const problems=[];
const ageMinutes=(Date.now()-new Date(raw.generatedAt||0).getTime())/60000;
if(!Number.isFinite(ageMinutes)||ageMinutes>30)problems.push(`broad universe stale: ${ageMinutes.toFixed(1)} minutes`);
if(Number(raw.activeTradableOperatingCompanies||0)<4000)problems.push(`operating-company universe unexpectedly small: ${raw.activeTradableOperatingCompanies}`);
if(Number(raw.snapshotSymbolsWithData||0)<3000)problems.push(`snapshot coverage unexpectedly small: ${raw.snapshotSymbolsWithData}`);
if(Number(raw.liveTournamentSize||0)<1000)problems.push(`live tournament too small: ${raw.liveTournamentSize}; expected at least 1000`);
if(Number(raw.historyPoolRequested||0)<500)problems.push(`history pool too small: ${raw.historyPoolRequested}; expected at least 500`);
if(Number(raw.validationPoolSize||0)<150)problems.push(`validation pool too small: ${raw.validationPoolSize}; expected at least 150`);
const banned=/(\bETF\b|\bETN\b|exchange.?traded|\bfund\b|\bproshares\b|\bishares\b|\bspdr\b|\bdirexion\b|\binvesco\b|\bwisdomtree\b|\bvaneck\b|\bglobal x\b|\bfirst trust\b|warrant|preferred|inverse|short qqq|short s&p|short russell|short dow)/i;
for(const row of raw.topCandidates||[])if(banned.test(String(row.name||'')))problems.push(`non-operating security leaked into qualified candidates: ${row.symbol} ${row.name}`);
if(problems.length){console.error('UNIVERSE HEALTH FAILED');for(const p of problems)console.error(`- ${p}`);process.exit(1);}
console.log(`Universe health OK: ${raw.activeTradableOperatingCompanies} operating companies, ${raw.snapshotSymbolsWithData} snapshots, top ${raw.liveTournamentSize}, history ${raw.historyPoolRequested}, validation ${raw.validationPoolSize}, qualified ${raw.qualifiedForOptimizer}.`);
