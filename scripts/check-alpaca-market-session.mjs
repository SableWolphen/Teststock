#!/usr/bin/env node
const key=process.env.ALPACA_API_KEY||process.env.APCA_API_KEY_ID||'';
const secret=process.env.ALPACA_API_SECRET||process.env.APCA_API_SECRET_KEY||'';

if(!key||!secret){
  console.error('Alpaca market clock unavailable: API credentials are missing.');
  process.exit(2);
}

try{
  const response=await fetch('https://paper-api.alpaca.markets/v2/clock',{
    headers:{
      'APCA-API-KEY-ID':key,
      'APCA-API-SECRET-KEY':secret
    },
    signal:AbortSignal.timeout(8000)
  });
  if(!response.ok)throw new Error('HTTP '+response.status);
  const clock=await response.json();
  const open=clock?.is_open===true;
  console.error(open
    ? 'Alpaca market clock: regular US stock session is OPEN.'
    : 'Alpaca market clock: regular US stock session is CLOSED.');
  process.stdout.write(open?'true':'false');
}catch(error){
  console.error('Alpaca market clock unavailable: '+String(error?.message||error));
  process.exit(1);
}
