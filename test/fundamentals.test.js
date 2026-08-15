import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFundamentals } from "../fundamentals.js";

test("summarizes the latest annual fundamentals known by the selected date",()=>{
  const payload={
    General:{Name:"Example Corp",Sector:"Technology",CurrencyCode:"USD"},
    Financials:{
      Income_Statement:{yearly:{
        a:{date:"2015-12-31",totalRevenue:"100",grossProfit:"60",operatingIncome:"20",researchDevelopment:"10"},
        b:{date:"2016-12-31",totalRevenue:"125",grossProfit:"75",operatingIncome:"25",researchDevelopment:"15"},
        c:{date:"2017-12-31",totalRevenue:"200",grossProfit:"120",operatingIncome:"60",researchDevelopment:"20"}
      }},
      Cash_Flow:{yearly:{b:{date:"2016-12-31",freeCashFlow:"18"}}}
    }
  };
  const result=summarizeFundamentals(payload,"2017-06-01");
  assert.equal(result.period,"2016-12-31");
  assert.equal(result.metrics.revenueGrowth,0.25);
  assert.equal(result.metrics.grossMargin,0.6);
  assert.equal(result.metrics.operatingMargin,0.2);
  assert.equal(result.metrics.rdIntensity,0.12);
  assert.equal(result.metrics.fcfMargin,0.144);
});

test("returns null when no statement existed by the selected date",()=>{
  const payload={Financials:{Income_Statement:{yearly:{a:{date:"2020-12-31",totalRevenue:"100"}}}}};
  assert.equal(summarizeFundamentals(payload,"2019-12-31"),null);
});
