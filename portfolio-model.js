const clamp=(value,min=0,max=100)=>Math.max(min,Math.min(max,value));
const mean=values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0;

export function evidenceFromPrices(rows,{assetType="stock",themeOverlap=0}={}){
  const prices=rows.map(row=>Number(row.adjusted_close??row.adjustedClose??row.close)).filter(value=>value>0);
  const returns=prices.slice(1).map((price,index)=>price/prices[index]-1).filter(Number.isFinite);
  const avg=mean(returns),variance=mean(returns.map(value=>(value-avg)**2)),annualVolatility=Math.sqrt(variance)*Math.sqrt(assetType==="crypto"?365:252);
  const volumes=rows.map(row=>Number(row.volume)*Number(row.close)).filter(value=>value>0),averageDollarVolume=mean(volumes);
  const change90d=prices.length>1?prices.at(-1)/prices[Math.max(0,prices.length-91)]-1:0;
  const stability=clamp(100-annualVolatility/(assetType==="crypto"?1.5:1)*100);
  const liquidity=clamp((Math.log10(Math.max(averageDollarVolume,1))-4)/5*100);
  const hypeRisk=clamp(Math.abs(change90d)/(assetType==="crypto"?1.5:.8)*100);
  const diversification=clamp(100-themeOverlap*25);
  const score=Math.round(stability*.35+liquidity*.3+(100-hypeRisk)*.2+diversification*.15);
  return{score,stability:Math.round(stability),liquidity:Math.round(liquidity),hypeRisk:Math.round(hypeRisk),diversification:Math.round(diversification),annualVolatility,change90d,averageDollarVolume};
}

export function allocateEvidence(items){
  if(!items.length)return[];
  const raw=items.map(item=>Math.max(5,item.score)**1.35),total=raw.reduce((sum,value)=>sum+value,0);
  const weights=raw.map(value=>Math.round(value/total*100));
  weights[0]+=100-weights.reduce((sum,value)=>sum+value,0);
  return weights;
}
