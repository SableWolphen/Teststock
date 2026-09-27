import fs from 'node:fs/promises';
import path from 'node:path';

const file=process.argv[2];
if(!file)throw new Error('heartbeat output path is required');
await fs.mkdir(path.dirname(file),{recursive:true});
const heartbeat={schemaVersion:1,state:'ACTIVE',updatedAt:new Date().toISOString(),pid:process.pid};
const temporary=`${file}.tmp`;
await fs.writeFile(temporary,JSON.stringify(heartbeat,null,2));
await fs.rename(temporary,file);
console.log(`Runner heartbeat refreshed at ${heartbeat.updatedAt}`);
