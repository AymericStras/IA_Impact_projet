import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end and visual-regression tests. They always run against the MOCK service
 * (demo mode): deterministic, no backend, no API key.
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

export default defineConfig({
  testDir: "./e2e",
  // Baselines are per platform (font rendering differs) and per project (viewport).
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  timeout: 60_000,
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
    { name: "desktop", use: { ...shared, viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...shared, viewport: { width: 390, height: 844 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 240_000,
    env: { NEXT_PUBLIC_DEMO_MODE: "true", NEXT_DIST_DIR: ".next-e2e" },
  },
});
