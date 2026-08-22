import fs from 'node:fs/promises';const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [s,st,c,m]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json','docs/data/crypto-tournament.json','docs/data/market-intelligence.json'].map(read)),fail=[];
for(const id of ['YAHOO_FINANCE','GOOGLE_FINANCE','WEBULL','TRADINGVIEW','FINVIZ'])if(!(m.providers||[]).some(x=>x.id===id))fail.push(`provider ${id}`);
if(!s.timeHorizonPolicy?.enabled||s.executionArchitecture?.mode!=='TWO_TOURNAMENTS_ONLY')fail.push('architecture');
if(s.autopilot?.requiresPerOrderApproval!==true||s.autopilot?.automaticQualifiedBuys!==false)fail.push('stock approval');
for(const x of [...(st.liveQueue||[]),...(st.researchFinalists||[])]){const p=x.timeHorizonPolicy;if(!p||p.mayNotCreateEligibility!==true||p.existingHardStopAndRiskRemainAuthoritative!==true)fail.push(`${x.ticker}: horizon authority`);if(p.classification==='DAY_TRADE'&&p.risk?.bracketRequired!==true)fail.push(`${x.ticker}: day bracket`);if(p.classification==='LONG_TERM'&&(p.risk?.unprotectedPositionAllowed!==false||p.risk?.marketStopDefault!==false))fail.push(`${x.ticker}: long protection`);}
for(const x of c.ranked||[]){const p=x.timeHorizonPolicy;if(!p||p.mayNotCreateEligibility!==true||p.risk?.noLeverage!==true||p.risk?.unprotectedPositionAllowed!==false)fail.push(`${x.ticker}: crypto horizon`);}
if(m.timeHorizonPolicy?.dayTrading?.maximumAccountRisk!=='Existing Teststock cap, never increased to 1%')fail.push('risk cap');
if(fail.length)throw new Error(`time-horizon validation failed: ${[...new Set(fail)].join(', ')}`);console.log('time-horizon validation passed: candidate-specific day/swing/long exits; hard risk and two tournaments preserved');
