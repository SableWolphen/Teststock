import {DEFAULT_PLAN,projectPlan,summarizeJournal} from './freedom-model.mjs';
const money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(n);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const storageKey='teststock-freedom-v1';
export class FinancialFreedom extends (globalThis.HTMLElement||class {}) {
  connectedCallback() {
    if(this.initialized)return;this.initialized=true;
    let saved;try{saved=JSON.parse(localStorage.getItem(storageKey));projectPlan(saved);}catch{saved=null;}
    this.plan={...DEFAULT_PLAN,...saved};
    this.innerHTML=`<style>
      financial-freedom{display:block;color:inherit} .ff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:16px;margin:20px 0}.ff-field{display:grid;gap:8px}.ff-field input,.ff-field select{font:inherit;color:inherit;background:transparent;border:1px solid #667085;border-radius:8px;padding:10px;min-width:0;width:100%;box-sizing:border-box}.ff-card{padding:18px;border:1px solid #667085;border-radius:12px}.ff-card strong{display:block;font-size:1.5rem;margin:8px 0}.ff-table{overflow:auto}financial-freedom table{width:100%;border-collapse:collapse}financial-freedom th,financial-freedom td{text-align:left;padding:12px;border-bottom:1px solid #667085}financial-freedom p{line-height:1.6}financial-freedom progress{width:100%;height:18px}financial-freedom button{font:inherit;padding:10px;border-radius:8px;cursor:pointer}.ff-error{color:#e89076}
    </style><h2>Financial Freedom</h2><p>$10,000/month is the goal. The next 1–2 years are a planning horizon, not a promised deadline.</p><p><b>Planning inputs only.</b> The $76.21 starting example is a historical app default, not a current brokerage balance. Enter your current investable capital. Edits stay in this browser; they never change trading budgets, admission or execution.</p><form class="ff-grid">
    ${[['capital','Current investable capital ($)'],['contribution','Optional monthly contribution ($)'],['monthlyIncome','Monthly spending in today’s dollars ($)'],['annualReturn','Illustrative net nominal annual return (%)'],['withdrawalRate','Illustrative annual withdrawal rate (%)'],['inflation','Annual inflation assumption (%)']].map(([key,label])=>`<label class="ff-field">${label}<input name="${key}" type="number" step="any" value="${this.plan[key]}" required></label>`).join('')}
    <label class="ff-field">Planning horizon<select name="months"><option value="12" ${this.plan.months===12?'selected':''}>1 year</option><option value="24" ${this.plan.months===24?'selected':''}>2 years</option></select></label><button type="button" id="ff-reset">Reset example</button></form><p class="ff-error" role="alert"></p><div class="ff-results" aria-live="polite"></div><section class="ff-evidence"><h3>Trading results</h3><p>Loading published journal…</p></section>`;
    this.querySelector('form').addEventListener('submit',e=>e.preventDefault());
    this.querySelector('form').addEventListener('input',()=>this.update());
    this.querySelector('#ff-reset').addEventListener('click',()=>{for(const [key,value] of Object.entries(DEFAULT_PLAN))this.querySelector(`[name="${key}"]`).value=value;this.update();});
    this.update();
    this.loadEvidence();
  }
  async loadEvidence() {
    try {
      const response=await fetch(new URL('./data/real-trade-journal.json',import.meta.url),{cache:'no-store'});
      if(!response.ok)throw Error();
      const s=summarizeJournal(await response.json());if(!s.available)throw Error();
      if(!this.isConnected)return;
      this.querySelector('.ff-evidence').innerHTML=`<h3>Published trading results</h3><p>Journal reconciliation: ${escape(s.asOf||'unknown')} · ${s.stale?'Stale / historical evidence':'Within 24 hours; independently verify broker state'}.</p><p>${s.confirmed} uniquely identified broker-reconciled records; ${s.closed} closed records; ${s.classified} with a classified outcome. Dollar P&amp;L available for ${s.dollarCoverage}/${s.closed} closed records. Total realized P&amp;L: <b>${s.totalPnl===null?'Unknown / incomplete':money(s.totalPnl)}</b>. Known subset: ${s.knownPnl===null?'unknown':money(s.knownPnl)}. Duplicate rows excluded: ${s.excludedDuplicateRows}.</p><p>Unknown outcomes and missing quantities/costs prevent a complete performance claim. Paper, historical and synthetic replay results are excluded. These records do not establish a monthly return or sustainable income and are never extrapolated into this plan.</p>`;
    }catch{if(this.isConnected)this.querySelector('.ff-evidence').innerHTML='<h3>Trading results unavailable</h3><p>The published journal could not be loaded. No zero profit or live execution is inferred.</p>';}
  }
  update() {
    try {
      const values=Object.fromEntries([...this.querySelectorAll('[name]')].map(el=>[el.name,el.value.trim()===''?NaN:Number(el.value)]));
      const p=projectPlan(values);this.plan=values;
      try{localStorage.setItem(storageKey,JSON.stringify(values));}catch{}
      this.querySelector('.ff-error').textContent='';
      this.querySelector('.ff-results').innerHTML=`<div class="ff-grid">
      ${[['Capital needed today',p.targetToday],['Inflation-adjusted target at deadline',p.requiredCapital],['Projected capital at deadline',p.projectedCapital],['Remaining projected gap',p.gap],['Monthly withdrawal capacity at deadline',p.monthlyCapacity],['Monthly contribution needed in this model',p.requiredContribution]].map(([label,value])=>`<div class="ff-card"><span>${label}</span><strong>${money(value)}</strong></div>`).join('')}</div>
      <p><b>${p.gap>0?'The selected plan does not reach the income target.':'The arithmetic reaches the target; sustainability remains uncertain.'}</b> A shortfall is a reason to revisit savings, spending or the timeline. It never justifies larger trades, leverage or weaker safeguards.</p>
      <label>Current capital progress: ${p.progress.toFixed(4)}%<progress value="${p.progress}" max="100"></progress></label>
      <p>Capital bridge: ${money(p.capital)} starting capital + ${money(p.deposits)} contributions + ${money(p.modeledGrowth)} modeled growth = ${money(p.projectedCapital)}. Contributions arrive at each month’s end; no withdrawals occur during accumulation.</p>
      <h3>Alternative annual-return scenarios</h3><div class="ff-table"><table><thead><tr><th>Net annual return</th><th>12 months</th><th>24 months</th></tr></thead><tbody>${p.scenarios.map(s=>`<tr><td>${s.annualReturn}%${s.annualReturn<0?' stress':''}</td><td>${money(projectPlan({...values,months:12,annualReturn:s.annualReturn}).projectedCapital)}</td><td>${money(projectPlan({...values,months:24,annualReturn:s.annualReturn}).projectedCapital)}</td></tr>`).join('')}</tbody></table></div>
      <h3>Withdrawal sustainability</h3><p>At the selected ${p.withdrawalRate}% annual withdrawal assumption, deadline spending is ${money(p.incomeAtDeadline)}/month before tax. Spending that amount from the projected balance with zero subsequent return would fund about ${p.zeroReturnRunwayMonths} full month${p.zeroReturnRunwayMonths===1?'':'s'}, with no inflation adjustment during that depletion illustration. Withdrawal capacity is annual portfolio withdrawals divided by 12, not guaranteed dividends or trading income.</p>
      <h3>Capital milestones</h3><div class="ff-table"><table><thead><tr><th>Capital</th><th>Monthly capacity at selected rate</th><th>Status</th></tr></thead><tbody>${p.milestones.map(m=>`<tr><td>${money(m.capital)}</td><td>${money(m.monthlyIncome)}</td><td>${m.achieved?'Reached with entered capital':m.projected?'Reached in selected model':'Beyond selected model'}</td></tr>`).join('')}</tbody></table></div>
      <h3>Explicit assumptions</h3><p>USD. Returns are hypothetical effective annual rates after investment fees and trading costs, before personal taxes; they are not forecasts or measured strategy returns. Monthly compounding uses (1 + annual rate)^(1/12) − 1. The income target rises with assumed inflation until the deadline. Withdrawal rates are adjustable illustrations, not a certified safe rate. Taxes, future inflation, losses, sequence of returns and longevity can require more capital. The −20% scenario is a smooth stress illustration, not a worst case. No success probability or guaranteed arrival date is claimed.</p><p><b>Live execution remains disabled by repository policy.</b> Windows monitoring reads data only. Broker entry, fills, protection, exits and alert delivery have not been verified as an operational automated service.</p>`;
    }catch(error){this.querySelector('.ff-error').textContent=error.message;this.querySelector('.ff-results').innerHTML='<p>Correct the inputs to calculate a plan.</p>';}
  }
}
if(globalThis.customElements&&!customElements.get('financial-freedom'))customElements.define('financial-freedom',FinancialFreedom);
