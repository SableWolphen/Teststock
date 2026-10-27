// Deterministic, read-only research scoring. No broker access or order instructions.
// Inspired by Oft3r/agentic-trading-desk (MIT); independent implementation.
const finite = n => typeof n === 'number' && Number.isFinite(n);
export function ema(values, period) {
  if (!Array.isArray(values) || values.length < period || values.some(v => !finite(v) || v <= 0)) return null;
  let value = values.slice(0, period).reduce((a,b)=>a+b,0)/period;
  const k = 2/(period+1);
  for (const price of values.slice(period)) value = price*k+value*(1-k);
  return value;
}
export function rsi(values, period=14) {
  if (!Array.isArray(values) || values.length < period+1 || values.some(v=>!finite(v)||v<=0)) return null;
  let gain=0,loss=0;
  for(let i=1;i<=period;i++){const d=values[i]-values[i-1];gain+=Math.max(d,0);loss+=Math.max(-d,0);}
  gain/=period;loss/=period;
  for(let i=period+1;i<values.length;i++){const d=values[i]-values[i-1];gain=(gain*(period-1)+Math.max(d,0))/period;loss=(loss*(period-1)+Math.max(-d,0))/period;}
  return loss===0?(gain===0?50:100):100-100/(1+gain/loss);
}
function emaSeries(values,period){
  const out=Array(values.length).fill(null); if(values.length<period)return out;
  let x=values.slice(0,period).reduce((a,b)=>a+b,0)/period;out[period-1]=x;
  for(let i=period;i<values.length;i++){x=(values[i]*2+x*(period-1))/(period+1);out[i]=x;}return out;
}
export function macdHistogram(values){
  if(values.length<35)return null;
  const a=emaSeries(values,12),b=emaSeries(values,26);
  const diffs=a.map((v,i)=>v===null||b[i]===null?null:v-b[i]).filter(v=>v!==null);
  const signal=ema(diffs.map(v=>v+1000000),9); // shift for ema positive-value validation
  return signal===null?null:diffs.at(-1)-(signal-1000000);
}
export function scoreResearch({symbol,closes,macroScore=null,asOf=null}={}){
  const invalid=!Array.isArray(closes)||closes.length<205||closes.some(v=>!finite(v)||v<=0);
  if(invalid)return {symbol,status:'INSUFFICIENT_DATA',decision:'WATCH',executionEligible:false,reasons:['Requires at least 205 valid positive historical closes']};
  const e20=ema(closes,20),e50=ema(closes,50),e200=ema(closes,200),prior200=ema(closes.slice(0,-5),200);
  const last=closes.at(-1),momentum=rsi(closes),hist=macdHistogram(closes);
  const trend=[last>e20,e20>e50,e50>e200,e200>prior200].filter(Boolean).length;
  const trendScore=trend>=3?2:trend===2?0:-2;
  const momentumScore=momentum>55&&hist>0?2:momentum<45&&hist<0?-2:0;
  const macro=finite(macroScore)&&macroScore>=-2&&macroScore<=2?macroScore:null;
  const reasons=[];
  if(macro===null)reasons.push('Macro evidence missing or invalid');
  if(!asOf)reasons.push('No timestamp; freshness unverified');
  return {symbol,status:macro===null||!asOf?'INCOMPLETE':'RESEARCH_ONLY',decision:'WATCH',executionEligible:false,
    scores:{trend:trendScore,momentum:momentumScore,macro,total:macro===null?null:trendScore+momentumScore+macro},
    indicators:{ema20:e20,ema50:e50,ema200:e200,rsi14:momentum,macdHistogram:hist},asOf,reasons};
}
