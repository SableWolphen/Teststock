// Deterministic broker snapshot normalization; never submits an order.
import {assessExecution} from './execution-safety.mjs';
const ACTIVE=new Set(['queued','confirmed','unconfirmed','partially_filled','pending','pending_cancelled']);
export function buildRiskSnapshot({account={},positions=[],orders=[],quotes=[],capabilities={},now=new Date().toISOString()}={}){
 const normalized=positions.map(p=>({...p,option_id:p.option_id??p.optionId,chain_symbol:p.chain_symbol??p.symbol}));
 const active=orders.filter(o=>ACTIVE.has(String(o.state).toLowerCase()));
 const safety=assessExecution({capabilities,account,positions:normalized,orders:active,quotes,now});
 const issues=[...safety.blockers.map(code=>({severity:'blocker',code}))];
 for(const p of normalized){
  const id=p.option_id;
  const open=active.filter(o=>o.legs?.some(l=>l.option_id===id&&l.position_effect==='close'));
  const qty=Number(p.quantity??0);
  const pending=Number(p.pending_sell_quantity??0);
  if(!Number.isFinite(qty)||qty<0)issues.push({severity:'error',code:'INVALID_POSITION_QUANTITY',optionId:id});
  if(p.expiration_date&&p.expiration_date<=now.slice(0,10))issues.push({severity:'urgent',code:'EXPIRATION_TODAY_OR_PAST',optionId:id,symbol:p.chain_symbol});
  if(pending>0&&!open.length)issues.push({severity:'warning',code:'PENDING_SELL_NOT_IN_OPEN_ORDERS',optionId:id});
  if(open.length>1)issues.push({severity:'warning',code:'MULTIPLE_OPEN_EXIT_ORDERS',optionId:id});
  const quote=quotes.find(q=>(q.instrument_id??q.option_id)===id);
  if(quote){
   const age=Date.parse(now)-Date.parse(quote.updated_at);
   if(!Number.isFinite(age)||age<0||age>120000)issues.push({severity:'warning',code:'STALE_OPTION_QUOTE',optionId:id,ageMs:age});
  }else issues.push({severity:'warning',code:'QUOTE_MISSING',optionId:id});
 }
 return {generatedAt:now,mode:'MONITOR_ONLY',liveOrderSubmissionAuthorized:false,allowNewOrders:false,activeOrderCount:active.length,positionCount:normalized.length,issues,actions:safety.actions};
}
