import test from 'node:test';
import assert from 'node:assert/strict';
import {collectSnapshot,unwrapTool} from './reconcile-broker-state.mjs';
import {reconcileWatchlist,validateSnapshot} from './broker-state.mjs';
const snapshot=()=>({generatedAt:new Date().toISOString(),complete:true,equities:[],options:[]});
test('confirmed empty broker snapshot closes sold holdings without inventing fills',()=>{
  const w={positions:[{ticker:'EQX',assetClass:'STOCK',status:'ACTIVE',stop:10},{ticker:'NAT',assetClass:'OPTION',optionId:'contract',status:'ACTIVE'},{ticker:'OLD',assetClass:'STOCK',status:'CLOSED'}]};
  const out=reconcileWatchlist(w,snapshot());
  assert.deepEqual(out.positions.map(p=>p.status),['CLOSED','CLOSED','CLOSED']);
  assert.equal(out.positions[0].stop,10);assert.equal(out.positions[0].actualAverageExit,undefined);assert.equal(w.positions[0].status,'ACTIVE');
});
test('live holdings stay active, option identity is matched by contract',()=>{
  const s={...snapshot(),equities:[{symbol:'EQX',quantity:'2'}],options:[{option_id:'one',quantity:'1'}]};
  const out=reconcileWatchlist({positions:[{ticker:'EQX',assetClass:'STOCK',status:'ACTIVE'},{assetClass:'OPTION',optionId:'one',status:'ACTIVE'},{assetClass:'OPTION',optionId:'two',status:'ACTIVE'}]},s);
  assert.deepEqual(out.positions.map(p=>p.status),['ACTIVE','ACTIVE','CLOSED']);
});
test('incomplete, stale, malformed and negative snapshots never close holdings',()=>{
  for(const s of [{...snapshot(),complete:false},{...snapshot(),generatedAt:'2000-01-01'},{...snapshot(),options:null},{...snapshot(),equities:[{symbol:'X',quantity:-1}]}])assert.throws(()=>validateSnapshot(s));
});
test('collector reads all position pages and fails closed on broker errors',async()=>{
  const calls=[];
  const s=await collectSnapshot(async(name,args)=>{calls.push([name,args]);if(name==='get_accounts')return{accounts:[{account_number:'test',agentic_allowed:true,state:'active'}]};if(name==='get_equity_positions')return args.cursor?{positions:[{symbol:'B',quantity:'1'}]}:{positions:[{symbol:'A',quantity:'1'}],next:'next'};return{positions:[]};});
  assert.equal(s.equities.length,2);assert.equal(calls[2][1].cursor,'next');
  await assert.rejects(collectSnapshot(async()=>({accounts:[]})));
  assert.throws(()=>unwrapTool({isError:true,content:[]}));
});
