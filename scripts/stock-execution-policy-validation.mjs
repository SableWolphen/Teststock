// Validate the asset-specific contract, never the retired cross-asset buy flag.
// Options admission is separate: stock authorization cannot grant option eligibility.
export function stockExecutionPolicyFailures(signal) {
  const a=signal.autopilot||{}, p=signal.claudeExecutionPolicy||{}, fail=[];
  if(a.enabled!==true||a.requiresPerOrderApproval!==false||a.stockBuysRequireUserApproval!==false||a.stockBuysRequireCurrentBatchApproval!==false||a.automaticQualifiedStockBuys!==true)fail.push('automatic stock policy');
  if(a.executionAgent!=='CLAUDE'||a.directGitHubBrokerExecution!==false||p.enabled!==true||p.role!=='SOLE_EXECUTION_AGENT')fail.push('Claude-only stock execution');
  if(p.stockBuys?.executionOwner!=='CLAUDE'||p.stockBuys?.explicitApprovalRequired!==false||p.stockBuys?.automaticWhenFullyQualifiedAndBrokerPermits!==true||p.stockBuys?.requireRobinhoodTradingMcp!==true||p.stockBuys?.requireLiveBrokerRecheck!==true)fail.push('stock live MCP recheck');
  if(p.sourceOfTruth!=='LATEST_RAW_MAIN'||p.generationMatchRequired!==true)fail.push('stock generation guard');
  const b=p.brokerExecutionContract||{};
  if(b.executor!=='CLAUDE_ONLY'||b.transport!=='ROBINHOOD_TRADING_MCP'||b.duplicateProtectionRequired!==true||b.reconcileByClientOrderId!==true||b.neverAssumeFill!==true||b.partialFillsUseConfirmedQuantityOnly!==true||b.protectionRequiredAfterEntry!==true)fail.push('fail-closed stock broker contract');
  if(a.automaticQualifiedCryptoBuys!==false||signal.generatorIntegrity?.traceableFeatures?.automaticCryptoExecution!==false||p.crypto?.automaticWhenFullyQualifiedAndBrokerPermits===true||(p.exits?.appliesTo||[]).includes('CRYPTO'))fail.push('crypto execution not disabled');
  const architecture=signal.executionArchitecture||{};
  if(architecture.mode!=='STOCK_ONLY'||architecture.crossAssetSelection!==false||architecture.liveDecisionPaths?.join(',')!=='STOCK_TOURNAMENT'||architecture.tournaments?.stock?.enabled!==true||architecture.tournaments?.crypto?.enabled!==false)fail.push('stock-only architecture');
  return fail;
}
