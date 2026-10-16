// Original implementations of published strategy concepts; no third-party code copied.
export const STRATEGIES=[
{id:'opening-range-breakout',name:'Opening Range Breakout',source:'https://www.quantconnect.com/docs/v2/writing-algorithms',description:'Break the first 30-minute range with strong relative volume'},
{id:'vwap-pullback',name:'VWAP Pullback',source:'https://www.tradingview.com/pine-script-docs/',description:'Trend continuation after a controlled pullback to VWAP'},
{id:'news-momentum',name:'News Momentum',source:'https://alpaca.markets/learn',description:'Catalyst-confirmed momentum with unusual volume'},
{id:'mean-reversion',name:'Intraday Mean Reversion',source:'https://www.quantconnect.com/docs/v2/writing-algorithms',description:'Short-term overextension with reversal confirmation'},
{id:'liquid-long-options',name:'Liquid Long Options',source:'https://www.optionseducation.org/',description:'Defined-premium options with liquid quotes and verified exit capability'}];
const number=n=>Number.isFinite(Number(n))?Number(n):NaN;
export function evaluateResearchTrade({strategyId,bars=[],newsCatalyst=false,relativeVolume=0,option=null}={}){
 const last=bars.at(-1),prev=bars.at(-2);if(!last||!prev||bars.length<3)return {strategyId,signal:'NO_DATA',reasons:['INSUFFICIENT_BARS']};
 const close=number(last.close),vwap=number(last.vwap),volume=number(relativeVolume),previous=number(prev.close);
 if(![close,vwap,previous,volume].every(Number.isFinite)||close<=0||vwap<=0)return {strategyId,signal:'NO_DATA',reasons:['INVALID_DATA']};
 const opening=bars.slice(0,Math.min(6,bars.length-1));const high=Math.max(...opening.map(b=>number(b.high)));const low=Math.min(...opening.map(b=>number(b.low)));
 let signal='WAIT';
 if(strategyId==='opening-range-breakout'&&close>high&&volume>=2)signal='LONG_RESEARCH';
 if(strategyId==='vwap-pullback'&&close>vwap&&previous<=number(prev.vwap)&&volume>=1.2)signal='LONG_RESEARCH';
 if(strategyId==='news-momentum'&&newsCatalyst&&close>previous&&volume>=2)signal='LONG_RESEARCH';
 if(strategyId==='mean-reversion'&&close<vwap*.97&&close>previous&&volume>=1.2)signal='LONG_RESEARCH';
 if(strategyId==='liquid-long-options'&&option?.bid>0&&option?.ask>=option?.bid&&(option.ask-option.bid)/option.ask<=.1&&volume>=1.5)signal='REVIEW_OPTION';
 return {strategyId,signal,reasons:[],observed:{close,vwap,relativeVolume:volume,openingHigh:high,openingLow:low},automaticSubmissionAuthorized:false};
}
export function rankStrategyResults(results=[]){
 return results.map(r=>{const trades=Number(r.trades||0),wins=Number(r.wins||0),gross=Number(r.grossProfit||0),loss=Number(r.grossLoss||0),cost=Number(r.fees||0)+Number(r.slippage||0);const net=gross-loss-cost;const expectancy=trades?net/trades:null;return {...r,netProfit:net,expectancy,winRate:trades?wins/trades:null,eligible:trades>=30&&net>0&&Number(r.maxDrawdownPct||100)<=20&&r.outOfSample===true}}).sort((a,b)=>Number(b.eligible)-Number(a.eligible)||(b.expectancy??-Infinity)-(a.expectancy??-Infinity));
}
