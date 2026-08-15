const MS_DAY = 86400000;
const iso = d => d.toISOString().slice(0,10);

export function addMonthsUTC(date, months=1){
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth()+months);
  const last = new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();
  d.setUTCDate(Math.min(day,last));
  return d;
}

export function scheduleDates(startStr,endStr,freq){
  const start = new Date(startStr+"T00:00:00Z");
  const end = new Date(endStr+"T00:00:00Z");
  const out = [];
  let d = new Date(start);
  let monthOffset = 0;
  while(d <= end){
    out.push(iso(d));
    if(freq==="daily") d = new Date(d.getTime()+MS_DAY);
    else if(freq==="weekly") d = new Date(d.getTime()+7*MS_DAY);
    else {
      monthOffset++;
      d = addMonthsUTC(start,monthOffset);
    }
  }
  return out;
}

function rateOnOrBefore(rates,date,startIndex=0){
  let index=startIndex;
  while(index+1 < rates.length && rates[index+1].date <= date) index++;
  if(!rates[index] || rates[index].date > date) return null;
  return {rate:rates[index].adjustedClose,index};
}

/*
  GBP investor methodology for a USD-listed security:
  - scheduled contributions are denominated in GBP
  - queued GBP is converted at GBP/USD on the execution trading date
  - GBP/USD is USD received for one GBP, so USD cash = GBP cash * FX
  - portfolio USD value is converted back to GBP at each valuation date
  - the latest available FX close on or before a trading date is used
*/
export function runDCA(prices,fxPrices,start,end,amount,freq){
  if(!prices.length) throw new Error("No prices available.");
  if(!fxPrices.length) throw new Error("No GBP/USD exchange rates available.");
  const scheduled = scheduleDates(start,end,freq);
  const trading = prices.filter(p=>p.date>=start && p.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  const rates = fxPrices.filter(p=>p.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
  if(!trading.length) throw new Error("No trading sessions in this period.");
  const requestedStart=new Date(start+"T00:00:00Z");
  const firstTrading=new Date(trading[0].date+"T00:00:00Z");
  if(firstTrading-requestedStart>7*MS_DAY)throw new Error(`Historical prices only begin on ${trading[0].date}. Choose a later start date or upgrade the market-data plan for full history.`);

  let s=0, queuedGBP=0, investedGBP=0, shares=0, fxIndex=0;
  const purchases=[];
  const points=[];
  for(const p of trading){
    const fxMatch=rateOnOrBefore(rates,p.date,fxIndex);
    if(!fxMatch) throw new Error(`No GBP/USD rate is available on or before ${p.date}.`);
    fxIndex=fxMatch.index;
    const fx=fxMatch.rate;
    while(s < scheduled.length && scheduled[s] <= p.date){
      queuedGBP += amount;
      s++;
    }
    if(queuedGBP > 0){
      const usd=queuedGBP*fx;
      const bought=usd/p.adjustedClose;
      shares += bought;
      investedGBP += queuedGBP;
      purchases.push({date:p.date,gbp:queuedGBP,usd,fx,price:p.adjustedClose,shares:bought});
      queuedGBP = 0;
    }
    points.push({date:p.date,invested:investedGBP,value:shares*p.adjustedClose/fx,price:p.adjustedClose,fx});
  }

  while(s < scheduled.length){ queuedGBP += amount; s++; }
  investedGBP += queuedGBP;
  const last = points[points.length-1];
  const value = last.value + queuedGBP;
  const endingFx = last.fx;
  const stockOnlyShares = purchases.reduce((total,purchase)=>
    total + (purchase.gbp*endingFx/purchase.price),0);
  const stockOnlyValue = stockOnlyShares*last.price/endingFx + queuedGBP;

  return {
    invested:investedGBP,value,profit:value-investedGBP,
    returnPct:investedGBP ? (value/investedGBP-1)*100 : 0,
    shares,cash:queuedGBP,contributions:scheduled.length,points,purchases,
    firstTradingDate:trading[0].date,lastTradingDate:last.date,lastPrice:last.price,
    endingFx,stockOnlyValue,fxImpact:value-stockOnlyValue
  };
}
