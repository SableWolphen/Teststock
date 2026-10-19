import {unwrapRead} from './monitor-reconciliation.mjs';
const num=v=>(typeof v==='number'||typeof v==='string'&&v.trim()!=='')&&Number.isFinite(Number(v))?Number(v):null;
const cents=v=>v!==null&&v>=0&&Number.isSafeInteger(Math.ceil(v*100))?Math.ceil(v*100):null;
const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));

// Conservative full-cost capital-at-risk bounds, not a claim of actual loss or
// guaranteed stop execution. Missing basis never becomes zero exposure.
export function capitalRiskFacts(snapshot={},portfolio={}) {
 const blockers=[];let cost=0;
 let valid=snapshot.positionsReadComplete===true&&snapshot.cryptoReadComplete===true&&['equities','options','cryptoPositions','orders'].every(k=>Array.isArray(snapshot[k]));
 for(const p of [...(snapshot.equities??[]),...(snapshot.options??[])]) {
  const quantity=num(p.quantity),isOption=Object.hasOwn(p,'option_id'),basis=num(isOption?p.average_price:p.average_buy_price);
  if(quantity===0)continue;
  if(quantity===null||quantity<0||basis===null||basis<0||p.type!=='long') {valid=false;continue;}
  // Option average_price is already the total cost per contract (not per share).
  cost+=quantity*basis;
 }
 for(const p of snapshot.cryptoPositions??[]) {
  if(p.currency?.type==='fiat'||num(p.quantity)===0)continue;
  const quantity=num(p.quantity),bases=p.cost_bases;
  if(quantity===null||quantity<0||!Array.isArray(bases)||!bases.length){valid=false;continue;}
  let direct=0,basis=0,complete=true;
  for(const b of bases){const q=num(b?.direct_quantity),c=num(b?.direct_cost_basis);if(q===null||c===null||q<0||c<0){complete=false;break;}direct+=q;basis+=c;}
  if(!complete||Math.abs(direct-quantity)>1e-10){valid=false;continue;}
  cost+=basis;
 }
 for(const k of ['futures_value','event_contracts_value','mutual_funds_value','fixed_income_value'])if(num(portfolio[k])!==0)valid=false;
 const equity=num(portfolio.total_value),cash=num(portfolio.cash),bp=num(portfolio.buying_power?.buying_power),unleveraged=num(portfolio.buying_power?.unleveraged_buying_power);
 const cashVerified=portfolio.currency==='USD'&&[cash,bp,unleveraged].every(x=>x!==null&&x>=0)&&num(portfolio.pending_deposits)===0;
 const pendingBuy=(snapshot.orders??[]).some(o=>o.working!==false&&(o.asset==='EQUITY'?o.side==='buy':o.legs?.some(l=>l.side==='buy')));
 if(!valid||cents(cost)===null)blockers.push('OPEN_CAPITAL_RISK_UNVERIFIED');
 if(!cashVerified)blockers.push('CASH_CAPACITY_UNVERIFIED');
 if(pendingBuy)blockers.push('PENDING_ENTRY_RESERVATION_UNVERIFIED');
 const openRiskCents=valid?cents(cost):null,heatLimitCents=equity!==null&&equity>0?Math.floor(equity*5):null;
 if(heatLimitCents===null)blockers.push('ACCOUNT_EQUITY_UNVERIFIED');
 if(openRiskCents!==null&&heatLimitCents!==null&&openRiskCents>=heatLimitCents)blockers.push('PORTFOLIO_HEAT_EXHAUSTED');
 return {basis:'FULL_COST_CAPITAL_AT_RISK_UPPER_BOUND',openRiskVerified:valid,openRiskCents,heatLimitCents,cashCapacityVerified:cashVerified&&!pendingBuy,cashCapacityCents:cashVerified&&!pendingBuy?Math.floor(Math.min(cash,bp,unleveraged)*100):null,blockers};
}

export async function readRealizedLossFacts(client,account,{now=Date.now(),maxPages=20}={}) {
 const sessionDate=day(now),trades=[],tokens=new Set();let cursor;
 for(let page=0;page<maxPages;page++) {
  const data=unwrapRead(await client.call('get_pnl_trade_history',{account_number:account,span:'week',...(cursor?{cursor}:{})}));
  if(data.account_number!==account||data.span!=='week'||!Array.isArray(data.trades))throw Error('PNL_SCHEMA_UNVERIFIED');
  for(const t of data.trades) {
   const at=Date.parse(t?.timestamp),gain=num(t?.realized_gain);
   if(!Number.isFinite(at)||at>now+2000||gain===null)throw Error('PNL_SCHEMA_UNVERIFIED');
   if(day(at)===sessionDate)trades.push(t);
  }
  if(!data.next_cursor)break;
  if(typeof data.next_cursor!=='string'||tokens.has(data.next_cursor)||page===maxPages-1)throw Error('PNL_PAGINATION_UNVERIFIED');
  cursor=data.next_cursor;tokens.add(cursor);
 }
 const aggregate=unwrapRead(await client.call('get_realized_pnl',{account_number:account,start_date:sessionDate,end_date:sessionDate,timezone:'America/New_York'}));
 const points=aggregate.data_points;
 if(aggregate.account_number!==account||aggregate.display_currency!=='USD'||aggregate.window!==`${sessionDate}..${sessionDate}`||!Array.isArray(points))throw Error('PNL_SCHEMA_UNVERIFIED');
 // Null gain/basis is unknown even when a bucket reports zero trades. Never
 // turn n/a from the broker into a zero-loss success.
 const basisKnown=points.every(p=>num(p.realized_gain)!==null&&Number.isSafeInteger(p.number_of_trades)&&p.number_of_trades>=0);
 const net=trades.reduce((sum,t)=>sum+num(t.realized_gain),0),gross=trades.reduce((sum,t)=>sum+Math.max(0,-num(t.realized_gain)),0);
 const count=points.reduce((sum,p)=>sum+p.number_of_trades,0),total=num(aggregate.total_returns);
 const matched=basisKnown&&count===trades.length&&total!==null&&Math.abs(net-total)<0.005;
 return {sessionDate,asOf:new Date(now).toISOString(),perTradeReadComplete:true,realizingTradeCount:trades.length,grossRealizedLossCents:cents(gross),aggregateMatched:matched,verified:matched,
  blockers:matched?[]:[basisKnown?'REALIZED_PNL_RECONCILIATION_UNVERIFIED':'REALIZED_PNL_BASIS_UNKNOWN'],
  unrealizedLossVerified:false,continuityVerified:false,note:'Realized observations are separate from current unrealized losses and the durable daily-loss latch.'};
}

export async function observeBrokerRisk(client,account,snapshot,portfolio,{now=Date.now()}={}) {
 const capital=capitalRiskFacts(snapshot,portfolio);let realized;
 try{realized=await readRealizedLossFacts(client,account,{now});}
 catch{realized={verified:false,continuityVerified:false,blockers:['REALIZED_PNL_READ_UNVERIFIED']};}
 return {source:'SUPPORTED_BROKER_RISK_READS',generatedAt:new Date(now).toISOString(),capital,realized,dailyLossVerified:false,
  blockers:[...capital.blockers,...realized.blockers,'DAILY_LOSS_CONTINUITY_UNVERIFIED'],brokerWrites:false};
}
