import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  BadgeDollarSign,
  CircleAlert,
  Flame,
  Gauge,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  WalletCards,
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
    setup: 'Momentum continuation',
    entry: 'Wait for confirmation above resistance',
    invalidation: 'Close below recent support',
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
      note: 'Example only until live API is connected',
    },
  },
  cards: [
    { label: 'Steadier pick', symbol: 'JPM', score: 84, tag: 'Quality trend', risk: 'Medium' },
    { label: 'Breakout watch', symbol: 'PLTR', score: 79, tag: 'High beta', risk: 'High' },
    { label: 'Avoid chasing', symbol: 'PANW', score: 68, tag: 'Option IV too rich', risk: 'High' },
  ],
};

const money = (n) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: n < 10 ? 2 : 0 }).format(n);

function Pill({ children, tone = 'neutral' }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Metric({ icon: Icon, label, value, sub }) {
  return (
    <div className="metric">
      <div className="metric-icon"><Icon size={18} /></div>
      <div><div className="metric-label">{label}</div><div className="metric-value">{value}</div>{sub && <div className="metric-sub">{sub}</div>}</div>
    </div>
  );
}

function App() {
  const [data, setData] = useState(demo);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [budget, setBudget] = useState(200);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const r = await fetch(`/api/picks?budget=${budget}`);
      if (!r.ok) throw new Error(`API ${r.status}`);
      const json = await r.json();
      setData(json);
    } catch (e) {
      setData({ ...demo, budget });
      setError('Live market backend is not connected yet. Showing the demo layout.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const pick = data.featured || demo.featured;
  const option = pick.option;
  const budgetFit = useMemo(() => option ? Math.max(0, Math.round((budget - option.maxRisk) * 100) / 100) : budget, [budget, option]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow"><Sparkles size={14} /> TESTSTOCK</div>
          <h1>Small-money opportunity engine</h1>
          <p>Ranks stocks and defined-risk option setups. No guaranteed winners. No fake certainty.</p>
        </div>
        <button className="refresh" onClick={load} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} /> {loading ? 'Scanning…' : 'Refresh'}
        </button>
      </header>

      <section className="control-strip">
        <div className="budget-box">
          <WalletCards size={18} />
          <div>
            <span>Max risk per moonshot</span>
            <div className="budget-input"><span>$</span><input value={budget} onChange={(e) => setBudget(Math.max(25, Number(e.target.value) || 0))} inputMode="numeric" /></div>
          </div>
        </div>
        <div className="status-box">
          <span className="status-dot" />
          <div><strong>{data.market || 'UNKNOWN'}</strong><small>{data.asOf}</small></div>
        </div>
      </section>

      {error && <div className="notice"><CircleAlert size={18} /> {error}</div>}

      <section className="hero-card">
        <div className="hero-head">
          <div>
            <Pill tone="hot"><Flame size={13} /> Best setup</Pill>
            <div className="ticker-line"><span>{pick.symbol}</span><b>{money(pick.price)}</b></div>
            <div className="setup-name">{pick.setup}</div>
          </div>
          <div className="score-ring"><span>{pick.score}</span><small>/100</small></div>
        </div>

        <div className="hero-grid">
          <Metric icon={Target} label="Entry" value={pick.entry} />
          <Metric icon={ShieldCheck} label="Invalidation" value={pick.invalidation} />
          <Metric icon={Gauge} label="Grade" value={pick.grade || '—'} sub="Model score + risk filters" />
        </div>

        <div className="why-row">
          {(pick.why || []).map((x) => <span key={x}><TrendingUp size={14} /> {x}</span>)}
        </div>
      </section>

      <section className="option-card">
        <div className="section-title">
          <div><Rocket size={20} /><div><span>CHEAP MOONSHOT</span><h2>{option ? option.kind : 'No option trade'}</h2></div></div>
          <Pill tone={option ? 'good' : 'neutral'}>{option ? 'Defined risk' : 'Skip'}</Pill>
        </div>

        {option ? (
          <>
            <div className="contract-line">
              <div><small>BUY</small><strong>{pick.symbol} {option.expiry} ${option.longStrike}C</strong></div>
              <ArrowRight size={18} />
              <div><small>SELL</small><strong>{pick.symbol} {option.expiry} ${option.shortStrike}C</strong></div>
            </div>
            <div className="payoff-grid">
              <div><span>Est. cost</span><strong>{money(option.maxRisk)}</strong></div>
              <div><span>Max profit</span><strong>{money(option.maxProfit)}</strong></div>
              <div><span>Return on risk</span><strong>{option.returnOnRisk}%</strong></div>
            </div>
            <div className={`budget-verdict ${budgetFit >= 0 ? 'ok' : 'bad'}`}>
              <BadgeDollarSign size={18} />
              {budgetFit >= 0 ? `Fits your $${budget} risk cap with ${money(budgetFit)} left.` : `Too expensive for your $${budget} cap.`}
            </div>
            {option.note && <p className="fineprint">{option.note}</p>}
          </>
        ) : <div className="empty-state">The scanner rejected the options chain. Shares/watchlist only.</div>}
      </section>

      <section className="watch-grid">
        {(data.cards || []).map((c, i) => (
          <article className="watch-card" key={`${c.symbol}-${i}`}>
            <div className="watch-top"><Pill tone={i === 0 ? 'good' : i === 2 ? 'warn' : 'neutral'}>{c.label}</Pill><b>{c.score}</b></div>
            <h3>{c.symbol}</h3>
            <p>{c.tag}</p>
            <div className="risk-row"><span>Risk</span><strong>{c.risk}</strong></div>
          </article>
        ))}
      </section>

      <section className="rules-card">
        <div className="section-title"><div><ShieldCheck size={20}/><div><span>AUTO-REJECT RULES</span><h2>What the engine refuses to buy</h2></div></div></div>
        <div className="rules-grid">
          <span>0DTE / ultra-short lottery tickets</span>
          <span>Wide bid-ask spreads</span>
          <span>Bad reward-to-risk</span>
          <span>Weak or deteriorating trend</span>
          <span>Options too expensive vs. stock move</span>
          <span>Risk above your dollar cap</span>
        </div>
      </section>

      <footer>
        <p><strong>Goal:</strong> maximize upside per dollar without pretending any trade can make someone a millionaire quickly or reliably.</p>
      </footer>
    </main>
  );
}

export default App;
