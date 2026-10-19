import test from 'node:test';
import assert from 'node:assert/strict';
import {capitalRiskFacts,readRealizedLossFacts} from './broker-risk-facts.mjs';
const now=Date.parse('2026-10-19T14:20:00Z'),date='2026-10-19',account='fixture';
const portfolio={currency:'USD',total_value:'100',cash:'2',pending_deposits:'0',buying_power:{buying_power:'2',unleveraged_buying_power:'2'},futures_value:'0',event_contracts_value:'0',mutual_funds_value:'0',fixed_income_value:'0'};
const snapshot={positionsReadComplete:true,cryptoReadComplete:true,equities:[],options:[{option_id:'contract',quantity:'1',average_price:'25',type:'long'}],cryptoPositions:[],orders:[]};
const trade=(gain,t='2026-10-19T13:30:00Z')=>({timestamp:t,realized_gain:String(gain)});
const client=(trades,points,total)=>({call:async name=>({structuredContent:{data:name==='get_pnl_trade_history'?{account_number:account,span:'week',trades,next_cursor:''}:{account_number:account,window:`${date}..${date}`,display_currency:'USD',data_points:points,total_returns:String(total)}}})});
test('whole premium is counted once per contract; small cash cannot overcome exhausted portfolio heat',()=>{
 const r=capitalRiskFacts(snapshot,portfolio);assert.equal(r.openRiskCents,2500);assert.equal(r.heatLimitCents,500);assert.ok(r.blockers.includes('PORTFOLIO_HEAT_EXHAUSTED'));assert.equal(r.cashCapacityVerified,true);
});
test('missing basis, transfers and unsupported assets remain unknown rather than zero risk',()=>{
 for(const [s,p]of [[{...snapshot,options:[{...snapshot.options[0],average_price:null}]},portfolio],[snapshot,{...portfolio,futures_value:'1'}],[{...snapshot,cryptoPositions:[{quantity:'1',currency:{type:'cryptocurrency'},cost_bases:[{direct_quantity:'0.5',direct_cost_basis:'1'}]}]},portfolio]])assert.equal(capitalRiskFacts(s,p).openRiskVerified,false);
});
test('spendable cents use decimal floors without binary rounding or rounding up fractional cents',()=>{
 const r=capitalRiskFacts(snapshot,{...portfolio,cash:'1.1600',buying_power:{buying_power:'1.1699',unleveraged_buying_power:'1.16'}});assert.equal(r.cashCapacityCents,116);
 assert.equal(capitalRiskFacts(snapshot,{...portfolio,cash:'0.019'}).cashCapacityCents,1);
});
test('realized loss uses gross losing trades; gains do not offset the risk limit',async()=>{
 const r=await readRealizedLossFacts(client([trade(-25),trade(100)],[{realized_gain:'75',number_of_trades:2}],75),account,{now});assert.equal(r.grossRealizedLossCents,2500);assert.equal(r.verified,true);assert.equal(r.continuityVerified,false);
});
test('null PnL with zero trade count stays unknown; empty verified history can establish only realized observations',async()=>{
 const r=await readRealizedLossFacts(client([],[{realized_gain:null,number_of_trades:0}],0),account,{now});assert.equal(r.verified,false);assert.ok(r.blockers.includes('REALIZED_PNL_BASIS_UNKNOWN'));
 assert.equal((await readRealizedLossFacts(client([],[],0),account,{now})).verified,true);
});
test('mismatched aggregate and cursor loops cannot verify losses',async()=>{
 assert.equal((await readRealizedLossFacts(client([trade(-25)],[{realized_gain:'0',number_of_trades:1}],0),account,{now})).verified,false);
 const bad={call:async()=>({structuredContent:{data:{account_number:account,span:'week',trades:[],next_cursor:'repeat'}}})};await assert.rejects(readRealizedLossFacts(bad,account,{now}),/PAGINATION_UNVERIFIED/);
});
