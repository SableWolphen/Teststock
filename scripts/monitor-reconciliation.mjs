import crypto from 'node:crypto';
const TERMINAL=new Set(['filled','cancelled','canceled','rejected','failed','voided','partially_filled_rest_cancelled','locate_failed']);
const WORKING=new Set(['new','queued','confirmed','unconfirmed','partially_filled','pending_cancelled','locating']);
export function unwrapRead(result) {
 if(result?.isError) throw Error('BROKER_READ_FAILED');
 let value=result?.structuredContent;
 if(!value) for(const item of result?.content||[]) if(item.type==='text') {try{value=JSON.parse(item.text);break;}catch{}}
 if(!value||typeof value!=='object') throw Error('INVALID_BROKER_SCHEMA');
 return value.data||value;
}
export async function readPages(client,name,args,key,{maxPages=100}={}) {
 const rows=[],seen=new Set(),ids=new Set();let cursor;
 for(let page=0;page<maxPages;page++) {
  const data=unwrapRead(await client.call(name,{...args,...(cursor?{cursor}:{})}));
  if(!Array.isArray(data[key])||data[key].some(x=>!x||typeof x!=='object')) throw Error('INVALID_BROKER_PAGE');
  for(const row of data[key]) {
   const id=row.id||row.option_id||row.symbol;
   if(typeof id!=='string'||!id||ids.has(id)) throw Error('DUPLICATE_OR_MISSING_BROKER_ID');
   ids.add(id);rows.push(row);
  }
  if(data.next===undefined||data.next===null||data.next==='') return rows;
  if(typeof data.next!=='string'||seen.has(data.next)) throw Error('BROKER_CURSOR_LOOP');
  seen.add(data.next);cursor=data.next;
 }
 throw Error('BROKER_PAGE_LIMIT');
}
export function describeOrders(equities,options) {
 const orders=[],fills=[],issues=[],workingKeys=new Set();
 for(const [asset,rows] of [['EQUITY',equities],['OPTION',options]]) for(const row of rows) {
  if(typeof row.id!=='string'||!row.id||typeof row.state!=='string') throw Error('INVALID_ORDER');
  const terminal=TERMINAL.has(row.state),working=WORKING.has(row.state);
  if(!terminal&&!working) issues.push('UNKNOWN_ORDER_STATE');
  const rawFilled=asset==='EQUITY'?row.cumulative_quantity:row.processed_quantity;
  if(rawFilled===null||rawFilled===undefined||rawFilled==='') throw Error('INVALID_FILLED_QUANTITY');
  const filled=Number(rawFilled);
  if(!Number.isFinite(filled)||filled<0) throw Error('INVALID_FILLED_QUANTITY');
  if(row.quantity!==null&&row.quantity!==undefined&&(!Number.isFinite(Number(row.quantity))||Number(row.quantity)<filled)) throw Error('INVALID_ORDER_QUANTITY');
  const legs=asset==='EQUITY'?[{option_id:null,side:row.side,executions:row.executions}]:row.legs;
  if(!Array.isArray(legs)) throw Error('INVALID_ORDER_LEGS');
  let executionCount=0;
  for(const leg of legs) {
   let legFilled=0;
   if(leg.executions!==null&&leg.executions!==undefined&&!Array.isArray(leg.executions)) throw Error('INVALID_EXECUTIONS');
   for(const fill of leg.executions||[]) {
    if(!fill?.id||!Number.isFinite(Number(fill.quantity))||Number(fill.quantity)<=0||!Number.isFinite(Number(fill.price))||Number(fill.price)<0||!Number.isFinite(Date.parse(fill.timestamp))) throw Error('INVALID_FILL');
    legFilled+=Number(fill.quantity);
    fills.push({asset,orderId:row.id,contract:leg.option_id||null,side:leg.side,id:fill.id,quantity:fill.quantity,price:fill.price,timestamp:fill.timestamp});executionCount++;
   }
   if(Math.abs(legFilled-filled*Number(leg.ratio_quantity??1))>0.000001) issues.push('EXECUTION_TOTAL_MISMATCH');
  }
  if(filled>0&&!executionCount) issues.push('FILLED_QUANTITY_WITHOUT_EXECUTIONS');
  if(working||!terminal) {
   if(asset==='OPTION'&&legs.some(l=>!l.option_id)) issues.push('UNRESOLVED_OPTION_IDENTITY');
   const key=asset+'|'+(asset==='EQUITY'?row.symbol:legs.map(l=>`${l.option_id}:${l.side}`).sort().join(','))+'|'+(row.side||'');
   if(workingKeys.has(key)) issues.push('MULTIPLE_WORKING_ORDERS_REQUIRE_REVIEW');workingKeys.add(key);
  }
  orders.push({...row,asset,working:!terminal,confirmedFilledQuantity:filled});
 }
 const fillKeys=new Set();for(const f of fills) {const key=f.asset+'|'+f.id;if(fillKeys.has(key)) throw Error('DUPLICATE_EXECUTION');fillKeys.add(key);}
 return {orders,fills,issues:[...new Set(issues)]};
}
export async function collectReadOnlySnapshot(client,{accountFingerprint,now=()=>Date.now(),maxDurationMs=120000}={}) {
 const started=now();
 const accounts=unwrapRead(await client.call('get_accounts',{})).accounts;
 if(!Array.isArray(accounts)) throw Error('INVALID_ACCOUNTS');
 const eligible=accounts.filter(a=>a?.agentic_allowed===true&&a.state==='active'&&!a.deactivated&&!a.permanently_deactivated);
 if(eligible.length!==1||!eligible[0].account_number) throw Error('ACCOUNT_SELECTION_UNVERIFIED');
 const account=eligible[0].account_number;
 const fingerprint=crypto.createHash('sha256').update(account).digest('hex');
 if(accountFingerprint&&accountFingerprint!==fingerprint) throw Error('BROKER_ACCOUNT_CHANGED');
 const equities=await readPages(client,'get_equity_positions',{account_number:account},'positions');
 const options=await readPages(client,'get_option_positions',{account_number:account,nonzero:true},'positions');
 for(const p of [...equities,...options]) if(p.quantity===null||p.quantity===''||!Number.isFinite(Number(p.quantity))) throw Error('INVALID_POSITION_QUANTITY');
 const equityOrders=await readPages(client,'get_equity_orders',{account_number:account},'orders');
 const optionOrders=await readPages(client,'get_option_orders',{account_number:account},'orders');
 const orderState=describeOrders(equityOrders,optionOrders);
 if(now()-started>maxDurationMs) throw Error('RECONCILIATION_TOO_SLOW');
 // Advanced orders and crypto are deliberately not claimed complete: this runtime has no verified readers for them.
 const blockers=['ADVANCED_ORDER_COVERAGE_UNVERIFIED','CRYPTO_COVERAGE_NOT_IMPLEMENTED',...orderState.issues];
 if([...equities,...options].some(p=>Number(p.quantity)<0||p.type==='short')) blockers.push('SHORT_POSITION_REQUIRES_REVIEW');
 return {schemaVersion:1,generatedAt:new Date(now()).toISOString(),accountFingerprint:fingerprint,scope:'EQUITY_AND_OPTION_READS',positionsReadComplete:true,orderHistoryReadComplete:true,allAssetReconciliationComplete:false,liveEnabled:false,entryAllowed:false,blockers,equities,options,...orderState,managedPositions:[...equities.map(p=>({...p,asset:'EQUITY'})),...options.map(p=>({...p,asset:'OPTION'}))]};
}
