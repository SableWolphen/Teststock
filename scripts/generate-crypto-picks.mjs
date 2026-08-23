import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const fallbackSymbols=['BTC/USD','ETH/USD','SOL/USD','AVAX/USD','LINK/USD','DOGE/USD'];
const outDir=path.resolve('docs/data');
await fs.mkdir(outDir,{recursive:true});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const sma=(a,n)=>avg(a.slice(-n));

// Teststock's crypto research now sources ALL crypto market data -- universe discovery, daily bars
// used for scoring/moving-averages/historical calibration, native 4-hour intraday bars for the
// pullback/rebound day-trade confirmation, and 24-hour liquidity -- from Crypto.com's public
// exchange API instead of Alpaca. Two separate diagnostics on 2026-08-22/23 found Alpaca's crypto
// feed unreliable for this purpose: its own volume field ran roughly 1,000x-5,000x below real
// market volume, and its crypto bars endpoint did not reliably serve native 4-hour candles for most
// pairs (including BTC/USD, which certainly has deep history). Crypto.com natively supports a 4h
// candle interval and its ticker/volume figures are real market figures directly, with no separate
// cross-check needed. Stocks are unaffected and continue to use Alpaca/SEC EDGAR as documented in
// CLAUDE.md; this file is the crypto-only research pipeline.
const CC='https://api.crypto.com/exchange/v1/public';
const SCAN_LIMIT=80; // bounds API calls/runtime; symbols below this rank by 24h volume could not
                      // clear the $250K/A or $2M/A+ liquidity floor below anyway, so nothing real is lost.
async function cget(url){
  const r=await fetch(url);
  if(!r.ok)throw new Error(`Crypto.com ${r.status}: ${await r.text()}`);
  const j=await r.json();
  if(j.code!==undefined&&j.code!==0)throw new Error(`Crypto.com code ${j.code}: ${j.message||j.msg||''}`);
  return j.result??j;
}
function toRows(data){
  return (data||[]).map(x=>({
    t:x.t!=null?new Date(Number(x.t)).toISOString():(x.timestamp||null),
    o:Number(x.o??x.open??0),h:Number(x.h??x.high??0),l:Number(x.l??x.low??0),c:Number(x.c??x.close??0),
    v:Number(x.v??x.volume??0),
  })).filter(x=>x.t&&x.c>0).sort((a,b)=>new Date(a.t)-new Date(b.t));
}
async function candles(instrument,timeframe,count=300){
  const q=new URLSearchParams({instrument_name:instrument,timeframe,interval:timeframe,count:String(count)});
  const j=await cget(`${CC}/get-candlestick?${q}`);
  return toRows(j.data||j.candles||[]);
}
async function mapLimit(items,limit,fn){
  const out=new Array(items.length);let i=0;
  async function worker(){while(i<items.length){const idx=i++;out[idx]=await fn(items[idx],idx).catch(e=>{console.log(`${items[idx].symbol||items[idx]}: ${e.message}`);return null;});}}
  await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
  return out;
}
async function discoverUniverse(){
  try{
    const [instrJ,tickJ]=await Promise.all([cget(`${CC}/get-instruments`),cget(`${CC}/get-tickers`)]);
    const rawNames=(instrJ.data||instrJ.instruments||[]).map(x=>typeof x==='string'?x:(x.instrument_name||x.symbol)).filter(Boolean);
    const bases=[...new Set(rawNames.filter(n=>/^[A-Z0-9]+USD$/.test(n)).map(n=>n.slice(0,-3)))];
    const volBy=new Map();
    for(const t of (tickJ.data||[])){
      const inst=String(t.instrument_name||t.i||'');
      const vv=Number(t.volume_value??t.vv??0);
      if(inst)volBy.set(inst,vv);
    }
    const scored=bases.map(b=>({base:b,symbol:`${b}/USD`,instrument:`${b}_USD`,vol24h:volBy.get(`${b}_USD`)||0}));
    const liquid=scored.filter(x=>x.vol24h>0).sort((a,b)=>b.vol24h-a.vol24h);
    const chosen=(liquid.length?liquid:scored).slice(0,SCAN_LIMIT);
    console.log(`Crypto.com universe: ${bases.length} USD spot instruments discovered, ${liquid.length} with live ticker volume, scanning top ${chosen.length} by 24h volume.`);
    return chosen.length?chosen:fallbackSymbols.map(s=>({base:s.replace('/USD',''),symbol:s,instrument:s.replace('/','_'),vol24h:0}));
  }catch(e){
    console.log(`Crypto.com universe discovery failed (${e.message}); using fallback symbol list.`);
    return fallbackSymbols.map(s=>({base:s.replace('/USD',''),symbol:s,instrument:s.replace('/','_'),vol24h:0}));
  }
}
function rsi(c,n=14){if(c.length<n+1)return 50;let g=0,l=0;for(let i=c.length-n;i<c.length;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-100/(1+rs);}
function atr(xs,n=14){const v=[];for(let i=Math.max(1,xs.length-n);i<xs.length;i++){const b=xs[i],p=xs[i-1];v.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));}return avg(v);}
// Crypto.com's public candlestick endpoint does not serve the same multi-year depth Alpaca did, so
// the minimum history requirement below is 60 daily bars (not the previous 100) -- still a
// meaningful ~2-month sample for RSI/ATR/moving-average math. Insufficient history still returns
// null (no candidate), consistent with "unknown data is not a pass."
function metrics(symbol,xs){if(!xs||xs.length<60)return null;const c=xs.map(x=>x.c),price=c.at(-1),m20=pct(price,c.at(-21)),m60=pct(price,c.at(-61)),ma20=sma(c,20),ma50=sma(c,50),ma100=sma(c,100),r=rsi(c),a=atr(xs),atrPct=a/price*100,high20=Math.max(...xs.slice(-20).map(x=>x.h)),high60=Math.max(...xs.slice(-60).map(x=>x.h)),vol20=avg(xs.slice(-20).map(x=>Number(x.v||0)*Number(x.c||0))),vol5=avg(xs.slice(-5).map(x=>Number(x.v||0)*Number(x.c||0))),nearHigh=price/high20,nearHigh60=price/high60;
  let score=50;score+=clamp(m20,-20,35)*.7+clamp(m60,-35,80)*.35;score+=price>ma20?8:-10;score+=price>ma50?10:-13;score+=price>ma100?7:-8;if(r>=50&&r<=72)score+=7;if(r>80)score-=10;if(r<40)score-=8;if(nearHigh>=.96)score+=7;else if(nearHigh<.82)score-=8;if(nearHigh60>=.93)score+=4;if(vol20&&vol5/vol20>=1.15)score+=4;if(vol20>=5_000_000)score+=5;else if(vol20<500_000)score-=12;if(atrPct>12)score-=8;
  return{symbol,price,score:Math.round(clamp(score,0,100)),m20:round(m20,1),m60:round(m60,1),ma20,ma50,ma100,rsi:round(r,1),atr:a,atrPct:round(atrPct,1),nearHigh:round(nearHigh*100,1),nearHigh60:round(nearHigh60*100,1),dollarVolume20d:Math.round(vol20),volumeBurst:round(vol20?vol5/vol20:1,2)};
}
function fourHourSetup(symbol,intra){const xs=intra[symbol]||[];if(xs.length<22)return{confirmed:false};const recent=xs.slice(-20),c=xs.map(x=>Number(x.c)),last=c.at(-1),previous=c.at(-2),ma20=sma(c,20),volume=recent.map(x=>Number(x.v||0)),volumeAvg=avg(volume.slice(0,-1)),volumeConfirm=volume.at(-1)>=volumeAvg*1.05;const weighted=recent.reduce((s,x)=>s+((Number(x.h)+Number(x.l)+Number(x.c))/3)*Number(x.v||0),0),volumeSum=volume.reduce((s,x)=>s+x,0),vwap=volumeSum?weighted/volumeSum:0,rsi4h=round(rsi(c),1),pullbackToSupportOrVwap=vwap>0&&(Math.abs(last-vwap)/vwap<=.025||(Number(recent.at(-1).l)<=vwap*1.01&&last>=vwap*.995)),momentumTurnedUp=last>previous&&pct(last,c.at(-4))>0,confirmed=last>=ma20*.995&&rsi4h>=50&&rsi4h<=70&&pullbackToSupportOrVwap&&momentumTurnedUp&&volumeConfirm;return{confirmed,rsi4h,vwap4h:round(vwap,6),support4h:round(Math.min(ma20,vwap||ma20),6),pullbackToSupportOrVwap,momentumTurnedUp,volumeConfirm};}
function calibration(symbol,xs){let n=0,w=0,moves=[];for(let i=Math.min(60,xs.length-22);i<xs.length-21;i+=7){if(i<0)break;const m=metrics(symbol,xs.slice(0,i+1));if(!m||m.score<78)continue;const move=pct(xs[i+20].c,xs[i].c);n++;if(move>0)w++;moves.push(move);}return{samples:n,winRate:n?Math.round(w/n*100):null,avg20dMove:n?round(avg(moves),1):null};}
function candidate(m,cal,intraday,btcTrend){const entry=m.price*1.002,intradayStop=Number(intraday.support4h||0)*.995,stop=Math.max(m.ma20,m.price-m.atr*2.1,intradayStop),risk=entry-stop;if(risk<=0)return null;const target1=entry+risk*3,target2=entry+risk*5;let q=m.score;if(intraday.confirmed)q+=5;else q-=8;if(cal.samples>=10&&cal.winRate>=56)q+=5;if(cal.samples>=8&&cal.winRate<48)q-=8;if(m.m20>30)q-=5;if(m.atrPct>12)q-=6;if(m.symbol!=='BTC/USD'&&btcTrend!==true)q-=6;q=Math.round(clamp(q,0,100));return{...m,...intraday,growthQuality:q,confirm4h:intraday.confirmed,btcTrendSupport:m.symbol==='BTC/USD'?true:btcTrend,validation:cal,entry:round(entry,6),stop:round(stop,6),target1:round(target1,6),target2:round(target2,6),rewardRisk1:3,rewardRisk2:5};}
function grade(x){const samples=Number(x.validation?.samples||0),win=Number(x.validation?.winRate||0),historyAPlus=samples<10||win>=56,historyA=samples<6||win>=50,btcOk=x.symbol==='BTC/USD'||x.btcTrendSupport===true,intradayOk=x.confirm4h&&x.rsi4h>=50&&x.rsi4h<=70&&x.pullbackToSupportOrVwap&&x.momentumTurnedUp&&x.volumeConfirm;if(x.growthQuality>=92&&x.score>=86&&intradayOk&&historyAPlus&&x.atrPct<=11&&btcOk&&x.dollarVolume24hReal>=2_000_000)return'A+';if(x.growthQuality>=84&&x.score>=78&&intradayOk&&historyA&&x.atrPct<=12&&btcOk&&x.dollarVolume24hReal>=250_000)return'A';return'NO_TRADE';}

const universe=await discoverUniverse();
const symbols=universe.map(u=>u.symbol);
const volOf=new Map(universe.map(u=>[u.symbol,u.vol24h]));
console.log(`Loading Crypto.com history for ${symbols.length} scanned USD pairs…`);
const daily={},intra={};
await mapLimit(universe,8,async u=>{
  const [d,f]=await Promise.all([candles(u.instrument,'1D',300),candles(u.instrument,'4h',300)]);
  daily[u.symbol]=d;intra[u.symbol]=f;
});
const dailyOk=symbols.filter(s=>(daily[s]||[]).length>=60).length,intraOk=symbols.filter(s=>(intra[s]||[]).length>=22).length;
console.log(`Candle coverage: ${dailyOk}/${symbols.length} symbols have >=60 daily bars; ${intraOk}/${symbols.length} have >=22 four-hour bars. Anything below these minimums returns no candidate for that symbol this run.`);
const btc=metrics('BTC/USD',daily['BTC/USD']);
const btcTrend=!!(btc&&btc.price>btc.ma20&&btc.price>btc.ma50&&btc.m20>0);
const ranked=symbols.map(s=>{const m=metrics(s,daily[s]);if(!m)return null;const c=candidate(m,calibration(s,daily[s]||[]),fourHourSetup(s,intra),btcTrend);if(!c)return null;const x={...c,dollarVolume24hReal:Math.round(volOf.get(s)||0)};return{...x,setupGrade:grade(x)};}).filter(Boolean).sort((a,b)=>b.growthQuality-a.growthQuality||b.score-a.score||b.dollarVolume24hReal-a.dollarVolume24hReal);

await fs.writeFile(path.join(outDir,'crypto-universe.json'),JSON.stringify({schemaVersion:2,generatedAt:new Date().toISOString(),supportedUsdPairs:symbols.length,btcTrendSupport:btcTrend,researchMode:'ACTIVE_24_7_MORE_OPPORTUNITIES',dataSource:'CRYPTO_COM_PUBLIC_API',ranked:ranked.slice(0,30)},null,2));
for(const budget of budgets){
  const aPlus=ranked.filter(x=>x.setupGrade==='A+'),a=ranked.filter(x=>x.setupGrade==='A'),chosen=(aPlus.length?aPlus.slice(0,1):a.slice(0,1));
  const selectedGrade=chosen[0]?.setupGrade||'NO_TRADE',maxPortfolioRisk=budget*(selectedGrade==='A+'?.025:selectedGrade==='A'?.015:0);let remaining=budget,remainingRisk=maxPortfolioRisk;const allocations=[];
  for(const x of chosen){const riskPct=(x.entry-x.stop)/x.entry;if(riskPct<=0||riskPct>.14)continue;const desired=budget*(x.setupGrade==='A+'?.45:.30),byRisk=remainingRisk/riskPct,amount=round(Math.min(remaining,desired,byRisk));if(amount<Math.min(5,budget*.05))continue;const loss=round(amount*riskPct);allocations.push({...x,allocationDollars:amount,estimatedUnitsAtEntry:round(amount/x.entry,8),estimatedLossAtStop:loss});remaining=round(remaining-amount);remainingRisk=round(remainingRisk-loss);}
  const plan={schemaVersion:4,generatedAt:new Date().toISOString(),asOf:new Date().toISOString(),assetClass:'CRYPTO',market:'OPEN_24_7',budget,universe:{source:'CRYPTO_COM_PUBLIC_API_USD_SPOT_PAIRS',quoteCurrency:'USD',excludeStablecoinQuotePairs:true,supportedUsdPairs:symbols.length,scanLimit:SCAN_LIMIT,report:'crypto-universe.json'},objective:'Use crypto\'s 24/7 market to surface more reasonable A/A+ opportunities without removing defined-risk, trend, liquidity, confirmation, or no-leverage controls.',policy:{researchMode:'ACTIVE_24_7_MORE_OPPORTUNITIES',dataSource:'CRYPTO_COM_PUBLIC_API',exactQuoteCurrency:'USD',excludeUSDTAndUSDCQuotePairs:true,aPlusMinGrowthQuality:92,aMinGrowthQuality:84,minRewardRisk:3,maxPositions:1,aPlusMaxPlannedPortfolioStopPct:2.5,aMaxPlannedPortfolioStopPct:1.5,aPlusMaxAllocationPct:45,aMaxAllocationPct:30,aPlusMinDollarVolume24hReal:2_000_000,aMinDollarVolume24hReal:250_000,dollarVolume24hRealSource:'CRYPTO_COM_PUBLIC_TICKERS',noLeverage:true,noAverageDown:true,noChasingPct:2,cryptoIs24x7:true},selectedGrade:allocations[0]?.setupGrade||'NO_TRADE',confidence:allocations[0]?.setupGrade==='A+'?'ELITE':allocations.length?'STRONG':'CASH',ranked:ranked.slice(0,10),allocations,keepCashDollars:round(remaining),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+x.estimatedLossAtStop,0)),action:allocations.length?'QUALIFIED_CRYPTO':'CASH',reasons:allocations.length?[`${allocations[0].setupGrade} crypto setup won the current supported-pair tournament and passed the relaxed 24/7 opportunity gates plus trend, 4-hour confirmation, liquidity, BTC-context, volatility, and reward/risk checks.`,'Only one crypto position at a time; reduced allocation/risk caps, no leverage, no averaging down, and no chasing.']:['No supported crypto pair currently clears even the relaxed 24/7 A/A+ gates; keep scanning rather than force a trade.']};
  await fs.writeFile(path.join(outDir,`crypto-plan-${budget}.json`),JSON.stringify(plan,null,2));
  console.log(`Crypto $${budget}: ${allocations.map(x=>`${x.setupGrade} ${x.symbol} $${x.allocationDollars}`).join(', ')||'CASH'}`);
}
