# Robinhood Crypto API setup for Teststock

Teststock now has a 24/7 crypto execution bridge that uses Robinhood's official Crypto Trading API directly instead of waiting for the Claude Robinhood MCP connector to expose crypto order tools.

The bridge is fail-closed. It cannot trade until all required GitHub Actions secrets are present and explicit enablement is set. Never put these values in public files, issues, chat messages, workflow YAML, or website code.

## Required GitHub Actions secrets

- `ROBINHOOD_CRYPTO_API_KEY` — API key created in Robinhood Crypto API settings.
- `ROBINHOOD_CRYPTO_PRIVATE_KEY_B64` — base64 Ed25519 private key paired with the public key registered for the Robinhood Crypto API credential.
- `ROBINHOOD_CRYPTO_AGENTIC_ACCOUNT_NUMBER` — the Agentic crypto account number. It remains private and is used only to select that account from the official accounts endpoint.
- `ROBINHOOD_CRYPTO_AUTOPILOT_ENABLED` — set to `true` only after the three required secrets above are correctly configured.
- `ROBINHOOD_CRYPTO_MAX_ORDER_USD` — optional hard ceiling for one new crypto buy. If omitted, Teststock defaults to `$25`.

## What the 24/7 executor does

The GitHub workflow `.github/workflows/crypto-autopilot.yml` runs about every five minutes. GitHub scheduled workflows can be delayed, so five minutes is a target cadence, not a guarantee.

For a new crypto position it requires a fresh Teststock A/A+ allocation, requires the private Agentic selector to match exactly one active Robinhood crypto trading account through the official accounts endpoint, confirms the pair is API-tradable, fetches a direct Robinhood bid/ask, enforces the 0.75% spread cap and 2% no-chase ceiling, checks for existing holdings/orders, sizes within the Teststock allocation, available buying power and the configured max-order cap, and uses a marketable limit order. If the buy does not fill promptly it cancels it rather than leaving an unattended order that could fill later without protection.

After a confirmed fill it immediately creates a Robinhood GTC stop-loss order and writes only non-sensitive saved levels to `docs/data/execution-watchlist.json`. Account numbers, balances, quantities, API credentials and broker order IDs are never written to the public repository.

For an existing tracked crypto position, Robinhood is authoritative for holdings and live bid/ask. Teststock checks the broker stop, handles the saved stop, takes about 25% at Target 1 when practical, re-arms the remainder with no looser than breakeven protection, and exits the remainder at Target 2 under the current no-runner policy. It never averages down, widens a stop, uses leverage, initiates funding, or treats an unconfirmed order as filled.

## Important account rule

The executor calls Robinhood's official accounts endpoint on every run and proceeds only when the private Agentic account selector matches exactly one active crypto trading account. A missing, inactive or ambiguous match fails closed with a public status that does not include any account number. The selected account number is used only in memory for authenticated API calls and is never written to repository files or workflow output.

## Robinhood documentation

Robinhood's official Crypto Trading API provides authenticated account, holdings, market-data and order endpoints, including market, limit, stop-loss and stop-limit orders. Credentials are created from Robinhood Crypto account settings on web classic. Keep the private key secret.
