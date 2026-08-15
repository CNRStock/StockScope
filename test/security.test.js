import test from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter,securityHeaders } from "../security.js";

test("security headers prevent framing and content sniffing",()=>{const headers=securityHeaders({production:true});assert.equal(headers["x-frame-options"],"DENY");assert.equal(headers["x-content-type-options"],"nosniff");assert.match(headers["content-security-policy"],/frame-ancestors 'none'/);assert.match(headers["strict-transport-security"],/max-age/)});
test("rate limiter resets after its window",()=>{const allow=createRateLimiter({windowMs:1000,limit:2});assert.equal(allow("client",0).allowed,true);assert.equal(allow("client",1).allowed,true);assert.equal(allow("client",2).allowed,false);assert.equal(allow("client",1001).allowed,true)});
