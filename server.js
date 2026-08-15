import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import { timingSafeEqual } from "node:crypto";
import Stripe from "stripe";
import { summarizeFundamentals } from "./fundamentals.js";
import { summarizeSecCompanyFacts } from "./sec-fundamentals.js";
import { compareProfiles } from "./similarity.js";
import { scoreCrypto } from "./crypto-model.js";
import { evidenceFromPrices,allocateEvidence } from "./portfolio-model.js";
import { securityHeaders,createRateLimiter } from "./security.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(__dirname, "public");
// Minimal .env loader so the project has zero npm dependencies.
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}
const PORT = Number(process.env.PORT || 3000);
const billingEnabled=process.env.BILLING_ENABLED==="true";
const stripe=billingEnabled?new Stripe(process.env.STRIPE_SECRET_KEY||""):null;

const mime = {
  ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8",
  ".svg":"image/svg+xml", ".png":"image/png", ".ico":"image/x-icon"
};
const production=process.env.NODE_ENV==="production",baseHeaders=securityHeaders({production});
const generalLimit=createRateLimiter({limit:Number(process.env.API_RATE_LIMIT||120)}),expensiveLimit=createRateLimiter({limit:Number(process.env.EXPENSIVE_RATE_LIMIT||20)});
const expensivePaths=new Set(["/api/similar","/api/crypto-similar","/api/portfolio-evidence"]);
const providerFetch=(url,options={})=>fetch(url,{...options,signal:options.signal||AbortSignal.timeout(15_000)});
function secureEqual(left,right){const a=Buffer.from(String(left)),b=Buffer.from(String(right));return a.length===b.length&&timingSafeEqual(a,b)}
function betaAuthorized(req){if(process.env.PRIVATE_BETA!=="true")return true;const header=String(req.headers.authorization||"");if(!header.startsWith("Basic "))return false;try{const decoded=Buffer.from(header.slice(6),"base64").toString("utf8"),separator=decoded.indexOf(":");if(separator<0)return false;return secureEqual(decoded.slice(0,separator),process.env.BETA_USERNAME||"")&&secureEqual(decoded.slice(separator+1),process.env.BETA_PASSWORD||"")}catch{return false}}
function validateProductionEnvironment(){if(!production)return;const required=["EODHD_API_KEY","SEC_USER_AGENT","SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY"],missing=required.filter(key=>!process.env[key]);if(process.env.PRIVATE_BETA==="true")for(const key of ["BETA_USERNAME","BETA_PASSWORD"])if(!process.env[key])missing.push(key);if(billingEnabled)for(const key of ["APP_URL","STRIPE_SECRET_KEY","STRIPE_WEBHOOK_SECRET","STRIPE_PRO_PRICE_ID","SUPABASE_SERVICE_ROLE_KEY"])if(!process.env[key])missing.push(key);if(missing.length)throw new Error(`Missing production environment variables: ${missing.join(", ")}`)}

function json(res, status, body) {
  res.writeHead(status, {...baseHeaders,"content-type":"application/json; charset=utf-8", "cache-control":"no-store"});
  res.end(JSON.stringify(body));
}

async function readBody(req,maxBytes=1_000_000){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error("Request body is too large.");chunks.push(chunk)}
  return Buffer.concat(chunks);
}
function bearerToken(req){const privateBetaCompatible=String(req.headers["x-stockscope-session"]||"");if(privateBetaCompatible)return privateBetaCompatible;const value=String(req.headers.authorization||"");return value.startsWith("Bearer ")?value.slice(7):null}
async function authenticatedUser(req){
  const token=bearerToken(req);if(!token)throw new Error("Sign in to manage billing.");
  const response=await providerFetch(`${process.env.SUPABASE_URL}/auth/v1/user`,{headers:{apikey:process.env.SUPABASE_PUBLISHABLE_KEY,Authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error("Your session has expired. Please sign in again.");
  return response.json();
}
async function supabaseAdmin(pathname,{method="GET",body}={}){
  const response=await providerFetch(`${process.env.SUPABASE_URL}/rest/v1/${pathname}`,{method,headers:{apikey:process.env.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,"content-type":"application/json",Prefer:"return=representation"},body:body===undefined?undefined:JSON.stringify(body)});
  const text=await response.text();let data=null;try{data=text?JSON.parse(text):null}catch{data=text}
  if(!response.ok)throw new Error(data?.message||`Database returned ${response.status}.`);return data;
}
async function billingProfile(userId){const rows=await supabaseAdmin(`profiles?select=id,email,plan,stripe_customer_id,subscription_status&id=eq.${encodeURIComponent(userId)}`);return rows?.[0]||null}
function subscriptionPlan(status){return ["active","trialing"].includes(status)?"pro":"free"}
async function updateSubscription(subscription,userIdHint){
  const customerId=typeof subscription.customer==="string"?subscription.customer:subscription.customer?.id;
  let userId=userIdHint||subscription.metadata?.user_id;
  if(!userId&&customerId){const rows=await supabaseAdmin(`profiles?select=id&stripe_customer_id=eq.${encodeURIComponent(customerId)}`);userId=rows?.[0]?.id}
  if(!userId)throw new Error("No StockScope user is linked to this Stripe subscription.");
  return supabaseAdmin(`profiles?id=eq.${encodeURIComponent(userId)}`,{method:"PATCH",body:{plan:subscriptionPlan(subscription.status),stripe_customer_id:customerId||null,stripe_subscription_id:subscription.id,subscription_status:subscription.status,current_period_end:subscription.current_period_end?new Date(subscription.current_period_end*1000).toISOString():null}});
}
function appUrl(){return String(process.env.APP_URL||`http://localhost:${PORT}`).replace(/\/$/,"")}
async function createCheckout(req,res){
  if(!billingEnabled)return json(res,503,{error:"Pro billing is not enabled yet."});
  try{const user=await authenticatedUser(req),profile=await billingProfile(user.id);if(profile?.plan==="pro")return json(res,409,{error:"You already have Pro. Use Manage billing instead."});
    const params={mode:"subscription",line_items:[{price:process.env.STRIPE_PRO_PRICE_ID,quantity:1}],success_url:`${appUrl()}/?checkout=success`,cancel_url:`${appUrl()}/?checkout=cancelled`,client_reference_id:user.id,allow_promotion_codes:true,metadata:{user_id:user.id},subscription_data:{metadata:{user_id:user.id}}};
    if(profile?.stripe_customer_id)params.customer=profile.stripe_customer_id;else params.customer_email=user.email;
    const checkout=await stripe.checkout.sessions.create(params);return json(res,200,{url:checkout.url});
  }catch(error){console.error("Stripe Checkout failed:",error.message);return json(res,400,{error:error.message})}
}
async function createPortal(req,res){
  if(!billingEnabled)return json(res,503,{error:"Pro billing is not enabled yet."});
  try{const user=await authenticatedUser(req),profile=await billingProfile(user.id);if(!profile?.stripe_customer_id)return json(res,404,{error:"No billing account is linked to this user yet."});const portal=await stripe.billingPortal.sessions.create({customer:profile.stripe_customer_id,return_url:`${appUrl()}/#settings`});return json(res,200,{url:portal.url})}catch(error){console.error("Stripe portal failed:",error.message);return json(res,400,{error:error.message})}
}
async function stripeWebhook(req,res){
  if(!billingEnabled)return json(res,503,{error:"Billing is disabled."});
  try{const raw=await readBody(req),event=stripe.webhooks.constructEvent(raw,String(req.headers["stripe-signature"]||""),process.env.STRIPE_WEBHOOK_SECRET);
    if(event.type==="checkout.session.completed"){const session=event.data.object;if(session.subscription){const subscription=await stripe.subscriptions.retrieve(session.subscription);await updateSubscription(subscription,session.metadata?.user_id||session.client_reference_id)}}
    else if(event.type==="customer.subscription.updated"||event.type==="customer.subscription.deleted")await updateSubscription(event.data.object);
    else if(event.type==="invoice.payment_failed"){const invoice=event.data.object,customerId=typeof invoice.customer==="string"?invoice.customer:invoice.customer?.id;if(customerId)await supabaseAdmin(`profiles?stripe_customer_id=eq.${encodeURIComponent(customerId)}`,{method:"PATCH",body:{subscription_status:"payment_failed"}})}
    return json(res,200,{received:true});
  }catch(error){console.error("Stripe webhook rejected:",error.message);return json(res,400,{error:"Invalid webhook."})}
}

function safeTicker(raw) {
  return String(raw || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 24);
}

// EODHD uses exchange suffixes; US tickers default to .US.
function providerSymbol(ticker) {
  if (ticker.includes(".")) return ticker;
  return `${ticker}.US`;
}

async function historical(reqUrl, res) {
  const ticker = safeTicker(reqUrl.searchParams.get("symbol"));
  const from = reqUrl.searchParams.get("from");
  const to = reqUrl.searchParams.get("to");
  if (!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "")) {
    return json(res, 400, {error:"Provide symbol, from and to."});
  }
  if (from > to) return json(res, 400, {error:"The start date must be before the end date."});

  const key = process.env.EODHD_API_KEY;
  if (!key) {
    return json(res, 503, {
      error:"Market data API key is not configured.",
      setup:"Copy .env.example to .env and add EODHD_API_KEY."
    });
  }

  const sym = providerSymbol(ticker);
  const endpoint = new URL(`https://eodhd.com/api/eod/${encodeURIComponent(sym)}`);
  endpoint.searchParams.set("api_token", key);
  endpoint.searchParams.set("fmt", "json");
  endpoint.searchParams.set("from", from);
  endpoint.searchParams.set("to", to);
  endpoint.searchParams.set("period", "d");

  try {
    const r = await providerFetch(endpoint, {headers: {"user-agent":"StockScope/2.0"}});
    const text = await r.text();
    if (!r.ok) return json(res, r.status, {error:`Market-data provider returned ${r.status}.`, detail:text.slice(0,400)});
    let rows;
    try { rows = JSON.parse(text); } catch { return json(res, 502, {error:"Invalid response from market-data provider."}); }
    if (!Array.isArray(rows) || !rows.length) return json(res, 404, {error:"No historical data found for that ticker/date range."});

    const prices = rows.map(x => ({
      date: x.date,
      close: Number(x.close),
      adjustedClose: Number(x.adjusted_close ?? x.adjustedClose ?? x.close)
    })).filter(x => x.date && Number.isFinite(x.adjustedClose) && x.adjustedClose > 0)
      .sort((a,b)=>a.date.localeCompare(b.date));

    if (!prices.length) return json(res, 404, {error:"No usable adjusted prices were returned."});
    return json(res, 200, {symbol:ticker, provider:"EODHD", currency:"USD", prices});
  } catch (e) {
    const cause = e?.cause;
    const detail = [
      e?.message,
      cause?.code,
      cause?.message
    ].filter(Boolean).join(" · ");
    console.error("EODHD request failed:", detail || e);
    return json(res, 502, {
      error:"Could not reach the market-data provider.",
      detail:detail || "Unknown connection error."
    });
  }
}

async function apiStatus(res) {
  json(res, 200, {
    configured: Boolean(process.env.EODHD_API_KEY),
    provider: "EODHD",
    mode: process.env.EODHD_API_KEY ? "live" : "setup-required"
  });
}

async function news(reqUrl,res){
  const ticker=safeTicker(reqUrl.searchParams.get("symbol"));
  if(!ticker)return json(res,400,{error:"Provide a symbol."});
  const key=process.env.EODHD_API_KEY;
  if(!key)return json(res,503,{error:"Market data API key is not configured."});
  const endpoint=new URL("https://eodhd.com/api/news");
  endpoint.searchParams.set("api_token",key);
  endpoint.searchParams.set("fmt","json");
  endpoint.searchParams.set("s",providerSymbol(ticker));
  endpoint.searchParams.set("limit","6");
  endpoint.searchParams.set("from",new Date(Date.now()-120*86400000).toISOString().slice(0,10));
  try{
    const response=await providerFetch(endpoint,{headers:{"user-agent":"StockScope/2.0"}}),text=await response.text();
    if(!response.ok)return json(res,response.status,{error:`News provider returned ${response.status}.`,detail:text.slice(0,300)});
    let rows;try{rows=JSON.parse(text)}catch{return json(res,502,{error:"Invalid response from news provider."})}
    if(!Array.isArray(rows))return json(res,502,{error:"Unexpected response from news provider."});
    const articles=rows.map(item=>({
      title:String(item.title||"").slice(0,240),date:String(item.date||"").slice(0,25),link:String(item.link||"").slice(0,1000),
      source:String(item.source||"Financial news").slice(0,80),summary:String(item.content||item.summary||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,360),
      tags:Array.isArray(item.tags)?item.tags.map(String).slice(0,8):[],sentiment:Number.isFinite(Number(item.sentiment?.polarity))?Number(item.sentiment.polarity):null
    })).filter(item=>item.title&&/^https?:\/\//i.test(item.link));
    return json(res,200,{symbol:ticker,provider:"EODHD Financial News",articles});
  }catch(error){return json(res,502,{error:"Could not reach the news provider.",detail:error.message})}
}

async function quotes(reqUrl,res){
  const symbols=String(reqUrl.searchParams.get("symbols")||"").split(",").map(safeTicker).filter(Boolean).slice(0,15);
  if(!symbols.length)return json(res,400,{error:"Provide at least one symbol."});
  const key=process.env.EODHD_API_KEY;if(!key)return json(res,503,{error:"Market data API key is not configured."});
  const providerSymbols=symbols.map(providerSymbol),endpoint=new URL(`https://eodhd.com/api/real-time/${encodeURIComponent(providerSymbols[0])}`);
  endpoint.searchParams.set("api_token",key);endpoint.searchParams.set("fmt","json");if(providerSymbols.length>1)endpoint.searchParams.set("s",providerSymbols.slice(1).join(","));
  try{const response=await providerFetch(endpoint,{headers:{"user-agent":"StockScope/2.0"}}),text=await response.text();if(!response.ok)return json(res,response.status,{error:`Quote provider returned ${response.status}.`,detail:text.slice(0,300)});let payload;try{payload=JSON.parse(text)}catch{return json(res,502,{error:"Invalid quote response."})}const rows=Array.isArray(payload)?payload:[payload],quotes=rows.map(row=>({symbol:String(row.code||"").toUpperCase(),price:Number(row.close),previousClose:Number(row.previousClose),changePct:Number(row.change_p),timestamp:Number(row.timestamp)})).filter(row=>row.symbol&&Number.isFinite(row.price)&&row.price>0);return json(res,200,{provider:"EODHD Live (Delayed)",currency:"USD",quotes})}catch(error){return json(res,502,{error:"Could not reach the quote provider.",detail:error.message})}
}

async function validateAsset(reqUrl,res){
  const ticker=safeTicker(reqUrl.searchParams.get("symbol")),type=reqUrl.searchParams.get("type")==="crypto"?"crypto":"stock",key=process.env.EODHD_API_KEY;
  if(!ticker)return json(res,400,{error:"Provide a symbol."});if(!key)return json(res,503,{error:"Market data API key is not configured."});
  const endpoint=new URL(`https://eodhd.com/api/search/${encodeURIComponent(ticker)}`);endpoint.searchParams.set("api_token",key);endpoint.searchParams.set("fmt","json");endpoint.searchParams.set("limit","20");
  try{const response=await providerFetch(endpoint,{headers:{"user-agent":"StockScope/2.0"}}),rows=await response.json();if(!response.ok)throw new Error(`Search provider returned ${response.status}.`);const match=(Array.isArray(rows)?rows:[]).find(item=>type==="crypto"?String(item.Exchange).toUpperCase()==="CC"&&String(item.Code).toUpperCase().replace(/-USD$/,"")===ticker.replace(/-USD$/,""):String(item.Exchange).toUpperCase()==="US"&&String(item.Code).toUpperCase()===ticker);if(!match)return json(res,404,{error:`No covered ${type} matched ${ticker}.`});return json(res,200,{ticker:type==="crypto"?ticker.replace(/-USD$/,""):ticker,type,name:match.Name||ticker,currency:match.Currency||"USD",exchange:match.Exchange})}catch(error){return json(res,502,{error:"Could not validate this asset.",detail:error.message})}
}

async function fundamentals(reqUrl,res){
  const ticker=safeTicker(reqUrl.searchParams.get("symbol"));
  const asOf=reqUrl.searchParams.get("asof");
  if(!ticker || !/^\d{4}-\d{2}-\d{2}$/.test(asOf||"")){
    return json(res,400,{error:"Provide symbol and asof date."});
  }
  const key=process.env.EODHD_API_KEY;
  if(!key) return json(res,503,{error:"Market data API key is not configured."});
  const endpoint=new URL(`https://eodhd.com/api/v1.1/fundamentals/${encodeURIComponent(providerSymbol(ticker))}`);
  endpoint.searchParams.set("api_token",key);
  endpoint.searchParams.set("fmt","json");
  try{
    const response=await providerFetch(endpoint,{headers:{"user-agent":"StockScope/2.0"}});
    const text=await response.text();
    if(response.status===403) return secFundamentals(ticker,asOf,res);
    if(!response.ok) return json(res,response.status,{error:`Fundamentals provider returned ${response.status}.`,detail:text.slice(0,300)});
    let payload;
    try{payload=JSON.parse(text)}catch{return json(res,502,{error:"Invalid fundamentals response."})}
    const summary=summarizeFundamentals(payload,asOf);
    if(!summary) return json(res,404,{error:"No annual fundamentals were available by the selected start date."});
    return json(res,200,{provider:"EODHD",asOf,...summary});
  }catch(e){
    const detail=[e?.message,e?.cause?.code,e?.cause?.message].filter(Boolean).join(" · ");
    return json(res,502,{error:"Could not reach the fundamentals provider.",detail});
  }
}

let secTickersCache=null;
async function secJson(url,userAgent){
  const response=await providerFetch(url,{headers:{"user-agent":userAgent,"accept-encoding":"gzip, deflate"}});
  if(!response.ok)throw new Error(`SEC returned ${response.status}.`);
  return response.json();
}

async function secFundamentals(ticker,asOf,res){
  const userAgent=process.env.SEC_USER_AGENT;
  if(!userAgent||!userAgent.includes("@"))return json(res,503,{error:"SEC fallback needs a contact user agent.",detail:"Add SEC_USER_AGENT=StockScope your-email@example.com to .env, then restart the server."});
  try{
    if(!secTickersCache)secTickersCache=await secJson("https://www.sec.gov/files/company_tickers.json",userAgent);
    const symbol=ticker.split(".")[0];
    const company=Object.values(secTickersCache).find(item=>String(item.ticker).toUpperCase()===symbol);
    if(!company)return json(res,404,{error:"This ticker was not found in the SEC company list."});
    const cik=String(company.cik_str).padStart(10,"0");
    const facts=await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,userAgent);
    const summary=summarizeSecCompanyFacts(facts,asOf);
    if(!summary)return json(res,404,{error:"No SEC annual filing was publicly available by the selected start date."});
    return json(res,200,{provider:"SEC EDGAR",asOf,...summary});
  }catch(error){return json(res,502,{error:"Could not load SEC fundamentals.",detail:error.message})}
}

const THEME_MAP={
  NVDA:["AI compute","semiconductors","data centres"],AMD:["AI compute","semiconductors"],MRVL:["semiconductors","data centres","networking"],ANET:["data centres","networking"],
  IONQ:["quantum computing"],RGTI:["quantum computing"],QBTS:["quantum computing"],QUBT:["quantum computing","photonics"],COHR:["photonics","networking"],LITE:["photonics","networking"],AAOI:["photonics","data centres"],
  VRT:["data centres","power and cooling"],POWL:["power and cooling","grid infrastructure"],NVT:["power and cooling","grid infrastructure"],SYM:["robotics","automation"],SERV:["robotics","automation"],
  S:["cybersecurity","AI software"],TENB:["cybersecurity"],PLTR:["AI software"],DDOG:["AI software","data centres"],NET:["networking","cybersecurity"],RXRX:["AI drug discovery","biotechnology"],SDGR:["AI drug discovery","biotechnology"],ASTS:["space infrastructure"]
};
const SIMILARITY_UNIVERSE=Object.keys(THEME_MAP).filter(ticker=>ticker!=="NVDA");
const secFactsCache=new Map();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function getSecSummary(ticker,asOf,userAgent){
  if(!secTickersCache)secTickersCache=await secJson("https://www.sec.gov/files/company_tickers.json",userAgent);
  const symbol=ticker.split(".")[0].toUpperCase();
  const company=Object.values(secTickersCache).find(item=>String(item.ticker).toUpperCase()===symbol);
  if(!company)return null;
  const cik=String(company.cik_str).padStart(10,"0");
  let facts=secFactsCache.get(cik);
  if(!facts){facts=await secJson(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,userAgent);secFactsCache.set(cik,facts);await pause(125)}
  return summarizeSecCompanyFacts(facts,asOf);
}

async function similarCompanies(reqUrl,res){
  const ticker=safeTicker(reqUrl.searchParams.get("symbol")),asOf=reqUrl.searchParams.get("asof");
  const userAgent=process.env.SEC_USER_AGENT;
  if(!ticker||!/^\d{4}-\d{2}-\d{2}$/.test(asOf||""))return json(res,400,{error:"Provide symbol and asof date."});
  if(!userAgent||!userAgent.includes("@"))return json(res,503,{error:"SEC_USER_AGENT is not configured."});
  try{
    const reference=await getSecSummary(ticker,asOf,userAgent);
    if(!reference)return json(res,404,{error:"No historical SEC profile was available for the selected company and date."});
    const today=new Date().toISOString().slice(0,10),matches=[];
    for(const candidateTicker of SIMILARITY_UNIVERSE){
      if(candidateTicker===ticker.split(".")[0])continue;
      const profile=await getSecSummary(candidateTicker,today,userAgent);
      const comparison=compareProfiles(reference,profile);
      if(profile&&comparison){
        const referenceThemes=THEME_MAP[ticker.split(".")[0]]||[],themes=THEME_MAP[candidateTicker]||[];
        const overlaps=themes.filter(theme=>referenceThemes.includes(theme));
        const themeScore=referenceThemes.length?Math.round(overlaps.length/referenceThemes.length*100):null;
        const combinedScore=themeScore===null?comparison.score:Math.round(comparison.score*.75+themeScore*.25);
        matches.push({ticker:candidateTicker,company:profile.company,period:profile.period,metrics:profile.metrics,themes,themeOverlap:overlaps,financialScore:comparison.score,themeScore, ...comparison,score:combinedScore});
      }
    }
    matches.sort((a,b)=>b.score-a.score);
    return json(res,200,{reference:{ticker:ticker.split(".")[0],company:reference.company,period:reference.period,metrics:reference.metrics},matches:matches.slice(0,5),universeSize:SIMILARITY_UNIVERSE.length,provider:"SEC EDGAR",method:"Weighted normalized distance"});
  }catch(error){return json(res,502,{error:"Could not calculate similarity matches.",detail:error.message})}
}

const CRYPTO_UNIVERSE={
  bitcoin:{symbol:"BTC",themes:["store of value","payments"]},ethereum:{symbol:"ETH",themes:["smart contracts","defi","infrastructure"]},dogecoin:{symbol:"DOGE",themes:["payments","community"]},
  "quant-network":{symbol:"QNT",themes:["interoperability","enterprise infrastructure"]},chainlink:{symbol:"LINK",themes:["oracles","infrastructure","interoperability"]},near:{symbol:"NEAR",themes:["smart contracts","AI","infrastructure"]},
  bittensor:{symbol:"TAO",themes:["AI","decentralised compute"]},"render-token":{symbol:"RENDER",themes:["AI","decentralised compute"]},"fetch-ai":{symbol:"FET",themes:["AI","agents"]},
  "ondo-finance":{symbol:"ONDO",themes:["tokenisation","defi"]},"hedera-hashgraph":{symbol:"HBAR",themes:["enterprise infrastructure","payments"]},"injective-protocol":{symbol:"INJ",themes:["defi","infrastructure"]},
  arweave:{symbol:"AR",themes:["storage","infrastructure"]},"akash-network":{symbol:"AKT",themes:["decentralised compute","AI"]},"the-graph":{symbol:"GRT",themes:["data","infrastructure"]}
};
let cryptoMarketsCache={at:0,data:null};
async function cryptoSimilar(reqUrl,res){
  const symbol=String(reqUrl.searchParams.get("symbol")||"").toUpperCase();
  const referenceEntry=Object.entries(CRYPTO_UNIVERSE).find(([,value])=>value.symbol===symbol);
  if(!referenceEntry)return json(res,404,{error:"That crypto asset is not yet mapped in the discovery universe."});
  try{
    if(!cryptoMarketsCache.data||Date.now()-cryptoMarketsCache.at>5*60*1000){
      const ids=Object.keys(CRYPTO_UNIVERSE).join(",");
      const url=`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&per_page=100&page=1&sparkline=false&price_change_percentage=30d`;
      const response=await providerFetch(url,{headers:{"user-agent":"StockScope/2.0"}});
      if(!response.ok)throw new Error(`CoinGecko returned ${response.status}.`);
      cryptoMarketsCache={at:Date.now(),data:await response.json()};
    }
    const referenceThemes=referenceEntry[1].themes;
    const matches=cryptoMarketsCache.data.filter(asset=>asset.symbol.toUpperCase()!==symbol).map(asset=>{
      const metadata=CRYPTO_UNIVERSE[asset.id]||{themes:[]};
      return{id:asset.id,symbol:asset.symbol.toUpperCase(),name:asset.name,themes:metadata.themes,marketCapRank:asset.market_cap_rank,marketCap:asset.market_cap,volume24h:asset.total_volume,change30d:asset.price_change_percentage_30d_in_currency,...scoreCrypto({...asset,themes:metadata.themes},referenceThemes)};
    }).sort((a,b)=>b.score-a.score).slice(0,5);
    return json(res,200,{reference:{symbol,themes:referenceThemes},matches,provider:"CoinGecko",method:"Theme, market-cap stage, liquidity, supply and hype-risk model",universeSize:Object.keys(CRYPTO_UNIVERSE).length});
  }catch(error){return json(res,502,{error:"Could not calculate crypto matches.",detail:error.message})}
}

async function portfolioEvidence(reqUrl,res){
  const encoded=String(reqUrl.searchParams.get("assets")||"").split(",").slice(0,12),assets=encoded.map(entry=>{const [symbol,type]=entry.split(":");return{ticker:safeTicker(symbol),type:type==="crypto"?"crypto":"stock"}}).filter(asset=>asset.ticker),key=process.env.EODHD_API_KEY;
  if(assets.length<2)return json(res,400,{error:"Provide at least two assets."});if(!key)return json(res,503,{error:"Market data API key is not configured."});
  const from=new Date(Date.now()-370*86400000).toISOString().slice(0,10),to=new Date().toISOString().slice(0,10);
  try{const profiles=await Promise.all(assets.map(async asset=>{const symbol=providerSymbol(asset.type==="crypto"?`${asset.ticker.replace(/-USD$/,'')}-USD.CC`:asset.ticker),endpoint=new URL(`https://eodhd.com/api/eod/${encodeURIComponent(symbol)}`);endpoint.searchParams.set("api_token",key);endpoint.searchParams.set("fmt","json");endpoint.searchParams.set("from",from);endpoint.searchParams.set("to",to);const response=await providerFetch(endpoint,{headers:{"user-agent":"StockScope/2.0"}});if(!response.ok)throw new Error(`${asset.ticker} history returned ${response.status}.`);const rows=await response.json();if(!Array.isArray(rows)||rows.length<30)throw new Error(`${asset.ticker} has insufficient history.`);const stockThemes=THEME_MAP[asset.ticker]||[],cryptoEntry=Object.values(CRYPTO_UNIVERSE).find(item=>item.symbol===asset.ticker),themes=asset.type==="crypto"?(cryptoEntry?.themes||[]):stockThemes,otherThemes=assets.flatMap(other=>other===asset?[]:(other.type==="crypto"?(Object.values(CRYPTO_UNIVERSE).find(item=>item.symbol===other.ticker)?.themes||[]):(THEME_MAP[other.ticker]||[]))),themeOverlap=themes.filter(theme=>otherThemes.includes(theme)).length;return{...asset,themes,...evidenceFromPrices(rows,{assetType:asset.type,themeOverlap})}}));const weights=allocateEvidence(profiles);return json(res,200,{provider:"EODHD adjusted prices and volume",method:"Risk-adjusted stability, liquidity, hype and theme-diversification model",items:profiles.map((profile,index)=>({...profile,weight:weights[index]}))})}catch(error){return json(res,502,{error:"Could not build portfolio evidence.",detail:error.message})}
}

const server = http.createServer(async (req,res) => {
  if(String(req.url||"").length>2_048)return json(res,414,{error:"Request URL is too long."});
  const reqUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  if(reqUrl.pathname==="/api/health")return json(res,200,{status:"ok",version:"2.0.0",uptimeSeconds:Math.round(process.uptime()),marketDataConfigured:Boolean(process.env.EODHD_API_KEY),databaseConfigured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY)});
  if(reqUrl.pathname==="/api/stripe/webhook"){if(req.method!=="POST")return json(res,405,{error:"Method not allowed."});return stripeWebhook(req,res)}
  if(!betaAuthorized(req)){res.writeHead(401,{...baseHeaders,"www-authenticate":'Basic realm="StockScope private beta", charset="UTF-8"',"content-type":"text/plain; charset=utf-8","cache-control":"no-store"});return res.end("StockScope private beta access required.")}
  const isApi=reqUrl.pathname.startsWith("/api/");
  const postPaths=new Set(["/api/billing/checkout","/api/billing/portal"]);
  if(!["GET","HEAD"].includes(req.method||"GET")&&!(req.method==="POST"&&postPaths.has(reqUrl.pathname)))return json(res,405,{error:"Method not allowed."});
  if(isApi){
    const forwarded=process.env.TRUST_PROXY==="true"?String(req.headers["x-forwarded-for"]||"").split(",")[0].trim():"";
    const client=forwarded||req.socket.remoteAddress||"unknown",result=(expensivePaths.has(reqUrl.pathname)?expensiveLimit:generalLimit)(`${client}:${reqUrl.pathname}`);
    if(!result.allowed){res.setHeader("retry-after",String(result.retryAfter));return json(res,429,{error:"Too many requests. Please try again shortly.",retryAfter:result.retryAfter})}
  }

  if (reqUrl.pathname === "/api/status") return apiStatus(res);
  if (reqUrl.pathname === "/api/config") return json(res,200,{supabaseUrl:process.env.SUPABASE_URL||null,supabaseKey:process.env.SUPABASE_PUBLISHABLE_KEY||null,unlimitedBeta:process.env.PRIVATE_BETA==="true"&&process.env.BETA_UNLIMITED==="true",billingEnabled});
  if (reqUrl.pathname === "/api/billing/checkout") return createCheckout(req,res);
  if (reqUrl.pathname === "/api/billing/portal") return createPortal(req,res);
  if (reqUrl.pathname === "/api/historical") return historical(reqUrl,res);
  if (reqUrl.pathname === "/api/news") return news(reqUrl,res);
  if (reqUrl.pathname === "/api/quotes") return quotes(reqUrl,res);
  if (reqUrl.pathname === "/api/assets/validate") return validateAsset(reqUrl,res);
  if (reqUrl.pathname === "/api/portfolio-evidence") return portfolioEvidence(reqUrl,res);
  if (reqUrl.pathname === "/api/fundamentals") return fundamentals(reqUrl,res);
  if (reqUrl.pathname === "/api/similar") return similarCompanies(reqUrl,res);
  if (reqUrl.pathname === "/api/crypto-similar") return cryptoSimilar(reqUrl,res);

  let pathname;try{pathname=decodeURIComponent(reqUrl.pathname)}catch{return json(res,400,{error:"Invalid URL encoding."})}
  if (pathname === "/") pathname = "/index.html";
  const file = path.normalize(path.join(PUBLIC, pathname));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("Forbidden"); }

  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, {"content-type":"text/plain; charset=utf-8"});
      return res.end("Not found");
    }
    const extension=path.extname(file),cacheControl=extension===".html"?"no-cache":"public, max-age=3600";
    res.writeHead(200, {...baseHeaders,"content-type": mime[extension] || "application/octet-stream","cache-control":cacheControl});
    if(req.method==="HEAD")return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

validateProductionEnvironment();
server.on("error",error=>{console.error("StockScope server error:",error.message);process.exitCode=1});
server.listen(PORT,"0.0.0.0",()=>{console.log(`StockScope running on port ${PORT} (${production?"production":"development"})`)});
for(const signal of ["SIGTERM","SIGINT"])process.on(signal,()=>server.close(()=>process.exit(0)));
