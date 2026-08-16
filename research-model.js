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

const NEXT_WAVE_THEMES={
  "AI compute":["quantum computing","photonics","power and cooling","grid infrastructure","robotics","cybersecurity","AI drug discovery"],
  semiconductors:["photonics","quantum computing","data centres","networking"],
  "data centres":["power and cooling","grid infrastructure","photonics","networking","cybersecurity"],
  "quantum computing":["photonics","cybersecurity","networking"],
  "AI software":["cybersecurity","robotics","automation","AI drug discovery"],
  AI:["decentralised compute","agents","data","infrastructure","interoperability"],
  infrastructure:["interoperability","oracles","data","storage","decentralised compute"],
  "smart contracts":["interoperability","oracles","tokenisation","infrastructure"],
  defi:["tokenisation","oracles","interoperability"],
  "store of value":["payments","tokenisation","infrastructure"],
  payments:["enterprise infrastructure","interoperability","tokenisation"]
};

const genericRisk=candidate=>candidate.type==="crypto"
  ?"Token adoption, liquidity, dilution and regulation can overwhelm a strong technology narrative."
  :"Smaller or earlier-stage companies can face financing, execution, customer-concentration and valuation risk.";

export function buildDiscoveryCandidates(assets=[],universe=[],limit=5){
  const selected=new Set(assets.map(asset=>`${asset.ticker}:${asset.type}`));
  const selectedTypes=new Set(assets.map(asset=>asset.type));
  const focusThemes=[...new Set(assets.flatMap(asset=>asset.themes||[]))];
  return universe.filter(candidate=>candidate?.ticker&&selectedTypes.has(candidate.type)&&!selected.has(`${candidate.ticker}:${candidate.type}`)).map(candidate=>{
    const themes=[...new Set(candidate.themes||[])],directThemes=themes.filter(theme=>focusThemes.includes(theme)),links=[];
    for(const focus of focusThemes)for(const theme of NEXT_WAVE_THEMES[focus]||[])if(themes.includes(theme)&&!directThemes.includes(theme))links.push({from:focus,to:theme});
    const uniqueLinks=[...new Map(links.map(link=>[`${link.from}:${link.to}`,link])).values()],underFollowed=Math.max(0,Math.min(100,Math.round(Number(candidate.underFollowed)||50)));
    const riskLevel=Math.max(1,Math.min(3,Math.round(Number(candidate.riskLevel)||2)));
    const score=Math.max(1,Math.min(95,Math.round(15+Math.min(50,directThemes.length*25)+Math.min(25,uniqueLinks.length*12)+underFollowed*.2-(riskLevel-1)*4)));
    const connection=directThemes.length
      ?`Direct theme overlap: ${directThemes.join(", ")}.`
      :uniqueLinks.length?`Adjacent theme: ${uniqueLinks[0].from} → ${uniqueLinks[0].to}.`:`A broader under-followed candidate outside the mapped themes.`;
    const potential=candidate.potential||`Investigate whether its ${themes[0]||candidate.type} exposure is producing durable ${candidate.type==="crypto"?"usage and adoption":"revenue and operating progress"}.`;
    return{ticker:candidate.ticker,type:candidate.type,name:candidate.name||candidate.ticker,themes,directThemes,adjacentLinks:uniqueLinks,underFollowed,riskLevel,score,connection,potential,risk:candidate.risk||genericRisk(candidate)};
  }).filter(candidate=>candidate.underFollowed>=50&&(!focusThemes.length||candidate.directThemes.length||candidate.adjacentLinks.length)).sort((a,b)=>b.score-a.score||b.underFollowed-a.underFollowed||a.ticker.localeCompare(b.ticker)).slice(0,limit);
}

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
