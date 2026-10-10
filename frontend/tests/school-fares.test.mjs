import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/school-fares.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
const { groupFare, estimateSchoolFare } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);
const route = (...modes) => ({ legs: modes.map((mode) => ({ mode })) });

test("official bracket boundaries count pupils and accompanying adults together", () => {
  for (const [total, price] of [[6,10],[10,10],[11,20],[20,20],[21,30],[30,30],[31,40],[40,40],[41,50],[50,50]]) {
    assert.equal(groupFare(total - 1, 1), price);
  }
  assert.equal(groupFare(30, 3), 40);
});
test("invalid or ineligible group sizes have no displayed estimate", () => {
  for (const pair of [[4,1],[48,3],[30,0],[0,6],[29.5,3],[NaN,3],[Infinity,3],[-1,7]]) assert.equal(groupFare(...pair), null);
});
test("direct round trip and connections are priced per train in each direction", () => {
  assert.equal(estimateSchoolFare(30,3,route("Train TER"),route("Train TER")).total, 80);
  const quote = estimateSchoolFare(30,3,route("Train TER","Marche","Train TER"),route("Train TER"));
  assert.equal(quote.outbound, 80);
  assert.equal(quote.inbound, 40);
  assert.equal(quote.total, 120);
});
test("walking is not billed as a train; unsupported or missing train journeys are not priced", () => {
  assert.equal(estimateSchoolFare(30,3,route("Marche","Train TER"),route("Train TER","Marche")).total, 80);
  for (const modes of [[],["Marche"],["TGV"],["Train TER","Car TER"]]) assert.equal(estimateSchoolFare(30,3,route(...modes),route("Train TER")), null);
  assert.equal(estimateSchoolFare(48,3,route("Train TER"),route("Train TER")), null);
});
