import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, BarChart3, CheckCircle2, ChevronRight, Clock3, Flame,
  Gauge, History, LineChart, RefreshCw, Rocket, ShieldCheck, Sparkles, Target,
  TrendingUp, WalletCards, Zap
} from 'lucide-react';

const demo={
  asOf:'Demo — connect Alpaca server keys',market:'DEMO',action:'WATCH',budget:200,mode:'aggressive',
  dataQuality:{stockFeed:'IEX',optionsFeed:'INDICATIVE',optionsOfficial:false,news:'Alpaca News'},
  regime:{label:'MIXED',score:64,tradeGate:'SELECTIVE',detail:'Demo market regime'},
  featured:{symbol:'NVDA',direction:'BULLISH',price:225.10,score:86,grade:'A',setup:'Good stock, entry/options not strong enough yet',instruction:'Watch $227.90; do not force an entry.',entry:227.90,stop:218.40,target1:242.15,target2:252.60,rsi:61.2,m20:12.1,m60:16.8,atrPct:3.4,contractsScanned:420,
    validation:{samples:11,winRate:64,avgMove:5.8},reasons:['Bullish setup scored 86/100','Trend is above 20-day and 50-day averages','Similar stock signals won 64% of 11 historical samples'],warnings:['Demo data only'],news:{risk:'LOW',headlines:[]},
    option:{kind:'Call debit spread',structure:'VERTICAL',side:'CALL',expiry:'2026-10-16',dte:59,longStrike:235,shortStrike:240,debit:1.86,maxRisk:186,maxProfit:314,returnOnRisk:169,breakeven:236.86,probProfit:44,expectedMove:16.1,breakevenMovePct:5.2,qualityScore:82,liquidityScore:91,delta:.41,theta:-.13,iv:.43,spreadPct:1.8},
    alternatives:[],exitPlan:{stockStop:218.40,target1:242.15,target2:252.60,optionTakeProfit:'Consider scaling near +50%; reassess near +100% rather than waiting for max profit',timeStop:'Reassess with 21+ DTE remaining; avoid drifting into expiration.'}},
  cards:[{symbol:'JPM',direction:'BULLISH',score:83,price:361,label:'Alternate',risk:'Medium',tag:'6.2% 1M · RSI 59 · 61% hist',hasOption:true},{symbol:'PLTR',direction:'BULLISH',score:79,price:172.5,label:'Stock watch',risk:'High',tag:'18.0% 1M · RSI 71 · 55% hist',hasOption:false},{symbol:'AMD',direction:'BEARISH',score:77,price:506,label:'Alternate',risk:'High',tag:'-8.1% 1M · RSI 43 · 58% hist',hasOption:true}],
  protection:['No 0DTE/ultra-short default trades','Hard max-loss budget','Bullish and bearish structure selection','Long option + debit-spread comparison','Full option-chain pagination','Expected-move vs breakeven filter','Probability-of-profit model','Historical stock-signal validation','No-trade is an allowed result']
};
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:Number(n)<10?2:0}).format(Number(n||0));
const tone=a=>a==='TRADE CANDIDATE'?'good':a==='WATCH'?'warn':'bad';
const loadLocal=(k,fallback)=>{try{return JSON.parse(localStorage.getItem(k))??fallback}catch{return fallback}};

function Pill({children,t='neutral'}){return <span className={`pill pill-${t}`}>{children}</span>}
function Stat({label,value,sub}){return <div className="stat"><span>{label}</span><strong>{value}</strong>{sub&&<small>{sub}</small>}</div>}

export default function App(){
  const [data,setData]=useState(demo),[budget,setBudget]=useState(()=>loadLocal('ts-budget',200));
  const [mode,setMode]=useState(()=>loadLocal('ts-mode','aggressive')),[tab,setTab]=useState('today');
  const [loading,setLoading]=useState(false),[error,setError]=useState('');
  const [paper,setPaper]=useState(()=>loadLocal('ts-paper',[]));
  const [account,setAccount]=useState(()=>loadLocal('ts-account',{value:500,monthly:250,goal:1000000}));
  useEffect(()=>localStorage.setItem('ts-budget',JSON.stringify(budget)),[budget]);
  useEffect(()=>localStorage.setItem('ts-mode',JSON.stringify(mode)),[mode]);
  useEffect(()=>localStorage.setItem('ts-paper',JSON.stringify(paper)),[paper]);
  useEffect(()=>localStorage.setItem('ts-account',JSON.stringify(account)),[account]);

  const scan=async()=>{
    setLoading(true);setError('');
    try{const r=await fetch(`/api/picks?budget=${budget}&mode=${mode}`);const j=await r.json();if(!r.ok)throw new Error(j.error||`API ${r.status}`);setData(j)}
    catch(e){setData({...demo,budget,mode});setError(`${e.message}. Showing demo data until the live backend is configured.`)}finally{setLoading(false)}
  };
  useEffect(()=>{scan()},[]);
  const p=data.featured||demo.featured,o=p.option,action=data.action||'WATCH',fits=!o||o.maxRisk<=budget;
  const optionLetter=o?.side==='PUT'?'P':'C';
  const optionId=o?`${p.symbol}-${o.expiry}-${o.longStrike}-${o.shortStrike||'LONG'}-${o.side}`:'';
  const logPaper=()=>{
    if(!o||action!=='TRADE CANDIDATE')return;
    if(paper.some(x=>x.id===optionId))return;
    setPaper([{id:optionId,date:new Date().toISOString(),symbol:p.symbol,direction:p.direction,entryStock:p.price,status:'OPEN',resultPct:null,option:o,score:p.score},...paper]);setTab('paper');
  };
  const closePaper=(id,resultPct)=>setPaper(paper.map(x=>x.id===id?{...x,status:'CLOSED',resultPct:Number(resultPct)}:x));
  const closed=paper.filter(x=>x.status==='CLOSED'),wins=closed.filter(x=>x.resultPct>0),avgResult=closed.length?closed.reduce((s,x)=>s+Number(x.resultPct||0),0)/closed.length:0;
  const doubles=account.value>0?Math.ceil(Math.log2(account.goal/account.value)):0;
  const timelines=useMemo(()=>[.08,.15,.25].map(rate=>{let v=account.value,m=0;while(v<account.goal&&m<1200){v=v*(1+rate/12)+account.monthly;m++}return{rate:Math.round(rate*100),years:m/12}}),[account]);

  return <main className="app-shell">
    <header className="topbar">
      <div><div className="eyebrow"><Sparkles size={14}/> TESTSTOCK</div><h1>One decision. No clutter.</h1><p>Rank the stock, compare the option structures, or tell you to keep your cash when the edge is not there.</p></div>
      <button className="refresh" onClick={scan} disabled={loading}><RefreshCw size={18} className={loading?'spin':''}/>{loading?'Scanning…':'Scan now'}</button>
    </header>

    <nav className="tabs">
      <button className={tab==='today'?'active':''} onClick={()=>setTab('today')}><Zap size={16}/>Today</button>
      <button className={tab==='paper'?'active':''} onClick={()=>setTab('paper')}><History size={16}/>Paper</button>
      <button className={tab==='plan'?'active':''} onClick={()=>setTab('plan')}><LineChart size={16}/>Road to $1M</button>
    </nav>

    {tab==='today'&&<>
      <section className="controls">
        <div className="budget-control"><WalletCards size={18}/><div><span>Max loss on one idea</span><small>The app may use less, never more.</small></div><div className="budget-pills">{[50,100,200,500].map(x=><button key={x} className={budget===x?'active':''} onClick={()=>setBudget(x)}>${x}</button>)}<input value={budget} onChange={e=>setBudget(Math.max(25,Number(e.target.value)||25))}/></div></div>
        <div className="mode-control"><span>Risk style</span><div><button className={mode==='aggressive'?'active':''} onClick={()=>setMode('aggressive')}>Aggressive</button><button className={mode==='balanced'?'active':''} onClick={()=>setMode('balanced')}>Balanced</button></div></div>
      </section>
      <div className="status-line"><span className={`status-dot ${data.regime?.label==='RISK OFF'?'red':''}`}/><b>{data.market}</b><span>{data.regime?.label} · regime {data.regime?.score}/100</span><span>{data.dataQuality?.optionsFeed||'—'} options</span><small>{data.asOf}</small></div>
      {error&&<div className="notice"><AlertTriangle size={18}/>{error}</div>}

      <section className={`decision-card decision-${tone(action)}`}>
        <div className="decision-head"><div><Pill t={tone(action)}><Flame size={13}/>{action}</Pill> <Pill t={p.direction==='BULLISH'?'good':'warn'}>{p.direction}</Pill><div className="ticker"><strong>{p.symbol}</strong><span>{money(p.price)}</span></div><p>{p.setup}</p></div><div className="score"><small>SETUP</small><b>{p.score}</b><span>{p.grade}</span></div></div>
        <div className="do-this"><Target size={22}/><div><span>DO THIS</span><strong>{p.instruction}</strong></div></div>
        <div className="levels"><Stat label="Trigger" value={money(p.entry)}/><Stat label="Invalid beyond" value={money(p.stop)}/><Stat label="Target 1" value={money(p.target1)}/><Stat label="Stretch target" value={money(p.target2)}/></div>
        <div className="signals">{(p.reasons||[]).map(x=><div key={x}><CheckCircle2 size={15}/>{x}</div>)}{(p.warnings||[]).map(x=><div className="warning" key={x}><AlertTriangle size={15}/>{x}</div>)}</div>
      </section>

      <section className="regime-card"><div><Activity size={20}/><span>MARKET GATE</span><strong>{data.regime?.label}</strong></div><p>{data.regime?.detail}</p><Pill t={data.regime?.label==='RISK ON'?'good':data.regime?.label==='RISK OFF'?'bad':'warn'}>{data.regime?.tradeGate}</Pill></section>

      <section className="option-card">
        <div className="section-title"><div><Rocket size={20}/><div><span>BEST QUALIFIED STRUCTURE</span><h2>{o?o.kind:'No option passed'}</h2></div></div>{o&&<Pill t={fits?'good':'bad'}>{o.dte} DTE · Q{o.qualityScore}</Pill>}</div>
        {o?<>
          {o.structure==='LONG'?<div className="ticket"><div><small>BUY</small><b>{p.symbol} {o.expiry} ${o.longStrike}{optionLetter}</b></div></div>:<div className="ticket"><div><small>BUY</small><b>{p.symbol} {o.expiry} ${o.longStrike}{optionLetter}</b></div><ChevronRight/><div><small>SELL</small><b>{p.symbol} {o.expiry} ${o.shortStrike}{optionLetter}</b></div></div>}
          <div className="payoff"><Stat label="Max loss" value={money(o.maxRisk)} sub="Defined risk"/><Stat label="Max profit" value={o.maxProfit==null?'Open-ended':money(o.maxProfit)}/><Stat label="Model P(profit)" value={`${o.probProfit||0}%`} sub="Approximation, not a guarantee"/><Stat label="Breakeven" value={money(o.breakeven)}/></div>
          <div className="greeks"><span>Δ {o.delta}</span><span>IV {Math.round(o.iv*100)}%</span><span>θ {o.theta}/day</span><span>Spread {o.spreadPct}%</span><span>Expected move {money(o.expectedMove)}</span><span>Liquidity {o.liquidityScore}/100</span></div>
          <div className="exit-plan"><div><Clock3 size={16}/><b>Exit plan</b></div><p>{p.exitPlan?.optionTakeProfit}. {p.exitPlan?.timeStop}</p></div>
          <button className="paper-btn" disabled={action!=='TRADE CANDIDATE'} onClick={logPaper}>{action==='TRADE CANDIDATE'?'Paper-track this setup':'Not qualified to paper-track yet'}</button>
        </>:<div className="empty"><ShieldCheck size={24}/><b>Keep the money.</b><span>The option chain failed one or more safety/quality filters.</span></div>}
      </section>

      <section className="news-card"><div className="section-title"><div><BarChart3 size={20}/><div><span>HISTORICAL CHECK</span><h2>{p.validation?.samples||0} similar stock signals</h2></div></div></div><div className="payoff"><Stat label="Win rate" value={p.validation?.winRate==null?'—':`${p.validation.winRate}%`}/><Stat label="Avg 20-day move" value={p.validation?.avgMove==null?'—':`${p.validation.avgMove}%`}/><Stat label="Contracts scanned" value={p.contractsScanned||0}/><Stat label="Options feed" value={data.dataQuality?.optionsFeed||'—'} sub={data.dataQuality?.optionsOfficial?'Official consolidated':'Indicative / modified'}/></div><p className="muted">Historical validation is on the underlying stock signal, not a promise that the option trade will repeat that result.</p></section>

      <section className="news-card"><div className="section-title"><div><Gauge size={20}/><div><span>CATALYST CHECK</span><h2>Recent news risk: {p.news?.risk||'UNKNOWN'}</h2></div></div></div>{p.news?.headlines?.length?<div className="headlines">{p.news.headlines.map(h=><p key={h}>{h}</p>)}</div>:<p className="muted">No recent headlines surfaced in the scanner response.</p>}</section>

      {p.alternatives?.length>0&&<section className="next-card"><div className="section-title"><div><Rocket size={20}/><div><span>STRUCTURE RUNNER-UPS</span><h2>What the engine rejected in favor of #1</h2></div></div></div><div className="watch-grid">{p.alternatives.map((a,i)=><article key={`${a.kind}-${a.expiry}-${a.longStrike}-${a.shortStrike||i}`}><div><Pill t="neutral">#{i+2}</Pill><b>Q{a.qualityScore}</b></div><h3>{a.kind}</h3><p>{a.expiry} · {a.dte} DTE · P(profit) {a.probProfit}%</p><footer><span>Risk {money(a.maxRisk)}</span><strong>{a.returnOnRisk?`${a.returnOnRisk}% max ROR`:'Open upside'}</strong></footer></article>)}</div></section>}

      <section className="next-card"><div className="section-title"><div><TrendingUp size={20}/><div><span>NEXT BEST STOCKS</span><h2>Only the strongest backups</h2></div></div></div><div className="watch-grid">{(data.cards||[]).map(c=><article key={c.symbol}><div><Pill t={c.hasOption?'good':'neutral'}>{c.label}</Pill><b>{c.score}</b></div><h3>{c.symbol} <small>{c.direction}</small></h3><p>{c.tag}</p><footer><span>{money(c.price)}</span><strong>{c.risk} risk</strong></footer></article>)}</div></section>

      <section className="protection-card"><div className="section-title"><div><ShieldCheck size={20}/><div><span>AUTO-PROTECTION</span><h2>Reasons the engine can say “no”</h2></div></div></div><div className="protection-grid">{(data.protection||[]).map(x=><span key={x}><CheckCircle2 size={14}/>{x}</span>)}</div></section>
    </>}

    {tab==='paper'&&<section className="page-card">
      <div className="section-title"><div><BarChart3 size={20}/><div><span>PAPER LAB</span><h2>Prove the scanner before risking real money</h2></div></div></div>
      <div className="paper-stats"><Stat label="Tracked" value={paper.length}/><Stat label="Closed" value={closed.length}/><Stat label="Win rate" value={closed.length?`${Math.round(wins.length/closed.length*100)}%`:'—'}/><Stat label="Avg result" value={closed.length?`${avgResult.toFixed(1)}%`:'—'}/></div>
      {!paper.length?<div className="empty"><History size={24}/><b>No paper setups yet.</b><span>A qualified Today setup can be added with one tap.</span></div>:<div className="paper-list">{paper.map(x=><article key={x.id}><div><b>{x.symbol} · {x.direction||x.option?.side}</b><span>{x.option.kind} · {x.option.longStrike}{x.option.side==='PUT'?'P':'C'}{x.option.shortStrike?` / ${x.option.shortStrike}${x.option.side==='PUT'?'P':'C'}`:''} · {x.option.expiry}</span></div><Pill t={x.status==='OPEN'?'warn':x.resultPct>0?'good':'bad'}>{x.status==='OPEN'?'OPEN':`${x.resultPct}%`}</Pill>{x.status==='OPEN'&&<div className="result-buttons"><button onClick={()=>closePaper(x.id,50)}>+50%</button><button onClick={()=>closePaper(x.id,100)}>+100%</button><button onClick={()=>closePaper(x.id,-50)}>-50%</button><button onClick={()=>closePaper(x.id,-100)}>-100%</button></div>}</article>)}</div>}
    </section>}

    {tab==='plan'&&<section className="page-card">
      <div className="section-title"><div><LineChart size={20}/><div><span>ROAD TO $1M</span><h2>Speed matters. Survival matters more.</h2></div></div></div>
      <div className="plan-inputs"><label>Current investable amount<input type="number" value={account.value} onChange={e=>setAccount({...account,value:Math.max(0,Number(e.target.value))})}/></label><label>Monthly contribution<input type="number" value={account.monthly} onChange={e=>setAccount({...account,monthly:Math.max(0,Number(e.target.value))})}/></label></div>
      <div className="goal-hero"><span>Perfect doublings from here</span><strong>{doubles}</strong><small>Useful math, not a realistic forecast of consecutive wins.</small></div>
      <div className="scenario-grid">{timelines.map(x=><div key={x.rate}><span>{x.rate}% annualized scenario</span><strong>{x.years>=100?'100+ yrs':`${x.years.toFixed(1)} yrs`}</strong><small>with {money(account.monthly)}/mo contributions</small></div>)}</div>
      <div className="wealth-rule"><ShieldCheck size={22}/><div><b>Teststock’s actual job</b><p>Find asymmetric opportunities while preventing one bad trade from destroying the compounding engine. There is no reliable cheap shortcut to $1M.</p></div></div>
    </section>}

    <footer className="disclaimer">Screening and paper-tracking tool only. Options can lose the full amount at risk. Probability estimates are models, not guarantees. Live quotes may be indicative or delayed depending on your Alpaca plan.</footer>
  </main>
}
