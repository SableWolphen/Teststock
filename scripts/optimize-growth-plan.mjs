import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const dataDir=path.resolve('docs/data');
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};

function rr(r){
  const entry=Number(r.entry||0),stop=Number(r.stop||0),target=Number(r.target1||0);
  if(!entry||!stop||!target||entry<=stop||target<=entry)return 0;
  return (target-entry)/(entry-stop);
}
function quality(r,data){
  const score=Number(r.score||0),win=Number(r.validation?.winRate||50),samples=Number(r.validation?.samples||0);
  const fund=r.fundamentals?.label||'';
  let q=score;
  q+=clamp((win-50)*.35,-8,8);
  if(samples>=15)q+=2; else if(samples<8)q-=3;
  const ratio=rr(r); if(ratio>=3)q+=6; else if(ratio>=2.25)q+=3; else if(ratio<1.7)q-=8;
  if(fund==='STRONG')q+=3; else if(fund==='WEAK')q-=5;
  if(data.regime?.tradeGate==='TRADE')q+=3;
  if(data.learning?.sector?.confirm===false)q-=6;
  if(data.learning?.intraday?.confirm===false)q-=5;
  return Math.round(clamp(q,0,100));
}
function recentOutcomeGuard(history){
  const done=history.filter(x=>x.status&&x.status!=='OPEN'&&x.status!=='AMBIGUOUS').slice(-12);
  let streak=0; for(let i=done.length-1;i>=0;i--){if(['STOP','STOP_GAP','MATURED_LOSS'].includes(done[i].status))streak++;else break;}
  const wins=done.filter(x=>['TARGET1','TARGET2','MATURED_WIN'].includes(x.status)).length;
  const losses=done.filter(x=>['STOP','STOP_GAP','MATURED_LOSS'].includes(x.status)).length;
  return {resolvedSample:done.length,recentWins:wins,recentLosses:losses,consecutiveLosses:streak,optionsLocked:streak>=3,sizeMultiplier:streak>=4?.35:streak===3?.5:streak===2?.75:1};
}
function optionGate(data,budget,best,guard){
  const o=data.featured?.option;
  const learning=Number(data.featured?.learningScore??data.learning?.score??0);
  const win=Number(best?.validation?.winRate||0),samples=Number(best?.validation?.samples||0);
  const maxRisk=Number(o?.maxRisk||0),ratio=rr(best||{});
  let dte=null; if(o?.expiry){const t=new Date(o.expiry+'T20:00:00Z').getTime()-Date.now();dte=Math.round(t/86400000);}
  const maxOptionRisk=round(Math.min(budget*.12,25));
  const checks={
    exists:!!o,
    tradeCandidate:data.action==='TRADE CANDIDATE',
    bullish:best?.direction==='BULLISH',
    quality:Number(best?.growthQuality||0)>=94,
    learning:learning>=90,
    historical:samples>=15&&win>=58,
    rewardRisk:ratio>=2.5,
    market:data.regime?.tradeGate==='TRADE'&&data.regime?.bias==='BULLISH',
    sector:data.learning?.sector?.confirm!==false,
    intraday:data.learning?.intraday?.confirm===true,
    definedRisk:maxRisk>0&&maxRisk<=maxOptionRisk,
    dte:dte==null||(dte>=30&&dte<=90),
    lossGuard:!guard.optionsLocked
  };
  const passed=Object.values(checks).every(Boolean);
  return {passed,label:passed?'ELITE OPTION':'NO OPTION',maxOptionRiskDollars:maxOptionRisk,dte,checks,contract:passed?o:null};
}

const history=await read(path.join(dataDir,'trade-history.json'),[]);
const guard=recentOutcomeGuard(history);
for(const budget of budgets){
  const data=await read(path.join(dataDir,`latest-${budget}.json`));
  if(!data||data.error){await fs.writeFile(path.join(dataDir,`growth-plan-${budget}.json`),JSON.stringify({budget,error:data?.error||'No scan'},null,2));continue;}
  const ranked=(data.recommendations||[]).map(r=>({...r,rewardRisk:round(rr(r),2),growthQuality:quality(r,data)})).sort((a,b)=>b.growthQuality-a.growthQuality||b.rewardRisk-a.rewardRisk||b.score-a.score);
  const eligible=ranked.filter(r=>r.direction==='BULLISH'&&r.growthQuality>=86&&r.rewardRisk>=2&&Number(r.validation?.samples||0)>=8&&Number(r.validation?.winRate||0)>=50).slice(0,3);
  const maxPortfolioStop=budget*.05;
  const sizeMultiplier=guard.sizeMultiplier;
  let remainingBudget=budget,remainingRisk=maxPortfolioStop;
  const allocations=[];
  for(const r of eligible){
    const entry=Number(r.entry||0),stop=Number(r.stop||0),riskPct=entry>stop?(entry-stop)/entry:1;
    if(!entry||riskPct<=0||riskPct>.2)continue;
    const desired=eligible.length===1?budget:budget*(r.growthQuality>=94?.55:.4);
    const byRisk=remainingRisk/riskPct;
    const amount=round(Math.max(0,Math.min(remainingBudget,desired*sizeMultiplier,byRisk)));
    if(amount<Math.min(5,budget*.05))continue;
    const stopRisk=round(amount*riskPct);
    allocations.push({...r,allocationDollars:amount,estimatedSharesAtEntry:round(amount/entry,6),estimatedLossAtStop:stopRisk});
    remainingBudget=round(remainingBudget-amount); remainingRisk=round(remainingRisk-stopRisk);
    if(remainingBudget<=1||remainingRisk<=.25)break;
  }
  const best=allocations[0]||eligible[0]||ranked[0]||null;
  const option=optionGate(data,budget,best,guard);
  const plan={
    schemaVersion:1,generatedAt:new Date().toISOString(),asOf:data.asOf,budget,market:data.market,session:data.session,regime:data.regime,dataQuality:data.dataQuality,
    objective:'Aggressive growth with capital preservation gates; no return is guaranteed.',
    policy:{maxPlannedPortfolioStopPct:5,maxOptionPremiumPct:12,noMargin:true,noAverageDown:true,noNakedOptions:true,noChasingPct:2,optionsRequireEliteGate:true},
    outcomeGuard:guard,
    action:data.action,
    confidence:allocations.length&&allocations[0].growthQuality>=94?'ELITE':allocations.length?'STRONG':'CASH',
    ranked:ranked.slice(0,5),allocations,keepCashDollars:round(remainingBudget),estimatedPortfolioStopLoss:round(allocations.reduce((s,x)=>s+x.estimatedLossAtStop,0)),
    eliteOption:option,
    reasons:allocations.length?['Only high-quality bullish setups with at least 2:1 first-target reward/risk receive capital.','Position sizes are cut automatically after consecutive tracked losses.','Options stay locked unless every elite gate passes.']:['No setup cleared the growth and risk gates; cash is the selected position.']
  };
  await fs.writeFile(path.join(dataDir,`growth-plan-${budget}.json`),JSON.stringify(plan,null,2));
  console.log(`Growth $${budget}: ${allocations.map(x=>`${x.symbol} $${x.allocationDollars}`).join(', ')||'CASH'} | option ${option.label}`);
}
