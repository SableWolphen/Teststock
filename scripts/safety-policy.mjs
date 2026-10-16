// One admission floor shared by generators and dispatch. Evidence never grants order authority.
export const SAFETY_POLICY=Object.freeze({
 version:1,liveExecutionEnabled:false,bootstrapAllowed:false,maxOrderUsd:0,
 stocks:Object.freeze({microSamples:100,microDays:20,probationSamples:200,probationDays:30,minProfitFactor:1.25}),
 options:Object.freeze({microSamples:50,microDays:20,probationSamples:100,probationDays:30,minProfitFactor:1.30}),
});
export const earnedAdmission=state=>['MICRO_PROBATION','PROBATION','LIVE_ADMITTED'].includes(state);
