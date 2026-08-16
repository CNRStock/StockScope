import test from "node:test";
import assert from "node:assert/strict";
import { summarizeSecCompanyFacts } from "../sec-fundamentals.js";
const fact=(end,val,filed="2017-02-01")=>({start:end.slice(0,4)+"-01-01",end,val,filed,form:"10-K",fp:"FY"});
const concept=values=>({units:{USD:values}});
test("SEC summary uses only annual facts filed by the selected date",()=>{
  const data={entityName:"Example Inc",facts:{"us-gaap":{Revenues:concept([fact("2015-12-31",100,"2016-02-01"),fact("2016-12-31",125),fact("2017-12-31",200,"2018-02-01")]),GrossProfit:concept([fact("2016-12-31",75)]),OperatingIncomeLoss:concept([fact("2016-12-31",25)]),ResearchAndDevelopmentExpense:concept([fact("2016-12-31",15)]),NetCashProvidedByUsedInOperatingActivities:concept([fact("2016-12-31",30)]),PaymentsToAcquirePropertyPlantAndEquipment:concept([fact("2016-12-31",12)])}}};
  const result=summarizeSecCompanyFacts(data,"2017-06-01");
  assert.equal(result.period,"2016-12-31");assert.equal(result.metrics.revenueGrowth,0.25);assert.equal(result.metrics.grossMargin,0.6);assert.equal(result.metrics.fcfMargin,0.144);
});
test("SEC summary follows a company when its revenue concept changes",()=>{
  const data={entityName:"Migrating Tags Plc",facts:{"us-gaap":{
    RevenueFromContractWithCustomerExcludingAssessedTax:concept([fact("2022-12-31",100,"2023-02-01")]),
    Revenues:concept([fact("2023-12-31",130,"2024-02-01"),fact("2024-12-31",169,"2025-02-01")]),
    OperatingIncomeLoss:concept([fact("2024-12-31",30,"2025-02-01")])
  }}};
  const result=summarizeSecCompanyFacts(data,"2025-06-01");
  assert.equal(result.period,"2024-12-31");assert.ok(Math.abs(result.metrics.revenueGrowth-.3)<1e-9);assert.ok(Math.abs(result.metrics.operatingMargin-30/169)<1e-9);
});
