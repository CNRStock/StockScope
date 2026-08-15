import test from "node:test";import assert from "node:assert/strict";import{compareProfiles}from"../similarity.js";
test("identical measurable profiles score 100",()=>{const profile={metrics:{revenueGrowth:.3,grossMargin:.6,operatingMargin:.2,rdIntensity:.15,fcfMargin:.12}};assert.equal(compareProfiles(profile,profile).score,100)});
test("requires at least three comparable features",()=>{assert.equal(compareProfiles({metrics:{revenueGrowth:.2}},{metrics:{revenueGrowth:.3}}),null)});
