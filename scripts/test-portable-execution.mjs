import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {chainSession} from './chain-live-session.mjs';
test('dispatch gate wakes for exit and entry, idles only on valid false flags',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dispatch-'));
  try{const file=path.join(dir,'dispatch.json');for(const [a,b,want] of [[true,false,'true'],[false,true,'true'],[false,false,'false']]){fs.writeFileSync(file,JSON.stringify({chatgptShouldRun:a,executionNeeded:b}));const r=spawnSync(process.execPath,['scripts/dispatch-needed.mjs',file],{encoding:'utf8'});assert.equal(r.status,0);assert.equal(r.stdout.trim(),want);}fs.writeFileSync(file,'broken');assert.notEqual(spawnSync(process.execPath,['scripts/dispatch-needed.mjs',file]).status,0);}finally{fs.rmSync(dir,{recursive:true});}
});
test('self-chain ignores its own active run and submits one next session',async()=>{
  const calls=[];const env={GITHUB_REPOSITORY:'owner/repo',GH_TOKEN:'test',GITHUB_RUN_ID:'1'};
  const fetchImpl=async(url,args)=>{calls.push([url,args]);return{ok:true,json:async()=>({workflow_runs:[{id:1,status:'in_progress'}]})};};
  assert.equal(await chainSession({fetchImpl,env}),true);assert.equal(calls.length,2);assert.equal(calls[1][1].method,'POST');
});
test('self-chain avoids duplicate session and fails on ambiguous lookup',async()=>{
  const env={GITHUB_REPOSITORY:'owner/repo',GH_TOKEN:'test',GITHUB_RUN_ID:'1'};let calls=0;
  assert.equal(await chainSession({env,fetchImpl:async()=>{calls++;return{ok:true,json:async()=>({workflow_runs:[{id:2,status:'queued'}]})};}}),false);assert.equal(calls,1);
  await assert.rejects(chainSession({env,fetchImpl:async()=>({ok:false,status:401})}));
});
