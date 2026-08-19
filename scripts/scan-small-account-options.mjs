import fs from 'node:fs/promises';
const universe=['SPY','QQQ','NVDA','MSFT','AAPL','AMZN','GOOGL','META','AMD','AVGO','PLTR','PANW','CRWD','ORCL','CRM','JPM','GS','V','MA','LLY','UNH','COST','WMT','CAT','GE','XOM','CVX','NEE','UBER','TSLA'];
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID,secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY;
if(!key||!secret)throw new Error('Missing Alpaca secrets');
const headers={'APCA-API-KEY-ID':key,'APCA-API-SECRET-KEY':secret};
const get=async u=>{const r=await fetch(u,{headers});if(!r.ok)throw new Error(`Alpaca ${r.status}: ${await r.text()}`);return r.json();};
const latest=await read('docs/data/latest-100.json');
const snap=new Map((latest.marketSnapshot||[]).map(x=>[x.symbol,x]));
const recommendationScore=new Map((latest.recommendations||[]).map(x=>[x.symbol,Number(x.score||0)]));
const trendScore=x=>{
  const above20=x.ma20>0?(x.price/x.ma20-1)*100:0;
  const above50=x.ma50>0?(x.price/x.ma50-1)*100:0;
  const above200=x.ma200>0?(x.price/x.ma200-1)*100:0;
  return Number(recommendationScore.get(x.symbol)||0)+above20*2+above50+Math.max(0,above200)*.25-Math.max(0,Number(x.atrPct||0)-5)*2;
};
const ranked=universe.map(s=>snap.get(s)).filter(Boolean).filter(x=>x.direction==='BULLISH'&&Number(x.price)>Number(x.ma20)&&Number(x.price)>Number(x.ma50)).sort((a,b)=>trendScore(b)-trendScore(a)).slice(0,12);
const now=new Date(),iso=d=>d.toISOString().slice(0,10),gte=iso(new Date(now.getTime()+35*864e5)),lte=iso(new Date(now.getTime()+90*864e5));
const feed=process.env.ALPACA_OPTIONS_FEED||'indicative';
const choices=[],errors=[];
for(const u of ranked){
  try{
    const q=new URLSearchParams({feed,limit:'1000',expiration_date_gte:gte,expiration_date_lte:lte,strike_price_gte:String(round(u.price*.88,2)),strike_price_lte:String(round(u.price*1.12,2))});
    const raw=await get(`https://data.alpaca.markets/v1beta1/options/snapshots/${u.symbol}?${q}`);
    for(const [contract,s] of Object.entries(raw.snapshots||{})){
      const m=contract.match(/^([A-Z.]+)(\d{6})(C)(\d{8})$/);if(!m)continue;
      const expiry=new Date(Date.UTC(2000+Number(m[2].slice(0,2)),Number(m[2].slice(2,4))-1,Number(m[2].slice(4,6)))),dte=Math.ceil((expiry-now)/864e5),strike=Number(m[4])/1000;
      const qx=s.latestQuote||s.latest_quote||{},bid=Number(qx.bp??qx.bid_price??0),ask=Number(qx.ap??qx.ask_price??0),mid=(bid+ask)/2,spreadPct=mid>0?(ask-bid)/mid*100:999;
      const g=s.greeks||{},delta=Math.abs(Number(g.delta||0)),iv=Number(s.impliedVolatility??s.implied_volatility??0),premium=ask*100;
      if(!(ask>0&&bid>0)||spreadPct>10||dte<35||dte>90||delta<.25||delta>.70||premium>35)continue;
      const underlyingScore=round(trendScore(u),1);
      const score=round(underlyingScore+Math.max(0,10-spreadPct)*1.5+Math.max(0,8-Math.abs(delta-.45)*20)-Math.max(0,iv-1)*5,1);
      choices.push({underlying:u.symbol,contract,kind:'LONG_CALL',expiry:iso(expiry),dte,strike,bid:round(bid,3),ask:round(ask,3),mid:round(mid,3),spreadPct:round(spreadPct,1),delta:round(delta,2),iv:round(iv,2),oneContractPremiumDollars:round(premium,2),underlyingPrice:u.price,underlyingScore,score});
    }
  }catch(error){errors.push({underlying:u.symbol,error:String(error?.message||error)});}
}
choices.sort((a,b)=>b.score-a.score||a.spreadPct-b.spreadPct||a.oneContractPremiumDollars-b.oneContractPremiumDollars);
const out={schemaVersion:2,generatedAt:new Date().toISOString(),sourceSnapshotAsOf:latest.asOf||null,objective:'Broaden the search for small-account-compatible long calls without weakening live safety gates.',policy:{maxOneContractPremiumDollars:35,minDte:35,maxDte:90,maxSpreadPct:10,minAbsDelta:.25,maxAbsDelta:.70,no0DTE:true,definedRiskOnly:true,liveWholeContractCheckRequired:true,doesNotOverrideRealFillGate:true},underlyingsScanned:ranked.map(x=>x.symbol),contractsQualified:choices.length,candidates:choices.slice(0,10),best:choices[0]||null,scanErrors:errors};
await fs.writeFile('docs/data/small-account-options.json',JSON.stringify(out,null,2));
console.log(`Small-account option scan: ${ranked.length} underlyings, ${choices.length} qualified contracts, ${errors.length} errors`);
