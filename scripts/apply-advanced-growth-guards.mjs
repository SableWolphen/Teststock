import fs from 'node:fs/promises';
import path from 'node:path';

const budgets=[50,100,200,500];
const dataDir=path.resolve('docs/data');
const read=async(f,x=null)=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const round=(n,d=2)=>Number(Number(n||0).toFixed(d));
const daysUntil=date=>{if(!date)return null;const t=new Date(`${date}T20:00:00Z`).getTime();if(!Number.isFinite(t))return null;return Math.ceil((t-Date.now())/86400000);};

function inferRegime(data){
  const label=String(data?.regime?.label||'').toUpperCase();
  const bias=String(data?.regime?.bias||'').toUpperCase();
  const detail=String(data?.regime?.detail||'').toUpperCase();
  if(label.includes('CALM')||detail.includes('CALM'))return 'CALM';
  if(label.includes('RISK OFF')||bias==='BEARISH')return 'TRENDING_DOWN';
  if(label.includes('RISK ON')||bias==='BULLISH')return 'TRENDING_UP';
  if(label.includes('MIXED'))return 'MIXED';
  if(detail.includes('VOLAT'))return 'VOLATILE';
  return 'UNKNOWN';
}
function eventGuard(row){
  const days=daysUntil(row?.fundamentals?.estimatedNextReport);
  const corp=String(row?.corporateActions?.risk||'UNKNOWN').toUpperCase();
  const reasons=[];
  let stockBlocked=false,optionBlocked=false;
  if(corp==='HIGH'){stockBlocked=true;optionBlocked=true;reasons.push('High corporate-action risk');}
  if(days!=null&&days>=-1&&days<=3){stockBlocked=true;reasons.push(`Estimated earnings/filing window is ${days} day(s) away`);}
  if(days!=null&&days>=-1&&days<=7){optionBlocked=true;reasons.push(`Option blackout around estimated earnings/filing window (${days} day(s))`);}
  return {stockBlocked,optionBlocked,daysToEstimatedReport:days,corporateActionRisk:corp,reasons};
}

const validation=await read(path.join(dataDir,'entry-gate-validation.json'),{});
for(const budget of budgets){
  const planFile=path.join(dataDir,`growth-plan-${budget}.json`),latestFile=path.join(dataDir,`latest-${budget}.json`);
  const plan=await read(planFile),latest=await read(latestFile);
  if(!plan||plan.error||!latest)continue;
  const runtimeRegime=inferRegime(latest);
  const disabled=new Set(validation?.disabledRegimes||[]);
  const fallback=disabled.has(runtimeRegime)?{samplesPrimary:0,samplesSecond:0,allowNewStocks:false,allowOptions:false,stockSizeMultiplier:0,status:'BLOCK_NONVIABLE',reason:`${runtimeRegime} is disabled by entry-gate validation.`}:{samplesPrimary:0,samplesSecond:0,allowNewStocks:true,allowOptions:false,stockSizeMultiplier:.5,status:'UNKNOWN_REDUCE',reason:'Current regime could not be matched to a sufficiently validated holdout bucket.'};
  const policy=validation?.runtimePolicy?.[runtimeRegime]||fallback;
  const ranked=plan.ranked||[];
  const eventBySymbol=Object.fromEntries(ranked.map(r=>[r.symbol,eventGuard(r)]));
  const blockedSymbols=[];
  const adjusted=[];
  for(const row of plan.allocations||[]){
    const ev=eventBySymbol[row.symbol]||eventGuard(row);
    if(!policy.allowNewStocks||ev.stockBlocked){blockedSymbols.push({symbol:row.symbol,reasons:[...(!policy.allowNewStocks?[policy.reason]:[]),...ev.reasons]});continue;}
    const multiplier=Math.max(0,Math.min(1,Number(policy.stockSizeMultiplier??.5)));
    const amount=round(Number(row.allocationDollars||0)*multiplier);
    const entry=Number(row.entry||0),stop=Number(row.stop||0),riskPct=entry>stop?(entry-stop)/entry:0;
    if(amount<=0)continue;
    adjusted.push({...row,allocationDollars:amount,estimatedSharesAtEntry:entry?round(amount/entry,6):0,estimatedLossAtStop:round(amount*riskPct),advancedGuardSizeMultiplier:multiplier});
  }
  let eliteOption=plan.eliteOption;
  if(eliteOption?.passed){
    const symbol=eliteOption?.contract?.symbol||adjusted[0]?.symbol||plan.allocations?.[0]?.symbol||ranked[0]?.symbol;
    const ev=eventBySymbol[symbol]||eventGuard(ranked.find(x=>x.symbol===symbol));
    if(!policy.allowOptions||ev.optionBlocked){eliteOption={...eliteOption,passed:false,label:'NO OPTION',contract:null,checks:{...(eliteOption.checks||{}),holdoutRegime:!!policy.allowOptions,eventBlackout:!ev.optionBlocked},advancedBlockReason:!policy.allowOptions?policy.reason:ev.reasons.join('; ')};}
  }
  const rejectedCandidates=ranked.slice(0,5).filter(r=>!adjusted.some(a=>a.symbol===r.symbol)).map(r=>{const ev=eventBySymbol[r.symbol]||eventGuard(r);const reasons=[];if(!policy.allowNewStocks)reasons.push(`Regime ${runtimeRegime}: ${policy.reason}`);if(ev.stockBlocked)reasons.push(...ev.reasons);if(!reasons.length)reasons.push('Did not clear one or more stock eligibility/position-sizing gates');return {symbol:r.symbol,entry:r.entry,stop:r.stop,target1:r.target1,target2:r.target2,rewardRisk:r.rewardRisk,growthQuality:r.growthQuality,reasons};});
  const remaining=round(budget-adjusted.reduce((s,x)=>s+Number(x.allocationDollars||0),0));
  const next={...plan,schemaVersion:6,policy:{...(plan.policy||{}),holdoutValidationRequired:true,eventRiskPolicy:{stockBlackoutDaysBeforeEstimatedReport:3,optionBlackoutDaysBeforeEstimatedReport:7,blackoutThroughOneDayAfter:true,highCorporateActionRiskBlocksEntry:true},runtimeRegimePolicy:{regime:runtimeRegime,...policy},disabledRegimes:[...(validation?.disabledRegimes||[])],validationScope:'REGIME_SPECIFIC_NOT_SYSTEM_WIDE'},allocations:adjusted,keepCashDollars:Math.max(0,remaining),estimatedPortfolioStopLoss:round(adjusted.reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0)),eliteOption,advancedGuards:{entryGateValidationStatus:validation?.status||'UNKNOWN',systemWideStockPause:false,validationScope:'REGIME_SPECIFIC',runtimeRegime,regimePolicy:policy,calmRetuning:runtimeRegime==='CALM'?validation?.calmRetuning||null:null,researchPriority:validation?.researchPriority||[],eventBySymbol,blockedSymbols,rejectedCandidates,automaticLooseningAllowed:false,note:'The overall validation status is diagnostic and must not freeze unrelated stock regimes. Block or reduce only the CURRENT runtime regime according to runtimePolicy. MIXED is disabled. CALM remains blocked when its own holdouts fail. Sparse regimes stay reduced. TRENDING_UP stays eligible when its own policy allows it.'}};
  await fs.writeFile(planFile,JSON.stringify(next,null,2));
  console.log(`Advanced guards $${budget}: ${runtimeRegime} ${policy.status}; allocations ${adjusted.length}; blocked ${blockedSymbols.length}; globalPause=false`);
}
