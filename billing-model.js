const PRO_STATUSES=new Set(["active","trialing","past_due"]);

export function planForSubscription(status){
  return PRO_STATUSES.has(String(status||"").toLowerCase())?"pro":"free";
}

export function subscriptionRecord(subscription){
  const customerId=typeof subscription.customer==="string"?subscription.customer:subscription.customer?.id;
  return{
    plan:planForSubscription(subscription.status),
    stripe_customer_id:customerId||null,
    stripe_subscription_id:subscription.id,
    subscription_status:subscription.status,
    current_period_end:subscription.current_period_end?new Date(subscription.current_period_end*1000).toISOString():null,
    cancel_at_period_end:Boolean(subscription.cancel_at_period_end),
    cancel_at:subscription.cancel_at?new Date(subscription.cancel_at*1000).toISOString():null
  };
}
