import fs from 'node:fs/promises';
import path from 'node:path';

const universe=['NVDA','MSFT','AAPL','AMZN','GOOGL','META','AVGO','AMD','PLTR','PANW','CRWD','ORCL','CRM','JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT','GE','XOM','CVX','NEE','UBER','TSLA'];
const symbols=[...universe,'SPY'];
const outFile=path.resolve('docs/data/entry-gate-validation.json');
const GATES={minHistoricalWinRatePct:52,minRewardRisk:2.5,minHistoricalSamples:15,minConservativeExpectedR:0.5};
const REQUIRED_REGIMES=['CALM','VOLATILE','TRENDING_DOWN'];
const HOLDOUT_START='2024-01-01';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const sma=(xs,n)=>avg(xs.slice(-n));
function rsi(closes,n=14){if(closes.length<n+1)return 50;let g=0,l=0;for(let i=closes.length-n;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-(100/(1+rs));}
function atr(bars,n=14){const xs=[];for(let i=Math.max(1,bars.length-n);i<bars.length;i++){const b=bars[i],p=bars[i-1];xs.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));}return avg(xs);}
function metrics(symbol,bars){
  if(!bars||bars.length<220)return null;
  const c=bars.map(b=>b.c),last=c.at(-1),ma20=sma(c,20),ma50=sma(c,50),ma200=sma(c,200),m20=pct(last,c.at(-21)),m60=pct(last,c.at(-61)),r=rsi(c),a=atr(bars),aPct=a/last*100;
  const high20=Math.max(...bars.slice(-20).map(b=>b.h)),low20=Math.min(...bars.slice(-20).map(b=>b.l));
  const trend20=pct(last,ma20),trend50=pct(last,ma50),trend200=pct(last,ma200),distHigh=pct(last,high20),distLow=pct(last,low20);
  let bull=50;bull+=clamp(m20,-15,18)*1.05+clamp(m60,-25,35)*.65;bull+=trend20>0?7:-8;bull+=trend50>0?9:-12;bull+=trend200>0?5:-7;if(r>=48&&r<=68)bull+=7;if(r>75)bull-=8;if(r<38)bull-=6;if(distHigh>-5)bull+=5;if(distHigh<-14)bull-=8;if(aPct>7)bull-=5;
  let bear=50;bear+=clamp(-m20,-15,18)*1.05+clamp(-m60,-25,35)*.65;bear+=trend20<0?7:-8;bear+=trend50<0?9:-12;bear+=trend200<0?5:-7;if(r>=30&&r<=52)bear+=7;if(r<24)bear-=8;if(r>68)bear-=6;if(distLow<5)bear+=5;if(distLow>14)bear-=8;if(aPct>7)bear-=5;
  const direction=bull>=bear?'BULLISH':'BEARISH',score=Math.round(clamp(Math.max(bull,bear),0,100));
  let entry,stop,target2;
  if(direction==='BULLISH'){entry=Math.max(last,high20*.998);stop=Math.min(ma20,last-a*1.35);const risk=Math.max(.01,entry-stop);target2=entry+risk*2.6;}
  else{entry=Math.min(last,low20*1.002);stop=Math.max(ma20,last+a*1.35);const risk=Math.max(.01,stop-entry);target2=entry-risk*2.6;}
  return {symbol,last,ma200,m20,m60,atrPct:aPct,direction,score,entry,stop,target2,rewardRisk:Math.abs(target2-entry)/Math.max(.01,Math.abs(entry-stop))};
}
function headers(){const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;if(!key||!secret)throw new Error('Missing Alpaca credentials');return {'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};}
async function fetchBars(){
  const out={};let token='';
  for(let page=0;page<12;page++){
    const q=new URLSearchParams({symbols:symbols.join(','),timeframe:'1Day',start:'2018-01-01',limit:'10000',adjustment:'all',feed:'iex'});if(token)q.set('page_token',token);
    const r=await fetch(`https://data.alpaca.markets/v2/stocks/bars?${q}`,{headers:headers()});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);const raw=await r.json();
    for(const [s,bars] of Object.entries(raw.bars||{}))out[s]=[...(out[s]||[]),...bars];token=raw.next_page_token||'';if(!token)break;
  }
  return out;
}
const day=b=>String(b?.t||'').slice(0,10);
function regimeAt(spyByDate,date){
  const slice=spyByDate.get(date);if(!slice)return 'UNKNOWN';const m=metrics('SPY',slice);if(!m)return 'UNKNOWN';
  if(m.last<m.ma200&&m.m60<=-5)return 'TRENDING_DOWN';
  if(m.atrPct>=2.25||Math.abs(m.m20)>=10)return 'VOLATILE';
  if(m.atrPct<=1.35&&Math.abs(m.m20)<6)return 'CALM';
  if(m.last>m.ma200&&m.m60>=5)return 'TRENDING_UP';
  return 'MIXED';
}
function outcome(signal,future){
  const bullish=signal.direction==='BULLISH',entry=signal.entry,stop=signal.stop,target=signal.target2,risk=Math.max(.01,Math.abs(entry-stop));let entered=false;
  for(const b of future){
    if(!entered){if(!(b.l<=entry&&b.h>=entry))continue;entered=true;}
    const stopHit=bullish?b.l<=stop:b.h>=stop,targetHit=bullish?b.h>=target:b.l<=target;
    if(stopHit&&targetHit)return {resolved:false,reason:'AMBIGUOUS_SAME_BAR'};
    if(stopHit)return {resolved:true,win:false,r:-1};
    if(targetHit)return {resolved:true,win:true,r:signal.rewardRisk};
  }
  if(!entered)return {resolved:false,reason:'NO_ENTRY'};
  const last=future.at(-1)?.c;if(!last)return {resolved:false,reason:'NO_FINAL_PRICE'};
  const rawR=bullish?(last-entry)/risk:(entry-last)/risk;return {resolved:true,win:rawR>0,r:clamp(rawR,-1,signal.rewardRisk)};
}
function stats(rows){
  const n=rows.length,wins=rows.filter(x=>x.win).length,win=n?wins/n:0,shrink=Math.min(1,n/30),conservativeWin=.5+(win-.5)*shrink,conservativeExpectedR=(conservativeWin*GATES.minRewardRisk)-((1-conservativeWin)*1),observedR=n?avg(rows.map(x=>x.r)):null;
  return {samples:n,wins,winRatePct:n?round(win*100,1):null,averageObservedR:n?round(observedR,2):null,conservativeExpectedR:n?round(conservativeExpectedR,2):null,passesSampleGate:n>=GATES.minHistoricalSamples,passesWinRateGate:n>=GATES.minHistoricalSamples&&win*100>=GATES.minHistoricalWinRatePct,passesExpectedValueGate:n>=GATES.minHistoricalSamples&&conservativeExpectedR>=GATES.minConservativeExpectedR,positiveObservedR:n>=GATES.minHistoricalSamples&&observedR>0};
}
function splitStats(rows){
  const regimes=['CALM','VOLATILE','TRENDING_DOWN','TRENDING_UP','MIXED','UNKNOWN'];
  return {overall:stats(rows),byRegime:Object.fromEntries(regimes.map(r=>[r,stats(rows.filter(x=>x.regime===r))]))};
}
function runtimePolicy(holdout){
  const out={};
  for(const [regime,s] of Object.entries(holdout.byRegime)){
    const sparse=s.samples<GATES.minHistoricalSamples;
    const weak=!sparse&&(!s.passesWinRateGate||!s.passesExpectedValueGate||!s.positiveObservedR);
    out[regime]={samples:s.samples,allowNewStocks:!weak,allowOptions:!weak&&!sparse&&s.winRatePct>=58&&Number(s.averageObservedR||0)>=0.15,stockSizeMultiplier:weak?0:sparse?0.5:s.winRatePct>=58&&Number(s.averageObservedR||0)>=0.15?1:0.75,status:weak?'BLOCK':sparse?'SPARSE_REDUCE':s.winRatePct>=58&&Number(s.averageObservedR||0)>=0.15?'STRONG':'NORMAL',reason:weak?'Holdout regime failed one or more robustness gates.':sparse?'Holdout regime has fewer than 15 resolved samples; reduce risk until evidence improves.':'Holdout regime remained positive after the untouched-period check.'};
  }
  return out;
}

const by=await fetchBars();
const spy=by.SPY||[],spyByDate=new Map();for(let i=219;i<spy.length;i++)spyByDate.set(day(spy[i]),spy.slice(0,i+1));
const rows=[];
for(const symbol of universe){
  const bars=by[symbol]||[];
  for(let i=220;i<bars.length-21;i+=10){
    const s=metrics(symbol,bars.slice(0,i+1));if(!s||s.direction!=='BULLISH'||s.score<86||s.rewardRisk<GATES.minRewardRisk)continue;
    const o=outcome(s,bars.slice(i+1,i+21));if(!o.resolved)continue;rows.push({symbol,date:day(bars[i]),regime:regimeAt(spyByDate,day(bars[i])),win:o.win,r:o.r,rewardRisk:round(s.rewardRisk,2)});
  }
}
const developmentRows=rows.filter(x=>x.date<HOLDOUT_START),holdoutRows=rows.filter(x=>x.date>=HOLDOUT_START);
const development=splitStats(developmentRows),holdout=splitStats(holdoutRows),allHistory=splitStats(rows);
const failedRequiredRegimes=REQUIRED_REGIMES.filter(r=>{const s=holdout.byRegime[r];return !(s.passesSampleGate&&s.passesWinRateGate&&s.passesExpectedValueGate&&s.positiveObservedR);});
const report={schemaVersion:3,generatedAt:new Date().toISOString(),period:{start:'2018-01-01',end:new Date().toISOString().slice(0,10)},holdoutStart:HOLDOUT_START,universeSize:universe.length,gatesUnderReview:GATES,method:'Chronological walk-forward-like barrier study sampled every 10 trading days. Development period ends before 2024-01-01; 2024 onward is treated as an untouched holdout for validation only. The same core trend score and entry/stop geometry are used, with a 20-trading-day 2.6R target horizon. Regimes are classified from contemporaneous SPY trend and ATR. No threshold is tuned on the holdout in this script.',requiredDiversityRegimes:REQUIRED_REGIMES,development,holdout,allHistory,runtimePolicy:runtimePolicy(holdout),status:failedRequiredRegimes.length?'RED_FLAG':'HOLDOUT_DIVERSE_HISTORY_PASS',failedRequiredRegimes,instructions:failedRequiredRegimes.length?'Do not loosen gates. Runtime policy blocks or reduces weak/sparse holdout regimes until evidence improves.':'The fixed gates remained positive in the named holdout regimes, but live fills and real-money results still govern risk.'};
await fs.mkdir(path.dirname(outFile),{recursive:true});await fs.writeFile(outFile,JSON.stringify(report,null,2));console.log(`Entry-gate holdout validation: ${report.status}; holdout=${holdout.overall.samples}; failed=${failedRequiredRegimes.join(',')||'none'}`);
