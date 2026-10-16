# Teststock automatic-only control center
These modules implement **research and risk evaluation**, not a deployed broker or a guarantee of returns.

| Feature | Implementation | Production gap |
| --- | --- | --- |
| AI trading brain | `rankOpportunities` with verified quotes and net edge | calibrated model and out-of-sample validation |
| Exit guardian | `positionRisk` using executable bid | persistent broker-backed exit placement and escalation |
| Opportunity radar | ranked candidate inputs | real-time licensed feeds |
| Fast execution | existing `chatgpt-executor.mjs` | verified broker submissions/fills |
| Capital allocation | `capitalPolicy` | broker buying-power and risk reconciliation |
| Expiration protection | pre-close and expiration flags | verified NYSE calendar and monitored exit service |
| Strategy tournament | `strategyScorecard` | separate paper/out-of-sample cohorts |
| News intelligence | existing source registry/fusion | ingestion, attribution, licensing |
| Health monitor | heartbeat freshness status | independently deployed alerts |
| Trading journal | confirmed entry/exit trade schema | durable write-ahead storage |
| Dashboard | `controlCenter` JSON view model | React UI wiring |
| $100M tracker | target exposed in view model | realized performance and scenario UI |

Never fabricate broker capabilities or set capability flags based on a preview. The broker is source of truth. Until independent entry, exit, heartbeat and reconciliation verification succeeds, the system remains blocked for new live risk. Test the modules with `npm test`. PR must be merged and production runtime deployed separately.
