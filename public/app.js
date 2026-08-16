import { runDCA } from "./calculator.js";
import { marketSymbol } from "./assets.js";
import { currentSession,signIn,signOut,signUp,consumeUsage,saveResearch,loadResearch,loadProfile,getEntitlements,exportAccountData,deleteAccount,billingAvailable,billingAction } from "./supabase-client.js";
import "./research.js";
import {initProTools,renderRadar} from "./pro-tools.js";

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
let frequency = "daily";
let assetType = "stock";
let current = null;
const frequencyLabels = {daily:"day",weekly:"week",monthly:"month"};

const gbp = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:n<100?2:0}).format(n);
const usd = n => new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:n<1?4:2}).format(n);
const num = (n,d=2) => new Intl.NumberFormat("en-GB",{maximumFractionDigits:d}).format(n);
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function drawChart(points){
  const c=$("#chart"),ctx=c.getContext("2d"),W=c.width,H=c.height;
  const L=48,R=18,T=28,B=36;
  ctx.clearRect(0,0,W,H);
  if(!points.length)return;
  const reduced=[];
  const stride=Math.max(1,Math.floor(points.length/260));
  for(let i=0;i<points.length;i+=stride) reduced.push(points[i]);
  if(reduced[reduced.length-1]!==points[points.length-1])reduced.push(points[points.length-1]);
  const ymax=Math.max(...reduced.flatMap(p=>[p.value,p.invested]),1)*1.08;

  ctx.font="22px DM Sans, sans-serif";ctx.fillStyle="#5f6b7b";ctx.textAlign="right";
  for(let i=0;i<5;i++){
    const y=T+(H-T-B)*i/4, val=ymax*(1-i/4);
    ctx.strokeStyle="rgba(255,255,255,.055)";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(W-R,y);ctx.stroke();
    ctx.fillText(val>=1000?"£"+Math.round(val/1000)+"k":"£"+Math.round(val),L-8,y+6);
  }

  function line(key,color,width){
    ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineJoin="round";ctx.lineCap="round";
    reduced.forEach((p,i)=>{
      const x=L+i/(reduced.length-1||1)*(W-L-R), y=H-B-(p[key]/ymax)*(H-T-B);
      if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    });ctx.stroke();
  }
  line("invested","#67a8ff",3);
  line("value","#bcff3c",4);

  // subtle glow
  ctx.save();ctx.globalAlpha=.12;ctx.filter="blur(12px)";line("value","#bcff3c",12);ctx.restore();

  ctx.fillStyle="#596678";ctx.textAlign="left";ctx.font="20px DM Sans, sans-serif";
  ctx.fillText(reduced[0].date.slice(0,4),L,H-8);
  ctx.textAlign="right";ctx.fillText(reduced[reduced.length-1].date.slice(0,4),W-R,H-8);
}

async function status(){
  try{
    const r=await fetch("/api/status"),j=await r.json();
    const pill=$("#apiPill");
    if(j.configured){pill.classList.add("live");pill.innerHTML="<span></span>Live market data";}
    else{pill.classList.add("warn");pill.innerHTML="<span></span>API setup needed";}
  }catch{}
}
status();
$("#homeLogo").addEventListener("click",event=>{event.preventDefault();showView("discover")});
function renderAccount(){const session=currentSession(),button=$("#accountButton");button.textContent=session?session.user.email:"Sign in";button.classList.toggle("signed-in",Boolean(session))}
renderAccount();
async function renderSettings(){showView("settings");$("#settingsEmail").textContent=currentSession().user.email;const upgrade=$("#upgradePro"),manage=$("#manageBilling"),message=$("#settingsMessage"),detail=$("#settingsPlanDetail");try{const enabled=await billingAvailable(),profile=enabled?(await billingAction("status")).profile:await loadProfile(),access=await getEntitlements({refresh:true}),isPro=profile?.plan==="pro",dateValue=profile?.cancel_at||profile?.current_period_end,date=dateValue?new Intl.DateTimeFormat("en-GB",{dateStyle:"long"}).format(new Date(dateValue)):null;$("#settingsPlan").textContent=access.beta?"PRIVATE BETA":(profile?.plan||"free").toUpperCase();upgrade.classList.toggle("hidden",isPro||access.beta);manage.classList.toggle("hidden",!isPro);upgrade.disabled=!enabled;if(access.beta)detail.textContent="Private beta access includes all Pro research tools while testing is open.";else if(profile?.cancel_at_period_end&&date)detail.textContent=`Pro remains active until ${date}, then returns to Free.`;else if(profile?.subscription_status==="payment_failed"||profile?.subscription_status==="past_due")detail.textContent="A payment failed. Update your payment method in Manage billing to keep Pro access.";else detail.textContent=isPro?(date?`Active subscription. Next billing date: ${date}.`:"Active Pro subscription."):"Free includes 3 calculations daily, 1 similarity search daily and 3 AI comparisons monthly.";if(!enabled&&!isPro)message.textContent="Pro checkout is being prepared and is not open yet."}catch(error){$("#settingsPlan").textContent="FREE";message.textContent=error.message}}
$("#accountButton").addEventListener("click",async()=>{if(!currentSession()){ $("#authModal").classList.remove("hidden");return }await renderSettings()});
$("#closeAuth").addEventListener("click",()=>$("#authModal").classList.add("hidden"));
$("#signIn").addEventListener("click",async()=>{const msg=$("#authMessage");try{await signIn($("#authEmail").value,$("#authPassword").value);msg.textContent="";$("#authModal").classList.add("hidden");renderAccount();renderSaved();window.dispatchEvent(new CustomEvent("assetseek:session-changed"))}catch(error){msg.textContent=error.message}});
$("#signUp").addEventListener("click",async()=>{const msg=$("#authMessage");try{await signUp($("#authEmail").value,$("#authPassword").value);msg.textContent="Account created. Check your email to confirm it, then sign in."}catch(error){msg.textContent=error.message}});
$("#settingsSignOut").addEventListener("click",()=>{signOut();renderAccount();renderSaved();window.dispatchEvent(new CustomEvent("assetseek:session-changed"));showView("discover")});
async function openBilling(action,button){const message=$("#settingsMessage");button.disabled=true;message.textContent="Opening secure Stripe billing…";try{const data=await billingAction(action);location.href=data.url}catch(error){message.textContent=error.message;button.disabled=false}}
$("#upgradePro").addEventListener("click",event=>openBilling("checkout",event.currentTarget));
$$('[data-upgrade-pro]').forEach(button=>button.addEventListener("click",()=>{if(!currentSession()){$("#authModal").classList.remove("hidden");$("#authMessage").textContent=button.querySelector("span")?.textContent.startsWith("Sign in")?"Sign in or create an account to open your Radar.":"Sign in or create an account before upgrading to Pro.";return}openBilling("checkout",button)}));
window.addEventListener("assetseek:auth",()=>{$("#authModal").classList.remove("hidden");$("#authMessage").textContent="Sign in to save and track research."});
window.addEventListener("assetseek:upgrade",event=>{if(!currentSession()){$("#authModal").classList.remove("hidden");$("#authMessage").textContent=`Sign in first to unlock ${event.detail?.feature||"this Pro feature"}.`;return}renderSettings().then(()=>{$("#settingsMessage").textContent=`${event.detail?.feature||"This feature"} is included with AssetSeek Pro.`})});
$("#manageBilling").addEventListener("click",event=>openBilling("portal",event.currentTarget));
$("#exportAccount").addEventListener("click",async()=>{const message=$("#settingsMessage");try{const data=await exportAccountData(),blob=new Blob([JSON.stringify(data,null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`assetseek-data-${new Date().toISOString().slice(0,10)}.json`;link.click();URL.revokeObjectURL(url);message.textContent="Your account-data export has downloaded."}catch(error){message.textContent=error.message}});
$("#deleteAccount").addEventListener("click",async()=>{const message=$("#settingsMessage");if(!confirm("Permanently delete your AssetSeek account and all saved research? This cannot be undone."))return;try{await deleteAccount();renderAccount();renderSaved();showView("discover")}catch(error){message.textContent=`Account deletion failed: ${error.message}`}});

const checkoutState=new URLSearchParams(location.search).get("checkout");if(checkoutState&&currentSession()){history.replaceState({},"",location.pathname+location.hash);renderSettings().then(()=>{$("#settingsMessage").textContent=checkoutState==="success"?"Payment received. Your Pro plan will appear as soon as Stripe confirms it.":"Checkout cancelled — no charge was made."})}

$$('[data-freq]').forEach(b=>b.addEventListener("click",()=>{
  $$('[data-freq]').forEach(x=>x.classList.remove("active"));
  b.classList.add("active");
  frequency=b.dataset.freq;
  $("#frequencySuffix").textContent=`/ ${frequencyLabels[frequency]}`;
}));
$$(".asset-type").forEach(button=>button.addEventListener("click",()=>{
  $$(".asset-type").forEach(item=>item.classList.remove("active"));button.classList.add("active");assetType=button.dataset.asset;
  const isCrypto=assetType==="crypto",ticker=$("#ticker");
  ticker.value=isCrypto?"BTC":"NVDA";
  $("#tickerAvatar").textContent=ticker.value[0];
  $("#assetLabel").textContent=isCrypto?"Cryptocurrency":"Company";
  $("#assetHint").textContent=isCrypto?"Symbol, e.g. BTC, ETH or DOGE":"US ticker symbol";
}));
$("#ticker").addEventListener("input",e=>{
  e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9.\-]/g,"");
  $("#tickerAvatar").textContent=e.target.value[0]||"?";
});

$("#run").addEventListener("click",async()=>{
  const ticker=$("#ticker").value.trim().toUpperCase();
  const amount=Number($("#amount").value);
  const start=$("#start").value,end=$("#end").value,msg=$("#formMessage"),btn=$("#run");
  msg.textContent="";
  if(!ticker||!amount||amount<=0||!start||!end||start>end){msg.textContent="Check the ticker, amount and date range.";return}
  btn.disabled=true;btn.querySelector("span").textContent="Loading historical data…";
  try{
    const usage=await consumeUsage("calculation");if(!usage.allowed)throw new Error("Daily free calculation limit reached. Pro includes a much higher fair-use allowance.");
    const fxFrom=new Date(new Date(start+"T00:00:00Z").getTime()-7*86400000).toISOString().slice(0,10);
    const [stockResponse,fxResponse]=await Promise.all([
      fetch(`/api/historical?symbol=${encodeURIComponent(marketSymbol(ticker,assetType))}&from=${start}&to=${end}`),
      fetch(`/api/historical?symbol=GBPUSD.FOREX&from=${fxFrom}&to=${end}`)
    ]);
    const [data,fxData]=await Promise.all([stockResponse.json(),fxResponse.json()]);
    for(const [response,payload] of [[stockResponse,data],[fxResponse,fxData]]){
      if(!response.ok){
        const guidance=payload.setup||payload.detail;
        throw new Error(guidance?`${payload.error} ${guidance}`:payload.error||"Could not load market data.");
      }
    }
    const result=runDCA(data.prices,fxData.prices,start,end,amount,frequency);
    current={ticker,assetType,amount,frequency,start,end,provider:data.provider,...result};
    render(current);
  }catch(e){msg.textContent=e.message}
  finally{btn.disabled=false;btn.querySelector("span").textContent="Calculate"}
});

function render(x){
  $("#result").classList.remove("hidden");
  $("#rTicker").textContent=x.ticker;
  $("#rSubtitle").textContent=`${x.start} → ${x.end} · ${gbp(x.amount)} ${x.frequency}`;
  $("#mInvested").textContent=gbp(x.invested);
  $("#mValue").textContent=gbp(x.value);
  $("#mProfit").textContent=(x.profit>=0?"+":"")+gbp(x.profit);
  $("#mProfit").style.color=x.profit>=0?"#bcff3c":"#ff7373";
  $("#mReturn").textContent=`${x.returnPct>=0?"+":""}${num(x.returnPct,1)}% total return`;
  $("#mContrib").textContent=`${num(x.contributions,0)} scheduled contributions`;
  $("#mShares").textContent=num(x.shares,4);
  $("#providerText").textContent=`Source: ${x.provider} · GBP/USD FX applied · last market date ${x.lastTradingDate}`;
  drawChart(x.points);
  const isCrypto=x.assetType==="crypto";
  $("#findSimilar span").textContent=isCrypto?"Discover similar crypto opportunities":"Discover similar opportunities";
  $("#stockResearch").classList.toggle("hidden",isCrypto);
  $("#cryptoResearch").classList.toggle("hidden",!isCrypto);
  if(!isCrypto)loadFundamentals(x);
  $("#result").scrollIntoView({behavior:"smooth",block:"start"});
}

function showView(id){$$('.view').forEach(view=>view.classList.remove('active'));$("#"+id).classList.add('active');window.scrollTo({top:0,behavior:'smooth'})}
const metricLabel={revenueGrowth:"Revenue growth",grossMargin:"Gross margin",operatingMargin:"Operating margin",rdIntensity:"R&D intensity",fcfMargin:"Free-cash-flow margin"};
const comparisonWidth=value=>Math.max(4,Math.min(100,((Number(value)||0)+.5)/1.5*100));
function yearBefore(date){const d=new Date(date+"T00:00:00Z");d.setUTCFullYear(d.getUTCFullYear()-1);return d.toISOString().slice(0,10)}
function drawTrendComparison(canvas,reference,candidate,referenceLabel,candidateLabel){const ctx=canvas.getContext("2d"),W=canvas.width,H=canvas.height,L=48,R=18,T=28,B=42;ctx.clearRect(0,0,W,H);const normalize=rows=>{const first=rows[0]?.adjustedClose||1;return rows.map(row=>row.adjustedClose/first*100)},a=normalize(reference),b=normalize(candidate),all=[...a,...b];if(!a.length||!b.length)return;const min=Math.min(...all)*.94,max=Math.max(...all)*1.06,range=max-min||1;ctx.font="18px DM Sans";ctx.fillStyle="#687587";ctx.textAlign="right";for(let i=0;i<4;i++){const y=T+(H-T-B)*i/3,value=max-range*i/3;ctx.strokeStyle="rgba(255,255,255,.06)";ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(W-R,y);ctx.stroke();ctx.fillText(value.toFixed(0),L-8,y+5)}const line=(values,color)=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=3;values.forEach((value,index)=>{const x=L+index/(values.length-1||1)*(W-L-R),y=H-B-(value-min)/range*(H-T-B);index?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.stroke()};line(a,"#67a8ff");line(b,"#bcff3c");ctx.textAlign="left";ctx.fillStyle="#67a8ff";ctx.fillText(`● ${referenceLabel}`,L,H-12);ctx.fillStyle="#bcff3c";ctx.fillText(`● ${candidateLabel}`,L+300,H-12)}
async function loadMatchTrend(detail,candidateTicker,candidateType){const canvas=detail.querySelector(".trend-chart"),status=detail.querySelector(".trend-status");if(canvas.dataset.loaded)return;canvas.dataset.loaded="true";status.textContent="Loading comparable 12-month price trends…";const referenceEnd=current.start,referenceStart=yearBefore(referenceEnd),candidateEnd=new Date().toISOString().slice(0,10),candidateStart=yearBefore(candidateEnd);try{const referenceSymbol=marketSymbol(current.ticker,current.assetType),candidateSymbol=marketSymbol(candidateTicker,candidateType),[a,b]=await Promise.all([fetch(`/api/historical?symbol=${encodeURIComponent(referenceSymbol)}&from=${referenceStart}&to=${referenceEnd}`),fetch(`/api/historical?symbol=${encodeURIComponent(candidateSymbol)}&from=${candidateStart}&to=${candidateEnd}`)]),[reference,candidate]=await Promise.all([a.json(),b.json()]);if(!a.ok||!b.ok)throw new Error(reference.error||candidate.error||"Trend data unavailable.");drawTrendComparison(canvas,reference.prices,candidate.prices,`${current.ticker} historical`,`${candidateTicker} recent`);status.textContent="Indexed to 100 at the start of each separate 12-month window. Shape comparison only—not a return forecast."}catch(error){status.textContent=error.message}}
async function loadMatchNews(detail,candidateTicker,candidateType,candidateThemes=[],sharedThemes=[]){const panel=detail.querySelector(".news-panel"),status=panel.querySelector(".news-status"),list=panel.querySelector(".news-list");if(panel.dataset.loaded)return;panel.dataset.loaded="true";status.textContent="Loading recent developments…";try{const symbol=marketSymbol(candidateTicker,candidateType),response=await fetch(`/api/news?symbol=${encodeURIComponent(symbol)}`),data=await response.json();if(!response.ok)throw new Error(data.error||"News unavailable.");if(!data.articles.length){status.textContent="No recent ticker-specific stories were returned.";return}list.innerHTML=data.articles.map(article=>{const articleText=`${article.title} ${article.summary} ${(article.tags||[]).join(" ")}`.toLowerCase(),relevant=(candidateThemes||[]).filter(theme=>articleText.includes(theme.toLowerCase())),connection=relevant.length?`This relates to ${relevant.join(", ")}.`:sharedThemes.length?`Wider commonality with ${current.ticker}: ${sharedThemes.join(", ")}.`:`No direct shared theme with ${current.ticker} was detected in this story.`;return `<article class="news-item"><header><span>${escapeHtml(article.source)}</span><time>${escapeHtml((article.date||"").slice(0,10))}</time></header><a href="${escapeHtml(article.link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.title)}</a><p>${escapeHtml(article.summary||"Open the source for the full report.")}</p><small>${escapeHtml(connection)}</small></article>`}).join("");status.textContent=`${data.articles.length} recent stories from ${data.provider}. Headlines are context only and do not alter the similarity score.`}catch(error){status.textContent=error.message||"News could not be loaded.";status.classList.add("error")}}
$("#findSimilar").addEventListener("click",async()=>{
  if(!current)return;
  const usage=await consumeUsage("similarity");if(!usage.allowed){alert("Daily free similarity limit reached. Pro includes a much higher fair-use allowance.");return}
  showView("similar");
  if(current.assetType==="crypto"){
    $("#similarTitle").textContent=`Crypto opportunities related to ${current.ticker}.`;
    const status=$("#similarStatus"),list=$("#similarList");status.classList.remove("hidden");status.textContent="Comparing crypto market structure and technology themes…";list.innerHTML="";
    try{
      const response=await fetch(`/api/crypto-similar?symbol=${encodeURIComponent(current.ticker)}`),data=await response.json();
      if(!response.ok)throw new Error([data.error,data.detail].filter(Boolean).join(" "));
      status.classList.add("hidden");
      $("#similarIntro").textContent=`Compared across ${data.universeSize} mapped crypto assets using ${data.method}. Source: ${data.provider}.`;
      list.innerHTML=data.matches.map((match,index)=>`<article class="glass match-card"><button class="match-summary" data-ticker="${match.symbol}" data-type="crypto" aria-expanded="false"><span class="match-rank">${index+1}</span><span><strong>${match.name}</strong><small>${match.symbol} · ${match.themes.join(" · ")} · market-cap rank #${match.marketCapRank||"—"}</small></span><b>${match.score}%</b></button><div class="match-detail hidden"><div><h4>Evidence supporting the match</h4><p>${match.themeOverlap.length?`Shared themes: ${match.themeOverlap.join(", ")}.`:"No direct theme overlap; the match comes from market structure."} The score also considers liquidity, supply maturity and market-cap stage.</p></div><div><h4>Risks and differences</h4><p>Short-term hype risk is ${match.hypeRisk}%. Supply maturity is ${match.supplyScore}%; a lower score can indicate greater future dilution.</p></div><div class="evidence-bars">${[["Theme alignment",match.themeScore],["Under-the-radar",match.underRadarScore],["Liquidity quality",match.liquidityScore],["Supply maturity",match.supplyScore],["Hype risk",match.hypeRisk]].map(([label,value])=>`<div><span>${label}<b>${value}%</b></span><i><em style="width:${value}%"></em></i></div>`).join("")}</div><div class="trend-panel"><h4>Historical pattern vs recent trend</h4><canvas class="trend-chart" width="1000" height="330"></canvas><p class="trend-status"></p></div><section class="news-panel"><h4>Breakthroughs and recent developments</h4><p class="news-status">Open this profile to load recent ticker-specific news.</p><div class="news-list"></div></section><p class="match-caution">On-chain adoption, developer activity and holder concentration are not yet scored.</p></div></article>`).join("");
      $$(".match-summary").forEach((button,index)=>button.addEventListener("click",()=>{const detail=button.nextElementSibling,isOpen=!detail.classList.contains("hidden"),match=data.matches[index];detail.classList.toggle("hidden",isOpen);button.setAttribute("aria-expanded",String(!isOpen));if(!isOpen){loadMatchTrend(detail,button.dataset.ticker,button.dataset.type);loadMatchNews(detail,button.dataset.ticker,button.dataset.type,match.themes,match.themeOverlap)}}));
    }catch(error){status.textContent=error.message||"Crypto discovery failed."}
    return;
  }
  $("#similarTitle").textContent=`Companies resembling ${current.ticker}'s earlier profile.`;
  const status=$("#similarStatus"),list=$("#similarList");status.classList.remove("hidden");status.textContent="Comparing current SEC filings across the initial stock universe…";list.innerHTML="";
  try{
    const response=await fetch(`/api/similar?symbol=${encodeURIComponent(current.ticker)}&asof=${current.start}`),data=await response.json();
    if(!response.ok)throw new Error([data.error,data.detail].filter(Boolean).join(" "));
    status.classList.add("hidden");
    $("#similarIntro").textContent=`Compared with ${data.reference.company}'s annual profile ending ${data.reference.period}. Initial universe: ${data.universeSize} US-listed growth companies. Source: ${data.provider}.`;
    list.innerHTML=data.matches.map((match,index)=>`<article class="glass match-card"><button class="match-summary" data-ticker="${match.ticker}" data-type="stock" aria-expanded="false"><span class="match-rank">${index+1}</span><span><strong>${match.company}</strong><small>${match.ticker} · ${match.themes.join(" · ")} · period ${match.period}</small></span><b>${match.score}%</b></button><div class="match-detail hidden"><div><h4>Why it matched</h4><p>${match.reasons.join(" and ")} were the closest financial characteristics.${match.themeOverlap.length?` Shared growth-driver themes: ${match.themeOverlap.join(", ")}.`:" The match is primarily financial rather than thematic."}</p></div><div><h4>Largest differences and risks</h4><p>${match.differences.join(" and ")} differ most from ${current.ticker}'s historical profile. This may reflect a different business model, maturity stage or capital requirement.</p></div><div class="fundamental-comparison">${match.comparisons.map(x=>`<div><header><span>${metricLabel[x.key]}</span><small>${current.ticker} ${pct(x.reference)} · ${match.ticker} ${pct(x.candidate)}</small></header><div class="dual-bars"><i style="width:${comparisonWidth(x.reference)}%"></i><em style="width:${comparisonWidth(x.candidate)}%"></em></div></div>`).join("")}</div><div class="trend-panel"><h4>Historical pattern vs recent trend</h4><canvas class="trend-chart" width="1000" height="330"></canvas><p class="trend-status"></p></div><section class="news-panel"><h4>Breakthroughs and recent developments</h4><p class="news-status">Open this profile to load recent ticker-specific news.</p><div class="news-list"></div></section><p class="match-caution">Financial similarity: ${match.financialScore}%. Theme alignment: ${match.themeScore??"not scored"}%. Price lines use different calendar windows and are indexed for shape comparison only.</p></div></article>`).join("");
    $$(".match-summary").forEach((button,index)=>button.addEventListener("click",()=>{const detail=button.nextElementSibling,isOpen=!detail.classList.contains("hidden"),match=data.matches[index];detail.classList.toggle("hidden",isOpen);button.setAttribute("aria-expanded",String(!isOpen));if(!isOpen){loadMatchTrend(detail,button.dataset.ticker,button.dataset.type);loadMatchNews(detail,button.dataset.ticker,button.dataset.type,match.themes,match.themeOverlap)}}));
  }catch(error){status.textContent=error.message||"Similarity calculation failed."}
});
$("#backToResults").addEventListener("click",()=>showView("discover"));

const pct=value=>value===null||value===undefined?"Not available":`${value>=0?"+":""}${num(value*100,1)}%`;

async function loadFundamentals(x){
  const note=$("#fundamentalsNote"),list=$("#fundamentalsList");
  note.textContent="Loading the financial statements available at the investment start date…";
  list.querySelectorAll("b").forEach(el=>el.textContent="Loading…");
  try{
    const response=await fetch(`/api/fundamentals?symbol=${encodeURIComponent(x.ticker)}&asof=${x.start}`);
    const data=await response.json();
    if(!response.ok) throw new Error([data.error,data.detail].filter(Boolean).join(" ")||"Fundamentals are unavailable.");
    $("#fundamentalsTitle").textContent=`${data.company||x.ticker} financial profile`;
    note.textContent=`Annual period ending ${data.period} · data available by selected start date · Source: ${data.provider}`;
    const rows=[
      ["Revenue growth",pct(data.metrics.revenueGrowth)],
      ["Gross margin",pct(data.metrics.grossMargin)],
      ["Operating margin",pct(data.metrics.operatingMargin)],
      ["R&D intensity",pct(data.metrics.rdIntensity)],
      ["Free-cash-flow margin",pct(data.metrics.fcfMargin)]
    ];
    list.innerHTML=rows.map(([label,value])=>`<div><span>${label}</span><b>${value}</b></div>`).join("");
  }catch(error){
    note.textContent=`Fundamentals unavailable: ${error.message}`;
    list.querySelectorAll("b").forEach(el=>el.textContent="Unavailable");
  }
}

$("#save").addEventListener("click",async()=>{
  if(!current)return;
  if(currentSession()){
    try{const [access,rows]=await Promise.all([getEntitlements({refresh:true}),loadResearch()]),cloudRows=rows.filter(row=>row.kind!=="candidate");if(access.savedResearch!==null&&cloudRows.length>=access.savedResearch)throw new Error(`Free accounts can keep ${access.savedResearch} cloud saves. Upgrade to Pro for unlimited saved research.`);await saveResearch("calculation",`${current.ticker} calculation`,{...current,points:undefined,purchases:undefined});await renderSaved();$("#save").textContent="★ Saved"}catch(error){alert(error.message)}
    return;
  }
  const all=JSON.parse(localStorage.getItem("assetseek-v2")||localStorage.getItem("stockscope-v2")||"[]");
  const saved={...current,points:undefined,savedAt:new Date().toISOString()};
  all.unshift(saved);localStorage.setItem("assetseek-v2",JSON.stringify(all.slice(0,30)));renderSaved();
  $("#save").textContent="★ Saved";setTimeout(()=>$("#save").textContent="☆ Save simulation",1200);
});

async function renderSaved(){
  if(currentSession()){
    const el=$("#savedList");
    try{
      const rows=(await loadResearch()).filter(row=>row.kind!=="candidate");if(!rows.length){el.innerHTML='<div class="glass empty">No account research saved yet.</div>';return}
      el.innerHTML=rows.map((row,index)=>`<article class="glass saved-card" ${row.kind==="portfolio"?`data-open-portfolio="${index}"`:""}><div class="section-tag">${row.kind.replace('_',' ').toUpperCase()}</div><h3>${escapeHtml(row.title)}</h3><p>${new Date(row.created_at).toLocaleDateString('en-GB')}${row.kind==="portfolio"?" · Click to reopen":""}</p></article>`).join("");
      $$('[data-open-portfolio]').forEach(card=>card.addEventListener("click",()=>openSavedPortfolio(rows[Number(card.dataset.openPortfolio)])));return;
    }catch(error){el.innerHTML=`<div class="glass empty">${escapeHtml(error.message)}</div>`;return}
  }
  const all=JSON.parse(localStorage.getItem("assetseek-v2")||localStorage.getItem("stockscope-v2")||"[]"),el=$("#savedList");
  if(!all.length){el.innerHTML='<div class="glass empty">No saved simulations yet. Run a backtest and hit “Save simulation”.</div>';return}
  el.innerHTML=all.map((x,i)=>`<article class="glass saved-card">
    <div class="saved-card-top"><div><div class="section-tag">${x.frequency.toUpperCase()}</div><h3>${x.ticker}</h3></div><button data-i="${i}" class="delete">Delete</button></div>
    <p>${x.start} → ${x.end} · ${gbp(x.amount)} per contribution</p>
    <div class="saved-nums"><div><span>Invested</span><b>${gbp(x.invested)}</b></div><div><span>Value</span><b>${gbp(x.value)}</b></div><div><span>Return</span><b>${num(x.returnPct,1)}%</b></div></div>
  </article>`).join("");
  $$(".delete").forEach(b=>b.addEventListener("click",()=>{all.splice(Number(b.dataset.i),1);localStorage.setItem("assetseek-v2",JSON.stringify(all));renderSaved()}));
}
renderSaved();

async function fetchAlertQuotes(assets){const unique=[...new Map(assets.map(asset=>[`${asset.ticker}:${asset.type}`,asset])).values()],quotes=[];for(let index=0;index<unique.length;index+=15){const batch=unique.slice(index,index+15),symbols=batch.map(asset=>marketSymbol(asset.ticker,asset.type)),response=await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),data=await response.json();if(!response.ok)throw new Error(data.error||"Latest prices could not be loaded.");quotes.push(...data.quotes)}return new Map(quotes.map(quote=>[quote.symbol,quote]))}
async function renderAlerts(){const status=$("#alertStatus"),list=$("#alertList"),button=$("#refreshAlerts"),gate=$("#alertGate"),summary=$(".alert-summary"),access=await getEntitlements({refresh:true});gate.classList.toggle("hidden",access.alerts);summary.classList.toggle("hidden",!access.alerts);status.classList.toggle("hidden",!access.alerts);list.classList.toggle("hidden",!access.alerts);button.classList.toggle("hidden",!access.alerts);list.innerHTML="";if(!access.alerts)return;if(!currentSession()){status.textContent="Sign in and save a portfolio to begin monitoring.";return}button.disabled=true;button.textContent="Checking…";status.textContent="Scanning saved portfolios and delayed market quotes…";try{const rows=await loadResearch(),portfolios=rows.filter(row=>row.kind==="portfolio"),candidates=rows.filter(row=>row.kind==="candidate");if(!portfolios.length&&!candidates.length){status.textContent="Save an evidence portfolio or track a candidate before running alerts.";return}const allAssets=[...portfolios.flatMap(row=>row.payload?.assets||[]),...candidates.map(row=>row.payload?.candidate).filter(Boolean)],quoteMap=await fetchAlertQuotes(allAssets),alerts=[],now=new Date().toLocaleString("en-GB");const add=(severity,title,detail,portfolio)=>alerts.push({severity,title,detail,portfolio,time:now});for(const row of portfolios){const payload=row.payload||{},assets=payload.assets||[],weights=payload.weights||[],evidence=payload.evidence||[];assets.forEach((asset,index)=>{const base=marketSymbol(asset.ticker,asset.type),quote=quoteMap.get(base)||quoteMap.get(asset.type==="stock"?`${base}.US`:base),move=quote?.changePct;if(Number.isFinite(move)){const absolute=Math.abs(move),critical=asset.type==="crypto"?15:10,warning=asset.type==="crypto"?8:5;if(absolute>=critical)add("critical",`${asset.ticker} moved ${move>=0?"+":""}${num(move,2)}%`,`The latest delayed quote crossed the ${critical}% critical daily-movement threshold. Investigate the source and market context; the movement alone is not a trade signal.`,row.title);else if(absolute>=warning)add("warning",`${asset.ticker} moved ${move>=0?"+":""}${num(move,2)}%`,`The latest delayed quote crossed the ${warning}% daily-movement threshold.`,row.title)}if(Number(weights[index])>40)add("warning",`${asset.ticker} concentration is ${weights[index]}%`,`This exceeds the 40% single-asset research threshold.`,row.title);const item=evidence[index];if(item?.hypeRisk>60)add("warning",`${asset.ticker} hype risk is elevated`,`Saved evidence recorded a hype-risk score of ${item.hypeRisk}/100. Rebuild the portfolio to refresh this evidence.`,row.title);if(item?.liquidity<30)add("critical",`${asset.ticker} liquidity evidence is weak`,`The saved liquidity score is ${item.liquidity}/100, which can increase slippage and exit risk.`,row.title)});const cryptoExposure=assets.reduce((sum,asset,index)=>sum+(asset.type==="crypto"?Number(weights[index]||0):0),0);if(cryptoExposure>35)add(cryptoExposure>60?"critical":"warning",`Crypto exposure is ${cryptoExposure}%`,`This saved scenario exceeds the 35% crypto-exposure research threshold.`,row.title);const themeWeights=new Map();evidence.forEach((item,index)=>(item.themes||[]).forEach(theme=>themeWeights.set(theme,(themeWeights.get(theme)||0)+Number(weights[index]||0))));for(const [theme,weight] of themeWeights)if(weight>60)add("warning",`${theme} theme exposure is ${Math.round(weight)}%`,`Several positions may depend on the same growth driver, reducing effective diversification.`,row.title)}for(const row of candidates){const candidate=row.payload?.candidate;if(!candidate)continue;const base=marketSymbol(candidate.ticker,candidate.type),quote=quoteMap.get(base)||quoteMap.get(candidate.type==="stock"?`${base}.US`:base),move=quote?.changePct;if(Number.isFinite(move)&&Math.abs(move)>=(candidate.type==="crypto"?8:5))add(Math.abs(move)>=(candidate.type==="crypto"?15:10)?"critical":"warning",`${candidate.ticker} tracked-candidate movement ${move>=0?"+":""}${num(move,2)}%`,`This daily move crossed the monitored threshold. Reopen the original evidence before interpreting the price change.`,"Opportunity Radar");if(Number(candidate.hypeRisk)>60)add("warning",`${candidate.ticker} has elevated mapped hype risk`,`The original research lead recorded hype risk of ${candidate.hypeRisk}/100.`,"Opportunity Radar")}if(!alerts.length)add("info","No thresholds triggered","No monitored daily-movement, concentration, crypto-exposure, hype, liquidity or theme threshold was triggered.","All saved research");const order={critical:0,warning:1,info:2};alerts.sort((a,b)=>order[a.severity]-order[b.severity]);list.innerHTML=alerts.map(alert=>`<article class="glass alert-card ${alert.severity}"><i class="alert-severity"></i><div><div class="section-tag">${escapeHtml(alert.severity)} · ${escapeHtml(alert.portfolio)}</div><h3>${escapeHtml(alert.title)}</h3><p>${escapeHtml(alert.detail)}</p></div><time>${escapeHtml(alert.time)}</time></article>`).join("");for(const severity of ["critical","warning","info"])$(`#${severity}AlertCount`).textContent=alerts.filter(alert=>alert.severity===severity).length;status.textContent=`Checked ${portfolios.length} saved portfolio${portfolios.length===1?"":"s"} and ${candidates.length} tracked candidate${candidates.length===1?"":"s"}.`}catch(error){status.textContent=error.message}finally{button.disabled=false;button.textContent="↻ Run alert check"}}
$("#refreshAlerts").addEventListener("click",renderAlerts);

let portfolioFrequency="daily",portfolioMax=3;
let portfolioAssets=JSON.parse(localStorage.getItem("assetseek-portfolio-assets")||localStorage.getItem("stockscope-portfolio-assets")||'[{"ticker":"NVDA","type":"stock"},{"ticker":"IONQ","type":"stock"},{"ticker":"BTC","type":"crypto"}]');
function savePortfolioAssets(){localStorage.setItem("assetseek-portfolio-assets",JSON.stringify(portfolioAssets))}
async function refreshPortfolioLimit(){try{const access=await getEntitlements({refresh:true});portfolioMax=access.portfolioAssets;$("#portfolioLimit").textContent=`${access.beta?"Private beta":access.development?"Local development":access.isPro?"Pro plan":"Free plan"} · up to ${portfolioMax} assets`;if(portfolioAssets.length>portfolioMax){portfolioAssets=portfolioAssets.slice(0,portfolioMax);savePortfolioAssets();renderPortfolioAssets()}}catch{portfolioMax=3;$("#portfolioLimit").textContent="Free plan · up to 3 assets"}}
async function loadPortfolioPrices(){if(!portfolioAssets.length)return;const requested=portfolioAssets.map(asset=>marketSymbol(asset.ticker,asset.type)),status=$("#portfolioPriceStatus");try{const response=await fetch(`/api/quotes?symbols=${encodeURIComponent(requested.join(","))}`),data=await response.json();if(!response.ok)throw new Error(data.error||"Prices unavailable.");const bySymbol=new Map(data.quotes.map(quote=>[quote.symbol,quote]));portfolioAssets.forEach(asset=>{const providerCode=asset.type==="crypto"?marketSymbol(asset.ticker,"crypto"):`${asset.ticker}.US`,quote=bySymbol.get(providerCode),box=document.querySelector(`[data-portfolio-price="${CSS.escape(asset.ticker)}"]`);if(!box)return;if(!quote){box.innerHTML='<b>Unavailable</b><small>Latest quote</small>';return}const change=Number.isFinite(quote.changePct)?quote.changePct:null;box.innerHTML=`<b>${usd(quote.price)}</b><small class="${change===null?"":change>=0?"positive":"negative"}">${change===null?"Delayed quote":`${change>=0?"+":""}${num(change,2)}% today`}</small>`});status.textContent=`Latest delayed prices · ${data.provider}`}catch(error){$$('[data-portfolio-price]').forEach(box=>box.innerHTML='<b>Unavailable</b><small>Quote could not load</small>');status.textContent=error.message}}
function renderPortfolioAssets(){const el=$("#portfolioAssets");if(!portfolioAssets.length){el.innerHTML='<div class="empty">Add at least two assets to build a diversified research scenario.</div>';return}el.innerHTML=portfolioAssets.map((asset,index)=>`<article class="portfolio-asset"><span class="ticker-avatar">${escapeHtml(asset.ticker[0])}</span><span><strong>${escapeHtml(asset.ticker)}</strong><small>${escapeHtml(asset.name||(asset.type==="crypto"?"Cryptoasset":"Listed stock"))}</small></span><span class="portfolio-price" data-portfolio-price="${escapeHtml(asset.ticker)}"><b>Loading…</b><small>Latest USD price</small></span><button class="portfolio-remove" data-portfolio-remove="${index}" aria-label="Remove ${escapeHtml(asset.ticker)}">Remove</button></article>`).join("");$$('[data-portfolio-remove]').forEach(button=>button.addEventListener("click",()=>{portfolioAssets.splice(Number(button.dataset.portfolioRemove),1);savePortfolioAssets();renderPortfolioAssets();$("#portfolioResult").classList.add("hidden")}));loadPortfolioPrices()}
$("#portfolioAddForm").addEventListener("submit",async event=>{event.preventDefault();const message=$("#portfolioMessage"),ticker=$("#portfolioTicker").value.toUpperCase().replace(/[^A-Z0-9.-]/g,"").slice(0,12),type=$("#portfolioType").value,button=event.currentTarget.querySelector("button");message.textContent="";if(!ticker){message.textContent="Enter a valid ticker.";return}if(portfolioAssets.length>=portfolioMax){message.textContent=`Your current plan allows ${portfolioMax} selected assets.`;return}if(portfolioAssets.some(asset=>asset.ticker===ticker)){message.textContent="That asset is already in your basket.";return}button.disabled=true;button.textContent="Checking…";try{const response=await fetch(`/api/assets/validate?symbol=${encodeURIComponent(ticker)}&type=${type}`),asset=await response.json();if(!response.ok)throw new Error(asset.error||"Asset could not be verified.");portfolioAssets.push({ticker:asset.ticker,type:asset.type,name:asset.name});savePortfolioAssets();renderPortfolioAssets();$("#portfolioTicker").value="";$("#portfolioResult").classList.add("hidden")}catch(error){message.textContent=error.message}finally{button.disabled=false;button.textContent="+ Add asset"}});
$$('[data-portfolio-freq]').forEach(button=>button.addEventListener("click",()=>{$$('[data-portfolio-freq]').forEach(item=>item.classList.remove("active"));button.classList.add("active");portfolioFrequency=button.dataset.portfolioFreq}));
let currentPortfolioEvidence=[];
function drawAllocationChart(weights){const canvas=$("#allocationChart"),ctx=canvas.getContext("2d"),cx=canvas.width/2,cy=canvas.height/2,r=125,inner=72,total=weights.reduce((sum,value)=>sum+value,0),colours=["#bcff3c","#67a8ff","#a774ff","#ffb45f","#45e0c1","#ff7373","#d6e36b","#758cff","#ec78c5","#82cfff","#c29cff","#f2d06b"];ctx.clearRect(0,0,canvas.width,canvas.height);let angle=-Math.PI/2;weights.forEach((weight,index)=>{const next=angle+Math.PI*2*weight/100;ctx.beginPath();ctx.arc(cx,cy,r,angle,next);ctx.arc(cx,cy,inner,next,angle,true);ctx.closePath();ctx.fillStyle=colours[index%colours.length];ctx.fill();angle=next});ctx.textAlign="center";ctx.fillStyle="#f5f7fb";ctx.font="700 31px Manrope";ctx.fillText(`${total}%`,cx,cy+5);ctx.fillStyle="#718092";ctx.font="15px DM Sans";ctx.fillText(`${weights.length} assets`,cx,cy+31)}
function renderPortfolioDashboard(weights,evidence){if(!evidence.length)return;const budget=Math.max(0,Number($("#portfolioBudget").value)||0),annualMultiplier={daily:365,weekly:52,monthly:12}[portfolioFrequency],annual=budget*annualMultiplier,cryptoExposure=evidence.reduce((sum,item,index)=>sum+(item.type==="crypto"?weights[index]:0),0),weightedScore=Math.round(evidence.reduce((sum,item,index)=>sum+item.score*weights[index]/100,0)),largest=Math.max(...weights),largestIndex=weights.indexOf(largest);drawAllocationChart(weights);$("#portfolioDashboardMetrics").innerHTML=`<div class="dashboard-metric"><span>Planned annual contributions</span><b>${gbp(annual)}</b><small>${portfolioFrequency} plan, before returns</small></div><div class="dashboard-metric"><span>Evidence strength</span><b>${weightedScore}/100</b><small>weighted across selected assets</small></div><div class="dashboard-metric"><span>Stock / crypto exposure</span><b>${100-cryptoExposure}% / ${cryptoExposure}%</b><small>based on current sliders</small></div><div class="dashboard-metric"><span>Largest position</span><b>${escapeHtml(portfolioAssets[largestIndex]?.ticker||"—")} · ${largest}%</b><small>concentration check</small></div>`;const themes=new Map();evidence.forEach((item,index)=>(item.themes||[]).forEach(theme=>themes.set(theme,(themes.get(theme)||0)+weights[index])));$("#portfolioThemes").innerHTML=themes.size?[...themes.entries()].sort((a,b)=>b[1]-a[1]).map(([theme,weight])=>`<span class="portfolio-theme">${escapeHtml(theme)} · ${Math.round(weight)}%</span>`).join(""):'<span class="portfolio-health">No mapped themes are available for this basket yet.</span>';const warnings=[];if(largest>40)warnings.push(`${portfolioAssets[largestIndex].ticker} represents ${largest}% of the scenario, creating material single-asset concentration.`);if(cryptoExposure>35)warnings.push(`Crypto exposure is ${cryptoExposure}%, which may produce substantial volatility and drawdowns.`);evidence.filter(item=>item.hypeRisk>60).forEach(item=>warnings.push(`${item.ticker} has elevated recent-momentum/hype risk (${item.hypeRisk}/100).`));evidence.filter(item=>item.liquidity<30).forEach(item=>warnings.push(`${item.ticker} has a low liquidity score (${item.liquidity}/100).`));$("#portfolioWarnings").innerHTML=warnings.length?warnings.map(warning=>`<div class="portfolio-health warn">${escapeHtml(warning)}</div>`).join(""):'<div class="portfolio-health good">No concentration, crypto-exposure, hype or liquidity threshold was triggered by this scenario.</div>'}
function renderAllocation(weights){const budget=Math.max(0,Number($("#portfolioBudget").value)||0),list=$("#allocationList");list.innerHTML=portfolioAssets.map((asset,index)=>`<div class="allocation-row"><div><strong>${escapeHtml(asset.ticker)}</strong><small>${asset.type==="crypto"?"Crypto · higher volatility":"Stock · company exposure"}</small></div><input type="range" min="0" max="100" step="1" value="${weights[index]}" data-allocation="${index}" aria-label="${escapeHtml(asset.ticker)} allocation"/><div class="allocation-value"><b>${weights[index]}%</b><span>${gbp(budget*weights[index]/100)}</span></div></div>`).join("");const inputs=$$('[data-allocation]'),update=()=>{let total=0;inputs.forEach((input,index)=>{const value=Number(input.value);total+=value;const box=input.nextElementSibling;box.querySelector("b").textContent=`${value}%`;box.querySelector("span").textContent=gbp(budget*value/100);weights[index]=value});$("#portfolioTotal").textContent=`${total}%`;$("#portfolioTotal").style.color=total===100?"var(--lime)":"var(--red)";$("#allocationAmount").textContent=gbp(budget*total/100)};inputs.forEach(input=>input.addEventListener("input",()=>{const others=inputs.reduce((sum,item)=>sum+(item===input?0:Number(item.value)),0),remaining=Math.max(0,100-others);input.value=String(Math.min(Number(input.value),remaining));update()}));update()}
$("#buildEvidenceAllocation").addEventListener("click",async()=>{
  const message=$("#portfolioMessage"),budget=Number($("#portfolioBudget").value),button=$("#buildEvidenceAllocation");
  if(portfolioAssets.length<2){message.textContent="Add at least two assets before building an allocation.";return}
  if(!budget||budget<=0){message.textContent="Enter a contribution amount above £0.";return}
  message.textContent="";button.disabled=true;button.querySelector("span").textContent="Analysing one year of evidence…";
  try{
    const assets=portfolioAssets.map(asset=>`${asset.ticker}:${asset.type}`).join(",");
    const response=await fetch(`/api/portfolio-evidence?assets=${encodeURIComponent(assets)}`),data=await response.json();
    if(!response.ok)throw new Error([data.error,data.detail].filter(Boolean).join(" "));
    currentPortfolioEvidence=data.items;const suggestedWeights=data.items.map(item=>item.weight);renderAllocation(suggestedWeights);renderPortfolioDashboard(suggestedWeights,currentPortfolioEvidence);
    $$('[data-allocation]').forEach(input=>input.addEventListener("input",()=>renderPortfolioDashboard($$('[data-allocation]').map(item=>Number(item.value)),currentPortfolioEvidence)));
    $$('.allocation-row').forEach((row,index)=>{const item=data.items[index];row.querySelector('small').textContent=`Evidence ${item.score}/100 · stability ${item.stability} · liquidity ${item.liquidity} · hype risk ${item.hypeRisk}`});
    $("#portfolioSummary").textContent=`This evidence-weighted scenario spreads ${gbp(budget)} ${portfolioFrequency}. It uses stability, liquidity, recent hype risk and theme diversification from the last year of market data. Source: ${data.provider}. Move one slider at a time to test your own allocation.`;
    $("#portfolioResult").classList.remove("hidden");$("#portfolioResult").scrollIntoView({behavior:"smooth",block:"start"});
  }catch(error){message.textContent=error.message}
  finally{button.disabled=false;button.querySelector("span").textContent="Build suggested allocation"}
});
function openSavedPortfolio(row){const payload=row?.payload;if(!payload?.assets?.length||!payload?.weights?.length)return;portfolioAssets=payload.assets;portfolioFrequency=payload.frequency||"weekly";currentPortfolioEvidence=payload.evidence||[];savePortfolioAssets();renderPortfolioAssets();$("#portfolioBudget").value=payload.budget||100;$("#portfolioName").value=row.title||"";$$('[data-portfolio-freq]').forEach(button=>button.classList.toggle("active",button.dataset.portfolioFreq===portfolioFrequency));renderAllocation(payload.weights);if(currentPortfolioEvidence.length){renderPortfolioDashboard(payload.weights,currentPortfolioEvidence);$$('.allocation-row').forEach((allocation,index)=>{const item=currentPortfolioEvidence[index];if(item)allocation.querySelector('small').textContent=`Evidence ${item.score}/100 · stability ${item.stability} · liquidity ${item.liquidity} · hype risk ${item.hypeRisk}`});$$('[data-allocation]').forEach(input=>input.addEventListener("input",()=>renderPortfolioDashboard($$('[data-allocation]').map(item=>Number(item.value)),currentPortfolioEvidence)))}$("#portfolioSummary").textContent=`Reopened ${row.title}. This saved research scenario uses the evidence captured when it was created; rebuild it to refresh market evidence.`;$("#portfolioResult").classList.remove("hidden");showView("portfolio")}
$("#savePortfolio").addEventListener("click",async()=>{const status=$("#portfolioSaveStatus"),button=$("#savePortfolio"),name=$("#portfolioName").value.trim(),weights=$$('[data-allocation]').map(input=>Number(input.value));status.textContent="";if(!currentSession()){status.textContent="Sign in before saving a cloud portfolio.";return}if(!name){status.textContent="Give this portfolio a name first.";return}if(!currentPortfolioEvidence.length||!weights.length){status.textContent="Build an evidence allocation before saving.";return}if(weights.reduce((sum,value)=>sum+value,0)!==100){status.textContent="Allocations must total 100% before saving.";return}button.disabled=true;button.textContent="Saving…";try{const [access,rows]=await Promise.all([getEntitlements({refresh:true}),loadResearch()]),savedCount=rows.filter(row=>row.kind==="portfolio").length,totalSaves=rows.filter(row=>row.kind!=="candidate").length;if(access.savedPortfolios!==null&&savedCount>=access.savedPortfolios)throw new Error("Free accounts can save one portfolio. Upgrade to Pro for unlimited saved portfolios.");if(access.savedResearch!==null&&totalSaves>=access.savedResearch)throw new Error(`Free accounts can keep ${access.savedResearch} cloud saves. Upgrade to Pro for unlimited saved research.`);await saveResearch("portfolio",name,{assets:portfolioAssets,budget:Number($("#portfolioBudget").value),frequency:portfolioFrequency,weights,evidence:currentPortfolioEvidence,savedAt:new Date().toISOString()});status.textContent="Portfolio saved to your account.";button.textContent="★ Saved";await renderSaved()}catch(error){status.textContent=error.message;button.textContent="☆ Save portfolio"}finally{button.disabled=false}});
renderPortfolioAssets();refreshPortfolioLimit();

let carouselIndex=0,carouselTimer;
const carouselSlides=$$(".research-slide"),carouselDots=$("#carouselDots");
carouselDots.innerHTML=carouselSlides.map((_,index)=>`<button aria-label="Show research item ${index+1}" data-carousel-index="${index}"></button>`).join("");
function showCarousel(index){carouselIndex=(index+carouselSlides.length)%carouselSlides.length;carouselSlides.forEach((slide,i)=>slide.classList.toggle("active",i===carouselIndex));$$('[data-carousel-index]').forEach((dot,i)=>dot.classList.toggle("active",i===carouselIndex))}
function restartCarousel(){clearInterval(carouselTimer);carouselTimer=setInterval(()=>showCarousel(carouselIndex+1),6500)}
$("#carouselPrev").addEventListener("click",()=>{showCarousel(carouselIndex-1);restartCarousel()});$("#carouselNext").addEventListener("click",()=>{showCarousel(carouselIndex+1);restartCarousel()});$$('[data-carousel-index]').forEach(dot=>dot.addEventListener("click",()=>{showCarousel(Number(dot.dataset.carouselIndex));restartCarousel()}));$("#researchCarousel").addEventListener("mouseenter",()=>clearInterval(carouselTimer));$("#researchCarousel").addEventListener("mouseleave",restartCarousel);showCarousel(0);restartCarousel();
$$('[data-legal-view]').forEach(button=>button.addEventListener("click",()=>showView(button.dataset.legalView)));
initProTools();

$$(".navlink").forEach(b=>b.addEventListener("click",()=>{
  $$(".navlink").forEach(x=>x.classList.remove("active"));b.classList.add("active");
  if(b.dataset.view==="portfolio")refreshPortfolioLimit();
  if(b.dataset.view==="alerts")renderAlerts();
  if(b.dataset.view==="radar")renderRadar();
  $$(".view").forEach(x=>x.classList.remove("active"));$("#"+b.dataset.view).classList.add("active");window.scrollTo({top:0,behavior:"smooth"});
}));
