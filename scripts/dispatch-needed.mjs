import fs from 'node:fs';
const dispatch=JSON.parse(fs.readFileSync(process.argv[2]||'docs/data/execution-dispatch.json','utf8'));
if(typeof dispatch.chatgptShouldRun!=='boolean'||typeof dispatch.executionNeeded!=='boolean')throw new Error('Invalid execution dispatch flags');
console.log(dispatch.chatgptShouldRun||dispatch.executionNeeded?'true':'false');
