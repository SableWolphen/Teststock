const finitePositive=value=>Number.isFinite(Number(value))&&Number(value)>0;

export function buildCryptoMonitorCandidates({cryptoOrders=[],tournament={}}={}){
  const qualified=[tournament?.qualifiedChampion,...(tournament?.fallbacks||[])].filter(Boolean);
  const qualifiedByTicker=new Map(qualified.map((x,i)=>[x.ticker||x.symbol,{...x,rank:Number(x.rank||i+1)}]));
  const ordersByTicker=new Map((cryptoOrders||[]).filter(x=>x?.ticker).map(x=>[x.ticker,x]));
  return [...qualifiedByTicker.values()].map((x,i)=>{
    const ticker=x.ticker||x.symbol,order=ordersByTicker.get(ticker)||{};
    const minimumEntry=Number(order.minimumEntry??x.minimumEntry??x.entry);
    const maximumEntry=Number(order.maximumEntry??x.maximumEntry??(minimumEntry*1.02));
    return {...x,...order,ticker,rank:Number(x.rank||order.rank||i+1),setupGrade:String(order.setupGrade||x.grade||x.setupGrade||'').toUpperCase(),minimumEntry,maximumEntry,stop:Number(order.stop??x.stop),target1:Number(order.target1??x.target1),target2:Number(order.target2??x.target2),qualificationSource:'CRYPTO_TOURNAMENT_QUALIFIED',tournamentGeneratedAt:tournament?.generatedAt||null};
  }).filter(x=>['A','A+'].includes(x.setupGrade)&&x.robinhoodTradable!==false&&[x.minimumEntry,x.maximumEntry,x.stop,x.target1,x.target2].every(finitePositive)&&x.maximumEntry>=x.minimumEntry);
}

export function evaluateCryptoMonitorCandidate({candidate,price,sourceFresh,admissionState,seedPolicy,activeCryptoPositions=0}={}){
  const grade=String(candidate?.setupGrade||'').toUpperCase();
  const seedEligible=seedPolicy?.enabled===true&&admissionState!=='LIVE_SUSPENDED'&&(seedPolicy?.requiredGrades||['A','A+']).includes(grade);
  const seedLane=seedEligible?{eligible:true,maxOrderUsd:Math.min(5,Number(seedPolicy.maxOrderUsd||5)),maxConcurrentPositions:Math.min(1,Number(seedPolicy.maxConcurrentPositions||1)),maxNewPositionsPerUtcDay:Math.min(1,Number(seedPolicy.maxNewPositionsPerUtcDay||1)),maxHoldingHours:Number(seedPolicy.maxHoldingHours||8),maxStopLossesPerUtcDay:Number(seedPolicy.maxStopLossesPerUtcDay||2),requiresPerOrderApproval:false,requiresBrokerResidentStop:seedPolicy.requiresBrokerResidentStop===true,existingRobinhoodCashOnly:true,agentMayInitiateDeposits:false,agentMayInitiateBankTransfers:false,marginAllowed:false,executionLane:'CLAUDE_ROBINHOOD_TRADING_MCP'}:{eligible:false};
  if(!seedEligible)return {status:'BLOCKED_PROFITABILITY_ADMISSION',reason:`Crypto profitability admission ${admissionState||'UNKNOWN'} does not permit normal execution and the automatic seed lane is unavailable.`,seedEligible,seedLane};
  if(!sourceFresh)return {status:'REFRESHING_SIGNAL',reason:'Current crypto tournament generation is stale or mismatched; no buy trigger may fire.',seedEligible,seedLane};
  if(Number(activeCryptoPositions)>=Number(seedLane.maxConcurrentPositions))return {status:'CRYPTO_POSITION_LIMIT_REACHED',reason:'An ACTIVE Teststock crypto position already uses the one-position seed limit.',seedEligible,seedLane};
  const p=Number(price),min=Number(candidate.minimumEntry),max=Number(candidate.maximumEntry);
  if(!(p>0))return {status:'PRICE_UNAVAILABLE',reason:'Latest Alpaca crypto price unavailable.',seedEligible,seedLane};
  if(p>max)return {status:'DO_NOT_CHASE',reason:'Crypto price is above maximumEntry.',seedEligible,seedLane};
  if(p>=min)return {status:'CRYPTO_SEED_LANE_BUY_TRIGGER',reason:`Automatic qualified crypto candidate is inside its buy zone. Capped at $${seedLane.maxOrderUsd} using existing Robinhood cash only and executed only through Claude Robinhood Trading MCP after every live guard passes.`,seedEligible,seedLane};
  return {status:'WAIT_ENTRY',reason:'Qualified crypto candidate remains under 24/7 monitoring below its current buy zone.',seedEligible,seedLane};
}
