import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// Fixed read-only source files only. Never copy credentials, journals or the order executor.
export const MONITOR_BUNDLE_FILES=Object.freeze(['windows-monitor.mjs','monitor-reconciliation.mjs','monitor-lock.mjs','robinhood-oauth.mjs','alpaca-data-client.mjs','stock-quote-fallback.mjs','protection-coverage.mjs','protection-shadow-drill.mjs','safety-policy.mjs','verify-protection-readiness.mjs','option-monitor-quotes.mjs','session-exit-review.mjs','alert-receipt.mjs']);
export function installReadOnlyBundle(repo,state) {
  if(!path.isAbsolute(repo)||!path.isAbsolute(state))throw Error('ABSOLUTE_BUNDLE_PATHS_REQUIRED');
  const files=MONITOR_BUNDLE_FILES.map(name=>({name,bytes:fs.readFileSync(path.join(repo,'scripts',name))}));
  const hash=crypto.createHash('sha256');for(const f of files)hash.update(f.name+'\0').update(f.bytes);
  const digest=hash.digest('hex'),root=path.join(state,'bundles','monitor-'+digest);
  fs.mkdirSync(root,{recursive:true});
  for(const {name,bytes} of files) {
    const target=path.join(root,name);
    if(fs.existsSync(target)) {if(!fs.readFileSync(target).equals(bytes))throw Error('MONITOR_BUNDLE_INTEGRITY_FAILURE');}
    else fs.writeFileSync(target,bytes,{flag:'wx',mode:0o600});
  }
  return {bundleDigest:digest,monitorRunner:path.join(root,'windows-monitor.mjs'),protectionAudit:path.join(root,'verify-protection-readiness.mjs'),fileCount:files.length};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const i=process.argv.indexOf('--state-dir');if(i<0)throw Error();
    console.log(JSON.stringify(installReadOnlyBundle(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),process.argv[i+1])));
  }catch{console.error('READ_ONLY_BUNDLE_INSTALL_FAILED');process.exitCode=1;}
}
