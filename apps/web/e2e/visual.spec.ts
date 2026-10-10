import { expect, test } from "@playwright/test";
import {
  FIRST_MESSAGE,
  chooseDestination,
  confirmProject,
  expectStage,
  failNextMessage,
  openDemo,
  send,
  setPanelExpanded,
  settle,
  startJourney,
} from "./helpers";

/**
 * Visual regression of the frozen design (docs/DESIGN.md), in demo mode.
 *
 * Baselines live in e2e/__screenshots__/<platform>/<project>/. A failing comparison means
 * the UI changed: open the diff in test-results/ and LOOK at it. Only when the change is
 * intended, regenerate with `pnpm test:e2e --update-snapshots` and review the new PNGs
 * before committing them. Never update baselines just to make the suite pass.
 */

test("conversation states", async ({ page }) => {
  await openDemo(page);
  await settle(page);
  await expect.soft(page).toHaveScreenshot("01-welcome.png");

  await send(page, FIRST_MESSAGE);
  await settle(page);
  await expect.soft(page).toHaveScreenshot("02-partial-4-of-5.png");

  await setPanelExpanded(page, true);
  await page.getByRole("button", { name: "Modifier : Retour" }).click();
  await expect(page.getByLabel("Date de retour")).toBeFocused();
  await page.mouse.move(0, 0);
  await expect.soft(page).toHaveScreenshot("03-inline-edit-open.png");
  await page.getByRole("button", { name: "Annuler" }).click();
  await setPanelExpanded(page, false);

  await send(page, "Avant 17 h.");
  await expect(page.getByTestId("confirmation-card")).toBeVisible();
  await settle(page);
  await expect.soft(page).toHaveScreenshot("04-complete-confirmation-card.png");

  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("confirmed-json")).toBeVisible();
  // The journey's start card comes right after the confirmed card (when it fits in the viewport).
  await expect(page.getByTestId("journey-start-button")).toBeVisible();
  await settle(page);
  await expect.soft(page).toHaveScreenshot("05-confirmed-json.png");
});

test("journey states", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  await startJourney(page, { search: "adjustments" });
  await expectStage(page, "destinations");
  await expect(page.getByTestId("destination-card")).toHaveCount(4);
  await settle(page);
  await expect.soft(page).toHaveScreenshot("10-journey-destinations.png");

  await chooseDestination(page, "carcassonne", ["Visite guidée des remparts", "Atelier « vie au Moyen Âge »"]);
  await expectStage(page, "adjustments");
  await expect(page.getByTestId("adjustment-card")).toHaveCount(6);
  await settle(page);
  await expect.soft(page).toHaveScreenshot("11-journey-adjustments.png");

  await page
    .getByTestId("adjustment-card")
    .filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" })
    .getByRole("button", { name: "Accepter cet ajustement" })
    .click();
  await expectStage(page, "itineraries");
  await page.getByTestId("itinerary-card").getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await settle(page);
  await expect.soft(page).toHaveScreenshot("12-journey-review.png");

  await page.getByTestId("booking-submit").click();
  await expectStage(page, "booked");
  const file = page.getByTestId("travel-file");
  await expect(file).toBeVisible();
  // Bring the file itself to the top of the conversation area (the thread only, not the shell).
  await file.evaluate((el) => {
    const scroller = el.closest<HTMLElement>("[data-thread-scroll]")!;
    scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 12;
  });
  await settle(page);
  await expect.soft(page).toHaveScreenshot("13-journey-travel-file.png");
});

test("voice recorder states", async ({ page }) => {
  await openDemo(page);
  await page.getByTestId("microphone-button").click();
  await expect(page.getByTestId("voice-recorder")).toContainText("Enregistrement en cours");
  await page.mouse.move(0, 0);
  // The elapsed timer is the only moving part of this state.
  await expect.soft(page).toHaveScreenshot("06-recorder-recording.png", { mask: [page.getByTestId("voice-timer")] });

  await page.getByRole("button", { name: "Arrêter" }).click();
  await expect(page.getByLabel("Texte transcrit")).toHaveValue(/27 élèves/);
  await page.mouse.move(0, 0);
  await expect.soft(page).toHaveScreenshot("07-transcript-preview.png");
});

test("help dialog", async ({ page }) => {
  await openDemo(page);
  await page.getByRole("button", { name: "Aide" }).click();
  await expect(page.getByRole("dialog")).toContainText("Comment décrire votre projet");
  await page.mouse.move(0, 0);
  await expect.soft(page).toHaveScreenshot("09-help-dialog.png");
});

test("error with retry", async ({ page }) => {
  await openDemo(page);
  await failNextMessage(page);
  const composer = page.getByLabel("Votre message");
  await composer.fill("Nous serons 30.");
  await composer.press("Enter");
  await expect(page.getByTestId("error-message")).toBeVisible();
  await page.mouse.move(0, 0);
  await expect.soft(page).toHaveScreenshot("08-error-retry.png");
});
