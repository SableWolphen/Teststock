import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {alertReceipt} from './alert-receipt.mjs';
const now=Date.parse('2026-10-19T14:00:00Z'),id='14739b76-81ac-489a-9ddb-7cabeed40e0a';
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'alert-receipt-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const save=(n,v)=>fs.writeFileSync(path.join(root,n),JSON.stringify(v));save('desktop-alert-status.json',{at:new Date(now).toISOString(),state:'DISPLAYED'});save('desktop-alert-challenge.json',{version:1,id,createdAt:new Date(now-60000).toISOString(),expiresAt:new Date(now+60000).toISOString()});return {root,save};}
test('displaying an alert or writing a log alone never verifies receipt',t=>{
 const {root}=setup(t);assert.equal(alertReceipt(root,{now}).userReceiptVerified,false);
});
test('receipt must match this challenge, be clicked within its lifetime, and have current delivery health',t=>{
 const {root,save}=setup(t),r={challengeId:id,acknowledgedAt:new Date(now).toISOString(),source:'DESKTOP_ACKNOWLEDGE_BUTTON'};
 save('desktop-alert-receipt.json',r);assert.equal(alertReceipt(root,{now}).userReceiptVerified,true);
 for(const patch of [{challengeId:'wrong'},{source:'LOG_WRITE'},{acknowledgedAt:new Date(now-120000).toISOString()},{acknowledgedAt:new Date(now+120000).toISOString()}]){save('desktop-alert-receipt.json',{...r,...patch});assert.equal(alertReceipt(root,{now}).userReceiptVerified,false);}
 save('desktop-alert-receipt.json',r);save('desktop-alert-status.json',{at:new Date(now-120001).toISOString(),state:'READY'});assert.equal(alertReceipt(root,{now}).userReceiptVerified,false);
 save('desktop-alert-status.json',{at:new Date(now).toISOString(),state:'DELIVERY_FAILED'});assert.equal(alertReceipt(root,{now}).userReceiptVerified,false);
});
test('a prior session acknowledgement does not carry into another trading day',t=>{
 const {root,save}=setup(t);save('desktop-alert-receipt.json',{challengeId:id,acknowledgedAt:new Date(now).toISOString(),source:'DESKTOP_ACKNOWLEDGE_BUTTON'});save('desktop-alert-status.json',{at:new Date(now+86400000).toISOString(),state:'READY'});assert.equal(alertReceipt(root,{now:now+86400000}).userReceiptVerified,false);
});
