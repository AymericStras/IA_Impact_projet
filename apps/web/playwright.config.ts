import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. They always run against the MOCK service (demo mode): deterministic,
 * no backend, no API key.
 *
 * Three kinds of spec:
 * - demo-flow.spec.ts   functional flows (portable);
 * - responsive.spec.ts  programmatic layout assertions over a viewport matrix (portable,
 *                       no screenshots — runs the same on Linux);
 * - visual.spec.ts      screenshot comparison against per-platform baselines (macOS only
 *                       until Linux baselines are generated and reviewed).
 *
 * `pnpm test:e2e` runs everything; `pnpm test:e2e:ci` runs the two portable specs.
 *
 * The web server is a production build on port 3100 with its own dist directory, so it
 * never collides with a `pnpm dev` on port 3000 (which owns `.next`).
 */
const PORT = 3100;
const BASE_URL = `http://localhost:${PORT}`;

const shared = {
  ...devices["Desktop Chrome"],
  deviceScaleFactor: 1,
  // A fake microphone lets the recorder reach its "recording" state without hardware.
  permissions: ["microphone"],
  launchOptions: {
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--lang=fr-FR"],
  },
};

const FLOW_AND_VISUAL = ["demo-flow.spec.ts", "visual.spec.ts"];

export default defineConfig({
  testDir: "./e2e",
  // Baselines are per platform (font rendering differs) and per project (viewport).
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [["list"]],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixels: 60,
    },
  },
  use: {
    baseURL: BASE_URL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light",
    // Motion and CSS animations collapse to their end state: screenshots are stable.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", testMatch: FLOW_AND_VISUAL, use: { ...shared, viewport: { width: 1440, height: 900 } } },
    { name: "mobile", testMatch: FLOW_AND_VISUAL, use: { ...shared, viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "tablet", testMatch: FLOW_AND_VISUAL, use: { ...shared, viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "landscape", testMatch: FLOW_AND_VISUAL, use: { ...shared, viewport: { width: 844, height: 390 }, hasTouch: true } },
    // The responsive spec sets its own viewport per test.
    { name: "responsive", testMatch: "responsive.spec.ts", use: { ...shared } },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_PUBLIC_DEMO_MODE: "true", NEXT_DIST_DIR: ".next-e2e" },
  },
});
