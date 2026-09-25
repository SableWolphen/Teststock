import fs from 'node:fs/promises';
const read=async f=>JSON.parse(await fs.readFile(f,'utf8'));
const [s,st,m]=await Promise.all(['docs/signal.json','docs/data/stock-tournament.json','docs/data/market-intelligence.json'].map(read)),fail=[];
if(m.timeHorizonPolicy?.enabled!==true||m.timeHorizonPolicy?.liveExecutionStyle!=='ACTIVE_DAY_TRADER')fail.push('day trader mode');
if(JSON.stringify(m.timeHorizonPolicy).toLowerCase().includes('crypto'))fail.push('crypto policy present');
const o=m.timeHorizonPolicy?.stocks;
for(const k of ['fixedDailyEntryCountLimit','fixedConcurrentPositionCountLimit','fixedPerExecutorRunEntryCountLimit'])if(o?.[k]!==null)fail.push(`fixed quota ${k}`);
if(o?.capacityMode!=='DYNAMIC_RISK_CASH_AND_BROKER_LIMITED')fail.push('dynamic capacity mode');
if(Number(o?.newEntryCutoffMinutesBeforeClose)!==20||Number(o?.forcedExitMinutesBeforeClose)!==10||Number(o?.maximumHoldingMinutes)!==120)fail.push('stock timing');
if(Number(o?.cooldownAfterStopMinutes)!==5||o?.sameSymbolReentryCooldownMinutes!==null||Number(o?.maximumEntriesPerSymbolPerNyDay)!==1||o?.sameDayStockReentryAllowed!==false||o?.distinctStockRotationRequired!==true)fail.push('stock rotation');
const ex=o?.orderExecution;
if(ex?.entryPreference!=='MARKETABLE_LIMIT_WHEN_SUPPORTED'||ex?.exitPreference!=='FASTEST_SUPPORTED_RISK_APPROPRIATE_ORDER'||Number(ex?.stalePassiveOrderSeconds)!==45||ex?.allowCancelReplaceAfterBrokerReconciliation!==true||ex?.neverBlindRetry!==true)fail.push('stock order execution');
for(const x of st.liveQueue||[]){const p=x.timeHorizonPolicy;if(!p||p.classification!=='DAY_TRADE'||p.classificationIsAdvisory!==false||p.liveExecutionStyle!=='ACTIVE_DAY_TRADER'||p.mayNotCreateEligibility!==true||p.risk?.noMargin!==true||p.risk?.noAverageDown!==true||p.risk?.noChasing!==true||p.risk?.unprotectedPositionAllowed!==false||Number(p.timeExit?.maximumHoldingMinutes)!==120)fail.push(`${x.ticker}: stock day horizon`);}
if(fail.length)throw new Error(`time-horizon validation failed: ${[...new Set(fail)].join(', ')}`);
console.log('time-horizon validation passed: stock-only day trader, one stock entry per ticker per NY day, no fixed trade quotas, hard risk/broker/protection gates preserved');