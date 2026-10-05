import fs from 'node:fs/promises';
import {buildIndexOptionsResearch} from './index-options-research-engine.mjs';

const read=async(f,x={})=>{try{return JSON.parse(await fs.readFile(f,'utf8'));}catch{return x;}};
const scan=await read('docs/data/small-account-options.json',{candidates:[]});
const out=buildIndexOptionsResearch({optionsScan:scan});
await fs.writeFile('docs/data/index-options-research.json',JSON.stringify(out,null,2)+'\n');
console.log('Index-options research: '+out.candidates.map(x=>x.indexSymbol+':'+x.researchStatus).join(', '));
