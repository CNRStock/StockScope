const FEATURES={
  revenueGrowth:{label:"Revenue growth",scale:.5,weight:1.2},grossMargin:{label:"Gross margin",scale:.3,weight:1},
  operatingMargin:{label:"Operating margin",scale:.25,weight:1},rdIntensity:{label:"R&D intensity",scale:.18,weight:1.1},fcfMargin:{label:"Free-cash-flow margin",scale:.22,weight:1}
};
export function compareProfiles(reference,candidate){
  const comparisons=Object.entries(FEATURES).flatMap(([key,config])=>{
    const a=reference?.metrics?.[key],b=candidate?.metrics?.[key];
    if(a===null||a===undefined||b===null||b===undefined)return[];
    return[{key,label:config.label,reference:a,candidate:b,distance:Math.min(Math.abs(a-b)/config.scale,1),weight:config.weight}];
  });
  if(comparisons.length<3)return null;
  const distance=comparisons.reduce((sum,x)=>sum+x.distance*x.weight,0)/comparisons.reduce((sum,x)=>sum+x.weight,0);
  const sorted=[...comparisons].sort((a,b)=>a.distance-b.distance);
  return{score:Math.round(Math.max(0,Math.min(100,(1-distance)*100))),featuresUsed:comparisons.length,reasons:sorted.slice(0,2).map(x=>x.label),differences:sorted.slice(-2).reverse().map(x=>x.label),comparisons};
}
