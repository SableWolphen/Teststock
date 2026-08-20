import fs from 'node:fs/promises';

for(const budget of [50,100,200,500]){
  const file=`docs/data/growth-plan-${budget}.json`;let plan;try{plan=JSON.parse(await fs.readFile(file,'utf8'));}catch{continue;}
  for(const row of plan.ranked||[]){if(row.adaptivePerformance){row.adaptivePerformance.modelReportedSizeMultiplier=row.adaptivePerformance.sizeMultiplier;row.adaptivePerformance.sizeMultiplier=Math.min(1,Number(row.adaptivePerformance.sizeMultiplier||1));row.adaptivePerformance.canIncreaseLiveSize=false;row.adaptivePerformance.note='Scanner/model history may rank or reduce risk, but may never increase live size. Only confirmed Robinhood real-fill evidence can participate in future risk scaling.';}}
  for(const row of plan.allocations||[]){const old=Math.max(1,Number(row.adaptivePerformance?.modelReportedSizeMultiplier??row.adaptivePerformance?.sizeMultiplier??1));if(row.adaptivePerformance){row.adaptivePerformance.modelReportedSizeMultiplier=old;row.adaptivePerformance.sizeMultiplier=Math.min(1,Number(row.adaptivePerformance.sizeMultiplier||1));row.adaptivePerformance.canIncreaseLiveSize=false;}if(old>1){row.allocationDollars=Number((Number(row.allocationDollars||0)/old).toFixed(2));row.estimatedSharesAtEntry=Number((Number(row.allocationDollars||0)/Number(row.entry||1)).toFixed(6));row.estimatedLossAtStop=Number((Number(row.allocationDollars||0)*Math.max(0,(Number(row.entry||0)-Number(row.stop||0))/Number(row.entry||1))).toFixed(2));}}
  plan.policy={...(plan.policy||{}),modelHistoryCanIncreaseLiveSize:false,liveSizeIncreaseAuthority:'CONFIRMED_ROBINHOOD_REAL_FILLS_ONLY'};
  plan.keepCashDollars=Number((budget-(plan.allocations||[]).reduce((s,x)=>s+Number(x.allocationDollars||0),0)).toFixed(2));
  plan.estimatedPortfolioStopLoss=Number((plan.allocations||[]).reduce((s,x)=>s+Number(x.estimatedLossAtStop||0),0).toFixed(2));
  await fs.writeFile(file,JSON.stringify(plan,null,2));
}
console.log('Model sizing lock applied: research history cannot increase live allocation.');
