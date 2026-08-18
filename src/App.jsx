import React, { useEffect, useMemo, useState } from 'react';
import {
  BadgeDollarSign,
  BarChart3,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Flame,
  Gauge,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
  XCircle,
} from 'lucide-react';

const demo = {
  asOf: 'Demo data — connect Alpaca backend',
  market: 'DEMO',
  budget: 200,
  featured: {
    symbol: 'NVDA',
    price: 225.1,
    score: 88,
    grade: 'A',
    setup: 'Momentum + affordable defined-risk option',
    entry: 'Wait for price confirmation; do not chase a gap',
    invalidation: 'Exit/reassess if the trend breaks below recent support',
    why: ['Strong multi-month trend', 'Liquid options', 'Defined-risk spread available'],
    option: {
      kind: 'Call debit spread',
      expiry: '2026-10-16',
      longStrike: 235,
      shortStrike: 240,
      debit: 1.86,
      maxRisk: 186,
      maxProfit: 314,
      returnOnRisk: 169,
      delta: 0.41,
      iv: 0.43,
      note: 'Example only until live API is connected',
    },
  },
  cards: [
    { label: 'Steadier pick', symbol: 'JPM', score: 84, tag: 'Quality trend', risk: 'Medium' },
    { label: 'Breakout watch', symbol: 'PLTR', score: 79, tag: 'High beta', risk: 'High' },
    { label: 'Skip options', symbol: 'PANW', score: 68, tag: 'Option IV too rich', risk: 'High' },
  ],
};

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 }).format(Number(n || 0));
const dte = (date) => Math.max(0, Math.round((new Date(date) - new Date()) / 86400000));

function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function App() {
  const [data, setData] = useState(demo);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [budget, setBudget] = useState(200);
  const [mode, setMode] = useState('fast');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/picks?budget=${budget}&mode=${mode}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      setData(await r.json());
    } catch {
      setData({ ...demo, budget });
      setError('Live backend is not connected yet, so this is the demo experience.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const pick = data.featured || demo.featured;
  const option = pick.option;
  const fitsBudget = !option || option.maxRisk <= budget;
  const action = option && fitsBudget && pick.score >= 82 ? 'TRADE CANDIDATE' : pick.score >= 75 ? 'WATCH' : 'SKIP';
  const actionTone = action === 'TRADE CANDIDATE' ? 'good' : action === 'WATCH' ? 'warn' : 'bad';
  const riskLeft = useMemo(() => option ? budget - option.maxRisk : budget, [budget, option]);
  const requiredDoubles = budget > 0 ? Math.ceil(Math.log2(1000000 / budget)) : 0;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow"><Sparkles size={14} /> TESTSTOCK</div>
          <h1>What should I do with my money today?</h1>
          <p>One answer first. Details second. The scanner ranks stocks and cheap defined-risk options, then rejects bad setups automatically.</p>
        </div>
        <button className="refresh" onClick={load} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} /> {loading ? 'Scanning…' : 'Scan now'}
        </button>
      </header>

      <section className="quick-controls">
        <div className="budget-card">
          <WalletCards size={18} />
          <div className="budget-copy"><span>How much can I lose on one idea?</span><strong>This is your hard max loss.</strong></div>
          <div className="budget-input"><span>$</span><input value={budget} onChange={(e) => setBudget(Math.max(25, Number(e.target.value) || 0))} inputMode="numeric" /></div>
        </div>
        <div className="mode-card">
          <span>Style</span>
          <div className="mode-buttons">
            <button className={mode === 'fast' ? 'active' : ''} onClick={() => setMode('fast')}>Fast upside</button>
            <button className={mode === 'balanced' ? 'active' : ''} onClick={() => setMode('balanced')}>Balanced</button>
          </div>
        </div>
      </section>

      <div className="scan-status"><span className="status-dot" /><strong>{data.market || 'UNKNOWN'}</strong><small>{data.asOf}</small></div>
      {error && <div className="notice"><CircleAlert size={18} /> {error}</div>}

      <section className="decision-card">
        <div className="decision-top">
          <div>
            <Pill tone={actionTone}><Flame size={13} /> {action}</Pill>
            <div className="ticker-line"><span>{pick.symbol}</span><b>{money(pick.price)}</b></div>
            <p className="decision-summary">{pick.setup}</p>
          </div>
          <div className="score-badge"><small>SETUP SCORE</small><strong>{pick.score}</strong><span>{pick.grade || '—'}</span></div>
        </div>

        <div className="simple-answer">
          <div className="answer-icon"><Target size={22}/></div>
          <div>
            <span>What to do</span>
            <strong>{action === 'TRADE CANDIDATE' ? 'Wait for confirmation, then use the defined-risk setup below.' : action === 'WATCH' ? 'Watch it. Do not force a trade yet.' : 'Skip it today.'}</strong>
          </div>
        </div>

        <div className="reason-list">
          {(pick.why || []).slice(0,4).map((x) => <div key={x}><CheckCircle2 size={16}/><span>{x}</span></div>)}
        </div>
      </section>

      <section className="moonshot-card">
        <div className="section-title">
          <div><Rocket size={21}/><div><span>CHEAPEST GOOD UPSIDE</span><h2>{option ? option.kind : 'No option worth taking'}</h2></div></div>
          <Pill tone={option ? 'good' : 'bad'}>{option ? `${dte(option.expiry)} DTE` : 'Skip'}</Pill>
        </div>

        {option ? (
          <>
            <div className="trade-ticket">
              <div className="leg buy"><small>BUY</small><strong>{pick.symbol} ${option.longStrike} Call</strong><span>{option.expiry}</span></div>
              <ChevronRight size={20}/>
              <div className="leg sell"><small>SELL</small><strong>{pick.symbol} ${option.shortStrike} Call</strong><span>{option.expiry}</span></div>
            </div>

            <div className="money-row">
              <div><span>Max you can lose</span><strong>{money(option.maxRisk)}</strong></div>
              <div><span>Max possible profit</span><strong>{money(option.maxProfit)}</strong></div>
              <div><span>Max return on risk</span><strong>{option.returnOnRisk}%</strong></div>
            </div>

            <div className={`budget-verdict ${fitsBudget ? 'ok' : 'bad'}`}>
              {fitsBudget ? <CheckCircle2 size={18}/> : <XCircle size={18}/>} 
              {fitsBudget ? `Fits your ${money(budget)} cap. ${money(Math.max(0, riskLeft))} remains unused.` : `Too expensive. Your max loss cap is ${money(budget)}.`}
            </div>

            <div className="plain-english">
              <div><Clock3 size={17}/><span><b>Expiration:</b> {option.expiry} ({dte(option.expiry)} days away)</span></div>
              <div><Gauge size={17}/><span><b>Why this structure:</b> limited loss, cheaper than buying the call by itself, and enough time for the thesis to work.</span></div>
              {option.note && <div><CircleAlert size={17}/><span>{option.note}</span></div>}
            </div>
          </>
        ) : <div className="empty-state">No option passed the budget, spread, volatility, trend, and payoff filters. That is a valid result.</div>}
      </section>

      <section className="road-card">
        <div className="section-title"><div><BarChart3 size={21}/><div><span>ROAD TO $1M</span><h2>Keep the goal visible without lying about the odds</h2></div></div></div>
        <div className="road-grid">
          <div><span>Starting risk budget</span><strong>{money(budget)}</strong></div>
          <div><span>Perfect doublings needed</span><strong>{requiredDoubles}</strong></div>
          <div><span>Reality check</span><strong>Very hard</strong></div>
        </div>
        <p>Turning a small account into $1M requires many exceptional wins and surviving losses. This app optimizes for upside per dollar, not guaranteed speed.</p>
      </section>

      <section className="watch-section">
        <div className="section-title"><div><TrendingUp size={21}/><div><span>NEXT BEST</span><h2>Only three things to watch</h2></div></div></div>
        <div className="watch-grid">
          {(data.cards || []).map((c, i) => (
            <article className="watch-card" key={`${c.symbol}-${i}`}>
              <div className="watch-top"><Pill tone={i === 0 ? 'good' : i === 2 ? 'warn' : 'neutral'}>{c.label}</Pill><b>{c.score}</b></div>
              <h3>{c.symbol}</h3>
              <p>{c.tag}</p>
              <div className="risk-row"><span>Risk</span><strong>{c.risk}</strong></div>
            </article>
          ))}
        </div>
      </section>

      <section className="rules-card">
        <div className="section-title"><div><ShieldCheck size={21}/><div><span>AUTO-PROTECTION</span><h2>The app says no for you</h2></div></div></div>
        <div className="rules-grid">
          <span>Rejects 0DTE and ultra-short lottery tickets</span>
          <span>Rejects ugly bid/ask spreads</span>
          <span>Rejects weak reward-to-risk</span>
          <span>Rejects deteriorating stock trends</span>
          <span>Rejects overpriced option volatility</span>
          <span>Rejects anything over your max-loss cap</span>
        </div>
      </section>

      <footer><p>Teststock is a screening tool, not a promise of profit. Options can lose the entire amount at risk.</p></footer>
    </main>
  );
}

export default App;
