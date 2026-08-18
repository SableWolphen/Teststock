import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/picks.js';

const budgets = [50, 100, 200, 500];
const universe = ['NVDA','MSFT','AAPL','AMZN','GOOGL','META','AVGO','AMD','PLTR','PANW','CRWD','ORCL','CRM','JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT','GE','XOM','CVX','NEE','UBER','TSLA'];
const sectorEtfs = ['XLK','SMH','XLY','XLC','XLF','XLV','XLP','XLI','XLE','XLU'];
const allSymbols = [...new Set([...universe,'SPY','QQQ',...sectorEtfs])];
const outDir = path.resolve('docs/data');
await fs.mkdir(outDir, { recursive: true });

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const sma=(xs,n)=>avg(xs.slice(-n));
function rsi(closes,n=14){if(closes.length<n+1)return 50;let g=0,l=0;for(let i=closes.length-n;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs));}
function atr(bars,n=14){const xs=[];for(let i=Math.max(1,bars.length-n);i<bars.length;i++){const b=bars[i],p=bars[i-1];xs.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));}return avg(xs);}

function headers(){
  const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
  const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
  if(!key||!secret)throw new Error('Missing Alpaca GitHub Action secrets');
  return {'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
}
async function alpaca(url){const r=await fetch(url,{headers:headers()});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();}
async function fetchBars(timeframe,start,symbols=allSymbols,maxPages=5){
  const out={};let token='';
  for(let page=0;page<maxPages;page++){
    const q=new URLSearchParams({symbols:symbols.join(','),timeframe,start,limit:'10000',adjustment:'all',feed:'iex'});
    if(token)q.set('page_token',token);
    const raw=await alpaca(`https://data.alpaca.markets/v2/stocks/bars?${q}`);
    for(const [s,bars] of Object.entries(raw.bars||{}))out[s]=[...(out[s]||[]),...bars];
    token=raw.next_page_token||'';if(!token)break;
  }
  return out;
}

function stockMetrics(symbol,bars){
  if(!bars||bars.length<70)return null;
  const c=bars.map(b=>b.c),last=c.at(-1),ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,Math.min(200,c.length));
  const m20=pct(last,c.at(-21)),m60=pct(last,c.at(-61)),r=rsi(c),a=atr(bars),aPct=a/last*100;
  const high20=Math.max(...bars.slice(-20).map(b=>b.h)),low20=Math.min(...bars.slice(-20).map(b=>b.l));
  const trend20=pct(last,ma20),trend50=pct(last,ma50),trend200=pct(last,ma200),distHigh=pct(last,high20),distLow=pct(last,low20);
  let bull=50;bull+=clamp(m20,-15,18)*1.05+clamp(m60,-25,35)*.65;bull+=trend20>0?7:-8;bull+=trend50>0?9:-12;bull+=trend200>0?5:-7;if(r>=48&&r<=68)bull+=7;if(r>75)bull-=8;if(r<38)bull-=6;if(distHigh>-5)bull+=5;if(distHigh<-14)bull-=8;if(aPct>7)bull-=5;
  let bear=50;bear+=clamp(-m20,-15,18)*1.05+clamp(-m60,-25,35)*.65;bear+=trend20<0?7:-8;bear+=trend50<0?9:-12;bear+=trend200<0?5:-7;if(r>=30&&r<=52)bear+=7;if(r<24)bear-=8;if(r>68)bear-=6;if(distLow<5)bear+=5;if(distLow>14)bear-=8;if(aPct>7)bear-=5;
  return {symbol,price:last,score:Math.round(clamp(Math.max(bull,bear),0,100)),direction:bull>=bear?'BULLISH':'BEARISH',ma20,ma50,ma200,m20,m60,rsi:r,atrPct:aPct};
}
function scoreBucket(score){return score>=90?'90+':score>=80?'80-89':score>=70?'70-79':'<70';}
function buildCalibration(by){
  const samples=[];
  for(const s of universe){
    const bars=by[s]||[];
    for(let i=220;i<bars.length-21;i+=10){
      const m=stockMetrics(s,bars.slice(0,i+1));if(!m||m.score<70)continue;
      const fwd=bars[i+20].c,move=m.direction==='BULLISH'?pct(fwd,bars[i].c):pct(bars[i].c,fwd);
      samples.push({symbol:s,score:m.score,bucket:scoreBucket(m.score),direction:m.direction,move,win:move>0});
    }
  }
  const groups={};
  for(const x of samples){const k=`${x.direction}:${x.bucket}`;(groups[k]??=[]).push(x);}
  const summary={};
  for(const [k,xs] of Object.entries(groups))summary[k]={samples:xs.length,winRate:Math.round(xs.filter(x=>x.win).length/xs.length*100),avg20dMove:round(avg(xs.map(x=>x.move)),2),median20dMove:round([...xs].sort((a,b)=>a.move-b.move)[Math.floor(xs.length/2)]?.move||0,2)};
  return {method:'Walk-forward-like underlying signal calibration; sampled every 10 trading days with a 20-trading-day forward check. This is not an options P/L backtest.',samples:samples.length,groups:summary};
}
function breadth(by){
  const rows=universe.map(s=>stockMetrics(s,by[s])).filter(Boolean),n=rows.length||1;
  return {symbols:rows.length,above20:Math.round(rows.filter(x=>x.price>x.ma20).length/n*100),above50:Math.round(rows.filter(x=>x.price>x.ma50).length/n*100),above200:Math.round(rows.filter(x=>x.price>x.ma200).length/n*100),bullishSignals:Math.round(rows.filter(x=>x.direction==='BULLISH').length/n*100)};
}
function sectorProxy(symbol){
  if(['NVDA','AMD','AVGO'].includes(symbol))return 'SMH';
  if(['MSFT','AAPL','PLTR','PANW','CRWD','ORCL','CRM'].includes(symbol))return 'XLK';
  if(['AMZN','TSLA','HD','UBER'].includes(symbol))return 'XLY';
  if(['GOOGL','META'].includes(symbol))return 'XLC';
  if(['JPM','GS','V','MA'].includes(symbol))return 'XLF';
  if(['LLY','UNH'].includes(symbol))return 'XLV';
  if(['COST','WMT'].includes(symbol))return 'XLP';
  if(['CAT','GE'].includes(symbol))return 'XLI';
  if(['XOM','CVX'].includes(symbol))return 'XLE';
  if(symbol==='NEE')return 'XLU';
  return 'SPY';
}
function sectorCheck(symbol,direction,by){
  const proxy=sectorProxy(symbol),m=stockMetrics(proxy,by[proxy]);
  if(!m)return {proxy,confirm:null,label:'UNKNOWN'};
  const confirm=m.direction===direction && ((direction==='BULLISH'&&m.price>m.ma20)||(direction==='BEARISH'&&m.price<m.ma20));
  return {proxy,confirm,label:confirm?'CONFIRMS':'CONFLICTS',score:m.score,direction:m.direction,m20:round(m.m20,1)};
}
function latestDayBars(bars=[]){if(!bars.length)return[];const day=String(bars.at(-1).t||'').slice(0,10);return bars.filter(b=>String(b.t||'').slice(0,10)===day);}
function intradayCheck(symbol,direction,intra){
  const xs=latestDayBars(intra[symbol]);if(xs.length<2)return {confirm:null,label:'NOT ENOUGH DATA'};
  let pv=0,v=0;for(const b of xs){const tp=(b.h+b.l+b.c)/3,vol=b.v||0;pv+=tp*vol;v+=vol;}
  const vwap=v?pv/v:xs.at(-1).c,cur=xs.at(-1).c,opening=xs.slice(0,Math.min(4,xs.length));
  const orHigh=Math.max(...opening.map(b=>b.h)),orLow=Math.min(...opening.map(b=>b.l));
  const confirm=direction==='BULLISH'?cur>=vwap && (xs.length<5||cur>=orHigh*.997):cur<=vwap && (xs.length<5||cur<=orLow*1.003);
  return {confirm,label:confirm?'CONFIRMS':'NOT CONFIRMED',bars:xs.length,current:round(cur),vwap:round(vwap),openingRangeHigh:round(orHigh),openingRangeLow:round(orLow)};
}
function calibrationFor(data,calibration){const p=data.featured||{},k=`${p.direction||'BULLISH'}:${scoreBucket(p.score||0)}`;return {key:k,...(calibration.groups[k]||{samples:0,winRate:null,avg20dMove:null,median20dMove:null})};}
function enhance(data,ctx){
  const p=data.featured;if(!p)return data;
  const sector=sectorCheck(p.symbol,p.direction,ctx.daily),intraday=intradayCheck(p.symbol,p.direction,ctx.intraday),cal=calibrationFor(data,ctx.calibration),b=ctx.breadth;
  const marketAlign=p.direction==='BULLISH'?b.above50>=50:b.above50<=50;
  const confirmations=[sector.confirm,intraday.confirm,marketAlign,cal.winRate==null?null:cal.winRate>=52].filter(x=>x!==null);
  const confirmed=confirmations.filter(Boolean).length,total=confirmations.length;
  let learningScore=p.score||0;
  if(sector.confirm===true)learningScore+=3;else if(sector.confirm===false)learningScore-=4;
  if(intraday.confirm===true)learningScore+=3;else if(intraday.confirm===false)learningScore-=3;
  learningScore+=marketAlign?2:-3;
  if(cal.samples>=20&&cal.winRate>=60)learningScore+=4;if(cal.samples>=20&&cal.winRate<48)learningScore-=6;
  learningScore=Math.round(clamp(learningScore,0,100));
  const learning={score:learningScore,confirmations:{confirmed,total},breadth:b,sector,intraday,calibration:cal,method:ctx.calibration.method};
  let action=data.action;
  if(action==='TRADE CANDIDATE'&&(confirmed<Math.min(3,total)||learningScore<82))action='WATCH';
  if(cal.samples>=20&&cal.winRate<45)action='WAIT';
  const warnings=[...(p.warnings||[])];
  if(sector.confirm===false)warnings.push(`${sector.proxy} sector trend conflicts with ${p.direction.toLowerCase()} setup`);
  if(intraday.confirm===false)warnings.push('15-minute VWAP/opening-range confirmation is not present');
  if(cal.samples>=20&&cal.winRate<50)warnings.push(`Past ${cal.key} signals won only ${cal.winRate}% of ${cal.samples} samples`);
  const reasons=[...(p.reasons||[])];
  if(sector.confirm)reasons.push(`${sector.proxy} confirms the setup direction`);
  if(intraday.confirm)reasons.push('15-minute price confirms VWAP/opening-range direction');
  if(cal.samples>=20)reasons.push(`Past ${cal.key} signals: ${cal.winRate}% directional win rate across ${cal.samples} samples`);
  return {...data,action,learning,featured:{...p,learningScore,reasons,warnings,setup:action==='TRADE CANDIDATE'?`Elite ${p.direction.toLowerCase()} setup passed trend, option, sector, intraday and historical gates`:action==='WATCH'?`Promising ${p.direction.toLowerCase()} setup, but the learning gates are not fully aligned`:'No trade: one or more protection/learning gates blocked the setup'}};
}

function runHandler(budget,segment='core') {
  return new Promise((resolve, reject) => {
    const req = { query: { budget: String(budget), mode: 'aggressive', segment } };
    const res = {code:200,headers:{},setHeader(name,value){this.headers[name]=value;},status(code){this.code=code;return this;},json(body){if(this.code>=400)reject(new Error(body?.error||`Scanner failed with ${this.code}`));else resolve(body);}};
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
function optionId(o){return o?`${o.side||''}-${o.expiry||''}-${o.longStrike||o.strike||''}-${o.shortStrike||''}`:'stock';}
function updateOutcomes(history,daily){
  for(const h of history){if(h.status&&h.status!=='OPEN')continue;const bars=(daily[h.symbol]||[]).filter(b=>String(b.t||'').slice(0,10)>h.date);if(!bars.length)continue;const maxBars=bars.slice(0,20);let resolved=null;
    for(const b of maxBars){const stopHit=h.direction==='BULLISH'?b.l<=h.stop:b.h>=h.stop,t1Hit=h.direction==='BULLISH'?b.h>=h.target1:b.l<=h.target1,t2Hit=h.direction==='BULLISH'?b.h>=h.target2:b.l<=h.target2;if(stopHit&&t1Hit){resolved='AMBIGUOUS';break;}if(stopHit){resolved='STOP';break;}if(t2Hit){resolved='TARGET2';break;}if(t1Hit){resolved='TARGET1';break;}}
    const last=maxBars.at(-1);if(resolved){h.status=resolved;h.resolvedAt=String(last.t||'').slice(0,10);}else if(maxBars.length>=20){const move=h.direction==='BULLISH'?pct(last.c,h.entryStock):pct(h.entryStock,last.c);h.status=move>0?'MATURED_WIN':'MATURED_LOSS';h.directional20dMove=round(move,2);h.resolvedAt=String(last.t||'').slice(0,10);}else{h.lastChecked=String(last.t||'').slice(0,10);}
  }
  return history;
}
function historySummary(history){const resolved=history.filter(x=>['TARGET1','TARGET2','STOP','MATURED_WIN','MATURED_LOSS'].includes(x.status)),wins=resolved.filter(x=>['TARGET1','TARGET2','MATURED_WIN'].includes(x.status));return {tracked:history.length,open:history.filter(x=>x.status==='OPEN').length,resolved:resolved.length,winRate:resolved.length?Math.round(wins.length/resolved.length*100):null,targetHits:resolved.filter(x=>['TARGET1','TARGET2'].includes(x.status)).length,stops:resolved.filter(x=>x.status==='STOP').length,note:'Tracks the underlying setup outcome, not historical option P/L.'};}

const startDaily=new Date(Date.now()-1000*86400000).toISOString().slice(0,10);
const startIntra=new Date(Date.now()-8*86400000).toISOString();
console.log('Loading shared free historical + intraday context…');
const [daily,intraday]=await Promise.all([fetchBars('1Day',startDaily,allSymbols,5),fetchBars('15Min',startIntra,[...universe,'SPY','QQQ'],3)]);
const calibration=buildCalibration(daily),marketBreadth=breadth(daily),ctx={daily,intraday,calibration,breadth:marketBreadth};

const manifest = { generatedAt: new Date().toISOString(), budgets: [], freeStack:true, segments:['core','penny'] };
const generated=[];
for (const segment of ['core','penny']) for (const budget of budgets) {
  try {
    const raw = await runHandler(budget,segment),data=segment==='core'?enhance(raw,ctx):{
      ...raw,
      learning:{score:raw.featured?.score??0,confirmations:{confirmed:raw.featured?.validation?.winRate>=52?1:0,total:1},calibration:{samples:raw.featured?.validation?.samples??0,winRate:raw.featured?.validation?.winRate??null},method:'Historical validation of the selected penny stock; strict price and liquidity gates also apply.'}
    };
    data.generatedBy = 'GitHub Actions';data.staticBudget = budget;data.freeStack = true;
    const file=segment==='penny'?`latest-penny-${budget}.json`:`latest-${budget}.json`;
    await fs.writeFile(path.join(outDir,file), JSON.stringify(data, null, 2));
    generated.push(data);manifest.budgets.push({ segment,budget,ok:true,asOf:data.asOf,action:data.action,symbol:data.featured?.symbol });
    console.log(`Generated ${segment} $${budget} scan: ${data.action} ${data.featured?.symbol || ''} · learning ${data.learning?.score ?? '—'}`);
  } catch (error) {
    const failure = { generatedAt:new Date().toISOString(),segment,budget,error:error.message };
    const file=segment==='penny'?`latest-penny-${budget}.json`:`latest-${budget}.json`;
    await fs.writeFile(path.join(outDir,file),JSON.stringify(failure,null,2));
    manifest.budgets.push({segment,budget,ok:false,error:error.message});console.error(`${segment} $${budget} scan failed:`,error.message);
  }
}

const historyFile=path.join(outDir,'trade-history.json');
let history=updateOutcomes(await readJson(historyFile,[]),daily);
const today=new Date().toISOString().slice(0,10);
for(const d of generated){if(d.action!=='TRADE CANDIDATE'||!d.featured)continue;const p=d.featured,o=p.option,id=`${today}-${d.segment||'core'}-${d.budget}-${p.symbol}-${optionId(o)}`;if(history.some(x=>x.id===id))continue;history.push({id,date:today,createdAt:d.asOf,segment:d.segment||'core',budget:d.budget,symbol:p.symbol,direction:p.direction,entryStock:p.price,trigger:p.entry,stop:p.stop,target1:p.target1,target2:p.target2,setupScore:p.score,learningScore:p.learningScore,stockPlan:p.stockPlan,option:o?{kind:o.kind,side:o.side,expiry:o.expiry,longStrike:o.longStrike,shortStrike:o.shortStrike,maxRisk:o.maxRisk,maxProfit:o.maxProfit,probProfit:o.probProfit,iv:o.iv,delta:o.delta}:null,status:'OPEN'});}
history=history.slice(-400);
await fs.writeFile(historyFile,JSON.stringify(history,null,2));
const learningFile={generatedAt:new Date().toISOString(),breadth:marketBreadth,calibration,history:historySummary(history)};
await fs.writeFile(path.join(outDir,'learning.json'),JSON.stringify(learningFile,null,2));
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

