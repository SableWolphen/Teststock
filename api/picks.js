const UNIVERSE = [
  'NVDA','MSFT','AAPL','AMZN','GOOGL','META','AVGO','AMD','PLTR','PANW',
  'CRWD','ORCL','CRM','JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT',
  'GE','XOM','CVX','NEE','UBER','TSLA'
];

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (a, b) => (a && b ? ((a / b) - 1) * 100 : 0);
const avg = (xs) => xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0;

function authHeaders(){
  const key = process.env.ALPACA_API_KEY || process.env.APCA_API_KEY_ID;
  const secret = process.env.ALPACA_API_SECRET || process.env.APCA_API_SECRET_KEY;
  if(!key || !secret) throw new Error('Missing Alpaca environment variables');
  return { 'APCA-API-KEY-ID': key, 'APCA-API-SECRET-KEY': secret };
}

async function alpaca(url){
  const r = await fetch(url, { headers: authHeaders() });
  if(!r.ok) throw new Error(`Alpaca ${r.status}: ${await r.text()}`);
  return r.json();
}

function scoreStock(symbol, bars){
  if(!bars || bars.length < 65) return null;
  const closes = bars.map(b=>b.c).filter(Number.isFinite);
  const last = closes.at(-1);
  const c20 = closes.at(-21);
  const c60 = closes.at(-61);
  const ma20 = avg(closes.slice(-20));
  const ma50 = avg(closes.slice(-50));
  const m20 = pct(last,c20);
  const m60 = pct(last,c60);
  const trend20 = pct(last,ma20);
  const trend50 = pct(last,ma50);
  const recentHigh = Math.max(...closes.slice(-20));
  const pullback = pct(last,recentHigh);

  let score = 50;
  score += clamp(m20, -15, 20) * 1.15;
  score += clamp(m60, -25, 35) * 0.8;
  score += trend20 > 0 ? 6 : -7;
  score += trend50 > 0 ? 9 : -12;
  if(pullback > -4) score += 5;
  if(pullback < -12) score -= 8;
  score = Math.round(clamp(score,0,100));

  return { symbol, price:last, score, m20, m60, pullback, ma20, ma50 };
}

function parseOccSymbol(symbol){
  const m = symbol.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/);
  if(!m) return null;
  const [,root,date,type,strikeRaw] = m;
  const yy = Number(date.slice(0,2));
  const mm = Number(date.slice(2,4));
  const dd = Number(date.slice(4,6));
  const expiry = new Date(Date.UTC(2000+yy,mm-1,dd));
  return { root, expiry, type, strike:Number(strikeRaw)/1000 };
}

function daysBetween(a,b){ return Math.round((b-a)/86400000); }

async function chooseOption(symbol, stockPrice, budget){
  const raw = await alpaca(`https://data.alpaca.markets/v1beta1/options/snapshots/${symbol}?feed=indicative&limit=1000`);
  const snapshots = raw.snapshots || raw;
  const now = new Date();
  const calls = Object.entries(snapshots).map(([contract,s])=>{
    const p = parseOccSymbol(contract);
    if(!p || p.type !== 'C') return null;
    const dte = daysBetween(now,p.expiry);
    const q = s.latestQuote || s.latest_quote || {};
    const bid = q.bp ?? q.bid_price ?? 0;
    const ask = q.ap ?? q.ask_price ?? 0;
    const iv = s.impliedVolatility ?? s.implied_volatility ?? 0;
    const g = s.greeks || {};
    return { contract, strike:p.strike, expiry:p.expiry, dte, bid, ask, iv, delta:g.delta ?? 0, theta:g.theta ?? 0 };
  }).filter(Boolean).filter(x=>x.dte>=35 && x.dte<=90 && x.strike>=stockPrice*.96 && x.strike<=stockPrice*1.12 && x.bid>0 && x.ask>0);

  let best = null;
  for(const long of calls){
    if(long.delta && (long.delta < .32 || long.delta > .68)) continue;
    const spreadPct = (long.ask-long.bid)/Math.max(.01,(long.ask+long.bid)/2);
    if(spreadPct > .16 || long.iv > .85) continue;
    const shorts = calls.filter(s=>s.expiry.getTime()===long.expiry.getTime() && s.strike>long.strike && s.strike<=long.strike+15);
    for(const short of shorts){
      const debit = long.ask - short.bid;
      const width = short.strike-long.strike;
      if(debit<=0 || debit>=width) continue;
      const maxRisk = Math.round(debit*100);
      const maxProfit = Math.round((width-debit)*100);
      if(maxRisk > budget || maxRisk < 25 || maxProfit <= maxRisk*.5) continue;
      const ror = Math.round((maxProfit/maxRisk)*100);
      const quality = ror - Math.abs(long.dte-60)*.7 - spreadPct*100 - Math.max(0,(long.iv-.55)*50);
      if(!best || quality>best.quality){
        best={quality,kind:'Call debit spread',expiry:long.expiry.toISOString().slice(0,10),longStrike:long.strike,shortStrike:short.strike,debit:Number(debit.toFixed(2)),maxRisk,maxProfit,returnOnRisk:ror,delta:Number((long.delta||0).toFixed(2)),iv:Number((long.iv||0).toFixed(2)),note:'Defined-risk setup selected from the live option chain. Prices can move before an order fills.'};
      }
    }
  }
  return best;
}

export default async function handler(req,res){
  try{
    const budget = clamp(Number(req.query?.budget)||200,25,5000);
    const start = new Date(Date.now()-220*86400000).toISOString().slice(0,10);
    const symbols = UNIVERSE.join(',');
    const url = `https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols}&timeframe=1Day&start=${start}&limit=10000&adjustment=all&feed=iex`;
    const raw = await alpaca(url);
    const bySymbol = raw.bars || {};
    const ranked = UNIVERSE.map(s=>scoreStock(s,bySymbol[s])).filter(Boolean).sort((a,b)=>b.score-a.score);
    if(!ranked.length) throw new Error('No market data returned');

    let featured = ranked[0];
    let option = null;
    for(const candidate of ranked.slice(0,4)){
      try{
        const o = await chooseOption(candidate.symbol,candidate.price,budget);
        if(o){ featured=candidate; option=o; break; }
      }catch(e){ /* try next candidate */ }
    }

    const grade = featured.score>=90?'A+':featured.score>=84?'A':featured.score>=78?'A-':featured.score>=72?'B+':'B';
    const why=[];
    if(featured.m20>5) why.push(`${featured.m20.toFixed(1)}% 1-month momentum`);
    if(featured.m60>10) why.push(`${featured.m60.toFixed(1)}% 3-month momentum`);
    if(featured.price>featured.ma50) why.push('Above 50-day trend');
    if(option) why.push('Defined-risk option fits budget');

    const cards = ranked.filter(x=>x.symbol!==featured.symbol).slice(0,3).map((x,i)=>({
      label:i===0?'Steadier pick':i===1?'Breakout watch':'Next best',
      symbol:x.symbol,
      score:x.score,
      tag:x.m20>0?`${x.m20.toFixed(1)}% over ~1 month`:'Needs momentum confirmation',
      risk:x.score>=85?'Medium':x.m60>20?'High':'Medium-high'
    }));

    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=600');
    res.status(200).json({
      asOf:new Date().toISOString(),
      market:'LIVE SCAN',
      budget,
      featured:{
        symbol:featured.symbol,
        price:Number(featured.price.toFixed(2)),
        score:featured.score,
        grade,
        setup:option?'Momentum + affordable defined-risk option':'Best stock setup; options rejected',
        entry:'Wait for price confirmation; do not chase a gap',
        invalidation:'Exit/reassess if the trend breaks below recent support',
        why,
        option
      },
      cards
    });
  }catch(error){
    res.status(500).json({error:error.message});
  }
}
