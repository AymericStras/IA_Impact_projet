import { access, cp, mkdir, readFile } from "node:fs/promises";

if (process.argv.includes("--snapshot") || process.env.VITE_PUBLIC_SNAPSHOT === "true") {
  const metadata = JSON.parse(await readFile("public/demo-routes/index.json", "utf8"));
  for (const id of new Set(Object.values(metadata.aliases))) {
    for (const margin of [5, 15]) await access(`public/demo-routes/${margin}/${id}.bin`);
  }
}

// /mobile works on static hosts even without an SPA fallback rule.
await mkdir("dist/mobile", { recursive: true });
await cp("dist/index.html", "dist/mobile/index.html");
