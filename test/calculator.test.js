import test from "node:test";
import assert from "node:assert/strict";
import { runDCA, scheduleDates } from "../public/calculator.js";

test("daily weekend contributions roll into Monday and convert from GBP",()=>{
  const prices=[{date:"2024-01-05",adjustedClose:100},{date:"2024-01-08",adjustedClose:100}];
  const fx=[{date:"2024-01-05",adjustedClose:1.25},{date:"2024-01-08",adjustedClose:1.30}];
  const result=runDCA(prices,fx,"2024-01-05","2024-01-08",10,"daily");
  assert.equal(result.contributions,4);
  assert.equal(result.purchases.length,2);
  assert.equal(result.purchases[1].gbp,30);
  assert.equal(result.purchases[1].usd,39);
  assert.equal(result.invested,40);
  assert.equal(result.shares,0.515);
});

test("uses the latest FX close on or before the stock trading day",()=>{
  const prices=[{date:"2024-01-08",adjustedClose:100}];
  const fx=[{date:"2024-01-05",adjustedClose:1.25},{date:"2024-01-09",adjustedClose:1.40}];
  const result=runDCA(prices,fx,"2024-01-08","2024-01-08",10,"daily");
  assert.equal(result.purchases[0].fx,1.25);
  assert.equal(result.shares,0.125);
  assert.equal(result.value,10);
});

test("preserves a contribution after the final trading session as GBP cash",()=>{
  const prices=[{date:"2024-01-05",adjustedClose:100}];
  const fx=[{date:"2024-01-05",adjustedClose:1.25}];
  const result=runDCA(prices,fx,"2024-01-05","2024-01-06",10,"daily");
  assert.equal(result.cash,10);
  assert.equal(result.invested,20);
  assert.equal(result.value,20);
});

test("monthly schedules clamp dates at month end",()=>{
  assert.deepEqual(scheduleDates("2024-01-31","2024-04-30","monthly"),[
    "2024-01-31","2024-02-29","2024-03-31","2024-04-30"
  ]);
});

test("rejects incomplete provider history instead of investing years of queued cash late",()=>{
  const prices=[{date:"2025-01-02",adjustedClose:100}],fx=[{date:"2025-01-02",adjustedClose:1.25}];
  assert.throws(()=>runDCA(prices,fx,"2016-01-01","2025-01-02",10,"daily"),/only begin on 2025-01-02/);
});
