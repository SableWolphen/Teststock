// Planning arithmetic only. This module has no connection to sizing or execution.
export const DEFAULT_PLAN = Object.freeze({capital:76.21, contribution:0, monthlyIncome:10000, months:24, annualReturn:5, withdrawalRate:4, inflation:2.5});
const limits = {capital:[0,1e9],contribution:[0,1e7],monthlyIncome:[1,1e7],months:[12,24],annualReturn:[-50,20],withdrawalRate:[1,10],inflation:[0,20]};
export function validatePlan(input) {
  const plan={...DEFAULT_PLAN,...input};
  for(const [key,[min,max]] of Object.entries(limits)) {
    if(typeof plan[key]!=='number'||!Number.isFinite(plan[key])||plan[key]<min||plan[key]>max) throw Error(`Invalid ${key}: use ${min}–${max}`);
  }
  if(![12,24].includes(plan.months)) throw Error('Choose 12 or 24 months');
  return plan;
}
export function futureValue(capital,contribution,annualReturn,months) {
  const rate=Math.expm1(Math.log1p(annualReturn/100)/12);
  const growth=(1+rate)**months;
  const annuity=Math.abs(rate)<1e-12?months:Math.expm1(months*Math.log1p(rate))/rate;
  return {value:capital*growth+contribution*annuity,annuity,growth};
}
export function projectPlan(input) {
  const p=validatePlan(input);
  const incomeAtDeadline=p.monthlyIncome*(1+p.inflation/100)**(p.months/12);
  const requiredCapital=incomeAtDeadline*12/(p.withdrawalRate/100);
  const targetToday=p.monthlyIncome*12/(p.withdrawalRate/100);
  const projected=futureValue(p.capital,p.contribution,p.annualReturn,p.months);
  const deposits=p.contribution*p.months;
  const scenarios=[-20,0,4,7].map(annualReturn=>({annualReturn,...futureValue(p.capital,p.contribution,annualReturn,p.months)}));
  const milestones=[1000,10000,100000,1000000,requiredCapital].filter((x,i,a)=>a.indexOf(x)===i).sort((a,b)=>a-b).map(capital=>({capital,achieved:p.capital>=capital,projected:projected.value>=capital,monthlyIncome:capital*p.withdrawalRate/100/12}));
  return {...p,targetToday,incomeAtDeadline,requiredCapital,projectedCapital:projected.value,deposits,modeledGrowth:projected.value-p.capital-deposits,
    gap:Math.max(0,requiredCapital-projected.value),progress:Math.min(100,p.capital/requiredCapital*100),
    requiredContribution:Math.max(0,(requiredCapital-p.capital*projected.growth)/projected.annuity),
    monthlyCapacity:projected.value*p.withdrawalRate/100/12,
    zeroReturnRunwayMonths:Math.floor(projected.value/incomeAtDeadline),scenarios,milestones};
}
export function summarizeJournal(journal,now=Date.now()) {
  if(!journal||!Array.isArray(journal.trades)) return {available:false};
  const counts=new Map();
  for(const t of journal.trades) if(t?.journalId) counts.set(t.journalId,(counts.get(t.journalId)||0)+1);
  const confirmed=journal.trades.filter(t=>t&&t.journalId&&counts.get(t.journalId)===1&&t.reconciledFromRobinhood===true);
  const closed=confirmed.filter(t=>Number.isFinite(Date.parse(t.finalExitAt)));
  const classified=closed.filter(t=>['WIN','LOSS','FLAT'].includes(t.outcome));
  const dollars=classified.filter(t=>typeof t.realizedPnlDollars==='number'&&Number.isFinite(t.realizedPnlDollars));
  const age=now-Date.parse(journal.lastReconciledAt);
  return {available:true,asOf:journal.lastReconciledAt||null,stale:!Number.isFinite(age)||age<0||age>86400000,
    confirmed:confirmed.length,closed:closed.length,classified:classified.length,dollarCoverage:dollars.length,
    knownPnl:dollars.length?dollars.reduce((s,t)=>s+t.realizedPnlDollars,0):null,
    totalPnl:closed.length&&dollars.length===closed.length?dollars.reduce((s,t)=>s+t.realizedPnlDollars,0):null,
    excludedDuplicateRows:journal.trades.filter(t=>t?.journalId&&counts.get(t.journalId)>1).length};
}
