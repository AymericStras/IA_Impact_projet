import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import ts from "typescript";

const source = await readFile(new URL("../src/snapshot-api.ts", import.meta.url), "utf8");
// Isolate the transport from the Vite environment while preserving its error contract.
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText.replace(/import.*from "\.\/api";/, 'class ApiError extends Error { constructor(code) { super(code); this.code = code; } }');
const { getSnapshot } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
const originalFetch = globalThis.fetch;
let fail = true;
const calls = [];
globalThis.fetch = async (url) => {
  calls.push(url);
  if (fail) throw new Error("offline");
  if (url.endsWith("index.json")) return Response.json({ schema: 1, aliases: { NIMES: 0, ALBI: 1, FOIX: 2 }, places: [], edges: [], modes: [], info: {} });
  return new Response(gzipSync(JSON.stringify([{ error: "same_place" }, { minutes: url.includes("/15/") ? 95 : 85, legs: [] }, null])));
};

test("snapshot transport retries metadata after offline failure and decodes both transfer margins", async () => {
  await assert.rejects(getSnapshot("/places"), { code: "network" });
  fail = false;
  assert.deepEqual(await getSnapshot("/places"), { places: [] });
  const params = new URLSearchParams({ from: "nîmes", to: "Albi", transfer_min: "15" });
  assert.equal((await getSnapshot("/route", params)).minutes, 95);
  const count = calls.length;
  await getSnapshot("/route", params);
  assert.equal(calls.length, count);
  params.delete("transfer_min");
  assert.equal((await getSnapshot("/route", params)).minutes, 85);
});
test("snapshot transport preserves unknown, same-place, disconnected and cancellation errors", async () => {
  for (const [to, code] of [["Unknown", "unknown_place"], ["Nîmes", "same_place"], ["Foix", "no_route"]]) {
    await assert.rejects(getSnapshot("/route", new URLSearchParams({ from: "Nîmes", to })), { code });
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(getSnapshot("/places", undefined, controller.signal), { name: "AbortError" });
  globalThis.fetch = originalFetch;
});
