import fs from 'node:fs/promises';

// Run the proven broad-universe scanner with a much wider discovery funnel.
// The target is UP TO 20,000 legitimate active/tradable operating-company stocks.
// If the connected market-data universe contains fewer than 20,000, scan all that actually exist
// rather than inventing symbols or padding the tournament with ETFs/warrants.
//
// Pool sizes are matched by pattern, not by exact number, so this keeps working whenever
// expand-stock-universe.mjs changes its own defaults. If a pool constant can't be found,
// the run fails loudly instead of silently scanning the smaller default universe.
let source=await fs.readFile('scripts/expand-stock-universe.mjs','utf8');

const pools={TOP_LIVE_POOL:20000,HISTORY_POOL:20000,VALIDATION_POOL:20000,FINAL_POOL:100};
for(const [name,value] of Object.entries(pools)){
  const pattern=new RegExp(`const ${name}=\\d+;`);
  if(!pattern.test(source))throw new Error(`run-20000-stock-universe: could not find "const ${name}=<number>;" in expand-stock-universe.mjs`);
  source=source.replace(pattern,`const ${name}=${value};`);
}

source=source
  .replace(/TOP_\d+_US_EQUITY_TOURNAMENT/g,'TOP_20000_MAX_US_EQUITY_TOURNAMENT')
  .replace(/top [\d,]+ pre-history tournament/g,'up to 20,000-stock pre-history tournament using every legitimate active/tradable operating-company candidate available')
  .replace(/top [\d,]+ daily-history analysis/g,'every discovered stock daily-history analysis (up to 20,000)')
  .replace(/top [\d,]+ setup-specific/g,'every discovered stock setup-specific')
  .replace(/method:'TOP_\d+_TOURNAMENT'/g,"method:'UP_TO_20000_STOCK_TOURNAMENT'")
  .replace(/top\d+Preview/g,'top20000Preview');

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
