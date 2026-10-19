import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('legacy desktop alert entry point has no UI invocation and installer cannot schedule another popup',()=>{
 const runner=fs.readFileSync('scripts/windows/Show-MonitorAlert.ps1','utf8'),installer=fs.readFileSync('scripts/windows/Install-AlertDelivery.ps1','utf8');
 assert.doesNotMatch(runner,/Add-Type|ShowDialog|TopMost|MessageBox|ToastNotification|Start-Process/i);
 assert.doesNotMatch(installer,/Register-ScheduledTask|Start-ScheduledTask|Enable-ScheduledTask/);
 assert.match(installer,/Disable-ScheduledTask/);
});
test('old task compatibility runner exits without a window or receipt',{skip:process.platform!=='win32'},t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'silent-alert-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.writeFileSync(path.join(root,'installation.json'),'{}');
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.resolve('scripts/windows/Show-MonitorAlert.ps1'),'-StateDir',root],{encoding:'utf8',windowsHide:true,timeout:10000});
 assert.equal(result.status,0,result.stderr);const status=JSON.parse(fs.readFileSync(path.join(root,'desktop-alert-status.json'),'utf8'));assert.equal(status.state,'SILENT_LOG_ONLY');assert.equal(status.userReceiptVerified,false);assert.equal(fs.existsSync(path.join(root,'desktop-alert-receipt.json')),false);
});
