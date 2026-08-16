import {currentSession,deleteResearch,getEntitlements,loadResearch} from "./supabase-client.js";
import {marketSymbol} from "./assets.js";
import {buildRadarDigest,candidatePerformance,summarizeRadar} from "./radar-model.js";

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
const usd=value=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"USD",maximumFractionDigits:Number(value)<1?4:2}).format(value);
const pct=value=>Number.isFinite(value)?`${value>=0?"+":""}${value.toFixed(1)}%`:"—";
const csvCell=value=>`"${String(value??"").replace(/"/g,'""')}"`;
let radarItems=[];

function download(name,content){const link=document.createElement("a");link.href=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000)}
async function quoteCandidates(rows){
  const candidates=rows.map(row=>row.payload?.candidate).filter(Boolean);
  if(!candidates.length)return new Map();
  const symbols=candidates.map(candidate=>marketSymbol(candidate.ticker,candidate.type));
  const response=await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols.join(","))}`),data=await response.json();
  if(!response.ok)throw new Error(data.error||"Tracked prices could not be loaded.");
  return new Map(data.quotes.map(quote=>[quote.symbol.toUpperCase(),quote]));
}
function findQuote(quotes,candidate){
  const base=marketSymbol(candidate.ticker,candidate.type).toUpperCase();
  return quotes.get(base)||quotes.get(candidate.type==="stock"?`${base}.US`:base);
}
function renderDigest(items){
  const digest=buildRadarDigest(items),box=$("#weeklyDigest");
  box.innerHTML=digest.length?digest.map(item=>`<article class="digest-item"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)}</p></article>`).join(""):"";
  $("#digestStatus").textContent=digest.length?`Generated from ${items.length} tracked research lead${items.length===1?"":"s"} and the latest available delayed quotes.`:"Track an emerging candidate from an AI comparison to build your first digest.";
}
function renderTracker(items){
  const box=$("#candidateTracker");
  if(!items.length){box.innerHTML='<div class="empty-radar">No candidates tracked yet. Run an AI comparison and select “Track in Opportunity Radar” on a research lead.</div>';return}
  box.innerHTML=items.map(item=>{const candidate=item.candidate,change=Number(item.quote?.changePct),themes=Array.isArray(candidate.themes)?candidate.themes:[];return`<article class="tracked-candidate"><span class="ticker-avatar">${escapeHtml(candidate.ticker?.[0]||"?")}</span><div><h3>${escapeHtml(candidate.ticker)} · ${escapeHtml(candidate.name||"Research candidate")}</h3><p>Found from ${escapeHtml(item.anchor?.ticker||"an earlier comparison")} · tracked ${new Date(item.discoveredAt).toLocaleDateString("en-GB")}</p><div class="tracked-candidate-tags">${themes.map(theme=>`<span>${escapeHtml(theme)}</span>`).join("")}</div></div><div class="tracked-candidate-metrics"><span>Delayed price<b>${item.quote?usd(item.quote.price):"Unavailable"}</b></span><span>Today<b class="${change>=0?"positive":"negative"}">${Number.isFinite(change)?pct(change):"—"}</b></span><span>Since tracked<b class="${item.performance>=0?"positive":"negative"}">${pct(item.performance)}</b></span></div><div class="tracked-candidate-actions"><button class="ghost" data-radar-compare="${escapeHtml(item.row.id)}">Research again</button><button class="ghost delete" data-radar-remove="${escapeHtml(item.row.id)}">Remove</button></div></article>`}).join("");
  $$('[data-radar-remove]').forEach(button=>button.addEventListener("click",async()=>{button.disabled=true;try{await deleteResearch(button.dataset.radarRemove);await renderRadar()}catch(error){button.textContent=error.message;button.disabled=false}}));
  $$('[data-radar-compare]').forEach(button=>button.addEventListener("click",()=>{const item=radarItems.find(entry=>entry.row.id===button.dataset.radarCompare);if(item)window.dispatchEvent(new CustomEvent("assetseek:compare-candidate",{detail:{anchor:item.anchor,candidate:item.candidate}}))}));
}

export async function renderRadar(){
  const gate=$("#radarGate"),workspace=$("#radarWorkspace"),exportCsv=$("#exportRadarCsv"),print=$("#printRadar");
  try{
    const access=await getEntitlements({refresh:true});
    gate.classList.toggle("hidden",access.candidateTracker);workspace.classList.toggle("hidden",!access.candidateTracker);exportCsv.disabled=!access.exports;print.disabled=!access.exports;
    if(!access.candidateTracker)return;
    if(!currentSession()){workspace.classList.add("hidden");gate.classList.remove("hidden");gate.querySelector("h2").textContent="Sign in to open your Opportunity Radar.";gate.querySelector("p").textContent="Your tracked candidates are securely attached to your AssetSeek account.";gate.querySelector("button span").textContent="Sign in to Radar";exportCsv.disabled=true;print.disabled=true;return}
    $("#candidateTracker").innerHTML='<div class="empty-radar">Refreshing tracked candidates and delayed prices…</div>';
    const rows=(await loadResearch()).filter(row=>row.kind==="candidate"),quotes=await quoteCandidates(rows);
    radarItems=rows.map(row=>{const payload=row.payload||{},candidate=payload.candidate||{},quote=findQuote(quotes,candidate);return{row,candidate,anchor:payload.anchor,discoveredAt:payload.discoveredAt||row.created_at,discoveryPrice:Number(payload.discoveryPrice)||null,quote,performance:candidatePerformance(payload.discoveryPrice,quote?.price)}});
    const summary=summarizeRadar(radarItems);$("#trackedCandidateCount").textContent=summary.count;$("#averageCandidateFit").textContent=summary.averageFit===null?"—":`${summary.averageFit}/100`;$("#largestTrackedMove").textContent=pct(summary.largestMove);
    renderDigest(radarItems);renderTracker(radarItems);
  }catch(error){$("#candidateTracker").innerHTML=`<div class="empty-radar">${escapeHtml(error.message)}</div>`}
}

export function initProTools(){
  $("#refreshRadar")?.addEventListener("click",renderRadar);
  $("#exportRadarCsv")?.addEventListener("click",async()=>{const access=await getEntitlements({refresh:true});if(!access.exports){window.dispatchEvent(new CustomEvent("assetseek:upgrade",{detail:{feature:"Radar exports"}}));return}const rows=[["Ticker","Type","Anchor","Research fit","Discovery price","Current delayed price","Move since tracked","Risk"],...radarItems.map(item=>[item.candidate.ticker,item.candidate.type,item.anchor?.ticker,item.candidate.score,item.discoveryPrice,item.quote?.price,item.performance,item.candidate.risk])];download(`assetseek-radar-${new Date().toISOString().slice(0,10)}.csv`,rows.map(row=>row.map(csvCell).join(",")).join("\n"))});
  $("#printRadar")?.addEventListener("click",async()=>{const access=await getEntitlements({refresh:true});if(access.exports)window.print();else window.dispatchEvent(new CustomEvent("assetseek:upgrade",{detail:{feature:"Radar exports"}}))});
  window.addEventListener("assetseek:radar-updated",renderRadar);
}
