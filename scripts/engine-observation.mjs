import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ReadOnlyMcp,atomicJson,quoteGuard} from './windows-monitor.mjs';
import {vault,accessToken} from './robinhood-oauth.mjs';
import {collectReadOnlySnapshot,unwrapRead} from './monitor-reconciliation.mjs';
import {SAFETY_POLICY} from './safety-policy.mjs';
import {readOptionMarkets} from './option-monitor-quotes.mjs';
import {observeBrokerRisk} from './broker-risk-facts.mjs';

// Explicit read-only bridge. Never accepts a transport URL or any order command.
export async function observeEngine({client,proposal={},now=()=>Date.now()}={}) {
 const started=now();
 const accounts=unwrapRead(await client.call('get_accounts',{})).accounts;
 const eligible=accounts?.filter(a=>a?.agentic_allowed===true&&a.state==='active'&&!a.deactivated&&!a.permanently_deactivated);
 if(eligible?.length!==1)throw Error('ACCOUNT_SELECTION_UNVERIFIED');
 const account=eligible[0];
 const portfolio=unwrapRead(await client.call('get_portfolio',{account_number:account.account_number}));
 const funds=[portfolio.total_value,portfolio.cash,portfolio.buying_power?.buying_power,portfolio.buying_power?.unleveraged_buying_power];
 if(funds.some(x=>x===null||x===undefined||x===''||typeof x==='boolean'||!Number.isFinite(Number(x))))throw Error('FUNDING_SCHEMA_INVALID');
 const snapshot=await collectReadOnlySnapshot(client,{now,maxDurationMs:30000});
 // Pin the two account reads to the same account without exporting its number.
 const {createHash}=await import('node:crypto');
 if(snapshot.accountFingerprint!==createHash('sha256').update(account.account_number).digest('hex'))throw Error('BROKER_ACCOUNT_CHANGED');
 snapshot.optionMarketData=await readOptionMarkets(client,snapshot.options,{now});
 const riskFacts=await observeBrokerRisk(client,account.rhs_account_number,snapshot,portfolio,{now:now()});
 let market=null;
 if(proposal.asset_type==='option') {
   if(typeof proposal.option_id!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(proposal.option_id))throw Error('INVALID_OPTION_ID');
   const instruments=unwrapRead(await client.call('get_option_instruments',{ids:proposal.option_id})).instruments;
   const instrument=instruments?.find(i=>i?.id===proposal.option_id);
   const results=unwrapRead(await client.call('get_option_quotes',{instrument_ids:[proposal.option_id]})).results;
   const quote=results?.find(r=>r?.quote?.instrument_id===proposal.option_id)?.quote;
   market={instrument,quote,asset_type:'option',observedAt:new Date(now()).toISOString()};
 } else if(proposal.asset_type==='stock') {
   if(typeof proposal.symbol!=='string'||! /^[A-Z][A-Z0-9.-]{0,14}$/.test(proposal.symbol))throw Error('INVALID_SYMBOL');
   const results=unwrapRead(await client.call('get_equity_quotes',{symbols:[proposal.symbol]})).results;
   const quote=results?.find(r=>r?.quote?.symbol===proposal.symbol)?.quote;
   market={quote,asset_type:'stock',observedAt:new Date(now()).toISOString(),quoteError:quoteGuard(quote,now())};
 }
 if(now()-started>30000)throw Error('ENGINE_OBSERVATION_TOO_SLOW');
 return {schemaVersion:1,source:'SUPPORTED_ROBINHOOD_READS',generatedAt:new Date(now()).toISOString(),readStartedAt:new Date(started).toISOString(),accountFingerprint:snapshot.accountFingerprint,accountType:account.type,optionLevel:account.user_option_level??account.option_level,brokerAccessible:true,portfolio,snapshot,market,riskFacts,policy:SAFETY_POLICY,brokerWrites:false};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  const value=flag=>{const i=process.argv.indexOf(flag);return i<0?null:process.argv[i+1]};
  const root=value('--state-dir');if(!root||!path.isAbsolute(root)||!fs.existsSync(path.join(root,'installation.json')))throw Error('RUNTIME_NOT_INSTALLED');
  const proposalPath=value('--proposal');let proposal={};
  if(proposalPath) {if(!path.isAbsolute(proposalPath)||fs.statSync(proposalPath).size>32768)throw Error('INVALID_PROPOSAL');proposal=JSON.parse(fs.readFileSync(proposalPath,'utf8'));}
  const client=new ReadOnlyMcp({tokenProvider:()=>accessToken(vault(root))});await client.connect();
  const observation=await observeEngine({client,proposal});atomicJson(path.join(root,'engine-observation.json'),observation);
  console.log(JSON.stringify({source:observation.source,generatedAt:observation.generatedAt,positionCount:observation.snapshot.managedPositions.length,brokerWrites:false}));
 } catch {console.error('ENGINE_OBSERVATION_FAILED');process.exitCode=1;}
}
