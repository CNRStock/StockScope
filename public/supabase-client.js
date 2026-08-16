let config=null,entitlementsCache=null,session=JSON.parse(localStorage.getItem("stockscope-session")||"null");
export const PLAN_LIMITS={
  free:{plan:"free",isPro:false,researchAssets:2,portfolioAssets:3,savedResearch:3,savedPortfolios:1,calculationsPerDay:3,similarityPerDay:1,aiResearchPerMonth:3,alerts:false,candidateTracker:false,exports:false,weeklyDigest:false},
  pro:{plan:"pro",isPro:true,researchAssets:4,portfolioAssets:12,savedResearch:null,savedPortfolios:null,calculationsPerDay:null,similarityPerDay:null,aiResearchPerMonth:100,alerts:true,candidateTracker:true,exports:true,weeklyDigest:true}
};
async function getConfig(){if(!config){config=await(await fetch("/api/config")).json()}return config}
async function request(path,{method="GET",body,authenticated=false,headers={}}={}){const c=await getConfig();if(!c.supabaseUrl||!c.supabaseKey)throw new Error("Supabase is not configured.");const response=await fetch(c.supabaseUrl+path,{method,headers:{apikey:c.supabaseKey,Authorization:authenticated&&session?.access_token?`Bearer ${session.access_token}`:c.supabaseKey,"content-type":"application/json",...headers},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||`Supabase returned ${response.status}.`);return data}
export const currentSession=()=>session;export const signUp=(email,password)=>request("/auth/v1/signup",{method:"POST",body:{email,password}});
export async function billingAvailable(){return Boolean((await getConfig()).billingEnabled)}
export async function billingAction(action){if(!session)throw new Error("Sign in to manage billing.");const response=await fetch(`/api/billing/${action}`,{method:"POST",headers:{Authorization:`Bearer ${session.access_token}`}}),text=await response.text();let data;try{data=text?JSON.parse(text):{}}catch{throw new Error(text||"Billing request failed.")}if(!response.ok)throw new Error(data.error||"Billing request failed.");return data}
export async function signIn(email,password){session=await request("/auth/v1/token?grant_type=password",{method:"POST",body:{email,password}});entitlementsCache=null;localStorage.setItem("stockscope-session",JSON.stringify(session));return session}export function signOut(){session=null;entitlementsCache=null;localStorage.removeItem("stockscope-session")}
export async function getEntitlements({refresh=false}={}){
  if(entitlementsCache&&!refresh)return entitlementsCache;
  const c=await getConfig(),local=["localhost","127.0.0.1","::1"].includes(location.hostname);
  if(local||c.unlimitedBeta)return entitlementsCache={...PLAN_LIMITS.pro,plan:local?"development":"beta",beta:!local,development:local};
  let profile=null;if(session)try{profile=await loadProfile()}catch{/* Expired sessions fall back to Free until sign-in is refreshed. */}
  return entitlementsCache={...(profile?.plan==="pro"?PLAN_LIMITS.pro:PLAN_LIMITS.free),profile};
}
export async function consumeUsage(type){
  if(["localhost","127.0.0.1","::1"].includes(location.hostname))return{allowed:true,development:true,remaining:null};
  const c=await getConfig();if(c.unlimitedBeta)return{allowed:true,beta:true,remaining:null};
  if(!session){
    const now=new Date(),period=type==="ai_research"?now.toISOString().slice(0,7):now.toISOString().slice(0,10),key=`assetseek-guest-usage-${period}`,usage=JSON.parse(localStorage.getItem(key)||"{}");
    const limit=type==="calculation"?PLAN_LIMITS.free.calculationsPerDay:type==="similarity"?PLAN_LIMITS.free.similarityPerDay:PLAN_LIMITS.free.aiResearchPerMonth,count=Number(usage[type]||0);
    if(count>=limit)return{allowed:false,guest:true,remaining:0};
    usage[type]=count+1;localStorage.setItem(key,JSON.stringify(usage));return{allowed:true,guest:true,remaining:limit-count-1};
  }
  return request("/rest/v1/rpc/consume_usage",{method:"POST",body:{requested_type:type},authenticated:true});
}
export async function saveResearch(kind,title,payload){if(!session)throw new Error("Sign in to save research to your account.");return request("/rest/v1/saved_research",{method:"POST",body:{user_id:session.user.id,kind,title,payload},authenticated:true,headers:{Prefer:"return=minimal"}})}
export async function loadResearch(){if(!session)return[];return request("/rest/v1/saved_research?select=*&order=created_at.desc&limit=100",{authenticated:true})}
export async function deleteResearch(id){if(!session)throw new Error("Sign in to remove saved research.");return request(`/rest/v1/saved_research?id=eq.${encodeURIComponent(id)}`,{method:"DELETE",authenticated:true,headers:{Prefer:"return=minimal"}})}
export async function loadProfile(){if(!session)return null;const rows=await request(`/rest/v1/profiles?select=email,plan,subscription_status,current_period_end,cancel_at_period_end,cancel_at,created_at&id=eq.${session.user.id}`,{authenticated:true});return rows[0]||null}
export async function exportAccountData(){if(!session)throw new Error("Sign in to export account data.");const [profile,research]=await Promise.all([loadProfile(),loadResearch()]);return{exportedAt:new Date().toISOString(),account:{id:session.user.id,email:session.user.email,profile},savedResearch:research}}
export async function deleteAccount(){if(!session)throw new Error("Sign in to delete your account.");await request("/rest/v1/rpc/delete_own_account",{method:"POST",body:{},authenticated:true});signOut()}
