import fs from 'node:fs/promises';

const OUT='docs/data/congressional-intelligence.json';
const now=new Date();
const iso=now.toISOString();
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const text=s=>String(s??'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&#39;/g,"'").replace(/&quot;/g,'"').replace(/\s+/g,' ').trim();
const ticker=s=>String(s??'').trim().toUpperCase().replace(/[^A-Z0-9.-]/g,'');
const date=s=>{const d=new Date(s);return Number.isFinite(d.getTime())?d.toISOString().slice(0,10):null};
const days=(a,b)=>Math.max(0,(Date.parse(a)-Date.parse(b))/86400000);
const midpoint=s=>{const raw=String(s),mult=/\d\s*m\b/i.test(raw)?1e6:/\d\s*k\b/i.test(raw)?1e3:1,n=[...raw.matchAll(/[\d,.]+/g)].map(x=>Number(x[0].replace(/,/g,''))*mult).filter(Number.isFinite);return n.length?round((n[0]+(n[1]??n[0]))/2):null};
const side=s=>/purchase|buy/i.test(s)?'BUY':/sale|sell/i.test(s)?'SELL':'OTHER';
const key=x=>[x.politician.toUpperCase(),x.ticker,x.transactionDate,x.side,String(x.amountRange).replace(/\s/g,'')].join('|');
const fetchHtml=async(url)=>{const c=new AbortController();const timer=setTimeout(()=>c.abort(),20000);try{const r=await fetch(url,{signal:c.signal,headers:{'user-agent':'Teststock congressional disclosure research/1.0 (public pages; low frequency)'}});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.text();}finally{clearTimeout(timer)}};

function parseInsiderFinance(h){
  const out=[];
  for(const m of h.matchAll(/\{"firstName":".*?","party":".*?"\}/g)){
    try{const x=JSON.parse(m[0]);const symbol=ticker(x.symbol),transactionDate=date(x.transactionDate),reportedDate=date(x.dateRecieved);if(!symbol||!transactionDate||!reportedDate||side(x.type)==='OTHER')continue;out.push({politician:text(`${x.firstName} ${x.lastName}`),ticker:symbol,asset:text(x.assetDescription),transactionDate,reportedDate,side:side(x.type),amountRange:text(x.amount),amountMidpoint:midpoint(x.amount),owner:text(x.owner)||'UNKNOWN',party:text(x.party)||'UNKNOWN',filingUrl:x.link||null,source:'INSIDERFINANCE'});}catch{}
  }
  return out;
}

function parseStockcircle(h){
  const out=[];
  for(const m of h.matchAll(/<div class="politician-overview__card">([\s\S]*?)(?=<div class="politician-overview__card">|<\/main>)/g)){
    const c=m[1],politician=text(c.match(/politician-overview__card__name[^>]*>([\s\S]*?)<\/h3>/i)?.[1]),party=text(c.match(/politician-overview__card__congress[^>]*>([\s\S]*?)<\/span>/i)?.[1]).split('–').at(-1)||'UNKNOWN';
    const pieces=c.split('<div class="politician-overview__card__transaction">').slice(1);
    for(const p of pieces){const symbol=ticker(p.match(/assets\.parqet\.com\/logos\/symbol\/([A-Za-z0-9.-]+)/i)?.[1]);const transactionDate=date(text(p.match(/politician-overview__card__transaction-date[^>]*>([\s\S]*?)<\/span>/i)?.[1]));const tradeSide=side(p.match(/transaction--(purchase|sale)/i)?.[1]);const amountRange=text(p.match(/column--amount[^>]*>([\s\S]*?)<\/div>/i)?.[1]);if(politician&&symbol&&transactionDate&&Date.parse(transactionDate)<=now.getTime()+86400000&&tradeSide!=='OTHER')out.push({politician,ticker:symbol,asset:text(p.match(/table__stock[\s\S]*?<div>([\s\S]*?)<\/div>/i)?.[1]),transactionDate,reportedDate:null,side:tradeSide,amountRange,amountMidpoint:midpoint(amountRange),owner:'UNKNOWN',party,filingUrl:null,source:'STOCKCIRCLE'});}
  }
  return out;
}

let previous=null;try{previous=JSON.parse(await fs.readFile(OUT,'utf8'))}catch{}
const providers=[
  {id:'INSIDERFINANCE',url:'https://www.insiderfinance.io/congress-trades',role:'PRIMARY_PUBLIC_HTML',parser:parseInsiderFinance},
  {id:'STOCKCIRCLE',url:'https://stockcircle.com/congress-stock-trades?view=latest_trades',role:'PUBLIC_RECONCILIATION_AND_PRICE_CONTEXT',parser:parseStockcircle},
  {id:'BARCHART',url:'https://www.barchart.com/investing-ideas/politician-insider-trading',role:'PUBLIC_RECONCILIATION_REFERENCE',parser:null},
  {id:'CAPITOL_TRADES',url:'https://www.capitoltrades.com/politicians',role:'MANUAL_RECONCILIATION_REFERENCE',parser:null},
  {id:'QUIVER_QUANT',url:'https://www.quiverquant.com/congresstrading/',role:'OPTIONAL_LICENSED_API_OR_MANUAL_REFERENCE',parser:null},
  {id:'UNUSUAL_WHALES',url:'https://unusualwhales.com/politics',role:'OPTIONAL_LICENSED_API_OR_MANUAL_REFERENCE',parser:null}
];
const records=[],status=[];
for(const p of providers){
  if(!p.parser){status.push({...p,lastAttemptAt:iso,status:'REFERENCE_ONLY',records:0});continue}
  try{const rows=p.parser(await fetchHtml(p.url));records.push(...rows);status.push({...p,parser:undefined,lastAttemptAt:iso,status:rows.length?'OK':'EMPTY',records:rows.length});}
  catch(e){status.push({...p,parser:undefined,lastAttemptAt:iso,status:'UNAVAILABLE',records:0,error:String(e.message).slice(0,160)});}
}
const merged=new Map();
for(const r of records){const k=key(r),old=merged.get(k);if(old){old.sources=[...new Set([...old.sources,r.source])];for(const f of ['reportedDate','filingUrl','asset','owner','party'])if(!old[f]&&r[f])old[f]=r[f];}else merged.set(k,{...r,sources:[r.source]});}
let unique=[...merged.values()].map(x=>{const reportDelayDays=x.reportedDate?round(days(x.reportedDate,x.transactionDate),1):null;const disclosureAgeDays=x.reportedDate?round(days(iso,x.reportedDate),1):round(days(iso,x.transactionDate),1);return {...x,reportDelayDays,disclosureAgeDays,recencyWeight:round(Math.pow(.5,disclosureAgeDays/30),4),sourceAgreement:x.sources.length};}).sort((a,b)=>String(b.reportedDate||b.transactionDate).localeCompare(String(a.reportedDate||a.transactionDate))).slice(0,2000);
if(!unique.length&&previous?.records?.length){unique=previous.records;status.push({id:'CACHE',status:'LAST_GOOD_PRESERVED',records:unique.length});}
const byTicker={};
for(const r of unique){if(r.disclosureAgeDays>180||r.side==='OTHER')continue;const a=byTicker[r.ticker]??={ticker:r.ticker,buyWeight:0,sellWeight:0,politicians:new Set(),parties:new Set(),sourceSet:new Set(),latestReportedDate:null,records:0};const w=r.recencyWeight*Math.log10(Math.max(1001,r.amountMidpoint||1001))/4*(1+Math.min(1,r.sourceAgreement-1)*.15);a[r.side==='BUY'?'buyWeight':'sellWeight']+=w;a.politicians.add(r.politician);a.parties.add(r.party);r.sources.forEach(s=>a.sourceSet.add(s));a.latestReportedDate=[a.latestReportedDate,r.reportedDate||r.transactionDate].filter(Boolean).sort().at(-1);a.records++;}
const tickerSignals=Object.values(byTicker).map(a=>{const raw=a.buyWeight-a.sellWeight;return {ticker:a.ticker,netActivityScore:round(clamp(raw*12,-100,100),1),buyWeight:round(a.buyWeight,3),sellWeight:round(a.sellWeight,3),distinctPoliticians:a.politicians.size,bipartisan:[...a.parties].filter(x=>x!=='UNKNOWN').length>1,sourceCount:a.sourceSet.size,recordCount:a.records,latestReportedDate:a.latestReportedDate,confidence:round(clamp(25+a.sourceSet.size*15+Math.min(30,a.records*3),0,100),0)}}).sort((a,b)=>Math.abs(b.netActivityScore)-Math.abs(a.netActivityScore));
const output={schemaVersion:1,generatedAt:iso,mode:'SHADOW_DIAGNOSTIC_ONLY',authority:'Congressional disclosures are delayed research context. They cannot create live eligibility, increase size or risk, loosen a gate, or bypass per-order stock approval.',admission:{state:'SHADOW',minimumResolvedShadowSignals:30,minimumForwardExpectancyR:0.15,minimumRegimeSamples:12,liveInfluenceAllowed:false,reason:'Forward profitability has not been independently established inside Teststock.'},deduplication:{key:'politician+ticker+transactionDate+side+amountRange',crossSourceRule:'Agreement raises data confidence; it never counts as another politician or another trade.'},decay:{basis:'reported-date when available; transaction-date fallback',halfLifeDays:30,maxAgeDays:180,warning:'Federal disclosures can arrive long after the transaction. This is not real-time order flow.'},providers:status,records:unique,tickerSignals,summary:{uniqueRecords:unique.length,tickers:tickerSignals.length,latestReportedDate:unique.map(x=>x.reportedDate).filter(Boolean).sort().at(-1)||null,automatedProvidersOk:status.filter(x=>x.status==='OK').length,cachePreserved:status.some(x=>x.id==='CACHE')}};
await fs.writeFile(OUT,JSON.stringify(output,null,2));
console.log(`Congressional intelligence: ${output.summary.uniqueRecords} unique records, ${output.summary.tickers} tickers, ${output.summary.automatedProvidersOk} automated sources OK; mode=${output.mode}`);
