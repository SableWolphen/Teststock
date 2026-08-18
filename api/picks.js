const UNIVERSE = [
  'NVDA','MSFT','AAPL','AMZN','GOOGL','META','AVGO','AMD','PLTR','PANW','CRWD','ORCL','CRM',
  'JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT','GE','XOM','CVX','NEE','UBER','TSLA'
];
const BENCHMARKS = ['SPY','QQQ'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));

function headers(){
  const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
  const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
  if(!key||!secret) throw new Error('Missing Alpaca server environment variables');
  return {'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
}
async function alpaca(url){
  const r=await fetch(url,{headers:headers()});
  if(!r.ok) throw new Error(`Alpaca ${r.status}: ${await r.text()}`);
  return r.json();
}
function sma(xs,n){return avg(xs.slice(-n));}
function std(xs){const m=avg(xs);return Math.sqrt(avg(xs.map(x=>(x-m)**2)));}
function rsi(closes,n=14){
  if(closes.length<n+1) return 50;
  let g=0,l=0;
  for(let i=closes.length-n;i<closes.length;i++){const d=closes[i]-closes[i-1];if(d>=0)g+=d;else l-=d;}
  if(!l) return 100; const rs=(g/n)/(l/n); return 100-(100/(1+rs));
}
function atr(bars,n=14){
  const xs=[]; for(let i=Math.max(1,bars.length-n);i<bars.length;i++){
    const b=bars[i],p=bars[i-1]; xs.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));
  } return avg(xs);
}
function stockMetrics(symbol,bars){
  if(!bars||bars.length<70) return null;
  const c=bars.map(b=>b.c), last=c.at(-1), ma20=sma(c,20), ma50=sma(c,50), ma200=sma(c,Math.min(200,c.length));
  const m20=pct(last,c.at(-21)),m60=pct(last,c.at(-61)),r=rsi(c),a=atr(bars),aPct=a/last*100;
  const returns=c.slice(-31).map((x,i,z)=>i?pct(x,z[i-1]):0).slice(1),vol=std(returns)*Math.sqrt(252);
  const high20=Math.max(...bars.slice(-20).map(b=>b.h)),low20=Math.min(...bars.slice(-20).map(b=>b.l));
  const distHigh=pct(last,high20),trend20=pct(last,ma20),trend50=pct(last,ma50),trend200=pct(last,ma200);
  let score=50;
  score+=clamp(m20,-15,18)*1.05+clamp(m60,-25,35)*.65;
  score+=trend20>0?7:-8; score+=trend50>0?9:-12; score+=trend200>0?5:-7;
  if(r>=48&&r<=68)score+=7; if(r>75)score-=8; if(r<38)score-=6;
  if(distHigh>-5)score+=5; if(distHigh<-14)score-=8;
  if(aPct>7)score-=5;
  score=Math.round(clamp(score,0,100));
  const entry=round(Math.max(last,high20*.998));
  const stop=round(Math.min(ma20,last-a*1.35));
  const risk=Math.max(.01,entry-stop),target1=round(entry+risk*1.5),target2=round(entry+risk*2.6);
  return {symbol,price:round(last),score,m20:round(m20,1),m60:round(m60,1),rsi:round(r,1),atr:round(a),atrPct:round(aPct,1),volatility:round(vol,1),ma20:round(ma20),ma50:round(ma50),ma200:round(ma200),distHigh:round(distHigh,1),entry,stop,target1,target2,rr:2.6};
}
function regimeFrom(bySymbol){
  const parts=BENCHMARKS.map(s=>stockMetrics(s,bySymbol[s])).filter(Boolean);
  if(!parts.length)return {label:'UNKNOWN',score:50,tradeGate:'WATCH',detail:'Benchmark data unavailable'};
  const score=Math.round(avg(parts.map(x=>x.score)));
  const breadth=parts.filter(x=>x.price>x.ma20&&x.price>x.ma50).length;
  if(score>=72&&breadth===parts.length)return {label:'RISK ON',score,tradeGate:'TRADE',detail:'SPY and QQQ trends support bullish setups'};
  if(score<48||breadth===0)return {label:'RISK OFF',score,tradeGate:'WAIT',detail:'Broad market trend is hostile to aggressive bullish trades'};
  return {label:'MIXED',score,tradeGate:'SELECTIVE',detail:'Only exceptional setups should pass'};
}
function parseOcc(symbol){
  const m=symbol.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/); if(!m)return null;
  const [,root,d,type,raw]=m; return {root,type,strike:Number(raw)/1000,expiry:new Date(Date.UTC(2000+Number(d.slice(0,2)),Number(d.slice(2,4))-1,Number(d.slice(4,6))))};
}
function days(a,b){return Math.ceil((b-a)/86400000);}
async function newsRisk(symbol){
  try{
    const start=new Date(Date.now()-5*86400000).toISOString();
    const raw=await alpaca(`https://data.alpaca.markets/v1beta1/news?symbols=${symbol}&start=${encodeURIComponent(start)}&limit=15&sort=desc`);
    const items=raw.news||[];
    const danger=/(earnings|guidance|fda|trial|investigation|lawsuit|offering|secondary|downgrade|upgrade|merger|acquisition)/i;
    const catalyst=/(beats|raises|approval|contract|partnership|launch|record|buyback|upgrade)/i;
    const risky=items.filter(n=>danger.test(`${n.headline||''} ${n.summary||''}`)).length;
    const positive=items.filter(n=>catalyst.test(`${n.headline||''} ${n.summary||''}`)).length;
    return {count:items.length,risk:risky>=2?'HIGH':risky===1?'MEDIUM':'LOW',positive,headlines:items.slice(0,3).map(n=>n.headline).filter(Boolean)};
  }catch{return {count:0,risk:'UNKNOWN',positive:0,headlines:[]};}
}
async function optionCandidates(symbol,stockPrice,budget,mode){
  const raw=await alpaca(`https://data.alpaca.markets/v1beta1/options/snapshots/${symbol}?feed=indicative&limit=1000`);
  const snaps=raw.snapshots||{}; const now=new Date();
  const minDte=mode==='aggressive'?28:42,maxDte=mode==='aggressive'?75:105;
  const calls=Object.entries(snaps).map(([contract,s])=>{
    const p=parseOcc(contract); if(!p||p.type!=='C')return null;
    const q=s.latestQuote||s.latest_quote||{},g=s.greeks||{}; const bid=q.bp??q.bid_price??0,ask=q.ap??q.ask_price??0;
    const mid=(bid+ask)/2,spreadPct=mid?((ask-bid)/mid):9;
    return {contract,strike:p.strike,expiry:p.expiry,dte:days(now,p.expiry),bid,ask,spreadPct,iv:s.impliedVolatility??s.implied_volatility??0,delta:g.delta??0,theta:g.theta??0};
  }).filter(Boolean).filter(x=>x.dte>=minDte&&x.dte<=maxDte&&x.strike>=stockPrice*.95&&x.strike<=stockPrice*1.15&&x.bid>0&&x.ask>0&&x.spreadPct<=.14&&x.iv<=.9);
  const spreads=[];
  for(const long of calls){
    if(long.delta&&(long.delta<.34||long.delta>.72))continue;
    for(const short of calls){
      if(short.expiry.getTime()!==long.expiry.getTime()||short.strike<=long.strike)continue;
      const width=short.strike-long.strike; if(width>Math.max(15,stockPrice*.06))continue;
      const debit=long.ask-short.bid; if(debit<=.2||debit>=width)continue;
      const maxRisk=Math.ceil(debit*100),maxProfit=Math.floor((width-debit)*100); if(maxRisk>budget||maxRisk<25)continue;
      const ror=maxProfit/maxRisk*100,breakeven=long.strike+debit; if(ror<55)continue;
      const quality=ror*.34+Math.max(0,20-Math.abs(long.dte-60)*.35)+Math.max(0,18-long.spreadPct*100)-Math.max(0,(long.iv-.55)*35)-Math.max(0,(Math.abs(long.theta)-.25)*25);
      spreads.push({quality,kind:'Call debit spread',expiry:long.expiry.toISOString().slice(0,10),dte:long.dte,longStrike:long.strike,shortStrike:short.strike,debit:round(debit),maxRisk,maxProfit,returnOnRisk:Math.round(ror),breakeven:round(breakeven),delta:round(long.delta,2),theta:round(long.theta,3),iv:round(long.iv,2),spreadPct:round(long.spreadPct*100,1)});
    }
  }
  spreads.sort((a,b)=>b.quality-a.quality);
  return spreads.slice(0,3);
}
function grade(n){return n>=92?'A+':n>=86?'A':n>=80?'A-':n>=74?'B+':n>=68?'B':'C';}

export default async function handler(req,res){
  try{
    const budget=clamp(Number(req.query?.budget)||200,25,5000),mode=req.query?.mode==='balanced'?'balanced':'aggressive';
    const start=new Date(Date.now()-330*86400000).toISOString().slice(0,10),symbols=[...UNIVERSE,...BENCHMARKS].join(',');
    const raw=await alpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols}&timeframe=1Day&start=${start}&limit=10000&adjustment=all&feed=iex`);
    const by=raw.bars||{},regime=regimeFrom(by);
    let ranked=UNIVERSE.map(s=>stockMetrics(s,by[s])).filter(Boolean).sort((a,b)=>b.score-a.score);
    if(!ranked.length)throw new Error('No stock history returned');
    const tested=[];
    for(const s of ranked.slice(0,7)){
      const news=await newsRisk(s.symbol); let options=[];
      try{options=await optionCandidates(s.symbol,s.price,budget,mode);}catch{}
      let adjusted=s.score-(news.risk==='HIGH'?9:news.risk==='MEDIUM'?3:0)+(news.positive?Math.min(4,news.positive):0);
      if(regime.label==='RISK OFF')adjusted-=12; if(regime.label==='MIXED')adjusted-=4;
      if(!options.length)adjusted-=3;
      tested.push({...s,score:Math.round(clamp(adjusted,0,100)),news,options});
    }
    tested.sort((a,b)=>b.score-a.score); const best=tested[0],option=best.options[0]||null;
    const hardNo=regime.label==='RISK OFF'||best.score<76||best.news.risk==='HIGH';
    const action=hardNo?'WAIT':option&&best.score>=82?'TRADE CANDIDATE':'WATCH';
    const reasons=[];
    if(best.price>best.ma20&&best.price>best.ma50)reasons.push('Trend is above 20-day and 50-day averages');
    if(best.m20>4)reasons.push(`${best.m20}% momentum over ~1 month`);
    if(best.rsi>=45&&best.rsi<=70)reasons.push(`RSI ${best.rsi}: strong without extreme overbought conditions`);
    if(option)reasons.push(`${option.returnOnRisk}% maximum return-on-risk with defined loss`);
    if(best.news.risk==='LOW')reasons.push('No major catalyst-risk keywords in recent Alpaca news scan');
    const warnings=[];
    if(regime.label!=='RISK ON')warnings.push(regime.detail);
    if(best.news.risk!=='LOW')warnings.push(`${best.news.risk} recent catalyst/news risk`);
    if(best.rsi>72)warnings.push('RSI is stretched; chasing is discouraged');
    if(!option)warnings.push('No option structure passed budget/liquidity/IV filters');
    const cards=tested.slice(1,5).map(x=>({symbol:x.symbol,score:x.score,price:x.price,label:x.options.length?'Alternate':'Stock watch',risk:x.atrPct>5?'High':'Medium',tag:`${x.m20}% 1M · RSI ${x.rsi}`,hasOption:Boolean(x.options.length)}));
    res.setHeader('Cache-Control','s-maxage=180, stale-while-revalidate=300');
    res.status(200).json({
      asOf:new Date().toISOString(),market:'LIVE',budget,mode,regime,
      action,
      featured:{...best,grade:grade(best.score),option,alternatives:best.options.slice(1),reasons,warnings,
        setup:action==='TRADE CANDIDATE'?'Qualified defined-risk bullish setup':action==='WATCH'?'Good stock, entry/options not strong enough yet':'No trade: protection rules blocked the setup',
        instruction:action==='TRADE CANDIDATE'?`Only consider entry near/above $${best.entry} while the setup remains valid.`:action==='WATCH'?`Watch $${best.entry}; do not force an entry.`:'Keep cash. Re-scan later.',
        exitPlan:{stockStop:best.stop,target1:best.target1,target2:best.target2,optionTakeProfit:'Consider scaling at +50%; reassess near +100%',timeStop:option?`Reassess with 21+ DTE remaining; avoid drifting into expiration.`:'N/A'}},
      cards,
      protection:['No 0DTE/ultra-short default trades','Hard max-loss budget','Wide-spread rejection','IV cap','Market-regime gate','Catalyst/news risk penalty','Trend + RSI + ATR checks','No-trade is an allowed result']
    });
  }catch(error){res.status(500).json({error:error.message});}
}
