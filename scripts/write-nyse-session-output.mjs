import fs from 'node:fs/promises';
import {readCalendarSession,sessionOutputs} from './alpaca-session-gate.mjs';

const out=process.argv[2];
if(!out)throw new Error('GITHUB_OUTPUT path required');
const session=await readCalendarSession();
await fs.appendFile(out,sessionOutputs(session));
// No credentials, provider bodies, or broker state enter this diagnostic.
if(process.env.TESTSTOCK_SESSION_STATUS_FILE)await fs.writeFile(process.env.TESTSTOCK_SESSION_STATUS_FILE,JSON.stringify(session,null,2));
console.log(JSON.stringify(session));
if(!session.calendarAvailable){
  console.error('NYSE session unverified: '+session.code+'. Verify a matching paper-account key pair in Actions secrets ALPACA_API_KEY / ALPACA_API_SECRET. Entries remain blocked.');
  process.exitCode=1;
}
