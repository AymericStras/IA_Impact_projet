import { expect, test } from "@playwright/test";
import { FIRST_MESSAGE, failNextMessage, openDemo, send, setPanelExpanded, settle } from "./helpers";

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
  await settle(page);
  await expect.soft(page).toHaveScreenshot("05-confirmed-json.png");
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
