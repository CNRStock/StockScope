import { consumeUsage } from './supabase-client.js';

const $=selector=>document.querySelector(selector);
const $$=selector=>[...document.querySelectorAll(selector)];
const colours=['#bcff3c','#67a8ff','#b67cff','#ffb45f'];
const escapeHtml=value=>String(value??'').replace(/[&<>\"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[char]));
const num=(value,digits=1)=>new Intl.NumberFormat('en-GB',{maximumFractionDigits:digits}).format(value);
const usd=value=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'USD',maximumFractionDigits:value<1?4:2}).format(value);
const percentage=value=>Number.isFinite(Number(value))?`${Number(value)>=0?'+':''}${num(Number(value)*100,1)}%`:'—';

let assets=(()=>{try{const saved=JSON.parse(localStorage.getItem('assetseek-research-assets')||'null');return Array.isArray(saved)&&saved.length>=2?saved:[{ticker:'NVDA',type:'stock',name:'NVIDIA Corporation'},{ticker:'IONQ',type:'stock',name:'IonQ, Inc.'}]}catch{return[{ticker:'NVDA',type:'stock'},{ticker:'IONQ',type:'stock'}]}})();
function saveAssets(){localStorage.setItem('assetseek-research-assets',JSON.stringify(assets))}

function renderAssets(){
  const element=$('#researchAssets');if(!element)return;
  element.innerHTML=assets.map((asset,index)=>`<article class='research-asset ${index===0?'anchor':''}'><span class='ticker-avatar'>${escapeHtml(asset.ticker[0])}</span><span><small>${index===0?'ANCHOR':'COMPARISON'} · ${asset.type.toUpperCase()}</small><strong>${escapeHtml(asset.ticker)}</strong><em>${escapeHtml(asset.name||'')}</em></span><button type='button' data-research-remove='${index}' aria-label='Remove ${escapeHtml(asset.ticker)}'>×</button></article>`).join('');
  $$('[data-research-remove]').forEach(button=>button.addEventListener('click',()=>{assets.splice(Number(button.dataset.researchRemove),1);saveAssets();renderAssets();$('#researchResult').classList.add('hidden')}));
}

async function addAsset(ticker,type){
  ticker=ticker.toUpperCase().replace(/[^A-Z0-9.-]/g,'').slice(0,12);
  if(!ticker)throw new Error('Enter a valid ticker or coin symbol.');
  if(assets.length>=4)throw new Error('A comparison can contain up to four assets.');
  if(assets.some(asset=>asset.ticker===ticker&&asset.type===type))throw new Error('That asset is already selected.');
  $('#researchMessage').textContent='Checking market coverage…';
  const response=await fetch(`/api/assets/validate?symbol=${encodeURIComponent(ticker)}&type=${type}`),asset=await response.json();
  if(!response.ok)throw new Error(asset.error||'Asset could not be verified.');
  assets.push({ticker:asset.ticker,type:asset.type,name:asset.name});saveAssets();renderAssets();$('#researchMessage').textContent='';
}

function drawChart(resultAssets){
  const canvas=$('#researchChart'),context=canvas.getContext('2d'),width=canvas.width,height=canvas.height,left=58,right=20,top=30,bottom=42;
  context.clearRect(0,0,width,height);
  const series=resultAssets.map(asset=>{const first=asset.stats.series[0]?.adjustedClose||1;return asset.stats.series.map(row=>row.adjustedClose/first*100)}),all=series.flat();if(!all.length)return;
  const min=Math.min(...all)*.94,max=Math.max(...all)*1.06,range=max-min||1;
  context.font='18px DM Sans';context.textAlign='right';context.fillStyle='#687587';
  for(let index=0;index<5;index++){const y=top+(height-top-bottom)*index/4,value=max-range*index/4;context.strokeStyle='rgba(255,255,255,.06)';context.beginPath();context.moveTo(left,y);context.lineTo(width-right,y);context.stroke();context.fillText(value.toFixed(0),left-9,y+5)}
  series.forEach((values,assetIndex)=>{context.beginPath();context.strokeStyle=colours[assetIndex];context.lineWidth=3.5;context.lineCap='round';context.lineJoin='round';values.forEach((value,index)=>{const x=left+index/(values.length-1||1)*(width-left-right),y=height-bottom-(value-min)/range*(height-top-bottom);index?context.lineTo(x,y):context.moveTo(x,y)});context.stroke()});
  context.textAlign='left';context.fillStyle='#687587';context.fillText(resultAssets[0].stats.periodStart.slice(0,7),left,height-10);context.textAlign='right';context.fillText(resultAssets[0].stats.periodEnd.slice(0,7),width-right,height-10);
}

function cited(value,sourceMap){
  return escapeHtml(value).replace(/\[(S\d+)\]/g,(match,id)=>{const source=sourceMap.get(id);return source&&/^https:\/\//i.test(source.url)?`<a class='citation' href='${escapeHtml(source.url)}' target='_blank' rel='noopener noreferrer'>[${id}]</a>`:match});
}

function renderBrief(data){
  const sourceMap=new Map(data.sources.map(source=>[source.id,source])),analysis=data.analysis;
  $('#researchTitle').textContent=data.assets.map(asset=>asset.ticker).join(' vs ');
  $('#researchGenerated').textContent=`Generated ${new Date(data.generatedAt).toLocaleString('en-GB')} · ${data.provider}`;
  $('#researchMode').textContent=data.ai.used?`AI-assisted · ${data.ai.model}`:'Evidence brief · AI setup pending';$('#researchMode').classList.toggle('ai-live',data.ai.used);
  $('#researchHeadline').textContent=analysis.headline;$('#researchSummary').innerHTML=cited(analysis.summary,sourceMap);
  const list=(selector,items)=>$(selector).innerHTML=items.length?`<ul>${items.map(item=>`<li>${cited(item,sourceMap)}</li>`).join('')}</ul>`:'<p>No supported claim was available.</p>';
  list('#researchCommon',analysis.commonGround);list('#researchDifferences',analysis.differences);
  const claims=(selector,items)=>$(selector).innerHTML=items.map(item=>`<div class='research-claim'><b>${escapeHtml(item.asset)}</b><strong>${escapeHtml(item.point)}</strong><p>${cited(item.evidence,sourceMap)}</p></div>`).join('');
  claims('#researchCatalysts',analysis.catalysts);claims('#researchRisks',analysis.risks);
  $('#researchVerdict').innerHTML=cited(analysis.verdict,sourceMap);$('#researchQuestions').innerHTML=analysis.questions.map(question=>`<li>${escapeHtml(question)}</li>`).join('');
  $('#researchSources').innerHTML=data.sources.map(source=>`<a href='${escapeHtml(source.url)}' target='_blank' rel='noopener noreferrer'><b>${escapeHtml(source.id)}</b><span><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(source.publisher)}${source.date?` · ${escapeHtml(source.date)}`:''}</small></span><em>↗</em></a>`).join('');
  $('#researchLegend').innerHTML=data.assets.map((asset,index)=>`<span><i style='background:${colours[index]}'></i>${escapeHtml(asset.ticker)}</span>`).join('');
  $('#researchEvidence').innerHTML=data.assets.map((asset,index)=>{
    const metrics=asset.fundamentals?.metrics;
    const fundamentals=metrics?`<div class='research-fundamentals'><span>Revenue growth <b>${percentage(metrics.revenueGrowth)}</b></span><span>Operating margin <b>${percentage(metrics.operatingMargin)}</b></span><span>R&amp;D intensity <b>${percentage(metrics.rdIntensity)}</b></span></div>`:`<p class='evidence-gap'>${asset.type==='crypto'?'Company fundamentals do not apply; on-chain evidence is a future data milestone.':'SEC fundamentals were unavailable for this asset.'}</p>`;
    return`<article class='glass evidence-card' style='--asset-colour:${colours[index]}'><header><div><span>${index===0?'ANCHOR':'COMPARISON'}</span><h3>${escapeHtml(asset.ticker)}</h3><small>${escapeHtml(asset.name)}</small></div><b>${usd(asset.stats.latestPrice)}</b></header><div class='evidence-metrics'><span>1-year move<b class='${asset.stats.change1y>=0?'positive':'negative'}'>${percentage(asset.stats.change1y)}</b></span><span>Volatility<b>${percentage(asset.stats.annualVolatility)}</b></span><span>Evidence score<b>${asset.stats.score}/100</b></span><span>Hype risk<b>${asset.stats.hypeRisk}/100</b></span></div><div class='evidence-themes'>${asset.themes.length?asset.themes.map(theme=>`<span>${escapeHtml(theme)}</span>`).join(''):'<span>Theme mapping pending</span>'}</div>${fundamentals}</article>`;
  }).join('');
  drawChart(data.assets);$('#researchResult').classList.remove('hidden');$('#researchResult').scrollIntoView({behavior:'smooth',block:'start'});
}

function init(){
  const form=$('#researchAddForm');if(!form)return;renderAssets();
  const matchList=$('#similarList');if(matchList)new MutationObserver(()=>{$$('.match-card').forEach(card=>{const summary=card.querySelector('.match-summary'),detail=card.querySelector('.match-detail');if(!summary||!detail||detail.querySelector('.research-from-match'))return;const button=document.createElement('button');button.type='button';button.className='ghost research-from-match';button.textContent=`Compare ${$('#rTicker').textContent} with ${summary.dataset.ticker} in Research →`;button.addEventListener('click',()=>{assets=[{ticker:$('#rTicker').textContent.trim(),type:summary.dataset.type},{ticker:summary.dataset.ticker,type:summary.dataset.type}];saveAssets();renderAssets();document.querySelector('[data-view=research]').click()});detail.append(button)})}).observe(matchList,{childList:true,subtree:true});
  form.addEventListener('submit',async event=>{event.preventDefault();const button=event.currentTarget.querySelector('button'),message=$('#researchMessage');button.disabled=true;try{await addAsset($('#researchTicker').value,$('#researchType').value);$('#researchTicker').value=''}catch(error){message.textContent=error.message}finally{button.disabled=false}});
  $$('[data-research-preset]').forEach(button=>button.addEventListener('click',()=>{assets=button.dataset.researchPreset.split(',').map(entry=>{const[ticker,type]=entry.split(':');return{ticker,type}});saveAssets();renderAssets();$('#researchMessage').textContent='Preset loaded. You can remove or add assets before running the comparison.';$('#researchResult').classList.add('hidden')}));
  $('#runResearch').addEventListener('click',async()=>{const message=$('#researchMessage'),button=$('#runResearch');if(assets.length<2){message.textContent='Choose an anchor and at least one comparison asset.';return}button.disabled=true;button.querySelector('span').textContent='Gathering market, filing and news evidence…';message.textContent='AssetSeek is checking each source before writing the brief.';try{const usage=await consumeUsage('similarity');if(!usage.allowed)throw new Error('Daily free research limit reached. Pro access removes this limit.');const requested=assets.map(asset=>`${asset.ticker}:${asset.type}`).join(','),response=await fetch(`/api/research?assets=${encodeURIComponent(requested)}`),data=await response.json();if(!response.ok)throw new Error([data.error,data.detail].filter(Boolean).join(' '));renderBrief(data);message.textContent=data.ai.used?'AI-assisted brief complete. Open any citation to inspect its source.':`Evidence brief complete. ${data.ai.reason||'AI is not configured.'}`}catch(error){message.textContent=error.message}finally{button.disabled=false;button.querySelector('span').textContent='Build in-depth comparison'}});
}

init();
