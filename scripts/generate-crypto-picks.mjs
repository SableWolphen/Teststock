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

const dailyStart=new Date(Date.now()-900*86400000).toISOString().slice(0,10),intraStart=new Date(Date.now()-30*86400000).toISOString();
console.log('Loading Alpaca crypto history…');
const [daily,intra]=await Promise.all([bars('1Day',dailyStart,8),bars('4Hour',intraStart,5)]);
const ranked=symbols.map(s=>{const m=metrics(s,daily[s]);if(!m)return null;return candidate(m,calibration(s,daily[s]||[]),fourHourConfirm(s,daily,intra));}).filter(Boolean).sort((a,b)=>b.growthQuality-a.growthQuality||b.score-a.score);
for(const budget of budgets){
  const eligible=ranked.filter(x=>x.growthQuality>=92&&x.score>=86&&x.confirm4h&&x.rsi<=76&&(x.validation.samples<12||x.validation.winRate>=55)).slice(0,2);
  const maxPortfolioRisk=budget*.04;let remaining=budget,remainingRisk=maxPortfolioRisk;const allocations=[];
  for(const x of eligible){const riskPct=(x.entry-x.stop)/x.entry;if(riskPct<=0||riskPct>.16)continue;const desired=eligible.length===1?budget:budget*(x.growthQuality>=96?.65:.5),byRisk=remainingRisk/riskPct,amount=round(Math.min(remaining,desired,byRisk));if(amount<Math.min(5,budget*.05))continue;const loss=round(amount*riskPct);allocations.push({...x,allocationDollars:amount,estimatedUnitsAtEntry:round(amount/x.entry,8),estimatedLossAtStop:loss});remaining=round(remaining-amount);remainingRisk=round(remainingRisk-loss);}
  const plan={schemaVersion:1,generatedAt:new Date().toISOString(),asOf:new Date().toISOString(),assetClass:'CRYPTO',market:'OPEN_24_7',budget,objective:'Only unusually strong crypto momentum/trend setups with asymmetric upside.',policy:{maxPlannedPortfolioStopPct:4,minGrowthQuality:92,minRewardRisk:3,maxPositions:2,noLeverage:true,noAverageDown:true,noChasingPct:2,cryptoIs24x7:true},confidence:allocations.length&&allocations[0].growthQuality>=96?'ELITE':allocations.length?'STRONG':'CASH',ranked:ranked.slice(0,5),allocations,keepCashDollars:round(remaining),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+x.estimatedLossAtStop,0)),action:allocations.length?'QUALIFIED_CRYPTO':'CASH',reasons:allocations.length?['Crypto capital is used only when daily trend, 4-hour momentum, score and reward/risk gates align.','Planned stop risk is capped at 4% of the selected crypto budget.','No leverage and no averaging down.']:['No crypto cleared the big-winner gates; stay in cash.']};
  await fs.writeFile(path.join(outDir,`crypto-plan-${budget}.json`),JSON.stringify(plan,null,2));
  console.log(`Crypto $${budget}: ${allocations.map(x=>`${x.symbol} $${x.allocationDollars}`).join(', ')||'CASH'}`);
}
