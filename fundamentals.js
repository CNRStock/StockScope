const number = value => {
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
};

function records(section,period="yearly"){
  const rows=section?.[period];
  if(!rows || typeof rows!=="object") return [];
  return Object.values(rows).filter(row=>row && row.date).sort((a,b)=>a.date.localeCompare(b.date));
}

function onOrBefore(rows,date){
  return rows.filter(row=>row.date<=date).at(-1)||null;
}

function prior(rows,current){
  if(!current)return null;
  const index=rows.findIndex(row=>row.date===current.date);
  return index>0?rows[index-1]:null;
}

const divide=(value,denominator)=>value!==null&&denominator?value/denominator:null;

export function summarizeFundamentals(payload,asOf){
  const financials=payload?.Financials||{};
  const incomeRows=records(financials.Income_Statement);
  const cashRows=records(financials.Cash_Flow);
  const income=onOrBefore(incomeRows,asOf);
  if(!income) return null;
  const previous=prior(incomeRows,income);
  const cash=onOrBefore(cashRows,income.date);
  const revenue=number(income.totalRevenue);
  const previousRevenue=number(previous?.totalRevenue);
  const grossProfit=number(income.grossProfit);
  const operatingIncome=number(income.operatingIncome);
  const research=number(income.researchDevelopment);
  const freeCashFlow=number(cash?.freeCashFlow);
  return {
    company:payload?.General?.Name||null,
    sector:payload?.General?.Sector||null,
    industry:payload?.General?.Industry||null,
    period:income.date,
    currency:income.currency_symbol||payload?.General?.CurrencyCode||"USD",
    metrics:{
      revenueGrowth:previousRevenue?revenue/previousRevenue-1:null,
      grossMargin:divide(grossProfit,revenue),
      operatingMargin:divide(operatingIncome,revenue),
      rdIntensity:divide(research,revenue),
      fcfMargin:divide(freeCashFlow,revenue)
    }
  };
}
