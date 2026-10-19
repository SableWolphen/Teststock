import test from 'node:test';
import assert from 'node:assert/strict';
import {observeEngine} from './engine-observation.mjs';
const account={account_number:'test-private',rhs_account_number:'123',agentic_allowed:true,state:'active',type:'limited_margin',option_level:'option_level_2'};
const portfolio={cash:'1.16',total_value:'72',buying_power:{buying_power:'1.16',unleveraged_buying_power:'1.16'}};
const client=(patch={})=>({call:async(name,args)=>({structuredContent:{data:patch[name]?await patch[name](args):name==='get_accounts'?{accounts:[account]}:name==='get_portfolio'?portfolio:name.includes('positions')?(name.includes('crypto')?{results:[]}:{positions:[]}):name.includes('crypto')?{results:[]}:{orders:[]}}})});
test('engine bridge uses supported independent reads, retains unknown coverage and cannot enable live orders',async()=>{
 const observation=await observeEngine({client:client()});assert.equal(observation.source,'SUPPORTED_ROBINHOOD_READS');assert.equal(observation.portfolio.cash,'1.16');assert.equal(observation.brokerWrites,false);assert.equal(observation.policy.liveExecutionEnabled,false);assert.equal(observation.snapshot.allAssetReconciliationComplete,false);assert.ok(observation.snapshot.blockers.includes('ADVANCED_ORDER_COVERAGE_UNVERIFIED'));assert.equal(observation.snapshot.optionMarketData.complete,true);
});
test('engine bridge rejects changing accounts, unknown funds, overlong reads and invalid contract identifiers',async()=>{
 let count=0;
 await assert.rejects(observeEngine({client:client({get_accounts:()=>({accounts:[{...account,account_number:++count===1?'first':'second'}]})})}),/BROKER_ACCOUNT_CHANGED/);
 await assert.rejects(observeEngine({client:client({get_portfolio:()=>({cash:null})})}),/FUNDING_SCHEMA_INVALID/);
 let time=0;await assert.rejects(observeEngine({client:client(),now:()=>time+=20000}),/(ENGINE_OBSERVATION|RECONCILIATION)_TOO_SLOW/);
 await assert.rejects(observeEngine({client:client(),proposal:{asset_type:'option',option_id:'not-a-contract'}}),/INVALID_OPTION_ID/);
});
