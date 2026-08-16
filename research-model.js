import { evidenceFromPrices } from "./portfolio-model.js";

const finite=value=>Number.isFinite(Number(value))?Number(value):null;
const signedPercent=value=>value===null?"unavailable":`${value>=0?"+":""}${(value*100).toFixed(1)}%`;

function downsample(rows,limit=180){
  if(rows.length<=limit)return rows;
  const result=[],step=(rows.length-1)/(limit-1);
  for(let index=0;index<limit;index++)result.push(rows[Math.round(index*step)]);
  return result;
}

export function summarizeResearchHistory(rows,{assetType="stock",themeOverlap=0}={}){
  const clean=(Array.isArray(rows)?rows:[]).map(row=>({
    date:String(row.date||""),
    adjustedClose:finite(row.adjusted_close??row.adjustedClose??row.close),
    close:finite(row.close),
    volume:finite(row.volume)
  })).filter(row=>/^\d{4}-\d{2}-\d{2}$/.test(row.date)&&row.adjustedClose>0).sort((a,b)=>a.date.localeCompare(b.date));
  if(clean.length<2)return null;
  const first=clean[0],last=clean.at(-1),high=Math.max(...clean.map(row=>row.adjustedClose)),low=Math.min(...clean.map(row=>row.adjustedClose));
  return{
    periodStart:first.date,periodEnd:last.date,latestPrice:last.adjustedClose,
    change1y:last.adjustedClose/first.adjustedClose-1,high,low,
    ...evidenceFromPrices(clean,{assetType,themeOverlap}),
    series:downsample(clean).map(row=>({date:row.date,adjustedClose:row.adjustedClose}))
  };
}

export const RESEARCH_SCHEMA={
  type:"object",additionalProperties:false,
  properties:{
    headline:{type:"string"},summary:{type:"string"},
    commonGround:{type:"array",items:{type:"string"}},
    differences:{type:"array",items:{type:"string"}},
    catalysts:{type:"array",items:{type:"object",additionalProperties:false,properties:{asset:{type:"string"},point:{type:"string"},evidence:{type:"string"}},required:["asset","point","evidence"]}},
    risks:{type:"array",items:{type:"object",additionalProperties:false,properties:{asset:{type:"string"},point:{type:"string"},evidence:{type:"string"}},required:["asset","point","evidence"]}},
    verdict:{type:"string"},questions:{type:"array",items:{type:"string"}}
  },
  required:["headline","summary","commonGround","differences","catalysts","risks","verdict","questions"]
};

export function buildEvidenceAnalysis(assets=[]){
  const names=assets.map(asset=>asset.ticker),anchor=assets[0],comparisons=assets.slice(1);
  const sharedThemes=anchor?anchor.themes.filter(theme=>comparisons.some(asset=>asset.themes.includes(theme))):[];
  const commonGround=sharedThemes.length
    ? sharedThemes.map(theme=>`${[anchor,...comparisons.filter(asset=>asset.themes.includes(theme))].map(asset=>asset.ticker).join(" and ")} share exposure to ${theme}. [${anchor.sourceIds?.history||"S1"}]`)
    : [`The selected assets do not have a mapped theme in common; compare the measurable market evidence instead. [${anchor?.sourceIds?.history||"S1"}]`];
  const differences=comparisons.map(asset=>`${asset.ticker} returned ${signedPercent(asset.stats.change1y)} over its displayed period versus ${signedPercent(anchor.stats.change1y)} for ${anchor.ticker}; their volatility and liquidity also differ. [${asset.sourceIds?.history||"S1"}]`);
  const catalysts=assets.map(asset=>({
    asset:asset.ticker,
    point:asset.news?.[0]?.title||`${asset.themes[0]||asset.type} development and adoption`,
    evidence:asset.news?.[0]?.sourceId?`Recent coverage provides a starting point, not confirmation of future growth. [${asset.news[0].sourceId}]`:`No recent sourced catalyst was available; this is an evidence gap. [${asset.sourceIds?.history||"S1"}]`
  }));
  const risks=assets.map(asset=>({
    asset:asset.ticker,
    point:asset.stats.hypeRisk>50?"Elevated recent-momentum risk":"Price and thesis can still deteriorate",
    evidence:`Annualised volatility is ${(asset.stats.annualVolatility*100).toFixed(1)}% and the mechanical hype-risk score is ${asset.stats.hypeRisk}/100. [${asset.sourceIds?.history||"S1"}]`
  }));
  return{
    headline:`${names.join(" vs ")}: an evidence-led comparison`,
    summary:`${anchor?.ticker||"The anchor"} is compared with ${comparisons.map(asset=>asset.ticker).join(", ")||"the selected peers"} using the same recent market window. This fallback brief is mechanical; it does not predict returns or select a winner.`,
    commonGround,differences,catalysts,risks,
    verdict:"The evidence supports further research, not a buy, sell or hold conclusion. The most important distinction is whether each asset's mapped growth thesis is supported by durable fundamentals or adoption rather than price momentum alone.",
    questions:["What measurable milestone would prove or disprove each thesis?","How much of the current valuation already assumes successful execution?","Which source should be refreshed before making any decision?"]
  };
}
