import test from "node:test";
import assert from "node:assert/strict";
import {planForSubscription,subscriptionRecord} from "../billing-model.js";

test("keeps Pro access while an active subscription is scheduled to cancel",()=>{
  const record=subscriptionRecord({id:"sub_test",customer:"cus_test",status:"active",cancel_at_period_end:true,current_period_end:1_800_000_000,cancel_at:1_800_000_000});
  assert.equal(record.plan,"pro");
  assert.equal(record.cancel_at_period_end,true);
  assert.match(record.cancel_at,/^2027-/);
});

test("keeps a grace period for past-due renewals",()=>assert.equal(planForSubscription("past_due"),"pro"));
test("revokes Pro for terminal or non-provisioned states",()=>{
  for(const status of ["unpaid","canceled","incomplete","incomplete_expired","paused"])assert.equal(planForSubscription(status),"free");
});
