export function marketSymbol(ticker,assetType){
  const clean=String(ticker||"").trim().toUpperCase();
  if(assetType!=="crypto")return clean;
  if(clean.endsWith(".CC"))return clean;
  return `${clean.replace(/-USD$/,"")}-USD.CC`;
}
