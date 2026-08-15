import test from "node:test";import assert from "node:assert/strict";import{marketSymbol}from"../public/assets.js";
test("maps simple crypto symbols to EODHD USD pairs",()=>{assert.equal(marketSymbol("doge","crypto"),"DOGE-USD.CC");assert.equal(marketSymbol("ETH-USD","crypto"),"ETH-USD.CC")});
test("leaves stock and complete crypto symbols unchanged",()=>{assert.equal(marketSymbol("nvda","stock"),"NVDA");assert.equal(marketSymbol("BTC-USD.CC","crypto"),"BTC-USD.CC")});
