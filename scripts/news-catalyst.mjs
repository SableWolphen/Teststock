// Shared multi-source news aggregation, used by enrich-stock-finalists.mjs (main research pool)
// and build-new-listing-live-candidates.mjs (new-listing seed-lane shortlist).
//
// Sources actually reachable from a headless GitHub Actions script without a new paid credential:
//  - Alpaca news (official, uses the Alpaca keys already configured everywhere else in this repo)
//  - Google News RSS (free, keyless, unofficial but widely used)
//  - Yahoo Finance's public search endpoint (free, keyless, unofficial)
// X/Twitter is deliberately NOT included: there is no free API tier with usable search access, and
// scraping it is both unreliable (frequent blocks/logins) and against its terms of service. Adding
// real Twitter coverage would require a paid X API credential configured as a new repo secret.
// Robinhood and Stocklake news are NOT fetched here either -- both are MCP tools tied to an
// authenticated Claude session, not callable from a static script with no session context. They are
// already required at the live pre-trade check (see claude-executor-prompt.md) before any order.
//
// Every source fails closed independently (a blocked/rate-limited free source just contributes zero
// articles, never breaks the run) since none of these are trusted enough alone to justify failing
// the whole enrichment step.

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const chunks=(a,n)=>Array.from({length:Math.ceil(a.length/n)},(_,i)=>a.slice(i*n,(i+1)*n));
const stripHtml=s=>String(s||'').replace(/<!\[CDATA\[|\]\]>/g,'').replace(/<[^>]*>/g,'').trim();

export async function fetchAlpacaNews(symbols,alpacaHeaders,batchSize=25){
  let articles=[];
  for(const batch of chunks(symbols,batchSize)){
    try{
      const r=await fetch(`https://data.alpaca.markets/v1beta1/news?symbols=${encodeURIComponent(batch.join(','))}&limit=50&sort=desc`,{headers:alpacaHeaders});
      if(r.ok){
        const x=await r.json();
        articles=[...articles,...(x?.news||[]).map(n=>({symbols:n.symbols||[],headline:n.headline||null,createdAt:n.created_at||n.updated_at||null,source:'ALPACA',link:n.url||null}))];
      }
    }catch{}
  }
  return articles;
}

export async function fetchGoogleNews(symbol){
  try{
    const q=encodeURIComponent(`${symbol} stock`);
    const r=await fetch(`https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`,{headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok)return[];
    const xml=await r.text();
    const items=[...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0,10);
    return items.map(m=>{
      const block=m[1];
      const title=stripHtml((block.match(/<title>([\s\S]*?)<\/title>/)||[])[1]||'');
      const pubDate=(block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)||[])[1]||null;
      const link=(block.match(/<link>([\s\S]*?)<\/link>/)||[])[1]||null;
      const source=stripHtml((block.match(/<source[^>]*>([\s\S]*?)<\/source>/)||[])[1]||'Google News');
      const createdAt=pubDate?new Date(pubDate).toISOString():null;
      return {symbols:[symbol],headline:title||null,createdAt,source:`GOOGLE_NEWS:${source}`,link};
    }).filter(x=>x.headline);
  }catch{return[];}
}

export async function fetchYahooNews(symbol){
  try{
    const r=await fetch(`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(symbol)}&newsCount=10&quotesCount=0`,{headers:{'User-Agent':'Mozilla/5.0'}});
    if(!r.ok)return[];
    const data=await r.json();
    return (data?.news||[]).map(n=>({symbols:[symbol],headline:n.title||null,createdAt:n.providerPublishTime?new Date(n.providerPublishTime*1000).toISOString():null,source:`YAHOO:${n.publisher||'Yahoo Finance'}`,link:n.link||null})).filter(x=>x.headline);
  }catch{return[];}
}

// Fetches Google News + Yahoo per symbol (no multi-symbol batch endpoint exists for either), with a
// small delay between symbols to stay polite to two free unofficial endpoints with no auth of their own.
export async function fetchPerSymbolNews(symbols,{delayMs=180}={}){
  const bySymbol=new Map();
  for(const symbol of symbols){
    const [google,yahoo]=await Promise.all([fetchGoogleNews(symbol),fetchYahooNews(symbol)]);
    bySymbol.set(symbol,[...google,...yahoo]);
    await sleep(delayMs);
  }
  return bySymbol;
}

const BINARY_RE=/bankrupt|chapter 11|halt|offering|secondary offering|fda|merger|acquisition|earnings|guidance|lawsuit|sec investigation/i;
const POSITIVE_RE=/beats|raises guidance|approval|contract|record revenue|buyback/i;
const NEGATIVE_RE=/misses|cuts guidance|offering|bankrupt|investigation|halt/i;

export function classifyCatalyst(symbol,articles,windowHours=72){
  const cutoff=Date.now()-windowHours*3600e3;
  const inWindow=articles.filter(n=>(n.symbols||[]).includes(symbol)&&Number.isFinite(Date.parse(n.createdAt||''))&&Date.parse(n.createdAt)>=cutoff);
  const seen=new Set(),dedup=[];
  for(const n of inWindow.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))){
    const key=String(n.headline||'').toLowerCase().replace(/\s+/g,' ').trim();
    if(key&&!seen.has(key)){seen.add(key);dedup.push(n);}
  }
  const text=dedup.map(n=>String(n.headline||'')).join(' ').toLowerCase();
  const binary=BINARY_RE.test(text),positive=POSITIVE_RE.test(text),negative=NEGATIVE_RE.test(text);
  return {
    articleCount:dedup.length,
    windowHours,
    binaryRisk:binary,
    sentimentHint:dedup.length?(positive&&!negative?'POSITIVE':negative&&!positive?'NEGATIVE':'MIXED_OR_UNKNOWN'):'NO_RECENT_NEWS',
    sourcesUsed:[...new Set(dedup.map(n=>String(n.source||'').split(':')[0]))],
    headlines:dedup.slice(0,5).map(n=>({headline:n.headline||null,createdAt:n.createdAt||null,source:n.source||null,link:n.link||null})),
    sourcesQueried:['ALPACA_NEWS','GOOGLE_NEWS_RSS','YAHOO_FINANCE_SEARCH'],
    note:'Keyword-based diagnostic only across multiple free/public sources; never a hard eligibility gate. A live pre-trade news check (including Robinhood and Stocklake news) still applies before any order.'
  };
}
