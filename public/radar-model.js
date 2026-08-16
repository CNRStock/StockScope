const finite=value=>Number.isFinite(Number(value));

export function candidatePerformance(discoveryPrice,currentPrice){
  if(!finite(discoveryPrice)||!finite(currentPrice)||Number(discoveryPrice)<=0)return null;
  return (Number(currentPrice)/Number(discoveryPrice)-1)*100;
}

export function summarizeRadar(items){
  const scores=items.map(item=>Number(item.candidate?.score)).filter(Number.isFinite);
  const moves=items.map(item=>item.performance).filter(Number.isFinite);
  return{
    count:items.length,
    averageFit:scores.length?Math.round(scores.reduce((sum,value)=>sum+value,0)/scores.length):null,
    largestMove:moves.length?moves.reduce((largest,value)=>Math.abs(value)>Math.abs(largest)?value:largest,moves[0]):null
  };
}

export function buildRadarDigest(items){
  if(!items.length)return[];
  const fit=[...items].filter(item=>finite(item.candidate?.score)).sort((a,b)=>Number(b.candidate.score)-Number(a.candidate.score))[0];
  const move=[...items].filter(item=>Number.isFinite(item.performance)).sort((a,b)=>Math.abs(b.performance)-Math.abs(a.performance))[0];
  const newest=[...items].sort((a,b)=>new Date(b.discoveredAt||0)-new Date(a.discoveredAt||0))[0];
  const entries=[];
  if(fit)entries.push({label:"STRONGEST RESEARCH FIT",title:`${fit.candidate.ticker} · ${fit.candidate.score}/100`,detail:fit.candidate.connection||"Reopen the original comparison and verify whether its shared evidence still holds."});
  if(move)entries.push({label:"LARGEST MOVE SINCE TRACKED",title:`${move.candidate.ticker} · ${move.performance>=0?"+":""}${move.performance.toFixed(1)}%`,detail:"Price movement does not validate the thesis. Check news, fundamentals and liquidity before drawing a conclusion."});
  if(newest)entries.push({label:"NEXT REVIEW",title:`Recheck ${newest.candidate.ticker}`,detail:newest.candidate.risk||"Look specifically for evidence that could disprove the original research case."});
  return entries;
}
