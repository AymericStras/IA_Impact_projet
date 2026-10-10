import { expect, type Locator, type Page } from "@playwright/test";

/** Scripted transcripts of the demo service, in the order the voice path meets them. */
export const TRANSCRIPT_FULL = "27 élèves et 3 accompagnateurs";
export const TRANSCRIPT_RETURN = "avant 17 h";

export const TYPED_FULL =
  "Bonjour, je voudrais organiser une sortie le 12 novembre au départ de la gare de Toulouse Matabiau. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h et on rentrerait avant 17 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge.";

/** Same key as DEMO_FAIL_NEXT_KEY in src/services/mockConversationApi.ts (root base path). */
const FAIL_NEXT_KEY = "lio.demo.fail_next";

export interface OpenVoiceOptions {
  /** Freezes the voice visual at this level (0..1) so screenshots are stable. */
  fixedLevel?: number;
}

/**
 * Opens `/vocal` in demo mode with everything that could vary between runs pinned down:
 * the clock (timestamps, `confirmed_at`, "current year"), random ids, and optionally the
 * level of the voice visual.
 */
export async function openVoice(page: Page, options: OpenVoiceOptions = {}): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00+02:00"));
  await page.addInitScript(() => {
    let counter = 0;
    crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
  });
  if (options.fixedLevel !== undefined) {
    await page.addInitScript((level) => {
      (window as unknown as { __lioVoiceFixedLevel: number }).__lioVoiceFixedLevel = level;
    }, options.fixedLevel);
  }
  await page.goto("/vocal");
  await expectStage(page, "ask");
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

export type Stage = "ask" | "listen" | "think" | "sheet" | "done";

export async function expectStage(page: Page, stage: Stage): Promise<void> {
  await expect(page.getByTestId("voice-shell")).toHaveAttribute("data-stage", stage, { timeout: 15_000 });
}

export function talkButton(page: Page): Locator {
  return page.getByTestId("talk-button");
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * Tap-to-toggle start: a press shorter than the 250 ms hold threshold.
 *
 * On a machine stalled by other work the browser can take longer than that between the
 * press and the release of one click; the page then — correctly — reads a hold released
 * too early, says so and returns. That is a property of the test machine, not of the
 * page: close the hint and tap again.
 */
export async function tapTalk(page: Page): Promise<void> {
  const shell = page.getByTestId("voice-shell");
  const origin = await shell.getAttribute("data-stage");
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await talkButton(page).click();
    await page.waitForTimeout(350);
    if ((await shell.getAttribute("data-stage")) !== origin) return;
    const tooShort = page.getByTestId("voice-hint").filter({ hasText: "Maintenez le bouton pendant que vous parlez." });
    if ((await tooShort.count()) === 0) return;
    await tooShort.getByRole("button", { name: "Fermer" }).click();
  }
}

/** Presses the talk button and keeps the pointer down; the caller releases it. */
export async function pressTalk(page: Page): Promise<{ x: number; y: number }> {
  const point = await centre(page.getByTestId("talk-disc"));
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  return point;
}

/** Hold-to-talk: press, speak for `ms` (the fake microphone beeps), release. */
export async function holdToTalk(page: Page, ms = 1_600): Promise<void> {
  await pressTalk(page);
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/** A full spoken turn: hold, release, wait for the sheet. */
export async function speak(page: Page): Promise<void> {
  await holdToTalk(page);
  await expectStage(page, "sheet");
}

/** Makes the next message fail once with a provider error (mock-only switch). */
export async function failNextMessage(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.setItem(key, "1"), FAIL_NEXT_KEY);
}

/** Parks the mouse away from every control (no hover state in screenshots). */
export async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(0, 0);
}
