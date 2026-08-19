import fs from 'node:fs/promises';

const budgets=[50,100,200,500];
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const sma=(xs,n)=>avg(xs.slice(-n));
function rsi(c,n=14){if(c.length<n+1)return 50;let g=0,l=0;for(let i=c.length-n;i<c.length;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs));}
function atr(b,n=14){const xs=[];for(let i=Math.max(1,b.length-n);i<b.length;i++){const x=b[i],p=b[i-1];xs.push(Math.max(x.h-x.l,Math.abs(x.h-p.c),Math.abs(x.l-p.c)));}return avg(xs);}
function looksLikeOperatingCompany(a){const name=String(a.name||'');return !/(ETF|ETN|exchange.?traded|index fund|mutual fund|closed.end fund|warrant|rights|units|unit$|preferred|depositary shares|trust|portfolio|2x|3x|ultra|inverse)/i.test(name);}

const assets=await get('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity');
const universe=(assets||[]).filter(a=>a.status==='active'&&a.tradable!==false&&a.symbol&&looksLikeOperatingCompany(a));
const symbols=universe.map(a=>a.symbol);
const snapshots={};
for(const batch of chunks(symbols,150)){
  try{
    const q=new URLSearchParams({symbols:batch.join(','),feed:'iex'});
    Object.assign(snapshots,await get(`https://data.alpaca.markets/v2/stocks/snapshots?${q}`));
  }catch{}
}
const firstPass=[];
for(const a of universe){
  const s=snapshots[a.symbol]||{},trade=s.latestTrade||s.latest_trade||{},quote=s.latestQuote||s.latest_quote||{},day=s.dailyBar||s.daily_bar||{},prev=s.prevDailyBar||s.prev_daily_bar||{};
  const price=Number(trade.p||day.c||0),volume=Number(day.v||0),prevClose=Number(prev.c||0),bid=Number(quote.bp||quote.bid_price||0),ask=Number(quote.ap||quote.ask_price||0);
  if(!(price>=1&&volume>0&&prevClose>0))continue;
  const dollarVolume=price*volume,mid=bid>0&&ask>0?(bid+ask)/2:0,spreadPct=mid>0?(ask-bid)/mid*100:999,dayChange=pct(price,prevClose);
  if(dollarVolume<2_000_000||spreadPct>1.25)continue;
  const liquidity=Math.min(35,Math.max(0,Math.log10(Math.max(1,dollarVolume))-6)*12);
  const momentum=clamp(dayChange,-8,12)*2;
  const spreadBonus=Math.max(0,12-spreadPct*20);
  firstPass.push({symbol:a.symbol,name:a.name||null,exchange:a.exchange||null,price:round(price),volume,dollarVolume:Math.round(dollarVolume),spreadPct:round(spreadPct,3),dayChangePct:round(dayChange,2),preScore:round(50+liquidity+momentum+spreadBonus,1)});
}
firstPass.sort((a,b)=>b.preScore-a.preScore||b.dollarVolume-a.dollarVolume);
const deepSymbols=firstPass.slice(0,200).map(x=>x.symbol);
const start=new Date(Date.now()-420*86400000).toISOString().slice(0,10);
const by={};
for(const batch of chunks(deepSymbols,80)){
  let token='';
  for(let page=0;page<4;page++){
    const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start,limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [sym,bars] of Object.entries(raw.bars||{}))by[sym]=[...(by[sym]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
}
function validation(bars){const moves=[];for(let i=80;i<bars.length-21;i+=5){const c=bars.slice(0,i+1).map(x=>x.c),last=c.at(-1),m20=sma(c,20),m50=sma(c,50);if(!(last>m20&&last>m50))continue;const move=pct(bars[i+20].c,last);moves.push(move);}return {samples:moves.length,winRate:moves.length?Math.round(moves.filter(x=>x>0).length/moves.length*100):null,avgMove:moves.length?round(avg(moves),1):null};}
const deep=[];
for(const base of firstPass.slice(0,200)){
  const bars=by[base.symbol]||[];if(bars.length<90)continue;
  const c=bars.map(x=>x.c),price=base.price,ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,Math.min(200,c.length)),a=atr(bars),atrPct=a/price*100,m20=pct(price,c.at(-21)),m60=pct(price,c.at(-61)),rrsi=rsi(c),high20=Math.max(...bars.slice(-20).map(x=>x.h));
  if(!(price>ma20&&price>ma50&&price>ma200&&m20>-8&&m60>-12&&atrPct>0&&atrPct<=10))continue;
  const v=validation(bars),entry=round(Math.max(price,high20*.998)),stop=round(Math.min(ma20,price-a*1.35));if(!(entry>stop&&stop>0))continue;
  const risk=entry-stop,target1=round(entry+risk*1.5),target2=round(entry+risk*2.6);
  let score=60;score+=clamp(m20,-10,20)*.8+clamp(m60,-20,40)*.35;score+=price>ma20?6:0;score+=price>ma50?8:0;score+=price>ma200?6:0;score+=rrsi>=48&&rrsi<=72?6:rrsi>80?-5:0;score+=base.spreadPct<=.35?5:0;score+=base.dollarVolume>=10_000_000?5:0;if(v.samples>=15&&v.winRate>=55)score+=7;if(v.samples>=25&&v.winRate>=60)score+=4;score-=Math.max(0,atrPct-6)*2;
  deep.push({...base,score:Math.round(clamp(score,0,100)),direction:'BULLISH',ma20:round(ma20),ma50:round(ma50),ma200:round(ma200),m20:round(m20,1),m60:round(m60,1),rsi:round(rrsi,1),atrPct:round(atrPct,1),entry,stop,target1,target2,validation:v,fundamentals:{label:'UNAVAILABLE',coverage:0},corporateActions:{risk:'UNKNOWN',events:[]},source:'BROAD_ACTIVE_US_EQUITY_SCAN'});
}
deep.sort((a,b)=>b.score-a.score||Number(b.validation?.winRate||0)-Number(a.validation?.winRate||0)||b.dollarVolume-a.dollarVolume);
const broadQualified=deep.filter(x=>x.score>=84&&x.validation.samples>=15&&x.validation.winRate>=52&&x.spreadPct<=.35).slice(0,30);
const report={schemaVersion:1,generatedAt:new Date().toISOString(),method:'Two-stage scan: every active tradable Alpaca US equity receives a live snapshot/liquidity screen; the strongest liquid names then receive deeper daily-history scoring and validation before entering the normal Teststock optimizer.',activeTradableOperatingCompanies:universe.length,snapshotSymbolsRequested:symbols.length,snapshotSymbolsWithData:Object.keys(snapshots).length,deepHistorySymbolsRequested:deepSymbols.length,deepCandidatesScored:deep.length,qualifiedForOptimizer:broadQualified.length,topCandidates:broadQualified.slice(0,20)};
await fs.writeFile('docs/data/broad-stock-universe.json',JSON.stringify(report,null,2));
for(const budget of budgets){
  const file=`docs/data/latest-${budget}.json`,data=await read(file);if(!data)continue;
  const recMap=new Map((data.recommendations||[]).map(x=>[x.symbol,x]));for(const x of broadQualified){const old=recMap.get(x.symbol);if(!old||Number(x.score)>Number(old.score||0))recMap.set(x.symbol,x);}
  data.recommendations=[...recMap.values()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,40);
  const snapMap=new Map((data.marketSnapshot||[]).map(x=>[x.symbol,x]));for(const x of deep.slice(0,80))if(!snapMap.has(x.symbol))snapMap.set(x.symbol,{symbol:x.symbol,price:x.price,direction:x.direction,ma20:x.ma20,ma50:x.ma50,ma200:x.ma200,entry:x.entry,stop:x.stop,target1:x.target1,target2:x.target2,atrPct:x.atrPct,m20:x.m20,m60:x.m60,dollarVolume:x.dollarVolume,spreadPct:x.spreadPct,source:x.source});
  data.marketSnapshot=[...snapMap.values()];
  data.broadUniverse={generatedAt:report.generatedAt,activeTradableOperatingCompanies:report.activeTradableOperatingCompanies,snapshotSymbolsWithData:report.snapshotSymbolsWithData,deepCandidatesScored:report.deepCandidatesScored,qualifiedForOptimizer:report.qualifiedForOptimizer,reportUrl:'https://sablewolphen.github.io/Teststock/data/broad-stock-universe.json'};
  await fs.writeFile(file,JSON.stringify(data,null,2));
}
console.log(`Broad stock scan: ${universe.length} active tradable operating companies, ${Object.keys(snapshots).length} snapshots, ${deep.length} deep-scored, ${broadQualified.length} sent to optimizer`);
