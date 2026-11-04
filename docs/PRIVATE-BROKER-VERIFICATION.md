# Private broker verification contract

Teststock HQ is a **public GitHub Pages site**, not a Robinhood-authenticated application. GitHub JSON ledgers never prove broker positions, fills, realized P&L, or unrealized P&L. The connected Robinhood tool in ChatGPT does **not** provide a credential or authenticated session to website visitors.

## Current implementation

The HQ browser optionally requests `GET /api/broker/verified-summary` using a same-origin HTTPS request with cookies and `cache: no-store`. GitHub Pages cannot serve this endpoint. Without a separately deployed private backend, the HQ must show **UNVERIFIED** and **NOT AVAILABLE**. These are expected truthful statuses, not a failed trade.

The server should respond `401` for unauthenticated visitors and set `Cache-Control: private, no-store`. Require an authenticated session and explicit per-account permission. The **private** server must independently read Robinhood account positions, fills, and realized P&L, reconcile pending/partial orders, compute marked unrealized P&L from confirmed holdings/cost basis, and reject stale or inconsistent data. Never accept public repository ledger data as broker proof.

Expected authenticated response schema:

```json
{
  "status": "verified",
  "source": "robinhood_authenticated",
  "reconciled": true,
  "scope": "selected_account",
  "verifiedAt": "2026-11-03T23:15:00Z",
  "realizedPnlUsd": 0,
  "unrealizedPnlUsd": 0,
  "positionsCount": 0
}
```

The values above are **schema examples only**, not actual account information. Realized P&L must have a defined reporting window agreed in the authenticated product; do not silently compare all-time realized and current open gains. Until such a window is provided, an integrator should not return a verified result. Never publish this JSON in `docs/data`, GitHub commits, GitHub Actions logs/artifacts, or a public CDN; never put API tokens, cookies, brokerage account numbers, order identifiers or balances in static assets. Do not add a proxy that embeds a personal Robinhood session into the public website.

The HQ rejects non-JSON responses, invalid numbers, negative position counts, timestamps older than five minutes, and missing verification metadata. It only reads the displayed allowlisted fields. Expired or disconnected sessions revert immediately to **UNVERIFIED** on the next refresh. This feature performs no brokerage transactions.

## Deployment prerequisites

1. Deploy a secure authenticated backend with a private broker integration, session login, authorization, no-store responses and operational monitoring; GitHub Pages alone cannot do this.
2. Provide the `/api/broker/verified-summary` route on the **same HTTPS origin** as the authenticated dashboard, or host a separate private dashboard. Do not redirect the public site into an unprotected proxy.
3. Verify account scope, realized-P&L window, cost basis, partial fills, stale-data fallback, access controls, and mobile layout before claiming real broker P&L.

Do not label a GitHub-published figure as verified. Public ledger and paper results stay separate from broker-confirmed figures.
