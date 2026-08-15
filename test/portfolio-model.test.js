import test from "node:test";
import assert from "node:assert/strict";
import { evidenceFromPrices,allocateEvidence } from "../portfolio-model.js";

const rows=(growth,volume)=>Array.from({length:120},(_,index)=>({close:100*(1+growth)**index,adjusted_close:100*(1+growth)**index,volume}));

test("portfolio evidence returns bounded explainable factors",()=>{const result=evidenceFromPrices(rows(.001,1_000_000),{assetType:"stock"});for(const key of ["score","stability","liquidity","hypeRisk","diversification"])assert.ok(result[key]>=0&&result[key]<=100)});
test("evidence allocations total exactly 100",()=>{const weights=allocateEvidence([{score:80},{score:60},{score:40}]);assert.equal(weights.reduce((sum,value)=>sum+value,0),100);assert.ok(weights[0]>weights[2])});
