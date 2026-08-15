const CONCEPTS={revenue:["RevenueFromContractWithCustomerExcludingAssessedTax","Revenues","SalesRevenueNet"],grossProfit:["GrossProfit"],operatingIncome:["OperatingIncomeLoss"],research:["ResearchAndDevelopmentExpense"],operatingCash:["NetCashProvidedByUsedInOperatingActivities"],capex:["PaymentsToAcquirePropertyPlantAndEquipment"]};
function annualFacts(data,names,asOf){for(const name of names){const units=data?.facts?.["us-gaap"]?.[name]?.units;if(!units)continue;const values=units.USD||Object.values(units)[0]||[];const rows=values.filter(r=>["10-K","10-K/A"].includes(r.form)&&r.fp==="FY"&&r.filed<=asOf&&r.start&&r.end&&Number.isFinite(Number(r.val))).sort((a,b)=>a.end.localeCompare(b.end)||a.filed.localeCompare(b.filed));if(rows.length)return rows}return[]}
function dedupe(rows){const periods=new Map();for(const row of rows)periods.set(row.end,row);return[...periods.values()].sort((a,b)=>a.end.localeCompare(b.end))}
const matching=(rows,end)=>rows.filter(row=>row.end===end).at(-1)||null;
const ratio=(value,revenue)=>value!==null&&revenue?value/revenue:null;
export function summarizeSecCompanyFacts(data,asOf){
  const revenues=dedupe(annualFacts(data,CONCEPTS.revenue,asOf)),current=revenues.at(-1),previous=revenues.at(-2);if(!current)return null;
  const valueFor=key=>{const row=matching(annualFacts(data,CONCEPTS[key],asOf),current.end);return row?Number(row.val):null};
  const revenue=Number(current.val),prior=previous?Number(previous.val):null,gross=valueFor("grossProfit"),operating=valueFor("operatingIncome"),research=valueFor("research"),cash=valueFor("operatingCash"),capex=valueFor("capex"),fcf=cash!==null&&capex!==null?cash-capex:null;
  return{company:data.entityName||null,sector:null,industry:null,period:current.end,currency:"USD",metrics:{revenueGrowth:prior?revenue/prior-1:null,grossMargin:ratio(gross,revenue),operatingMargin:ratio(operating,revenue),rdIntensity:ratio(research,revenue),fcfMargin:ratio(fcf,revenue)}};
}
