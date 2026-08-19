import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const symbols=['BTC/USD','ETH/USD','SOL/USD','AVAX/USD','LINK/USD','DOGE/USD'];
const outDir=path.resolve('docs/data');
await fs.mkdir(outDir,{recursive:true});
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const sma=(a,n)=>avg(a.slice(-n));
function headers(){const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;if(!key||!secret)throw new Error('Missing Alpaca secrets');return{'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};}
async function get(url){const r=await fetch(url,{headers:headers()});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();}
async function bars(timeframe,start,maxPages=8){const out={};let token='';for(let p=0;p<maxPages;p++){const q=new URLSearchParams({symbols:symbols.join(','),timeframe,start,limit:'10000',sort:'asc'});if(token)q.set('page_token',token);const raw=await get(`https://data.alpaca.markets/v1beta3/crypto/us/bars?${q}`);for(const [s,xs] of Object.entries(raw.bars||{}))out[s]=[...(out[s]||[]),...xs];token=raw.next_page_token||'';if(!token)break;}return out;}
function rsi(c,n=14){if(c.length<n+1)return 50;let g=0,l=0;for(let i=c.length-n;i<c.length;i++){const d=c[i]-c[i-1];if(d>=0)g+=d;else l-=d;}if(!l)return 100;const rs=(g/n)/(l/n);return 100-100/(1+rs);}
function atr(xs,n=14){const v=[];for(let i=Math.max(1,xs.length-n);i<xs.length;i++){const b=xs[i],p=xs[i-1];v.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));}return avg(v);}
function metrics(symbol,xs){if(!xs||xs.length<80)return null;const c=xs.map(x=>x.c),price=c.at(-1),m20=pct(price,c.at(-21)),m60=pct(price,c.at(-61)),ma20=sma(c,20),ma50=sma(c,50),ma100=sma(c,100),r=rsi(c),a=atr(xs),atrPct=a/price*100,high20=Math.max(...xs.slice(-20).map(x=>x.h)),vol20=avg(xs.slice(-20).map(x=>Number(x.v||0))),vol5=avg(xs.slice(-5).map(x=>Number(x.v||0))),nearHigh=price/high20;
let score=50;score+=clamp(m20,-20,35)*.7+clamp(m60,-35,80)*.35;score+=price>ma20?8:-10;score+=price>ma50?10:-13;score+=price>ma100?7:-8;if(r>=50&&r<=72)score+=7;if(r>80)score-=10;if(r<40)score-=8;if(nearHigh>=.96)score+=7;else if(nearHigh<.82)score-=8;if(vol20&&vol5/vol20>=1.15)score+=4;if(atrPct>12)score-=8;return{symbol,price,score:Math.round(clamp(score,0,100)),m20:round(m20,1),m60:round(m60,1),ma20,ma50,ma100,rsi:round(r,1),atr:a,atrPct:round(atrPct,1),nearHigh:round(nearHigh*100,1),volumeBurst:round(vol20?vol5/vol20:1,2)};}
function fourHourConfirm(symbol,daily,intra){const d=metrics(symbol,daily[symbol]);const xs=intra[symbol]||[];if(!d||xs.length<20)return false;const c=xs.map(x=>x.c),last=c.at(-1),ma20=sma(c,20),mom=pct(last,c.at(-7));return last>=ma20&&mom>0;}
function calibration(symbol,xs){let n=0,w=0,moves=[];for(let i=100;i<xs.length-21;i+=7){const m=metrics(symbol,xs.slice(0,i+1));if(!m||m.score<82)continue;const move=pct(xs[i+20].c,xs[i].c);n++;if(move>0)w++;moves.push(move);}return{samples:n,winRate:n?Math.round(w/n*100):null,avg20dMove:n?round(avg(moves),1):null};}
function candidate(m,cal,confirm){const stop=Math.max(m.ma20,m.price-m.atr*2.1),risk=m.price-stop;if(risk<=0)return null;const entry=m.price*1.002,target1=entry+risk*3,target2=entry+risk*5;let q=m.score;if(confirm)q+=5;else q-=8;if(cal.samples>=12&&cal.winRate>=58)q+=5;if(cal.samples>=12&&cal.winRate<50)q-=8;if(m.m20>25)q-=5;if(m.atrPct>10)q-=6;q=Math.round(clamp(q,0,100));return{...m,growthQuality:q,confirm4h:confirm,validation:cal,entry:round(entry,6),stop:round(stop,6),target1:round(target1,6),target2:round(target2,6),rewardRisk1:3,rewardRisk2:5};}
function grade(x){
  const samples=Number(x.validation?.samples||0),win=Number(x.validation?.winRate||0);
  const historyAPlus=samples<12||win>=58;
  const historyA=samples<8||win>=52;
  if(x.growthQuality>=94&&x.score>=88&&x.confirm4h&&x.rsi<=74&&historyAPlus&&x.atrPct<=10)return'A+';
  if(x.growthQuality>=88&&x.score>=82&&x.confirm4h&&x.rsi<=74&&historyA&&x.atrPct<=11)return'A';
  return'NO_TRADE';
}

const dailyStart=new Date(Date.now()-900*86400000).toISOString().slice(0,10),intraStart=new Date(Date.now()-30*86400000).toISOString();
console.log('Loading Alpaca crypto history…');
const [daily,intra]=await Promise.all([bars('1Day',dailyStart,8),bars('4Hour',intraStart,5)]);
const ranked=symbols.map(s=>{const m=metrics(s,daily[s]);if(!m)return null;const x=candidate(m,calibration(s,daily[s]||[]),fourHourConfirm(s,daily,intra));return x?{...x,setupGrade:grade(x)}:null;}).filter(Boolean).sort((a,b)=>b.growthQuality-a.growthQuality||b.score-a.score);
for(const budget of budgets){
  const aPlus=ranked.filter(x=>x.setupGrade==='A+');
  const a=ranked.filter(x=>x.setupGrade==='A');
  const chosen=(aPlus.length?aPlus.slice(0,1):a.slice(0,1));
  const selectedGrade=chosen[0]?.setupGrade||'NO_TRADE';
  const maxPortfolioRisk=budget*(selectedGrade==='A+'?.04:selectedGrade==='A'?.02:0);
  let remaining=budget,remainingRisk=maxPortfolioRisk;const allocations=[];
  for(const x of chosen){
    const riskPct=(x.entry-x.stop)/x.entry;if(riskPct<=0||riskPct>.14)continue;
    const desired=budget*(x.setupGrade==='A+'?.65:.35),byRisk=remainingRisk/riskPct,amount=round(Math.min(remaining,desired,byRisk));
    if(amount<Math.min(5,budget*.05))continue;
    const loss=round(amount*riskPct);
    allocations.push({...x,allocationDollars:amount,estimatedUnitsAtEntry:round(amount/x.entry,8),estimatedLossAtStop:loss});remaining=round(remaining-amount);remainingRisk=round(remainingRisk-loss);
  }
  const plan={
    schemaVersion:2,generatedAt:new Date().toISOString(),asOf:new Date().toISOString(),assetClass:'CRYPTO',market:'OPEN_24_7',budget,
    objective:'Take only A or A+ crypto trend/momentum setups with 3:1 first-target asymmetry; protect small-account capital first.',
    policy:{aPlusMinGrowthQuality:94,aMinGrowthQuality:88,minRewardRisk:3,maxPositions:1,aPlusMaxPlannedPortfolioStopPct:4,aMaxPlannedPortfolioStopPct:2,aPlusMaxAllocationPct:65,aMaxAllocationPct:35,noLeverage:true,noAverageDown:true,noChasingPct:2,cryptoIs24x7:true},
    selectedGrade:allocations[0]?.setupGrade||'NO_TRADE',confidence:allocations[0]?.setupGrade==='A+'?'ELITE':allocations.length?'STRONG':'CASH',ranked:ranked.slice(0,5),allocations,keepCashDollars:round(remaining),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+x.estimatedLossAtStop,0)),action:allocations.length?'QUALIFIED_CRYPTO':'CASH',
    reasons:allocations.length?[`${allocations[0].setupGrade} crypto setup passed daily trend, 4-hour confirmation, history, volatility, and 3:1 reward/risk gates.`,allocations[0].setupGrade==='A+'?'A+ may use up to 65% allocation subject to a 4% planned stop-risk cap.':'A is deliberately half-strength: up to 35% allocation subject to a 2% planned stop-risk cap.','Only one crypto position at a time; no leverage, no averaging down, and no chasing.']:['No A or A+ crypto setup is available; stay in cash.']
  };
  await fs.writeFile(path.join(outDir,`crypto-plan-${budget}.json`),JSON.stringify(plan,null,2));
  console.log(`Crypto $${budget}: ${allocations.map(x=>`${x.setupGrade} ${x.symbol} $${x.allocationDollars}`).join(', ')||'CASH'}`);
}
