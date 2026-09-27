import fs from 'node:fs/promises';
const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const [daily,intraday,adaptive,exitValidation,options,correlation]=await Promise.all([
 read('docs/data/web-market-history-learning.json'),read('docs/data/intraday-history-learning.json'),read('docs/data/adaptive-performance.json'),read('docs/data/exit-policy-validation.json'),read('docs/data/options-shadow-trades.json'),read('docs/data/portfolio-correlation.json')
]);
const minSamples=50;
const intradayPatterns=Object.entries(intraday.patterns||{}).filter(([,x])=>Number(x.samples)>=minSamples).map(([key,x])=>({key,...x})).sort((a,b)=>Number(b.avgForward30mPct)-Number(a.avgForward30mPct));
const strong=intradayPatterns.filter(x=>x.avgForward30mPct>0&&x.hitRatePct>=52).slice(0,10);
const weak=[...intradayPatterns].reverse().filter(x=>x.avgForward30mPct<0&&x.hitRatePct<=48).slice(0,10);
const out={schemaVersion:1,generatedAt:new Date().toISOString(),authority:'RESEARCH_AND_THROTTLE_ONLY',evidence:{daily:{generatedAt:daily.generatedAt||null,coverage:daily.coverage||null},intraday:{generatedAt:intraday.generatedAt||null,coverage:intraday.coverage||null},realFills:{generatedAt:adaptive.generatedAt||null,resolvedTrades:adaptive.resolvedTrades??adaptive.sampleCount??null},optionsShadow:{generatedAt:options.generatedAt||null,summary:options.summary||null},exitValidation:{generatedAt:exitValidation.generatedAt||null,recommendedPolicy:exitValidation.recommendedPolicy||null},correlation:{generatedAt:correlation.generatedAt||null,status:correlation.status||null}},researchSignals:{strongIntradayPatterns:strong,weakIntradayPatterns:weak},promotionRules:{historicalMayRank:true,historicalMayReduceRisk:true,historicalMayIncreaseRisk:false,forwardEvidenceRequiredForPromotion:true,realFillEvidenceRequiredForFullSize:true,negativeRealFillExpectancyMayThrottleOrSuspend:true,noForcedTrades:true},objective:'Improve after-cost expectancy and capital efficiency, not trade count. Prefer cash over unproven edge.'};
await fs.writeFile('docs/data/learning-consensus.json',JSON.stringify(out,null,2));
console.log(`Learning consensus: strong=${strong.length}, weak=${weak.length}`);
