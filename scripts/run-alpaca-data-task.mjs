import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {alpacaVault,validateCredentials} from './alpaca-data-client.mjs';
export const DATA_TASKS=Object.freeze(['check-alpaca-market-session.mjs','validate-entry-gates.mjs']);
export function runAlpacaDataTask(root,name,{store=alpacaVault(root),spawn=spawnSync}={}) {
 if(!DATA_TASKS.includes(name)) throw Error('ALPACA_DATA_TASK_DENIED');
 const credentials=validateCredentials(store.load());
 const script=path.join(path.dirname(fileURLToPath(import.meta.url)),name);
 const childRuntimeEnv={...process.env,ALPACA_API_KEY:credentials.key,ALPACA_API_SECRET:credentials.secret,APCA_API_BASE_URL:'https://paper-api.alpaca.markets',TESTSTOCK_EXECUTION_MODE:'paper'};
 delete childRuntimeEnv.TESTSTOCK_LIVE_TRADING;
 const child=spawn(process.execPath,[script],{cwd:path.dirname(path.dirname(script)),env:childRuntimeEnv,stdio:'inherit',windowsHide:true});
 if(child.error) throw Error('ALPACA_DATA_TASK_FAILED');
 return child.status??1;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const index=process.argv.indexOf('--state-dir'),root=process.argv[index+1],name=process.argv[2];
 try {if(index<0||!root||!path.isAbsolute(root)) throw Error('ALPACA_ABSOLUTE_STATE_REQUIRED');process.exitCode=runAlpacaDataTask(root,name);}
 catch(error){process.stderr.write(/^ALPACA_[A-Z_]+$/.test(error.message)?error.message+'\n':'ALPACA_DATA_TASK_FAILED\n');process.exitCode=1;}
}
