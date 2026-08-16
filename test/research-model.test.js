import test from "node:test";
import assert from "node:assert/strict";
import { summarizeResearchHistory,buildEvidenceAnalysis,RESEARCH_SCHEMA } from "../research-model.js";

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
