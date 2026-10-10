import { expect, test, type Page } from "@playwright/test";
import { confirmTrip, expectStage, failNextMessage, parkMouse, pressTalk, searchProposals, tapTalk, talkButton } from "./voice-helpers";

/**
 * Visual baselines of the voice flow (`/vocal`), in demo mode, for the four projects of
 * playwright.voice.config.ts: desktop 1440×900, tablet 768×1024, mobile 390×844 and
 * landscape 844×390.
 *
 * Baselines: e2e/__screenshots__/<platform>/<project>/voice-*.png. A failing comparison
 * means the UI changed: open the diff in .next-voice-results/ and LOOK at it. Only when the
 * change is intended, regenerate with `--update-snapshots` and review every new PNG before
 * committing. Never update baselines just to make the suite pass.
 *
 * Determinism: the page clock is installed (so the mock's replies can be held while the
 * think stage is captured), ids are fixed, the voice shape is frozen at a fixed level and
 * instant, and the elapsed timer — the only remaining moving part — is masked.
 */

const FIXED_LEVEL = 0.62;

async function open(page: Page): Promise<void> {
  await page.clock.install({ time: new Date("2026-10-10T10:00:00+02:00") });
  await page.addInitScript((level) => {
    let counter = 0;
    crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
    (window as unknown as { __lioVoiceFixedLevel: number }).__lioVoiceFixedLevel = level;
  }, FIXED_LEVEL);
  await page.goto("/vocal");
  await expectStage(page, "ask");
  await page.evaluate(() => document.fonts.ready);
}

/** Holds the page clock: pending replies of the mock stay pending, the screen stays as it is. */
async function freeze(page: Page): Promise<void> {
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 10);
}

async function recordingStarted(page: Page): Promise<void> {
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
}

test("ask, listen and think", async ({ page }) => {
  await open(page);
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-01-ask.png");

  await page.getByTestId("write-instead").click();
  await page.getByLabel("Votre réponse").fill("Nous serons 30, au départ de la gare de Toulouse Matabiau.");
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-02-ask-text.png");
  await page.getByTestId("text-entry").getByRole("button", { name: "Annuler" }).click();

  // Pointer only from here on: a key press would switch the browser to keyboard focus
  // rings, which are not part of these states.

  // Reduced motion (the suite's default): the static level meter. Tap to toggle.
  await tapTalk(page);
  await recordingStarted(page);
  await expect(page.getByTestId("voice-meter")).toBeVisible();
  await expect(page.getByTestId("listen-hint")).toHaveText("Touchez à nouveau pour terminer");
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-04-listen-reduced-motion.png", { mask: [page.getByTestId("voice-timer")] });
  await page.getByTestId("listen-cancel").click();
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-hint")).toBeVisible();
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-11-ask-hint.png");

  // Motion on: the voice shape, frozen at a fixed level and instant. Hold to talk.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await pressTalk(page);
  await recordingStarted(page);
  await expect(page.getByTestId("voice-canvas")).toBeVisible();
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour terminer");
  await expect.soft(page).toHaveScreenshot("voice-03-listen.png", { mask: [page.getByTestId("voice-timer")] });

  // Sliding away arms the cancel: the screen says so.
  const disc = await page.getByTestId("talk-disc").boundingBox();
  await page.mouse.move(disc!.x + disc!.width / 2, disc!.y - 200, { steps: 4 });
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour annuler");
  await expect.soft(page).toHaveScreenshot("voice-12-listen-cancel-armed.png", { mask: [page.getByTestId("voice-timer")] });
  await page.mouse.move(disc!.x + disc!.width / 2, disc!.y + disc!.height / 2, { steps: 4 });
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour terminer");
  await page.waitForTimeout(600);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.mouse.up();

  // think: transcription done, understanding in progress, the transcript already shown.
  await expectStage(page, "think");
  await expect(page.getByTestId("think-transcript")).toBeVisible();
  await freeze(page);
  await expectStage(page, "think");
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-05-think.png");
  await page.clock.resume();
  await expectStage(page, "sheet");
});

test("think with a provider error", async ({ page }) => {
  await open(page);
  await failNextMessage(page);
  await tapTalk(page);
  await recordingStarted(page);
  await page.waitForTimeout(1_300);
  await talkButton(page).click();
  await expect(page.getByTestId("think-failure")).toBeVisible();
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-06-think-error.png");
});

test("sheet and done", async ({ page }) => {
  await open(page);
  await tapTalk(page);
  await recordingStarted(page);
  await page.waitForTimeout(1_300);
  await talkButton(page).click();
  await expectStage(page, "sheet");
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-07-sheet-partial.png");

  await page.getByRole("button", { name: "Modifier : Retour" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Modifier : Retour" }).click();
  await expect(page.getByLabel("Date de retour")).toBeFocused();
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-08-sheet-edit.png");
  await page.getByTestId("sheet-editor-return").getByRole("button", { name: "Annuler" }).click();

  // Complete by voice from the sheet.
  await tapTalk(page);
  await recordingStarted(page);
  await page.waitForTimeout(1_300);
  await talkButton(page).click();
  await expectStage(page, "sheet");
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-09-sheet-ready.png");

  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-10-done.png");
});

// ---------------------------------------------------------------------------------------
// The journey after confirmation (demo journey service: the scripted simulation).
// ---------------------------------------------------------------------------------------

/** Top of the stage, pointer away, entrance finished: the state a teacher sees on entry. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
  await parkMouse(page);
  await page.waitForTimeout(350);
}

test("journey: destinations, adjustments, itineraries, review, booking, travel file, feedback", async ({ page }) => {
  await open(page);
  await confirmTrip(page);
  await searchProposals(page, { search: "adjustments" });

  await expectStage(page, "destinations");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-13-destinations.png");

  await page.getByTestId("destination-choose").click();
  await expectStage(page, "adjustments");
  // Pointer only: one option selected, nothing accepted.
  await page.locator('[data-testid^="adjustment-adj_"]').first().click();
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-14-adjustments.png");

  await page.getByTestId("adjustment-accept").click();
  await expectStage(page, "itineraries");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-15-itineraries.png");

  await page.getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-16-review.png");

  // Waiting: the clock is held so the automatic check does not fire under the camera.
  await page.getByTestId("review-send").click();
  await expectStage(page, "booking_pending");
  await freeze(page);
  await parkMouse(page);
  await expect.soft(page).toHaveScreenshot("voice-17-booking-pending.png");
  await page.clock.resume();

  await expectStage(page, "booked");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-18-booked.png");

  await page.getByTestId("booked-open-file").click();
  await expectStage(page, "travel_file");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-19-travel-file.png");

  await page.getByTestId("file-feedback").click();
  await expectStage(page, "feedback");
  await page.getByTestId("feedback-rating-4").click();
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-20-feedback.png");

  await page.getByTestId("feedback-send").click();
  await expectStage(page, "closed");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-21-closed.png");
});

test("journey: no result, the restart notice, a technical error, a refused booking", async ({ page }) => {
  await open(page);
  await confirmTrip(page);

  await searchProposals(page, { search: "no_match" });
  await expectStage(page, "no_match");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-22-no-match.png");

  await page.getByTestId("journey-modify").click();
  await expectStage(page, "sheet");
  await page.getByRole("button", { name: "Modifier : Participants" }).scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Modifier : Participants" }).click();
  await page.getByLabel("Nombre total de participants").fill("28");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("search-restart-notice")).toBeVisible();
  // Focus returns to the row's button after saving: release it, this state is about the notice.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-23-sheet-search-restart.png");

  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");
  await searchProposals(page, { search: "error", booking: "refused" });
  await expect(page.getByTestId("journey-error")).toBeVisible();
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-24-search-error.png");

  await searchProposals(page, { search: "auto" });
  await expectStage(page, "destinations");
  await page.getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");
  await page.getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await page.getByTestId("review-send").click();
  await expectStage(page, "booking_pending");
  await page.getByTestId("booking-check").click();
  await expectStage(page, "booking_refused");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("voice-25-booking-refused.png");
});
