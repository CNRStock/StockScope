import test from "node:test";
import assert from "node:assert/strict";
import {buildRadarDigest,candidatePerformance,summarizeRadar} from "../public/radar-model.js";

test("candidate performance is measured from its tracked price",()=>{assert.equal(candidatePerformance(10,12.5),25);assert.equal(candidatePerformance(null,12),null)});
test("radar summary reports research fit and the largest absolute movement",()=>{const result=summarizeRadar([{candidate:{score:80},performance:5},{candidate:{score:60},performance:-12}]);assert.deepEqual(result,{count:2,averageFit:70,largestMove:-12})});
test("weekly digest remains a research prompt rather than a recommendation",()=>{const digest=buildRadarDigest([{candidate:{ticker:"QNT",score:82,connection:"Shared infrastructure theme",risk:"Adoption evidence may weaken."},performance:9,discoveredAt:"2026-08-01"}]);assert.equal(digest.length,3);assert.match(digest[1].detail,/does not validate/i);assert.match(digest[2].detail,/Adoption evidence/)});
