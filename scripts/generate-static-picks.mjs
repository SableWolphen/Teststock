import fs from 'node:fs/promises';
import path from 'node:path';
import handler from '../api/picks.js';

const budgets = [50, 100, 200, 500];
const outDir = path.resolve('docs/data');
await fs.mkdir(outDir, { recursive: true });

function runHandler(budget) {
  return new Promise((resolve, reject) => {
    const req = { query: { budget: String(budget), mode: 'aggressive' } };
    const res = {
      code: 200,
      headers: {},
      setHeader(name, value) { this.headers[name] = value; },
      status(code) { this.code = code; return this; },
      json(body) {
        if (this.code >= 400) reject(new Error(body?.error || `Scanner failed with ${this.code}`));
        else resolve(body);
      }
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

const manifest = { generatedAt: new Date().toISOString(), budgets: [] };
for (const budget of budgets) {
  try {
    const data = await runHandler(budget);
    data.generatedBy = 'GitHub Actions';
    data.staticBudget = budget;
    await fs.writeFile(path.join(outDir, `latest-${budget}.json`), JSON.stringify(data, null, 2));
    manifest.budgets.push({ budget, ok: true, asOf: data.asOf });
    console.log(`Generated $${budget} scan: ${data.action} ${data.featured?.symbol || ''}`);
  } catch (error) {
    const failure = { generatedAt: new Date().toISOString(), budget, error: error.message };
    await fs.writeFile(path.join(outDir, `latest-${budget}.json`), JSON.stringify(failure, null, 2));
    manifest.budgets.push({ budget, ok: false, error: error.message });
    console.error(`$${budget} scan failed:`, error.message);
  }
}
await fs.writeFile(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
