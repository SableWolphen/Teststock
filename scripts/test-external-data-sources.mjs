import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const registry=JSON.parse(readFileSync(new URL('../docs/external-data-sources.json',import.meta.url),'utf8'));
test('external feeds remain research only',()=>{assert.equal(registry.mode,'RESEARCH_ONLY');assert.ok(registry.admissionRules.some(x=>x.includes('broker-authoritative')));assert.ok(registry.admissionRules.some(x=>x.includes('attestation')))});
test('feeds have usage and compliance metadata',()=>{assert.ok(registry.sources.length>=3);for(const source of registry.sources){assert.ok(source.url.startsWith('https://'));assert.ok(source.auth);assert.ok(source.freshness);assert.ok(source.constraints.length)}});
