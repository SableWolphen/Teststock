import fs from 'node:fs/promises';

const budgets=[50,100,200,500];
const TOP_LIVE_POOL=2000;
const HISTORY_POOL=800;
const VALIDATION_POOL=300;
const FINAL_POOL=60;
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
function setupType({price,ma20,ma50,high20,rsiValue,m20,m60}){
  const breakoutDistance=high20?((price/high20)-1)*100:0;
  const pullbackDistance=ma20?((price/ma20)-1)*100:99;
  if(breakoutDistance>=-1.5&&breakoutDistance<=2.5&&m20>0&&m60>0&&rsiValue<=74)return'BREAKOUT';
  if(pullbackDistance>=0&&pullbackDistance<=4&&price>ma50&&m60>0&&rsiValue>=45&&rsiValue<=68)return'PULLBACK';
  return'TREND';
}
function historicalValidation(bars,type){
  const moves=[];
  for(let i=100;i<bars.length-21;i+=5){
    const prior=bars.slice(0,i+1),c=prior.map(x=>x.c),last=c.at(-1),m20=sma(c,20),m50=sma(c,50),m60=pct(last,c.at(-61)),rrsi=rsi(c),h20=Math.max(...prior.slice(-20).map(x=>x.h));
    const breakout=last>=h20*.985&&last>m20&&last>m50&&m60>0&&rrsi<=76;
    const pullback=last>m50&&last>=m20&&last<=m20*1.04&&m60>0&&rrsi>=43&&rrsi<=70;
    const trend=last>m20&&last>m50&&m60>-5;
    if(type==='BREAKOUT'&&!breakout)continue;
    if(type==='PULLBACK'&&!pullback)continue;
    if(type==='TREND'&&!trend)continue;
    moves.push(pct(bars[i+20].c,last));
  }
  const wins=moves.filter(x=>x>0).length;
  const sorted=[...moves].sort((a,b)=>a-b);
  const median=sorted.length?sorted[Math.floor(sorted.length/2)]:null;
  return {samples:moves.length,winRate:moves.length?Math.round(wins/moves.length*100):null,avgMove:moves.length?round(avg(moves),1):null,medianMove:moves.length?round(median,1):null};
}

const assets=await get('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity');
const universe=(assets||[]).filter(a=>a.status==='active'&&a.tradable!==false&&a.symbol&&looksLikeOperatingCompany(a));
const symbols=universe.map(a=>a.symbol);
const snapshots={};
for(const batch of chunks(symbols,150)){
  try{const q=new URLSearchParams({symbols:batch.join(','),feed:'iex'});Object.assign(snapshots,await get(`https://data.alpaca.markets/v2/stocks/snapshots?${q}`));}catch{}
}

const firstPass=[];
for(const a of universe){
  const s=snapshots[a.symbol]||{},trade=s.latestTrade||s.latest_trade||{},quote=s.latestQuote||s.latest_quote||{},day=s.dailyBar||s.daily_bar||{},prev=s.prevDailyBar||s.prev_daily_bar||{};
  const price=Number(trade.p||day.c||0),volume=Number(day.v||0),prevClose=Number(prev.c||0),bid=Number(quote.bp||quote.bid_price||0),ask=Number(quote.ap||quote.ask_price||0);
  if(!(price>=1&&volume>0&&prevClose>0))continue;
  const dollarVolume=price*volume,mid=bid>0&&ask>0?(bid+ask)/2:0,spreadPct=mid>0?(ask-bid)/mid*100:999,dayChange=pct(price,prevClose);
  if(dollarVolume<1_000_000||spreadPct>1.25)continue;
  const liquidity=Math.min(38,Math.max(0,Math.log10(Math.max(1,dollarVolume))-5.5)*12);
  const momentum=clamp(dayChange,-10,12)*1.8;
  const spreadBonus=Math.max(0,14-spreadPct*22);
  const priceQuality=price>=5?5:price>=2?2:0;
  firstPass.push({symbol:a.symbol,name:a.name||null,exchange:a.exchange||null,price:round(price),volume,dollarVolume:Math.round(dollarVolume),spreadPct:round(spreadPct,3),dayChangePct:round(dayChange,2),preScore:round(45+liquidity+momentum+spreadBonus+priceQuality,1)});
}
firstPass.sort((a,b)=>b.preScore-a.preScore||b.dollarVolume-a.dollarVolume);
const liveTournament=firstPass.slice(0,TOP_LIVE_POOL);
const historySymbols=liveTournament.slice(0,HISTORY_POOL).map(x=>x.symbol);

const start=new Date(Date.now()-540*86400000).toISOString().slice(0,10);
const by={};
for(const batch of chunks(historySymbols,80)){
  let token='';
  for(let page=0;page<5;page++){
    const q=new URLSearchParams({symbols:batch.join(','),timeframe:'1Day',start,limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const raw=await get(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [sym,bars] of Object.entries(raw.bars||{}))by[sym]=[...(by[sym]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
}

const historyScored=[];
for(const base of liveTournament.slice(0,HISTORY_POOL)){
  const bars=by[base.symbol]||[];if(bars.length<110)continue;
  const c=bars.map(x=>x.c),price=base.price,ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,Math.min(200,c.length)),a=atr(bars),atrPct=a/price*100,m20=pct(price,c.at(-21)),m60=pct(price,c.at(-61)),rrsi=rsi(c),high20=Math.max(...bars.slice(-20).map(x=>x.h)),high60=Math.max(...bars.slice(-60).map(x=>x.h));
  if(!(price>0&&ma20>0&&ma50>0&&atrPct>0&&atrPct<=12))continue;
  const type=setupType({price,ma20,ma50,high20,rsiValue:rrsi,m20,m60});
  let score=55;
  score+=clamp(m20,-12,22)*.75+clamp(m60,-25,45)*.32;
  score+=price>ma20?6:-7;score+=price>ma50?8:-9;score+=price>ma200?5:-5;
  if(rrsi>=48&&rrsi<=72)score+=6;else if(rrsi>80)score-=7;else if(rrsi<38)score-=7;
  if(price>=high20*.985)score+=5;if(price>=high60*.97)score+=3;
  if(type==='BREAKOUT')score+=5;if(type==='PULLBACK')score+=4;
  if(base.spreadPct<=.35)score+=5;if(base.spreadPct<=.12)score+=2;if(base.dollarVolume>=10_000_000)score+=5;if(base.dollarVolume>=50_000_000)score+=2;
  score-=Math.max(0,atrPct-6)*2;
  historyScored.push({...base,preValidationScore:Math.round(clamp(score,0,100)),setupType:type,direction:price>ma20&&price>ma50?'BULLISH':'MIXED',ma20:round(ma20),ma50:round(ma50),ma200:round(ma200),m20:round(m20,1),m60:round(m60,1),rsi:round(rrsi,1),atrPct:round(atrPct,1),high20:round(high20),high60:round(high60)});
}
historyScored.sort((a,b)=>b.preValidationScore-a.preValidationScore||b.preScore-a.preScore||b.dollarVolume-a.dollarVolume);
const validationPool=historyScored.slice(0,VALIDATION_POOL);

const deep=[];
for(const base of validationPool){
  const bars=by[base.symbol]||[],price=base.price,ma20=base.ma20,a=atr(bars),v=historicalValidation(bars,base.setupType);
  if(v.samples<10)continue;
  const high20=Math.max(...bars.slice(-20).map(x=>x.h));
  const entry=base.setupType==='PULLBACK'?round(Math.max(price,ma20*1.002)):round(Math.max(price,high20*.998));
  const stop=round(Math.min(ma20,price-a*1.35));
  if(!(entry>stop&&stop>0))continue;
  const risk=entry-stop,target1=round(entry+risk*1.5),target2=round(entry+risk*2.6);
  let score=base.preValidationScore;
  if(v.samples>=15&&Number(v.winRate)>=55)score+=6;
  if(v.samples>=25&&Number(v.winRate)>=60)score+=4;
  if(Number(v.avgMove)>=3)score+=3;
  if(Number(v.medianMove)>=2)score+=2;
  if(Number(v.winRate)<50)score-=10;
  deep.push({...base,score:Math.round(clamp(score,0,100)),entry,stop,target1,target2,validation:v,fundamentals:{label:'UNAVAILABLE',coverage:0},corporateActions:{risk:'UNKNOWN',events:[]},source:'TOP_2000_US_EQUITY_TOURNAMENT'});
}
deep.sort((a,b)=>b.score-a.score||Number(b.validation?.winRate||0)-Number(a.validation?.winRate||0)||Number(b.validation?.avgMove||0)-Number(a.validation?.avgMove||0)||b.dollarVolume-a.dollarVolume);
const broadQualified=deep.filter(x=>x.direction==='BULLISH'&&x.score>=84&&x.validation.samples>=15&&x.validation.winRate>=52&&x.spreadPct<=.35&&x.atrPct<=7).slice(0,FINAL_POOL);

const report={
  schemaVersion:2,
  generatedAt:new Date().toISOString(),
  method:'Hierarchical stock tournament: snapshot every active tradable operating-company equity, rank the strongest live/liquid 2,000, run daily-history analysis on the top 800, setup-specific BREAKOUT/PULLBACK/TREND validation on the top 300, then send only the strongest qualified names into the normal Teststock optimizer.',
  activeTradableOperatingCompanies:universe.length,
  snapshotSymbolsRequested:symbols.length,
  snapshotSymbolsWithData:Object.keys(snapshots).length,
  liquidLiveCandidates:firstPass.length,
  liveTournamentSize:liveTournament.length,
  historyPoolRequested:historySymbols.length,
  historyCandidatesScored:historyScored.length,
  validationPoolSize:validationPool.length,
  deepCandidatesScored:deep.length,
  qualifiedForOptimizer:broadQualified.length,
  setupMix:{BREAKOUT:broadQualified.filter(x=>x.setupType==='BREAKOUT').length,PULLBACK:broadQualified.filter(x=>x.setupType==='PULLBACK').length,TREND:broadQualified.filter(x=>x.setupType==='TREND').length},
  topCandidates:broadQualified.slice(0,30),
  top2000Preview:liveTournament.slice(0,50)
};
await fs.writeFile('docs/data/broad-stock-universe.json',JSON.stringify(report,null,2));

for(const budget of budgets){
  const file=`docs/data/latest-${budget}.json`,data=await read(file);if(!data)continue;
  const recMap=new Map((data.recommendations||[]).map(x=>[x.symbol,x]));for(const x of broadQualified){const old=recMap.get(x.symbol);if(!old||Number(x.score)>Number(old.score||0))recMap.set(x.symbol,x);}
  data.recommendations=[...recMap.values()].sort((a,b)=>Number(b.score||0)-Number(a.score||0)||Number(b.validation?.winRate||0)-Number(a.validation?.winRate||0)).slice(0,60);
  const snapMap=new Map((data.marketSnapshot||[]).map(x=>[x.symbol,x]));for(const x of deep.slice(0,120))if(!snapMap.has(x.symbol))snapMap.set(x.symbol,{symbol:x.symbol,price:x.price,direction:x.direction,setupType:x.setupType,ma20:x.ma20,ma50:x.ma50,ma200:x.ma200,entry:x.entry,stop:x.stop,target1:x.target1,target2:x.target2,atrPct:x.atrPct,m20:x.m20,m60:x.m60,dollarVolume:x.dollarVolume,spreadPct:x.spreadPct,source:x.source});
  data.marketSnapshot=[...snapMap.values()];
  data.broadUniverse={generatedAt:report.generatedAt,method:'TOP_2000_TOURNAMENT',activeTradableOperatingCompanies:report.activeTradableOperatingCompanies,snapshotSymbolsWithData:report.snapshotSymbolsWithData,liveTournamentSize:report.liveTournamentSize,historyPoolRequested:report.historyPoolRequested,validationPoolSize:report.validationPoolSize,deepCandidatesScored:report.deepCandidatesScored,qualifiedForOptimizer:report.qualifiedForOptimizer,reportUrl:'https://raw.githubusercontent.com/SableWolphen/Teststock/main/docs/data/broad-stock-universe.json'};
  await fs.writeFile(file,JSON.stringify(data,null,2));
}
console.log(`Stock tournament: ${universe.length} active companies -> ${liveTournament.length} live top pool -> ${historySymbols.length} history -> ${validationPool.length} validated -> ${broadQualified.length} optimizer candidates`);
