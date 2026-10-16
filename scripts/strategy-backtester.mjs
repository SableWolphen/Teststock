import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {evaluateResearchTrade,rankStrategyResults,STRATEGIES} from './strategy-library.mjs';
export function backtest(bars,{strategyId,initialCash=1000,allocation=0.1,feePerTrade=0,slippageBps=10,stopPct=.02,targetPct=.04}={}){
 if(!STRATEGIES.some(s=>s.id===strategyId))throw new Error('UNKNOWN_STRATEGY');
 if(!Array.isArray(bars)||bars.length<40)throw new Error('AT_LEAST_40_BARS_REQUIRED');
 if(!bars.every(b=>Number.isFinite(Date.parse(b.time))&&[b.open,b.high,b.low,b.close,b.volume,b.vwap].every(x=>Number.isFinite(Number(x))&&Number(x)>0)))throw new Error('INVALID_BARS');
 if(bars.some((b,i)=>i&&Date.parse(b.time)<=Date.parse(bars[i-1].time)))throw new Error('BARS_MUST_BE_CHRONOLOGICAL');
 let cash=initialCash,peak=cash,maxDrawdownPct=0,position=null,wins=0,grossProfit=0,grossLoss=0,fees=0,slippage=0;const trades=[];
 for(let i=30;i<bars.length;i++){
  const b=bars[i],prior=bars.slice(0,i),price=Number(b.open);
  // Signals are generated on the PREVIOUS completed bar; execution uses this bar's open.
  const relativeVolume=Number(prior.at(-1).volume)/(prior.slice(-21,-1).reduce((s,x)=>s+Number(x.volume),0)/20);
  const signal=evaluateResearchTrade({strategyId,bars:prior,relativeVolume,newsCatalyst:prior.at(-1).newsCatalyst===true});
  if(position){
   const stop=position.entry*(1-stopPct),target=position.entry*(1+targetPct);
   // Conservative when both intrabar thresholds are hit: assume stop first.
   const exit=Number(b.open)<=stop?Number(b.open):Number(b.low)<=stop?stop:Number(b.high)>=target?target:i===bars.length-1?Number(b.close):null;
   if(exit!==null){
    const executionExit=exit*(1-slippageBps/10000),gross=(exit-position.entry)*position.qty,net=(executionExit-position.entryFill)*position.qty-2*feePerTrade;
    grossProfit+=Math.max(0,gross);grossLoss+=Math.max(0,-gross);slippage+=(position.entryFill-position.entry)*position.qty+(exit-executionExit)*position.qty;fees+=2*feePerTrade;cash+=net;if(net>0)wins++;
    trades.push({entryTime:position.time,exitTime:b.time,entry:position.entryFill,exit:executionExit,quantity:position.qty,net});position=null;
   }
  }
  if(!position&&i<bars.length-1&&signal.signal==='LONG_RESEARCH'){
   const entryFill=price*(1+slippageBps/10000),qty=Math.floor(cash*allocation/entryFill);
   if(qty>0&&cash>=qty*entryFill+2*feePerTrade)position={entry:price,entryFill,qty,time:b.time};
  }
  peak=Math.max(peak,cash);maxDrawdownPct=Math.max(maxDrawdownPct,(peak-cash)/peak*100);
 }
 return {strategyId,trades:trades.length,wins,grossProfit,grossLoss,fees,slippage,netProfit:cash-initialCash,maxDrawdownPct,initialCash,endingCash:cash,openPosition:position!==null,tradeLog:trades,outOfSample:false};
}
export function walkForward(bars,options){const split=Math.floor(bars.length*.7);if(split<40||bars.length-split<40)throw new Error('AT_LEAST_134_BARS_FOR_WALK_FORWARD');const train=backtest(bars.slice(0,split),options),test=backtest(bars.slice(split),options);return {train,test:{...test,outOfSample:true},ranking:rankStrategyResults([{...test,outOfSample:true}])[0]};}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const file=process.argv[2];if(!file)throw new Error('Usage: node scripts/strategy-backtester.mjs historical-bars.json');
 const bars=JSON.parse(await fs.readFile(file,'utf8'));const output=STRATEGIES.filter(s=>s.id!=='liquid-long-options').map(s=>{try{return walkForward(bars,{strategyId:s.id})}catch(e){return {strategyId:s.id,error:e.message}}});console.log(JSON.stringify({source:file,results:output},null,2));
}
