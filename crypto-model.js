const clamp=n=>Math.max(0,Math.min(100,n));
export function scoreCrypto(asset,referenceThemes=[]){
  const rank=Number(asset.market_cap_rank)||9999,marketCap=Number(asset.market_cap)||0,volume=Number(asset.total_volume)||0;
  const supplyBase=Number(asset.max_supply)||Number(asset.total_supply)||0,circulating=Number(asset.circulating_supply)||0;
  const themes=asset.themes||[],overlap=themes.filter(theme=>referenceThemes.includes(theme));
  const themeScore=referenceThemes.length?overlap.length/referenceThemes.length*100:50;
  const underRadarScore=rank<40?clamp(rank/40*55):rank<=250?clamp(100-Math.abs(rank-120)/2):clamp(55-(rank-250)/8);
  const liquidityScore=marketCap?clamp(volume/marketCap/0.12*100):0;
  const supplyScore=supplyBase?clamp(circulating/supplyBase*100):45;
  const change30d=Number(asset.price_change_percentage_30d_in_currency)||0;
  const hypeRisk=clamp(Math.max(0,change30d)/1.5);
  const score=Math.round(clamp(themeScore*.35+underRadarScore*.3+liquidityScore*.2+supplyScore*.15-hypeRisk*.15));
  return{score,themeScore:Math.round(themeScore),underRadarScore:Math.round(underRadarScore),liquidityScore:Math.round(liquidityScore),supplyScore:Math.round(supplyScore),hypeRisk:Math.round(hypeRisk),themeOverlap:overlap};
}
