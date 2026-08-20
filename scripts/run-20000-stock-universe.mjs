import fs from 'node:fs/promises';

// Run the proven broad-universe scanner with a much wider discovery funnel.
// The target is UP TO 20,000 legitimate active/tradable operating-company stocks.
// If the connected market-data universe contains fewer than 20,000, scan all that actually exist
// rather than inventing symbols or padding the tournament with ETFs/warrants.
let source=await fs.readFile('scripts/expand-stock-universe.mjs','utf8');
source=source
  .replace('const TOP_LIVE_POOL=2000;','const TOP_LIVE_POOL=20000;')
  .replace('const HISTORY_POOL=800;','const HISTORY_POOL=2000;')
  .replace('const VALIDATION_POOL=300;','const VALIDATION_POOL=800;')
  .replace('const FINAL_POOL=60;','const FINAL_POOL=100;')
  .replaceAll('TOP_2000_US_EQUITY_TOURNAMENT','TOP_20000_MAX_US_EQUITY_TOURNAMENT')
  .replaceAll('top 2,000 pre-history tournament','up to 20,000-stock pre-history tournament using every legitimate active/tradable operating-company candidate available')
  .replaceAll('top 800 daily-history analysis','top 2,000 daily-history analysis')
  .replaceAll('top 300 setup-specific','top 800 setup-specific')
  .replaceAll("method:'TOP_2000_TOURNAMENT'","method:'UP_TO_20000_STOCK_TOURNAMENT'")
  .replaceAll('top2000Preview','top20000Preview');

await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
