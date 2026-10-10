import path from "node:path";
import type { NextConfig } from "next";

// Sub-path deployment (e.g. "/sncf-chatbot"). Build-time; empty means served at the root.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  basePath,
  // Under a sub-path the public URL is "<basePath>/": serve it directly (200) instead of
  // redirecting to the slash-less form, which reverse proxies tend to bounce back.
  trailingSlash: basePath !== "",
  // NEXT_DIST_DIR lets a second build or server (e2e, verification) run next to a
  // live `pnpm dev` without overwriting its `.next` directory. Default is unchanged.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Self-contained server bundle for deployment only; local dev and tests are unaffected.
  ...(process.env.NEXT_OUTPUT === "standalone" ? { output: "standalone" as const } : {}),
  // The app has its own lockfile; keep file tracing scoped to apps/web.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
