import test from "node:test";
import assert from "node:assert/strict";
import { summarizeResearchHistory,buildEvidenceAnalysis,buildDiscoveryCandidates,RESEARCH_SCHEMA } from "../research-model.js";

const rows=Array.from({length:40},(_,index)=>({date:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10),adjusted_close:100+index,close:100+index,volume:1_000_000}));

test("summarizeResearchHistory produces chart and evidence fields",()=>{
  const summary=summarizeResearchHistory(rows,{assetType:"stock"});
  assert.equal(summary.latestPrice,139);
  assert.ok(summary.series.length>1);
  assert.ok(Number.isFinite(summary.annualVolatility));
  assert.ok(summary.score>=0&&summary.score<=100);
});

test("buildEvidenceAnalysis returns a complete safe fallback",()=>{
  const assets=["NVDA","IONQ"].map((ticker,index)=>({ticker,type:"stock",themes:index?["quantum computing"]:["AI compute"],stats:{change1y:index?.2:.1,annualVolatility:.4,hypeRisk:20},news:[],sourceIds:{history:`S${index+1}`}}));
  const result=buildEvidenceAnalysis(assets);
  assert.match(result.headline,/NVDA vs IONQ/);
  assert.match(result.verdict,/not a buy, sell or hold/i);
  assert.equal(Object.keys(result).sort().join(","),RESEARCH_SCHEMA.required.sort().join(","));
});

test("discovery candidates rank connected under-followed assets and exclude selections",()=>{
  const assets=[{ticker:"NVDA",type:"stock",themes:["AI compute","data centres"]},{ticker:"IONQ",type:"stock",themes:["quantum computing"]}];
  const universe=[
    {ticker:"IONQ",type:"stock",themes:["quantum computing"],underFollowed:80},
    {ticker:"RGTI",type:"stock",themes:["quantum computing"],underFollowed:92,riskLevel:3},
    {ticker:"AAOI",type:"stock",themes:["photonics","data centres"],underFollowed:90,riskLevel:3},
    {ticker:"POWL",type:"stock",themes:["power and cooling"],underFollowed:72,riskLevel:2},
    {ticker:"AKT",type:"crypto",themes:["AI","decentralised compute"],underFollowed:88,riskLevel:3}
  ];
  const candidates=buildDiscoveryCandidates(assets,universe,3);
  assert.deepEqual(candidates.map(candidate=>candidate.ticker),["AAOI","RGTI","POWL"]);
  assert.ok(candidates.every(candidate=>candidate.type==="stock"));
  assert.match(candidates[0].connection,/Direct theme overlap/);
  assert.match(candidates[2].connection,/Adjacent theme/);
});

test("crypto comparisons return only connected crypto research leads",()=>{
  const assets=[{ticker:"ETH",type:"crypto",themes:["smart contracts","defi","infrastructure"]}];
  const universe=[
    {ticker:"QNT",type:"crypto",themes:["interoperability"],underFollowed:86,riskLevel:3},
    {ticker:"ONDO",type:"crypto",themes:["tokenisation","defi"],underFollowed:58,riskLevel:3},
    {ticker:"RGTI",type:"stock",themes:["quantum computing"],underFollowed:92,riskLevel:3}
  ];
  const candidates=buildDiscoveryCandidates(assets,universe,5);
  assert.deepEqual(new Set(candidates.map(candidate=>candidate.type)),new Set(["crypto"]));
  assert.deepEqual(candidates.map(candidate=>candidate.ticker),["ONDO","QNT"]);
});
