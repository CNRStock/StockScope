let config=null,session=JSON.parse(localStorage.getItem("stockscope-session")||"null");
async function getConfig(){if(!config){config=await(await fetch("/api/config")).json()}return config}
async function request(path,{method="GET",body,authenticated=false,headers={}}={}){const c=await getConfig();if(!c.supabaseUrl||!c.supabaseKey)throw new Error("Supabase is not configured.");const response=await fetch(c.supabaseUrl+path,{method,headers:{apikey:c.supabaseKey,Authorization:authenticated&&session?.access_token?`Bearer ${session.access_token}`:c.supabaseKey,"content-type":"application/json",...headers},body:body?JSON.stringify(body):undefined});const text=await response.text();let data;try{data=text?JSON.parse(text):null}catch{data=text}if(!response.ok)throw new Error(data?.msg||data?.message||data?.error_description||`Supabase returned ${response.status}.`);return data}
export const currentSession=()=>session;export const signUp=(email,password)=>request("/auth/v1/signup",{method:"POST",body:{email,password}});
export async function signIn(email,password){session=await request("/auth/v1/token?grant_type=password",{method:"POST",body:{email,password}});localStorage.setItem("stockscope-session",JSON.stringify(session));return session}export function signOut(){session=null;localStorage.removeItem("stockscope-session")}
export async function consumeUsage(type){
  if(["localhost","127.0.0.1","::1"].includes(location.hostname))return{allowed:true,development:true,remaining:null};
  if(!session){
    const day=new Date().toISOString().slice(0,10),key=`stockscope-guest-usage-${day}`,usage=JSON.parse(localStorage.getItem(key)||"{}");
    const limit=type==="calculation"?3:1,count=Number(usage[type]||0);
    if(count>=limit)return{allowed:false,guest:true,remaining:0};
    usage[type]=count+1;localStorage.setItem(key,JSON.stringify(usage));return{allowed:true,guest:true,remaining:limit-count-1};
  }
  return request("/rest/v1/rpc/consume_usage",{method:"POST",body:{requested_type:type},authenticated:true});
}
export async function saveResearch(kind,title,payload){if(!session)throw new Error("Sign in to save research to your account.");return request("/rest/v1/saved_research",{method:"POST",body:{user_id:session.user.id,kind,title,payload},authenticated:true,headers:{Prefer:"return=minimal"}})}
export async function loadResearch(){if(!session)return[];return request("/rest/v1/saved_research?select=*&order=created_at.desc&limit=30",{authenticated:true})}
export async function loadProfile(){if(!session)return null;const rows=await request(`/rest/v1/profiles?select=email,plan,created_at&id=eq.${session.user.id}`,{authenticated:true});return rows[0]||null}
export async function exportAccountData(){if(!session)throw new Error("Sign in to export account data.");const [profile,research]=await Promise.all([loadProfile(),loadResearch()]);return{exportedAt:new Date().toISOString(),account:{id:session.user.id,email:session.user.email,profile},savedResearch:research}}
export async function deleteAccount(){if(!session)throw new Error("Sign in to delete your account.");await request("/rest/v1/rpc/delete_own_account",{method:"POST",body:{},authenticated:true});signOut()}
