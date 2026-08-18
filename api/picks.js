const UNIVERSE = [
  'NVDA','MSFT','AAPL','AMZN','GOOGL','META','AVGO','AMD','PLTR','PANW','CRWD','ORCL','CRM',
  'JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT','GE','XOM','CVX','NEE','UBER','TSLA'
];
const BENCHMARKS = ['SPY','QQQ'];
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const avg=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:0;
const pct=(a,b)=>a&&b?((a/b)-1)*100:0;
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const isoDate=d=>d.toISOString().slice(0,10);

function headers(){
  const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID;
  const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
  if(!key||!secret) throw new Error('Missing Alpaca server environment variables');
  return {'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
}
async function alpaca(url,{timeout=9000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const r=await fetch(url,{headers:headers(),signal:controller.signal});
    if(!r.ok) throw new Error(`Alpaca ${r.status}: ${await r.text()}`);
    return r.json();
  }finally{clearTimeout(timer);}
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
  const xs=[];
  for(let i=Math.max(1,bars.length-n);i<bars.length;i++){
    const b=bars[i],p=bars[i-1];
    xs.push(Math.max(b.h-b.l,Math.abs(b.h-p.c),Math.abs(b.l-p.c)));
  }
  return avg(xs);
}
function stockMetrics(symbol,bars){
  if(!bars||bars.length<70) return null;
  const c=bars.map(b=>b.c), last=c.at(-1), ma20=sma(c,20), ma50=sma(c,50), ma200=sma(c,Math.min(200,c.length));
  const m20=pct(last,c.at(-21)),m60=pct(last,c.at(-61)),r=rsi(c),a=atr(bars),aPct=a/last*100;
  const returns=c.slice(-31).map((x,i,z)=>i?pct(x,z[i-1]):0).slice(1),vol=std(returns)*Math.sqrt(252);
  const high20=Math.max(...bars.slice(-20).map(b=>b.h)),low20=Math.min(...bars.slice(-20).map(b=>b.l));
  const trend20=pct(last,ma20),trend50=pct(last,ma50),trend200=pct(last,ma200),distHigh=pct(last,high20),distLow=pct(last,low20);

  let bull=50;
  bull+=clamp(m20,-15,18)*1.05+clamp(m60,-25,35)*.65;
  bull+=trend20>0?7:-8; bull+=trend50>0?9:-12; bull+=trend200>0?5:-7;
  if(r>=48&&r<=68)bull+=7; if(r>75)bull-=8; if(r<38)bull-=6;
  if(distHigh>-5)bull+=5; if(distHigh<-14)bull-=8; if(aPct>7)bull-=5;

  let bear=50;
  bear+=clamp(-m20,-15,18)*1.05+clamp(-m60,-25,35)*.65;
  bear+=trend20<0?7:-8; bear+=trend50<0?9:-12; bear+=trend200<0?5:-7;
  if(r>=30&&r<=52)bear+=7; if(r<24)bear-=8; if(r>68)bear-=6;
  if(distLow<5)bear+=5; if(distLow>14)bear-=8; if(aPct>7)bear-=5;

  const direction=bull>=bear?'BULLISH':'BEARISH';
  const score=Math.round(clamp(Math.max(bull,bear),0,100));
  let entry,stop,target1,target2;
  if(direction==='BULLISH'){
    entry=round(Math.max(last,high20*.998));
    stop=round(Math.min(ma20,last-a*1.35));
    const risk=Math.max(.01,entry-stop);
    target1=round(entry+risk*1.5); target2=round(entry+risk*2.6);
  }else{
    entry=round(Math.min(last,low20*1.002));
    stop=round(Math.max(ma20,last+a*1.35));
    const risk=Math.max(.01,stop-entry);
    target1=round(entry-risk*1.5); target2=round(entry-risk*2.6);
  }
  const avgVolume=Math.round(avg(bars.slice(-20).map(b=>Number(b.v||0)))),dollarVolume=Math.round(avgVolume*last);
  return {symbol,price:round(last),score,bullScore:Math.round(clamp(bull,0,100)),bearScore:Math.round(clamp(bear,0,100)),direction,
    m20:round(m20,1),m60:round(m60,1),rsi:round(r,1),atr:round(a),atrPct:round(aPct,1),volatility:round(vol,1),
    ma20:round(ma20),ma50:round(ma50),ma200:round(ma200),distHigh:round(distHigh,1),distLow:round(distLow,1),
    entry,stop,target1,target2,rr:2.6,avgVolume,dollarVolume};
}
async function secJson(url,{timeout=12000}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
  try{
    const secIdentity=process.env.SEC_USER_AGENT||'Teststock research app https://github.com/SableWolphen/Teststock';
    const r=await fetch(url,{headers:{'User-Agent':secIdentity,'From':secIdentity.includes('@')?secIdentity.split(/\s+/).find(x=>x.includes('@'))||'':'','Accept-Encoding':'gzip, deflate'},signal:controller.signal});
    if(!r.ok)throw new Error(`SEC ${r.status}`);
    return r.json();
  }finally{clearTimeout(timer);}
}
function factRows(facts,tags,unit='USD'){
  for(const tag of tags){const rows=facts?.['us-gaap']?.[tag]?.units?.[unit];if(rows?.length)return rows;}
  return [];
}
function annualRows(facts,tags,unit='USD'){
  const rows=factRows(facts,tags,unit).filter(x=>['10-K','10-K/A'].includes(x.form)&&Number.isFinite(Number(x.fy))&&x.fp==='FY');
  const byYear=new Map();for(const x of rows){const old=byYear.get(Number(x.fy));if(!old||String(x.end)>String(old.end)||(String(x.end)===String(old.end)&&String(x.filed)>String(old.filed)))byYear.set(Number(x.fy),x);}
  return [...byYear.values()].sort((a,b)=>Number(b.fy)-Number(a.fy));
}
function latestFiled(facts,tags,unit='USD'){
  return factRows(facts,tags,unit).filter(x=>['10-K','10-K/A','10-Q','10-Q/A'].includes(x.form)).sort((a,b)=>String(b.filed).localeCompare(String(a.filed)))[0]||null;
}
function financialScore(symbol,raw){
  const facts=raw?.facts||{},revenue=annualRows(facts,['RevenueFromContractWithCustomerExcludingAssessedTax','Revenues','SalesRevenueNet']),income=annualRows(facts,['NetIncomeLoss','ProfitLoss']),cash=annualRows(facts,['NetCashProvidedByUsedInOperatingActivities']);
  const assets=latestFiled(facts,['Assets']),liabilities=latestFiled(facts,['Liabilities']),shares=annualRows(facts,['CommonStockSharesOutstanding','EntityCommonStockSharesOutstanding'],'shares');
  const revNow=Number(revenue[0]?.val),revPrev=Number(revenue[1]?.val),net=Number(income[0]?.val),ocf=Number(cash[0]?.val),asset=Number(assets?.val),debt=Number(liabilities?.val),shareNow=Number(shares[0]?.val),sharePrev=Number(shares[1]?.val);
  const revenueGrowth=revNow>0&&revPrev>0?pct(revNow,revPrev):null,netMargin=revNow>0&&Number.isFinite(net)?net/revNow*100:null,liabilityRatio=asset>0&&Number.isFinite(debt)?debt/asset*100:null,dilution=shareNow>0&&sharePrev>0?pct(shareNow,sharePrev):null;
  const values=[revenueGrowth,netMargin,Number.isFinite(ocf)?ocf:null,liabilityRatio,dilution],coverage=values.filter(x=>x!=null&&Number.isFinite(x)).length;
  let score=50;
  if(revenueGrowth!=null)score+=clamp(revenueGrowth,-20,30)*.5;
  if(netMargin!=null)score+=netMargin>15?12:netMargin>5?8:netMargin>0?3:-12;
  if(Number.isFinite(ocf))score+=ocf>0?10:-14;
  if(liabilityRatio!=null&&!['JPM','GS'].includes(symbol))score+=liabilityRatio<55?8:liabilityRatio<75?1:-9;
  if(dilution!=null)score+=dilution<=2?5:dilution<=6?0:-10;
  score=Math.round(clamp(score,0,100));
  return {source:'SEC EDGAR',filedThrough:[revenue[0]?.filed,income[0]?.filed,cash[0]?.filed].filter(Boolean).sort().at(-1)||null,coverage,score,revenueGrowth:revenueGrowth==null?null:round(revenueGrowth,1),netMargin:netMargin==null?null:round(netMargin,1),operatingCashFlowPositive:Number.isFinite(ocf)?ocf>0:null,liabilityRatio:liabilityRatio==null?null:round(liabilityRatio,1),shareDilution:dilution==null?null:round(dilution,1),label:coverage<4?'INCOMPLETE':score>=70?'STRONG':score>=58?'ACCEPTABLE':'WEAK'};
}
async function secFundamentals(symbols){
  try{
    const tickers=await secJson('https://www.sec.gov/files/company_tickers.json');
    const cikBySymbol={};for(const row of Object.values(tickers||{}))cikBySymbol[String(row.ticker||'').toUpperCase()]=String(row.cik_str).padStart(10,'0');
    const pairs=await Promise.all(symbols.map(async symbol=>{try{const cik=cikBySymbol[symbol];if(!cik)return[symbol,{source:'SEC EDGAR',coverage:0,score:null,label:'UNAVAILABLE'}];const raw=await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`);return[symbol,financialScore(symbol,raw)];}catch{return[symbol,{source:'SEC EDGAR',coverage:0,score:null,label:'UNAVAILABLE'}];}}));
    return Object.fromEntries(pairs);
  }catch{return Object.fromEntries(symbols.map(s=>[s,{source:'SEC EDGAR',coverage:0,score:null,label:'UNAVAILABLE'}]));}
}
function regimeFrom(bySymbol){
  const parts=BENCHMARKS.map(s=>stockMetrics(s,bySymbol[s])).filter(Boolean);
  if(!parts.length)return {label:'UNKNOWN',score:50,tradeGate:'WATCH',detail:'Benchmark data unavailable'};
  const bullScore=Math.round(avg(parts.map(x=>x.bullScore))),bearScore=Math.round(avg(parts.map(x=>x.bearScore)));
  const breadth=parts.filter(x=>x.price>x.ma20&&x.price>x.ma50).length;
  if(bullScore>=70&&breadth===parts.length)return {label:'RISK ON',score:bullScore,bias:'BULLISH',tradeGate:'TRADE',detail:'SPY and QQQ trends support bullish setups'};
  if(bearScore>=70&&breadth===0)return {label:'RISK OFF',score:bearScore,bias:'BEARISH',tradeGate:'DEFENSIVE',detail:'SPY and QQQ trends favor defensive or bearish setups'};
  return {label:'MIXED',score:Math.max(bullScore,bearScore),bias:bullScore>=bearScore?'BULLISH':'BEARISH',tradeGate:'SELECTIVE',detail:'Only exceptional setups should pass'};
}
function parseOcc(symbol){
  const m=symbol.match(/^([A-Z.]+)(\d{6})([CP])(\d{8})$/); if(!m)return null;
  const [,root,d,type,raw]=m;
  return {root,type,strike:Number(raw)/1000,expiry:new Date(Date.UTC(2000+Number(d.slice(0,2)),Number(d.slice(2,4))-1,Number(d.slice(4,6))))};
}
function days(a,b){return Math.ceil((b-a)/86400000);}
function normalCdf(x){
  const t=1/(1+0.2316419*Math.abs(x));
  const d=0.3989423*Math.exp(-x*x/2);
  let p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));
  p=1-p; return x>=0?p:1-p;
}
function approxProfitProbability(S,breakeven,iv,dte,direction){
  if(!S||!breakeven||!iv||!dte)return null;
  const t=dte/365,r=.04,s=Math.max(.05,iv);
  const d2=(Math.log(S/breakeven)+(r-.5*s*s)*t)/(s*Math.sqrt(t));
  return clamp((direction==='BULLISH'?normalCdf(d2):normalCdf(-d2))*100,1,99);
}
function historicalValidation(bars,direction){
  if(!bars||bars.length<110)return {samples:0,winRate:null,avgMove:null};
  const wins=[],moves=[];
  for(let i=70;i<bars.length-21;i+=5){
    const slice=bars.slice(0,i+1),m=stockMetrics('X',slice);
    if(!m||m.direction!==direction||m.score<72)continue;
    const here=bars[i].c,fwd=bars[i+20].c;
    const move=direction==='BULLISH'?pct(fwd,here):pct(here,fwd);
    moves.push(move);wins.push(move>0?1:0);
  }
  return {samples:moves.length,winRate:moves.length?Math.round(avg(wins)*100):null,avgMove:moves.length?round(avg(moves),1):null};
}
async function batchNewsRisk(symbols){
  const result=Object.fromEntries(symbols.map(s=>[s,{count:0,risk:'UNKNOWN',positive:0,headlines:[]}]))
  try{
    const start=new Date(Date.now()-6*86400000).toISOString();
    const raw=await alpaca(`https://data.alpaca.markets/v1beta1/news?symbols=${symbols.join(',')}&start=${encodeURIComponent(start)}&limit=50&sort=desc`);
    const danger=/(earnings|guidance|fda|trial|investigation|lawsuit|offering|secondary|downgrade|upgrade|merger|acquisition|bankruptcy|recall)/i;
    const catalyst=/(beats|raises|approval|contract|partnership|launch|record|buyback|upgrade|award|expands)/i;
    for(const s of symbols){
      const items=(raw.news||[]).filter(n=>(n.symbols||[]).includes(s));
      const risky=items.filter(n=>danger.test(`${n.headline||''} ${n.summary||''}`)).length;
      const positive=items.filter(n=>catalyst.test(`${n.headline||''} ${n.summary||''}`)).length;
      result[s]={count:items.length,risk:risky>=2?'HIGH':risky===1?'MEDIUM':'LOW',positive,headlines:items.slice(0,3).map(n=>n.headline).filter(Boolean)};
    }
  }catch{}
  return result;
}
async function marketSession(){
  try{
    const raw=await alpaca('https://paper-api.alpaca.markets/v2/clock',{timeout:5000});
    return {isOpen:Boolean(raw.is_open),timestamp:raw.timestamp,nextOpen:raw.next_open,nextClose:raw.next_close,label:raw.is_open?'OPEN':'CLOSED'};
  }catch{return {isOpen:null,label:'UNKNOWN'};}
}
async function discoverPennyUniverse(){
  const [raw,assets]=await Promise.all([
    alpaca('https://data.alpaca.markets/v1beta1/screener/stocks/most-actives?top=100&by=volume'),
    alpaca('https://paper-api.alpaca.markets/v2/assets?status=active&asset_class=us_equity')
  ]);
  const allowed=new Set((assets||[]).filter(a=>a.tradable!==false&&!/(ETF|ETN|exchange.traded|fund|trust|warrant|unit|preferred|depositary)/i.test(a.name||'')).map(a=>a.symbol));
  const symbols=(raw.most_actives||raw.mostActives||[]).map(x=>x.symbol).filter(Boolean);
  if(!symbols.length)throw new Error('No active penny-stock candidates returned');
  const q=new URLSearchParams({symbols:symbols.join(','),feed:'iex'});
  const snaps=await alpaca(`https://data.alpaca.markets/v2/stocks/snapshots?${q}`);
  return symbols.filter(symbol=>allowed.has(symbol)).filter(symbol=>{
    const s=snaps[symbol]||{},price=Number(s.latestTrade?.p||s.latest_trade?.p||s.dailyBar?.c||s.daily_bar?.c||0);
    const volume=Number(s.dailyBar?.v||s.daily_bar?.v||0);
    return price>=1&&price<=5&&volume>=1000000;
  }).slice(0,25);
}
async function fetchChain(symbol,stockPrice,mode,feed){
  const now=new Date(),minDte=mode==='aggressive'?28:42,maxDte=mode==='aggressive'?90:120;
  const expiryGte=isoDate(new Date(now.getTime()+minDte*86400000)),expiryLte=isoDate(new Date(now.getTime()+maxDte*86400000));
  const strikeMin=round(stockPrice*.82,2),strikeMax=round(stockPrice*1.18,2);
  const out={};
  let token='';
  for(let page=0;page<3;page++){
    const q=new URLSearchParams({feed,limit:'1000',strike_price_gte:String(strikeMin),strike_price_lte:String(strikeMax),expiration_date_gte:expiryGte,expiration_date_lte:expiryLte});
    if(token)q.set('page_token',token);
    const raw=await alpaca(`https://data.alpaca.markets/v1beta1/options/snapshots/${symbol}?${q.toString()}`);
    Object.assign(out,raw.snapshots||{});
    token=raw.next_page_token||'';
    if(!token)break;
  }
  return out;
}
function normalizeContracts(snaps,stockPrice){
  const now=new Date();
  return Object.entries(snaps).map(([contract,s])=>{
    const p=parseOcc(contract); if(!p)return null;
    const q=s.latestQuote||s.latest_quote||{},g=s.greeks||{},t=s.latestTrade||s.latest_trade||{};
    const bid=q.bp??q.bid_price??0,ask=q.ap??q.ask_price??0,bidSize=q.bs??q.bid_size??0,askSize=q.as??q.ask_size??0;
    const mid=(bid+ask)/2,spreadPct=mid?((ask-bid)/mid):9;
    const tradePrice=t.p??t.price??0,iv=s.impliedVolatility??s.implied_volatility??0,delta=g.delta??0,theta=g.theta??0,gamma=g.gamma??0;
    return {contract,type:p.type,strike:p.strike,expiry:p.expiry,dte:days(now,p.expiry),bid,ask,bidSize,askSize,mid,spreadPct,tradePrice,iv,delta,theta,gamma,moneyness:p.strike/stockPrice};
  }).filter(Boolean);
}
function scoreLong(x,stockPrice,budget,direction,validation){
  const isCall=direction==='BULLISH',rightType=isCall?'C':'P';
  if(x.type!==rightType||x.bid<=0||x.ask<=0||x.ask*100>budget||x.ask*100<20)return null;
  const ad=Math.abs(x.delta);
  if(ad<.42||ad>.72||x.spreadPct>.12||x.iv<=0||x.iv>1.1)return null;
  const breakeven=isCall?x.strike+x.ask:x.strike-x.ask;
  const maxRisk=Math.ceil(x.ask*100),prob=approxProfitProbability(stockPrice,breakeven,x.iv,x.dte,direction);
  const expectedMove=stockPrice*x.iv*Math.sqrt(x.dte/365),beMove=Math.abs(breakeven-stockPrice);
  if(expectedMove&&beMove>expectedMove*1.05)return null;
  const hist=validation.winRate??50;
  const quality=hist*.28+(prob??45)*.25+Math.max(0,20-Math.abs(x.dte-60)*.25)+Math.max(0,18-x.spreadPct*100)-Math.max(0,(x.iv-.65)*25)-Math.max(0,(Math.abs(x.theta)-.3)*20);
  return {quality,kind:isCall?'Long call':'Long put',structure:'LONG',side:isCall?'CALL':'PUT',expiry:isoDate(x.expiry),dte:x.dte,longStrike:x.strike,shortStrike:null,debit:round(x.ask),maxRisk,maxProfit:null,returnOnRisk:null,breakeven:round(breakeven),probProfit:Math.round(prob??0),expectedMove:round(expectedMove),breakevenMovePct:round(Math.abs(pct(breakeven,stockPrice)),1),delta:round(x.delta,2),theta:round(x.theta,3),gamma:round(x.gamma,4),iv:round(x.iv,2),spreadPct:round(x.spreadPct*100,1),liquidityScore:Math.round(clamp(100-x.spreadPct*500,0,100))};
}
function scoreSpreads(contracts,stockPrice,budget,direction,validation){
  const isCall=direction==='BULLISH',rightType=isCall?'C':'P';
  const xs=contracts.filter(x=>x.type===rightType&&x.bid>0&&x.ask>0&&x.spreadPct<=.14&&x.iv>0&&x.iv<=1.1);
  const spreads=[];
  for(const long of xs){
    const ad=Math.abs(long.delta); if(ad<.34||ad>.72)continue;
    for(const short of xs){
      if(short.expiry.getTime()!==long.expiry.getTime())continue;
      if(isCall&&short.strike<=long.strike)continue;
      if(!isCall&&short.strike>=long.strike)continue;
      const width=Math.abs(short.strike-long.strike); if(width<1||width>Math.max(15,stockPrice*.07))continue;
      const debit=long.ask-short.bid; if(debit<=.2||debit>=width)continue;
      const maxRisk=Math.ceil(debit*100),maxProfit=Math.floor((width-debit)*100); if(maxRisk>budget||maxRisk<25)continue;
      const ror=maxProfit/maxRisk*100;if(ror<45)continue;
      const breakeven=isCall?long.strike+debit:long.strike-debit,prob=approxProfitProbability(stockPrice,breakeven,long.iv,long.dte,direction);
      const expectedMove=stockPrice*long.iv*Math.sqrt(long.dte/365),beMove=Math.abs(breakeven-stockPrice);
      if(expectedMove&&beMove>expectedMove*1.1)continue;
      const hist=validation.winRate??50;
      const quality=hist*.28+(prob??45)*.24+Math.min(28,ror*.09)+Math.max(0,16-Math.abs(long.dte-60)*.2)+Math.max(0,14-long.spreadPct*100)-Math.max(0,(long.iv-.7)*22);
      spreads.push({quality,kind:isCall?'Call debit spread':'Put debit spread',structure:'VERTICAL',side:isCall?'CALL':'PUT',expiry:isoDate(long.expiry),dte:long.dte,longStrike:long.strike,shortStrike:short.strike,debit:round(debit),maxRisk,maxProfit,returnOnRisk:Math.round(ror),breakeven:round(breakeven),probProfit:Math.round(prob??0),expectedMove:round(expectedMove),breakevenMovePct:round(Math.abs(pct(breakeven,stockPrice)),1),delta:round(long.delta,2),theta:round(long.theta,3),gamma:round(long.gamma,4),iv:round(long.iv,2),spreadPct:round(long.spreadPct*100,1),liquidityScore:Math.round(clamp(100-long.spreadPct*500,0,100))});
    }
  }
  return spreads;
}
async function optionCandidates(symbol,stockPrice,budget,mode,direction,validation,feed){
  const snaps=await fetchChain(symbol,stockPrice,mode,feed);
  const contracts=normalizeContracts(snaps,stockPrice);
  const longs=contracts.map(x=>scoreLong(x,stockPrice,budget,direction,validation)).filter(Boolean);
  const spreads=scoreSpreads(contracts,stockPrice,budget,direction,validation);
  const all=[...spreads,...longs].sort((a,b)=>b.quality-a.quality).map((x,i)=>({...x,rank:i+1,qualityScore:Math.round(clamp(x.quality,0,100))}));
  return {contractsScanned:contracts.length,choices:all.slice(0,5)};
}
function grade(n){return n>=92?'A+':n>=86?'A':n>=80?'A-':n>=74?'B+':n>=68?'B':'C';}

export default async function handler(req,res){
  try{
    const budget=clamp(Number(req.query?.budget)||200,25,5000),mode=req.query?.mode==='balanced'?'balanced':'aggressive',segment=req.query?.segment==='penny'?'penny':'core';
    const requestedFeed=(process.env.ALPACA_OPTIONS_FEED||'indicative').toLowerCase()==='opra'?'opra':'indicative';
    const selectedUniverse=segment==='penny'?await discoverPennyUniverse():UNIVERSE;
    if(segment==='penny'&&!selectedUniverse.length)throw new Error('No liquid $1-$5 penny stocks passed today');
    const start=new Date(Date.now()-420*86400000).toISOString().slice(0,10),symbols=[...selectedUniverse,...BENCHMARKS].join(',');
    const [raw,session]=await Promise.all([
      alpaca(`https://data.alpaca.markets/v2/stocks/bars?symbols=${symbols}&timeframe=1Day&start=${start}&limit=10000&adjustment=all&feed=iex`),
      marketSession()
    ]);
    const by=raw.bars||{},regime=regimeFrom(by);
    let ranked=selectedUniverse.map(s=>stockMetrics(s,by[s])).filter(Boolean).sort((a,b)=>b.score-a.score);
    if(segment==='penny')ranked=ranked.filter(x=>x.price>=1&&x.price<=5&&x.avgVolume>=1000000&&x.dollarVolume>=3000000&&x.atrPct<=15);
    if(!ranked.length)throw new Error('No stock history returned');

    const top=ranked.slice(0,8);
    const [newsMap,fundamentalsMap]=await Promise.all([batchNewsRisk(top.map(x=>x.symbol)),secFundamentals(top.map(x=>x.symbol))]);
    const prelim=top.map(s=>{
      const validation=historicalValidation(by[s.symbol],s.direction),news=newsMap[s.symbol]||{risk:'UNKNOWN',positive:0,headlines:[]},fundamentals=fundamentalsMap[s.symbol]||{coverage:0,score:null,label:'UNAVAILABLE'};
      let adjusted=s.score-(news.risk==='HIGH'?10:news.risk==='MEDIUM'?3:0)+(news.positive?Math.min(4,news.positive):0);
      if(regime.label==='RISK ON'&&s.direction==='BEARISH')adjusted-=9;
      if(regime.label==='RISK OFF'&&s.direction==='BULLISH')adjusted-=9;
      if(regime.label==='MIXED')adjusted-=2;
      if(validation.samples>=6&&validation.winRate<45)adjusted-=6;
      if(validation.samples>=6&&validation.winRate>=60)adjusted+=4;
      if(fundamentals.coverage>=4)adjusted+=(fundamentals.score-60)*.22;else adjusted-=8;
      return {...s,score:Math.round(clamp(adjusted,0,100)),news,validation,fundamentals};
    }).sort((a,b)=>b.score-a.score);

    // Long-term mode recommends shares only. Options are intentionally not scanned.
    const optionTargets=[];
    const optionResults=await Promise.all(optionTargets.map(async s=>{
      try{return [s.symbol,await optionCandidates(s.symbol,s.price,budget,mode,s.direction,s.validation,requestedFeed)];}
      catch(error){return [s.symbol,{contractsScanned:0,choices:[],error:error.message}];}
    }));
    const optionMap=Object.fromEntries(optionResults);
    const tested=prelim.map(s=>{
      const opt=optionMap[s.symbol]||{contractsScanned:0,choices:[]};
      let adjusted=s.score;if(!opt.choices.length)adjusted-=4;
      return {...s,score:Math.round(clamp(adjusted,0,100)),options:opt.choices,contractsScanned:opt.contractsScanned};
    }).sort((a,b)=>b.score-a.score);

    const best=tested[0],option=best.options[0]||null;
    const directionConflict=(regime.label==='RISK ON'&&best.direction==='BEARISH')||(regime.label==='RISK OFF'&&best.direction==='BULLISH');
    const historyOkay=best.validation.samples>=6&&best.validation.winRate>=52;
    const pennyLiquid=segment!=='penny'||(best.avgVolume>=1000000&&best.dollarVolume>=3000000&&best.atrPct<=15);
    const financialEvidence=best.fundamentals?.coverage>=4&&best.fundamentals?.score>=58;
    const hardNo=best.score<76||best.news.risk==='HIGH'||directionConflict||!pennyLiquid||(best.fundamentals?.coverage>=4&&best.fundamentals?.score<42);
    const stockQualified=!hardNo&&best.score>=(segment==='penny'?88:86)&&historyOkay&&best.direction==='BULLISH'&&best.price>best.ma200&&best.m60>0&&financialEvidence;
    const action=hardNo?'WAIT':stockQualified?'TRADE CANDIDATE':'WATCH';
    const shares=Math.max(0,Math.floor(budget/Math.max(best.entry,.01)));
    const stockPlan={shares,estimatedCost:round(shares*best.entry),maxLossAtStop:round(shares*Math.max(0,best.entry-best.stop)),holdingStyle:'Swing / hold while trend remains valid'};
    const reasons=[];
    reasons.push(`${best.direction.toLowerCase()} setup scored ${best.score}/100`);
    if(best.direction==='BULLISH'&&best.price>best.ma20&&best.price>best.ma50)reasons.push('Price is above 20-day and 50-day trends');
    if(best.direction==='BEARISH'&&best.price<best.ma20&&best.price<best.ma50)reasons.push('Price is below 20-day and 50-day trends');
    if(best.validation.samples>=4)reasons.push(`Similar stock signals won ${best.validation.winRate}% of ${best.validation.samples} historical samples`);
    if(option)reasons.push(`${option.kind}: ${option.probProfit}% model probability of finishing beyond breakeven`);
    if(option?.returnOnRisk)reasons.push(`${option.returnOnRisk}% maximum return-on-risk with defined loss`);
    if(best.news.risk==='LOW')reasons.push('Recent Alpaca news scan found no major event-risk keywords');
    if(best.fundamentals?.coverage>=4)reasons.push(`SEC fundamentals ${best.fundamentals.label.toLowerCase()}: ${best.fundamentals.score}/100`);
    if(best.fundamentals?.revenueGrowth!=null)reasons.push(`Latest SEC annual revenue growth: ${best.fundamentals.revenueGrowth}%`);
    if(best.fundamentals?.operatingCashFlowPositive)reasons.push('Latest SEC annual operating cash flow is positive');

    const warnings=[];
    if(directionConflict)warnings.push(`${best.direction} setup conflicts with the broad market regime`);
    if(best.news.risk!=='LOW')warnings.push(`${best.news.risk} recent catalyst/news risk`);
    if(best.rsi>75||best.rsi<25)warnings.push('RSI is stretched; chasing is discouraged');
    if(!option)warnings.push('No option structure passed budget, liquidity, IV, DTE and expected-move filters');
    if(requestedFeed!=='opra')warnings.push('Options use Alpaca indicative quotes; use OPRA for official real-time consolidated options data');
    if(best.validation.samples<6)warnings.push('Historical signal sample is small; confidence is reduced');
    if((best.fundamentals?.coverage||0)<4)warnings.push('SEC fundamental coverage is incomplete; BUY & HOLD is blocked');
    if(best.fundamentals?.score!=null&&best.fundamentals.score<58)warnings.push(`SEC fundamental score is only ${best.fundamentals.score}/100`);
    if(best.fundamentals?.shareDilution>6)warnings.push(`Share count increased ${best.fundamentals.shareDilution}% in the latest annual comparison`);

    const cards=tested.slice(1,5).map(x=>({symbol:x.symbol,score:x.score,price:x.price,direction:x.direction,label:x.options.length?'Alternate':'Stock watch',risk:x.atrPct>5?'High':'Medium',tag:`${x.m20}% 1M · RSI ${x.rsi} · ${x.validation.winRate??'—'}% hist`,hasOption:Boolean(x.options.length)}));
    res.setHeader('Cache-Control','s-maxage=120, stale-while-revalidate=180');
    res.status(200).json({
      asOf:new Date().toISOString(),market:session.label,budget,mode,segment,session,regime,
      dataQuality:{stockFeed:'IEX',news:'Alpaca News',fundamentals:'SEC EDGAR XBRL',history:'Alpaca bars + Teststock outcomes'},
      dataSources:['Alpaca IEX market prices','Alpaca News','SEC EDGAR company filings and XBRL financial statements','SPY/QQQ market regime','Sector and breadth history','Teststock tracked outcomes'],
      action,
      featured:{...best,grade:grade(best.score),option,stockPlan,alternatives:best.options.slice(1,4),reasons,warnings,
        setup:action==='TRADE CANDIDATE'?`Qualified ${segment==='penny'?'liquid penny-stock':'stock'} setup for shares${option?' with an optional defined-risk option':''}`:action==='WATCH'?`Interesting stock, but the buy gates are not fully aligned yet`:'No trade: protection rules blocked the setup',
        instruction:action==='TRADE CANDIDATE'?`Buy only near the trigger around ${best.entry}; use the stop and hold while the trend remains valid.`:action==='WATCH'?`Watch ${best.entry}; do not force an entry.`:'Keep cash. Re-scan later.',
        exitPlan:{stockStop:best.stop,target1:best.target1,target2:best.target2,optionTakeProfit:'Consider scaling near +50%; reassess near +100% rather than waiting for max profit',timeStop:option?`Reassess with 21+ DTE remaining; avoid drifting into expiration.`:'N/A'}},
      cards,
      protection:['Stocks are the primary recommendation','No 0DTE/ultra-short default trades','Hard spending budget','Historical stock-signal validation','Penny-stock price and liquidity gates','Market-regime gate','Catalyst/news risk penalty','No-trade is an allowed result']
    });
  }catch(error){res.status(500).json({error:error.name==='AbortError'?'Market-data request timed out':error.message});}
}

