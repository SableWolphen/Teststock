// Side-effect-free execution simulation. It exercises the decision order without
// contacting Robinhood or submitting an order.
export function simulateExecution({events=[], broker={authenticated:true,tradable:true,buyingPower:100,spreadPct:.1}, now=new Date()}={}) {
  const exits=events.filter(e=>['STOP','TARGET1','TARGET2','FORCED_EXIT'].includes(e.action));
  const buys=events.filter(e=>e.action==='BUY');
  if(!broker.authenticated) return {status:'NO_ACTION',reason:'BROKER_AUTH_UNAVAILABLE',orders:[]};
  if(exits.length) return {status:'EXIT_ONLY',reason:'EXIT_PRIORITY',orders:exits.map(e=>({side:'SELL',symbol:e.symbol,reason:e.action}))};
  if(!broker.tradable) return {status:'NO_ACTION',reason:'BROKER_SYMBOL_NOT_TRADABLE',orders:[]};
  if(broker.spreadPct>.35) return {status:'NO_ACTION',reason:'SPREAD_TOO_WIDE',orders:[]};
  const orders=[]; let cash=Number(broker.buyingPower||0);
  for(const e of buys){const amount=Math.min(Number(e.amount||0),cash);if(amount<=0)continue;orders.push({side:'BUY',symbol:e.symbol,amount,protectionRequired:true});cash-=amount;}
  return {status:orders.length?'BUY_READY':'NO_ACTION',reason:orders.length?'QUALIFIED_BUY':'NO_QUALIFIED_EVENT',orders,remainingBuyingPower:cash};
}

if (import.meta.url===`file://${process.argv[1]?.replaceAll('\\','/')}`) {
  console.log(JSON.stringify(simulateExecution({events:[],broker:{authenticated:true,tradable:true,buyingPower:100,spreadPct:.1}})));
}
