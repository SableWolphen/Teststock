import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const engine=fileURLToPath(new URL('./build-trade-quality-engine.mjs',import.meta.url));
const recorder=fileURLToPath(new URL('./record-executor-result.py',import.meta.url));
test('watchdog uses publishedAt and still blocks missing, stale and future timestamps',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-watchdog-'));
 await fs.mkdir(path.join(dir,'docs/data'),{recursive:true});
 const stamp=new Date().toISOString();
 await fs.writeFile(path.join(dir,'docs/data/daytrader-intelligence.json'),JSON.stringify({generatedAt:stamp}));
 await fs.writeFile(path.join(dir,'docs/signal.json'),JSON.stringify({generatedAt:stamp}));
 for(const [board,fresh] of [[{publishedAt:stamp,generatedAt:'2000-01-01'},true],[{},false],[{publishedAt:'2000-01-01'},false],[{publishedAt:'2099-01-01'},false]]){
   await fs.writeFile(path.join(dir,'docs/data/trigger-board.json'),JSON.stringify(board));
   const run=spawnSync(process.execPath,[engine],{cwd:dir,encoding:'utf8'});
   assert.equal(run.status,0,run.stderr);
   const result=JSON.parse(await fs.readFile(path.join(dir,'docs/data/trade-quality-intelligence.json'),'utf8'));
   assert.equal(result.dataWatchdog.checks.find(x=>x.name==='trigger-board').fresh,fresh);
   assert.equal(result.dataWatchdog.state,fresh?'OK':'STOP_NEW_RISK');
 }
});
test('executor failure evidence survives and public logs exclude raw account details',async()=>{
 for(const [payload,stderr,code,expected] of [
   [{is_error:false,result:'private account details'},'',0,'COMPLETED'],
   [{is_error:true,result:'authentication_error private account details'},'',1,'AUTHENTICATION'],
   [{is_error:true,result:'max_turns private account details'},'',0,'TURN_LIMIT'],
   [{is_error:true,result:"You've hit your session limit"},'',1,'RATE_OR_USAGE_LIMIT'],
   ['not json','private account details',1,'INVALID_OR_MISSING_OUTPUT']
 ]){
   const dir=await fs.mkdtemp(path.join(os.tmpdir(),'teststock-executor-'));
   const raw=typeof payload==='string'?payload:JSON.stringify(payload);
   await fs.writeFile(path.join(dir,'stdout.json'),raw);
   await fs.writeFile(path.join(dir,'stderr.txt'),stderr);
   const run=spawnSync('python',[recorder,dir,String(code)],{encoding:'utf8'});
   assert.equal(run.status,expected==='COMPLETED'?0:1,run.stderr);
   assert.match(run.stdout,new RegExp(expected));
   assert.doesNotMatch(run.stdout,/private account details/);
   assert.equal(await fs.readFile(path.join(dir,'stdout.json'),'utf8'),raw);
   const meta=JSON.parse(await fs.readFile(path.join(dir,'status.json'),'utf8'));
   assert.equal(meta.automaticRetry,false);
   assert.equal(meta.brokerOutcome,'UNVERIFIED');
 }
});
