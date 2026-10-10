import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests of the voice flow (`/vocal`). Separate from `playwright.config.ts` so
 * they can run next to the classic suite: own port (3200) and own build directory
 * (`.next-voice`). Always demo mode (mock service): deterministic, no backend, no API key.
 *
 *   pnpm exec playwright test -c playwright.voice.config.ts                    everything
 *   pnpm exec playwright test -c playwright.voice.config.ts --project=voice    functional
 *   pnpm exec playwright test -c playwright.voice.config.ts --project=voice-responsive
 *   pnpm exec playwright test -c playwright.voice.config.ts voice-visual       baselines
 *
 * Three kinds of spec:
 * - voice-flow.spec.ts        functional journeys (portable);
 * - voice-responsive.spec.ts  programmatic layout assertions over the viewport matrix
 *                             (portable, no screenshots — same verdict on Linux);
 * - voice-visual.spec.ts      screenshots against per-platform baselines (macOS only until
 *                             Linux baselines are generated and reviewed).
 *
 * `VOICE_E2E_REUSE=1` reuses a server already listening on the port (local iteration):
 * make sure it serves the current build.
 */
const PORT = 3200;
const BASE_URL = `http://localhost:${PORT}`;

const shared = {
  ...devices["Desktop Chrome"],
  deviceScaleFactor: 1,
  permissions: ["microphone"],
  launchOptions: {
    // A fake microphone (a periodic beep) feeds getUserMedia, MediaRecorder and the analyser.
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--lang=fr-FR"],
  },
};

const VISUAL = "voice-visual.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  // Same layout as the classic baselines; the files of this route are named `voice-*`.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  // Not under ./test-results: the classic suite wipes that directory when it starts.
  // `.next-*` is already ignored by git and ESLint.
  outputDir: "./.next-voice-results",
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
      // Per-pixel colour tolerance. Playwright's default (0.2) cannot tell a white card
      // from the near-white page background: a card that grows, shrinks or disappears
      // would pass unnoticed. Measured: a row stretched by 240 px passed at 0.2.
      threshold: 0.03,
    },
  },
  use: {
    baseURL: BASE_URL,
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
    colorScheme: "light",
    // Stage transitions collapse to a cross-fade; the listen stage shows its level meter.
    // The visual spec turns motion back on for the frozen canvas.
    reducedMotion: "reduce",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "voice", testMatch: "voice-flow.spec.ts", use: { ...shared, viewport: { width: 1280, height: 800 } } },
    // The responsive spec sets its own viewport per test.
    { name: "voice-responsive", testMatch: "voice-responsive.spec.ts", use: { ...shared } },
    { name: "desktop", testMatch: VISUAL, use: { ...shared, viewport: { width: 1440, height: 900 } } },
    { name: "tablet", testMatch: VISUAL, use: { ...shared, viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: "mobile", testMatch: VISUAL, use: { ...shared, viewport: { width: 390, height: 844 }, hasTouch: true } },
    { name: "landscape", testMatch: VISUAL, use: { ...shared, viewport: { width: 844, height: 390 }, hasTouch: true } },
  ],
  webServer: {
    command: `pnpm exec next build && pnpm exec next start --port ${PORT}`,
    url: `${BASE_URL}/vocal`,
    reuseExistingServer: process.env.VOICE_E2E_REUSE === "1",
    timeout: 240_000,
    env: { NEXT_PUBLIC_DEMO_MODE: "true", NEXT_DIST_DIR: ".next-voice" },
  },
});
