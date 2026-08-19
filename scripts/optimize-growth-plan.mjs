import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const dataDir=path.resolve('docs/data');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const WIN=new Set(['TARGET1','TARGET2','MATURED_WIN']);
const LOSS=new Set(['STOP','STOP_GAP','MATURED_LOSS']);
const resolved=x=>WIN.has(x?.status)||LOSS.has(x?.status);

function rr(r){
  const entry=Number(r.entry||0),stop=Number(r.stop||0),target=Number(r.target1||0);
  if(!entry||!stop||!target||entry<=stop||target<=entry)return 0;
  return (target-entry)/(entry-stop);
}
function expectancy(r){
  const ratio=rr(r),win=clamp(Number(r.validation?.winRate||0)/100,0,1),samples=Number(r.validation?.samples||0);
  if(!ratio||!samples)return {expectedR:null,conservativeExpectedR:null};
  const raw=(win*ratio)-((1-win)*1);
  const shrink=Math.min(1,samples/30);
  const conservativeWin=.5+(win-.5)*shrink;
  const conservative=(conservativeWin*ratio)-((1-conservativeWin)*1);
  return {expectedR:round(raw,2),conservativeExpectedR:round(conservative,2)};
}
function adaptiveSymbolStats(history,symbol){
  const rows=history.filter(x=>x.symbol===symbol&&resolved(x)).slice(-30);
  const wins=rows.filter(x=>WIN.has(x.status)).length;
  const losses=rows.filter(x=>LOSS.has(x.status)).length;
  const winRate=rows.length?round(wins/rows.length*100,1):null;
  let sizeMultiplier=1,qualityAdjustment=0,label='UNPROVEN';
  if(rows.length>=6){
    if(winRate<35){sizeMultiplier=.5;qualityAdjustment=-10;label='COLD';}
    else if(winRate<45){sizeMultiplier=.7;qualityAdjustment=-6;label='WEAK';}
    else if(winRate<52){sizeMultiplier=.85;qualityAdjustment=-3;label='MIXED';}
    else if(rows.length>=10&&winRate>=65){sizeMultiplier=1.05;qualityAdjustment=2;label='HOT_CONFIRMED';}
    else label='NORMAL';
  }
  return {samples:rows.length,wins,losses,winRate,sizeMultiplier,qualityAdjustment,label};
}
function quality(r,data,adaptive){
  const score=Number(r.score||0),win=Number(r.validation?.winRate||50),samples=Number(r.validation?.samples||0),exp=expectancy(r);
  const fund=r.fundamentals?.label||'';
  let q=score;
  q+=clamp((win-50)*.3,-7,7);
  if(samples>=25)q+=4; else if(samples>=15)q+=2; else if(samples<10)q-=6;
  const ratio=rr(r); if(ratio>=3)q+=7; else if(ratio>=2.5)q+=4; else if(ratio<2)q-=10;
  if(exp.conservativeExpectedR!=null){if(exp.conservativeExpectedR>=1)q+=7;else if(exp.conservativeExpectedR>=.6)q+=4;else if(exp.conservativeExpectedR<.25)q-=10;}
  if(fund==='STRONG')q+=3; else if(fund==='WEAK')q-=6;
  if(data.regime?.tradeGate==='TRADE')q+=3;
  if(data.learning?.sector?.confirm===false)q-=7;
  if(data.learning?.intraday?.confirm===false)q-=7;
  q+=Number(adaptive?.qualityAdjustment||0);
  return Math.round(clamp(q,0,100));
}
function recentOutcomeGuard(history){
  const done=history.filter(resolved).slice(-20);
  let streak=0; for(let i=done.length-1;i>=0;i--){if(LOSS.has(done[i].status))streak++;else break;}
  const wins=done.filter(x=>WIN.has(x.status)).length;
  const losses=done.filter(x=>LOSS.has(x.status)).length;
  const recentWinRate=done.length?round(wins/done.length*100,1):null;
  const sampleFailure=done.length>=8&&recentWinRate<40;
  const weakWindow=done.length>=6&&recentWinRate<45;
  const pause=streak>=4||sampleFailure;
  const stocksOnly=!pause&&(streak>=3||(done.length>=8&&recentWinRate<48));
  const reduce=!pause&&!stocksOnly&&(streak>=2||weakWindow);
  const cooldown=pause?'PAUSE_NEW_TRADES':stocksOnly?'STOCKS_ONLY':reduce?'REDUCE_SIZE':'NORMAL';
  const sizeMultiplier=pause?0:stocksOnly?.4:reduce?.65:1;
  return {
    resolvedSample:done.length,recentWins:wins,recentLosses:losses,recentWinRate,consecutiveLosses:streak,
    optionsLocked:pause||stocksOnly,
    cooldown,sizeMultiplier,
    reason:sampleFailure?'Recent resolved win rate fell below 40%; pause new trades.':streak>=4?'Four consecutive tracked losses; pause new trades.':stocksOnly?'Loss guard requires stocks/cash only.':reduce?'Loss guard reduced new position size.':'Normal risk mode.'
  };
}
function optionGate(data,budget,best,guard){
  const o=data.featured?.option;
  const learning=Number(data.featured?.learningScore??data.learning?.score??0);
  const win=Number(best?.validation?.winRate||0),samples=Number(best?.validation?.samples||0),exp=best?.expectancy||{};
  const maxRisk=Number(o?.maxRisk||0),ratio=rr(best||{});
  let dte=null; if(o?.expiry){const t=new Date(o.expiry+'T20:00:00Z').getTime()-Date.now();dte=Math.round(t/86400000);}
  const maxOptionRisk=round(Math.min(budget*.08,20));
  const adaptive=best?.adaptivePerformance||{};
  const checks={
    exists:!!o,
    tradeCandidate:data.action==='TRADE CANDIDATE',
    bullish:best?.direction==='BULLISH',
    quality:Number(best?.growthQuality||0)>=96,
    learning:learning>=92,
    historical:samples>=20&&win>=60,
    expectancy:Number(exp.conservativeExpectedR||0)>=.8,
    rewardRisk:ratio>=3,
    market:data.regime?.tradeGate==='TRADE'&&data.regime?.bias==='BULLISH',
    sector:data.learning?.sector?.confirm===true,
    intraday:data.learning?.intraday?.confirm===true,
    adaptive:adaptive.label!=='COLD'&&adaptive.label!=='WEAK',
    definedRisk:maxRisk>0&&maxRisk<=maxOptionRisk,
    dte:dte==null||(dte>=30&&dte<=75),
    lossGuard:!guard.optionsLocked&&guard.cooldown!=='PAUSE_NEW_TRADES'
  };
  const passed=Object.values(checks).every(Boolean);
  return {passed,label:passed?'ELITE OPTION':'NO OPTION',maxOptionRiskDollars:maxOptionRisk,dte,checks,contract:passed?o:null};
}

const history=await read(path.join(dataDir,'trade-history.json'),[]);
const guard=recentOutcomeGuard(history);
for(const budget of budgets){
  const data=await read(path.join(dataDir,`latest-${budget}.json`));
  if(!data||data.error){await fs.writeFile(path.join(dataDir,`growth-plan-${budget}.json`),JSON.stringify({budget,error:data?.error||'No scan'},null,2));continue;}
  const ranked=(data.recommendations||[]).map(r=>{
    const exp=expectancy(r),adaptive=adaptiveSymbolStats(history,r.symbol);
    const row={...r,rewardRisk:round(rr(r),2),expectancy:exp,adaptivePerformance:adaptive};
    row.growthQuality=quality(row,data,adaptive);
    return row;
  }).sort((a,b)=>b.growthQuality-a.growthQuality||Number(b.expectancy?.conservativeExpectedR||-99)-Number(a.expectancy?.conservativeExpectedR||-99)||b.rewardRisk-a.rewardRisk||b.score-a.score);

  const eligible=ranked.filter(r=>
    r.direction==='BULLISH' &&
    r.growthQuality>=90 &&
    r.rewardRisk>=2.5 &&
    Number(r.expectancy?.conservativeExpectedR||0)>=.5 &&
    Number(r.validation?.samples||0)>=15 &&
    Number(r.validation?.winRate||0)>=52 &&
    r.adaptivePerformance?.label!=='COLD' &&
    data.learning?.sector?.confirm!==false &&
    data.learning?.intraday?.confirm!==false
  ).slice(0,2);

  const maxPortfolioStop=budget*.03;
  const sizeMultiplier=guard.sizeMultiplier;
  let remainingBudget=budget,remainingRisk=maxPortfolioStop;
  const allocations=[];
  if(guard.cooldown!=='PAUSE_NEW_TRADES'){
    for(const r of eligible){
      const entry=Number(r.entry||0),stop=Number(r.stop||0),riskPct=entry>stop?(entry-stop)/entry:1;
      if(!entry||riskPct<=0||riskPct>.15)continue;
      const desired=eligible.length===1?budget*.75:budget*(r.growthQuality>=96?.45:.3);
      const byRisk=remainingRisk/riskPct;
      const adaptiveSize=clamp(Number(r.adaptivePerformance?.sizeMultiplier||1),.5,1.05);
      const amount=round(Math.max(0,Math.min(remainingBudget,desired*sizeMultiplier*adaptiveSize,byRisk)));
      if(amount<Math.min(5,budget*.05))continue;
      const stopRisk=round(amount*riskPct);
      allocations.push({...r,allocationDollars:amount,estimatedSharesAtEntry:round(amount/entry,6),estimatedLossAtStop:stopRisk});
      remainingBudget=round(remainingBudget-amount); remainingRisk=round(remainingRisk-stopRisk);
      if(remainingBudget<=1||remainingRisk<=.25)break;
    }
  }
  const best=allocations[0]||eligible[0]||ranked[0]||null;
  const option=optionGate(data,budget,best,guard);
  const plan={
    schemaVersion:3,generatedAt:new Date().toISOString(),asOf:data.asOf,budget,market:data.market,session:data.session,regime:data.regime,dataQuality:data.dataQuality,
    objective:'Aggressive selective compounding with conservative expectancy, adaptive performance, and capital-preservation gates; no return is guaranteed.',
    policy:{maxPlannedPortfolioStopPct:3,maxOptionPremiumPct:8,maxConcurrentNewPositions:2,noMargin:true,noAverageDown:true,noNakedOptions:true,noChasingPct:2,optionsRequireEliteGate:true,minRewardRisk:2.5,minHistoricalSamples:15,minHistoricalWinRate:52,minConservativeExpectedR:.5},
    outcomeGuard:guard,
    action:data.action,
    confidence:allocations.length&&allocations[0].growthQuality>=96?'A_PLUS':allocations.length?'A':'CASH',
    ranked:ranked.slice(0,5),allocations,keepCashDollars:round(remainingBudget),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+x.estimatedLossAtStop,0)),
    eliteOption:option,
    reasons:allocations.length?[
      'Capital is assigned only to bullish setups with at least 2.5:1 first-target reward/risk and positive conservative historical expectancy.',
      'Resolved Teststock outcomes can reduce or slightly increase sizing for a symbol, but never override a failed quality gate.',
      'At most two new stock positions are selected and planned stock stop risk is capped near 3% of the reference sleeve before live-account limits.',
      'Loss streaks and a weak recent resolved win-rate window automatically reduce size, lock options, or pause new trades.',
      'Options are capped near 8% of the reference sleeve and require a stricter A+ gate; otherwise stocks or cash are used.'
    ]:[guard.cooldown==='PAUSE_NEW_TRADES'?guard.reason:'No setup cleared the stricter expectancy, adaptive-performance, and risk gates; cash is the selected position.']
  };
  await fs.writeFile(path.join(dataDir,`growth-plan-${budget}.json`),JSON.stringify(plan,null,2));
  console.log(`Growth $${budget}: ${allocations.map(x=>`${x.symbol} $${x.allocationDollars} expR ${x.expectancy?.conservativeExpectedR} ${x.adaptivePerformance?.label}`).join(', ')||'CASH'} | option ${option.label} | guard ${guard.cooldown}`);
}
