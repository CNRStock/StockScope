export function securityHeaders({production=false}={}){
  const headers={
    "content-security-policy":"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    "cross-origin-opener-policy":"same-origin",
    "cross-origin-resource-policy":"same-origin",
    "permissions-policy":"camera=(), microphone=(), geolocation=(), payment=()",
    "referrer-policy":"strict-origin-when-cross-origin",
    "x-content-type-options":"nosniff",
    "x-frame-options":"DENY"
  };
  if(production)headers["strict-transport-security"]="max-age=31536000; includeSubDomains";
  return headers;
}

export function createRateLimiter({windowMs=60_000,limit=120}={}){
  const clients=new Map();
  return function allow(key,now=Date.now()){
    const previous=clients.get(key);
    if(!previous||now-previous.startedAt>=windowMs){clients.set(key,{startedAt:now,count:1});return{allowed:true,remaining:limit-1,retryAfter:0}}
    previous.count+=1;
    const allowed=previous.count<=limit;
    if(clients.size>10_000)for(const [client,value] of clients)if(now-value.startedAt>=windowMs)clients.delete(client);
    return{allowed,remaining:Math.max(0,limit-previous.count),retryAfter:allowed?0:Math.ceil((windowMs-(now-previous.startedAt))/1000)};
  };
}
