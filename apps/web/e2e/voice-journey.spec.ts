import { expect, test, type Page } from "@playwright/test";
import { SIMULATION_NOTICE, confirmTrip, expectSimulationLabel, expectStage, openVoice, searchProposals } from "./voice-helpers";

/**
 * The journey after confirmation on `/vocal`, in demo mode: the demo journey service is a
 * scripted port of the API's simulation (docs/PLANNER_CONTRACT.md), so every stage and
 * branch can be walked without a backend.
 *
 * Emulation only: desktop Chromium, a mouse as the finger.
 */

const value = (page: Page, field: string) => page.getByTestId(`sheet-row-${field}-value`);
const heading = (page: Page) => page.getByTestId("stage-heading");
const dock = (page: Page) => page.getByTestId("voice-dock");
/** Alerts of the page itself (Next's own route announcer, outside the shell, is one too). */
const alerts = (page: Page) => page.getByTestId("voice-shell").getByRole("alert");

/** Confirms the scripted trip, searches, and stops on the destinations. */
async function toDestinations(page: Page, scenarios: Parameters<typeof searchProposals>[1] = {}): Promise<void> {
  await openVoice(page);
  await confirmTrip(page);
  await searchProposals(page, scenarios);
  await expectStage(page, "destinations");
}

test("happy path: destinations → itinerary → review → booking → travel file → feedback → closed", async ({ page }) => {
  await openVoice(page);
  await confirmTrip(page);

  // done: the search is the one primary action, in the dock; the scenarios are closed.
  await expect(dock(page).getByTestId("done-search")).toHaveText("Rechercher des propositions");
  await expect(page.getByTestId("scenario-toggle")).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByTestId("scenario-search")).toHaveCount(0);
  await searchProposals(page);

  // destinations: one card at a time.
  await expectStage(page, "destinations");
  await expect(heading(page)).toHaveText("Choisissez une destination");
  await expect(heading(page)).toBeFocused();
  await expect(page.getByTestId("stage-announcer")).toContainText("Destinations proposées.");
  await expectSimulationLabel(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  const total = Number(((await page.getByTestId("destinations-carousel-position").textContent()) ?? "").split(" sur ")[1]);
  expect(total).toBeGreaterThan(1);
  const firstTitle = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  await expect(page.getByTestId("destination-why")).not.toBeEmpty();
  await expect(page.getByTestId("destination-travel")).toContainText("de trajet");
  await expect(page.getByRole("article")).toContainText("à pied de la gare");

  // Keyboard: the arrows work right after entry (focus is on the heading), and stop at the ends.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("destinations-carousel-position")).toHaveText(`2 sur ${total}`);
  await expect(page.getByRole("article").getByRole("heading", { level: 2 })).not.toHaveText(firstTitle ?? "");
  await page.keyboard.press("End");
  await expect(page.getByTestId("destinations-carousel-position")).toHaveText(`${total} sur ${total}`);
  await expect(page.getByRole("button", { name: "Destination suivante" })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(page.getByRole("button", { name: "Destination précédente" })).toBeDisabled();
  await page.getByRole("button", { name: "Destination suivante" }).click();
  await page.getByRole("button", { name: "Destination précédente" }).click();
  await expect(page.getByRole("article").getByRole("heading", { level: 2 })).toHaveText(firstTitle ?? "");

  // Activities are toggles with their duration.
  const activity = page.locator('[data-testid^="activity-"]').first();
  await expect(activity).toHaveAttribute("aria-pressed", "false");
  await activity.click();
  await expect(activity).toHaveAttribute("aria-pressed", "true");
  await dock(page).getByTestId("destination-choose").click();

  // itineraries: a timeline of the day, free time and checks.
  await expectStage(page, "itineraries");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByTestId("timeline-outbound")).toContainText("Aller");
  await expect(page.getByTestId("timeline-outbound")).toContainText("(horaire simulé)");
  await expect(page.getByTestId("timeline-activity").first()).toBeVisible();
  await expect(page.getByTestId("timeline-return")).toContainText("Retour");
  await expect(page.getByTestId("itinerary-free-time")).toContainText("Temps libre sur place");
  await expect(page.getByTestId("itinerary-checks").getByRole("listitem").first()).toBeVisible();
  const label = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  await dock(page).getByTestId("itinerary-choose").click();

  // review: the chosen itinerary in full; nothing is booked yet.
  await expectStage(page, "review");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("review-not-booked")).toContainText("Rien n'est encore réservé.");
  await expect(page.getByTestId("review-itinerary").getByRole("heading", { level: 2 })).toHaveText(label ?? "");
  await dock(page).getByTestId("review-send").click();

  // booking_pending: the reference, and ONE automatic check after about 2.5 s.
  await expectStage(page, "booking_pending");
  await expect(heading(page)).toHaveText("Demande envoyée");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("booking-reference")).toContainText("Référence : SIM-");
  await expect(dock(page).getByRole("button")).toHaveCount(1);
  await expect(dock(page).getByTestId("booking-check")).toHaveText("Vérifier la réponse");
  const sentAt = Date.now();
  await expectStage(page, "booked");
  expect(Date.now() - sentAt, "the answer was checked by the page itself, not at once").toBeGreaterThan(2_000);

  // booked → travel file.
  await expect(heading(page)).toHaveText("Réservation confirmée");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("booked-booking")).toContainText("(simulation)");
  await dock(page).getByTestId("booked-open-file").click();
  await expectStage(page, "travel_file");
  await expect(heading(page)).toContainText("Sortie pédagogique");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("file-schedule").getByRole("listitem").first()).toContainText("Départ de Toulouse Matabiau");
  await expect(page.getByTestId("file-places").getByRole("listitem").first()).toBeVisible();
  await expect(page.getByTestId("file-safety").getByRole("listitem").first()).toBeVisible();
  await expect(page.getByTestId("file-contacts")).toContainText("112");

  // « Imprimer » calls the browser's print; on paper only the file is left.
  await page.evaluate(() => {
    (window as unknown as { __prints: number }).__prints = 0;
    window.print = () => {
      (window as unknown as { __prints: number }).__prints += 1;
    };
  });
  await dock(page).getByTestId("file-print").click();
  expect(await page.evaluate(() => (window as unknown as { __prints: number }).__prints)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header").first()).toBeHidden();
  await expect(dock(page)).toBeHidden();
  await expect(page.getByTestId("file-schedule")).toBeVisible();
  await expect(page.getByTestId("file-contacts")).toBeVisible();
  // The paper also says that the data is simulated.
  await expect(page.getByTestId("journey-notices")).toBeVisible();
  const printed = await page.evaluate(() => {
    const shell = document.querySelector('[data-testid="voice-shell"]')!;
    const last = document.querySelector('[data-testid="file-contacts"]')!.getBoundingClientRect();
    const style = getComputedStyle(shell);
    return { clipped: style.overflowY !== "visible", fileEnd: last.bottom, shellEnd: shell.getBoundingClientRect().bottom };
  });
  expect(printed.clipped, "the shell must not clip the file on paper").toBe(false);
  expect(printed.fileEnd).toBeLessThanOrEqual(printed.shellEnd + 1);
  await page.emulateMedia({ media: "screen" });

  // feedback: 1–5 by keyboard, optional comment.
  await dock(page).getByTestId("file-feedback").click();
  await expectStage(page, "feedback");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(dock(page).getByTestId("feedback-send")).toBeDisabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("radio").first()).toBeFocused();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio", { name: "1 sur 5 : Pas du tout" })).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "4 sur 5 : Bien" })).toBeChecked();
  await page.getByTestId("feedback-comment").fill("Très clair, merci.");
  await dock(page).getByTestId("feedback-send").click();

  // closed.
  await expectStage(page, "closed");
  await expect(heading(page)).toHaveText("Merci !");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("closed-feedback")).toContainText("Votre note : 4 sur 5");
  await expect(page.getByTestId("closed-feedback")).toContainText("Très clair, merci.");

  // A reload lands on the server's stage again.
  await page.reload();
  await expectStage(page, "closed");

  await dock(page).getByTestId("closed-new").click();
  await expectStage(page, "ask");
  await expect(page.getByTestId("progress-dots")).toHaveAttribute("data-known", "0");
});

test("adjustments: several options, nothing applied before acceptance, then the sheet shows the new time", async ({ page }) => {
  await toDestinations(page, { search: "adjustments" });
  await dock(page).getByTestId("destination-choose").click();

  await expectStage(page, "adjustments");
  await expect(heading(page)).toHaveText("Aucun itinéraire tel que demandé");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("adjustments-reason")).toHaveCount(1);
  await expect(page.getByTestId("adjustments-reason")).not.toBeEmpty();
  await expect(page.getByTestId("adjustments-consent")).toHaveText("Rien n'est modifié tant que vous n'avez pas accepté un ajustement.");

  // SEVERAL options, each saying how many itineraries it unlocks.
  const options = page.locator('[data-testid^="adjustment-adj_"]');
  expect(await options.count()).toBeGreaterThan(1);
  for (const option of await options.all()) {
    await expect(option.getByTestId("adjustment-unlocks")).toHaveText(/^→ \d+ itinéraires? possibles?$/);
  }
  // A time change shows before → after.
  const later = options.filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" });
  await expect(later.getByTestId("adjustment-change")).toContainText("Retour : 17 h 00 → 17 h 30");

  // Selecting is not accepting.
  const accept = dock(page).getByTestId("adjustment-accept");
  await expect(accept).toBeDisabled();
  await later.click();
  await expect(later).toHaveAttribute("data-selected", "true");
  await expect(accept).toBeEnabled();
  await expectStage(page, "adjustments");

  // Nothing changed so far: the sheet still shows the time that was asked.
  await dock(page).getByTestId("journey-modify").click();
  await expectStage(page, "sheet");
  await expect(value(page, "return")).toContainText("17 h 00");
  await expect(page.getByTestId("search-restart-notice")).toHaveCount(0);
  await page.getByTestId("back-to-confirmation").click();
  await expectStage(page, "adjustments");

  // The explicit acceptance.
  await page.locator('[data-testid^="adjustment-adj_"]').filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" }).click();
  await dock(page).getByTestId("adjustment-accept").click();
  await expectStage(page, "itineraries");
  await expect(page.getByRole("article")).toHaveCount(1);

  // The requirements changed on the server and stay confirmed: the sheet shows the new time.
  await dock(page).getByTestId("journey-modify").click();
  await expectStage(page, "sheet");
  await expect(value(page, "return")).toContainText("17 h 30");
  await expect(page.getByTestId("sheet-status")).toHaveText("Cette sortie est déjà confirmée.");
  await expect(page.getByTestId("search-restart-notice")).toHaveCount(0);
  await page.getByTestId("back-to-confirmation").click();
  await expectStage(page, "itineraries");

  // The review recalls what was accepted.
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await expect(page.getByTestId("review-accepted")).toContainText("Retour : 17 h 00 → 17 h 30");
});

test("adjustments by keyboard alone: arrows move the selection, only the button accepts", async ({ page }) => {
  await toDestinations(page, { search: "adjustments" });
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "adjustments");

  await page.getByRole("radio").first().focus();
  await page.keyboard.press("Space");
  await expect(page.getByRole("radio").first()).toBeChecked();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio").nth(1)).toBeChecked();
  await expectStage(page, "adjustments");

  await dock(page).getByTestId("adjustment-accept").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("voice-shell")).not.toHaveAttribute("data-stage", "adjustments");
});

test("no result is a calm stage; a technical error is an alert with « Réessayer »", async ({ page }) => {
  await openVoice(page);
  await confirmTrip(page);

  // No result: a stage of its own, no alert, no retry.
  await searchProposals(page, { search: "no_match" });
  await expectStage(page, "no_match");
  await expect(heading(page)).toHaveText("Aucune proposition pour cette demande");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("journey-message")).not.toBeEmpty();
  await expect(alerts(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Réessayer" })).toHaveCount(0);
  await expect(dock(page).getByTestId("journey-modify")).toBeVisible();

  // Way out: the sheet; nothing was edited, so the confirmation stands.
  await dock(page).getByTestId("journey-modify").click();
  await expectStage(page, "sheet");
  await page.getByRole("button", { name: "Modifier : Participants" }).click();
  await page.getByLabel("Nombre total de participants").fill("28");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("search-restart-notice")).toBeVisible();
  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");

  // Technical error: still on done, an alert with the server's words, and a retry.
  await searchProposals(page, { search: "error" });
  const alert = page.getByTestId("journey-error");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Erreur technique");
  await expect(alert).toContainText("Cela ne signifie pas qu'aucun trajet n'existe");
  await expectStage(page, "done");
  await expect(page.getByTestId("stage-no_match")).toHaveCount(0);

  // « Réessayer » repeats the same request: the scripted failure fails again, visibly.
  await page.getByTestId("journey-error-action").click();
  await expect(alert).toBeVisible();
  await expectStage(page, "done");

  // With another scenario the search goes through and the error is gone.
  await searchProposals(page, { search: "auto" });
  await expectStage(page, "destinations");
  await expect(page.getByTestId("journey-error")).toHaveCount(0);
});

test("refused booking → alternative → booked", async ({ page }) => {
  await toDestinations(page, { booking: "refused" });
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");
  const refusedLabel = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await dock(page).getByTestId("review-send").click();
  await expectStage(page, "booking_pending");
  await dock(page).getByTestId("booking-check").click();

  // Refused: the server's message, and the other itineraries one at a time.
  await expectStage(page, "booking_refused");
  await expect(heading(page)).toHaveText("Réservation non confirmée");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByTestId("refused-message")).toContainText("La demande n'a pas pu être confirmée");
  await expect(page.getByTestId("refused-message")).toContainText("Rien n'a été réservé.");
  await expect(alerts(page)).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(1);
  await expect(page.getByRole("article").getByRole("heading", { level: 2 })).not.toHaveText(refusedLabel ?? "");
  await expect(dock(page).getByTestId("journey-destinations")).toBeVisible();
  await expect(dock(page).getByTestId("journey-modify")).toBeVisible();

  await page.keyboard.press("ArrowRight");
  const alternative = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await expect(page.getByTestId("review-itinerary").getByRole("heading", { level: 2 })).toHaveText(alternative ?? "");
  await dock(page).getByTestId("review-send").click();
  await expectStage(page, "booking_pending");
  await dock(page).getByTestId("booking-check").click();
  await expectStage(page, "booked");
});

test("a booking failure is an error: the request is not sent, and it can be retried", async ({ page }) => {
  await toDestinations(page, { booking: "error" });
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await dock(page).getByTestId("review-send").click();

  const alert = page.getByTestId("journey-error");
  await expect(alert).toBeVisible();
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(alert).toContainText("Erreur technique");
  await expect(page.getByTestId("journey-error-action")).toHaveText("Réessayer");
  await expect(alert).toContainText("Votre demande n'a pas été envoyée");
  // Not sent, not refused, not booked: still the review, with its statement and its ways back.
  await expectStage(page, "review");
  await expect(page.getByTestId("review-not-booked")).toBeVisible();
  await expect(page.getByTestId("stage-booking_refused")).toHaveCount(0);
  await expect(dock(page).getByTestId("review-send")).toBeEnabled();
  await page.getByTestId("journey-error-action").click();
  await expect(alert).toBeVisible();
  await expectStage(page, "review");

  // Leaving the stage leaves its error behind.
  await dock(page).getByTestId("review-other-itinerary").click();
  await expectStage(page, "itineraries");
  await expect(page.getByTestId("journey-error")).toHaveCount(0);
});

test("change of destination mid-way, from the review", async ({ page }) => {
  await toDestinations(page);
  const first = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await expect(page.getByTestId("review-itinerary")).toContainText(first ?? "");

  // Back to the destinations: the cards open on the current choice; « Retour » changes nothing.
  await dock(page).getByTestId("journey-destinations").click();
  await expectStage(page, "destinations");
  await expect(heading(page)).toBeFocused();
  await expectSimulationLabel(page);
  await expect(page.getByRole("article").getByRole("heading", { level: 2 })).toHaveText(first ?? "");
  await dock(page).getByTestId("journey-back").click();
  await expectStage(page, "review");

  // « Autre itinéraire » goes back one step only.
  await dock(page).getByTestId("review-other-itinerary").click();
  await expectStage(page, "itineraries");
  await dock(page).getByTestId("journey-destinations").click();
  await expectStage(page, "destinations");

  // Another destination: new itineraries, for that destination.
  await page.getByRole("button", { name: "Destination suivante" }).click();
  const second = await page.getByRole("article").getByRole("heading", { level: 2 }).textContent();
  expect(second).not.toBe(first);
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");
  await expect(page.getByRole("article")).toContainText(second ?? "");
  await dock(page).getByTestId("itinerary-choose").click();
  await expectStage(page, "review");
  await expect(page.getByTestId("review-itinerary")).toContainText(second ?? "");

  // A reload restores the stage from the server state.
  await page.reload();
  await expectStage(page, "review");
  await expect(page.getByTestId("review-itinerary")).toContainText(second ?? "");
});

test("edit of a requirement mid-way: the journey disappears, the search restarts after confirmation", async ({ page }) => {
  await toDestinations(page);
  await dock(page).getByTestId("destination-choose").click();
  await expectStage(page, "itineraries");

  await dock(page).getByTestId("journey-modify").click();
  await expectStage(page, "sheet");
  await expect(page.getByTestId("back-to-confirmation")).toHaveText("Revenir aux propositions");
  // The talk button stays available on the sheet, as before.
  await expect(page.getByTestId("talk-button")).toBeVisible();

  await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
  await page.getByRole("textbox", { name: "Gare de départ" }).fill("Montpellier Saint-Roch");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  // The confirmation is cleared: sheet, short notice, and nothing of the journey left.
  await expect(page.getByTestId("search-restart-notice")).toHaveText(/la recherche de propositions reprendra après la confirmation/);
  await expectStage(page, "sheet");
  await expect(page.getByTestId("back-to-confirmation")).toHaveCount(0);
  await expect(page.getByTestId("journey-notices")).toHaveCount(0);
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByText(SIMULATION_NOTICE)).toHaveCount(0);

  // After a reload too: the server has no journey.
  await page.reload();
  await expectStage(page, "sheet");
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();

  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");
  await expect(page.getByTestId("search-restart-notice")).toHaveCount(0);
  await expect(page.getByTestId("done-value-departure_station")).toContainText("Montpellier Saint-Roch");
  // The search starts again, from the beginning.
  await searchProposals(page);
  await expectStage(page, "destinations");
});

test("touch: a horizontal swipe changes the card, a vertical one scrolls the stage", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ["microphone"],
    reducedMotion: "reduce",
    baseURL: "http://localhost:3200",
  });
  const page = await context.newPage();
  await toDestinations(page);
  const client = await context.newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ x: number; y: number }>) =>
    client.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  const position = page.getByTestId("destinations-carousel-position");
  await expect(position).toHaveText(/^1 sur/);

  const swipe = async (from: { x: number; y: number }, to: { x: number; y: number }) => {
    await touch("touchStart", [from]);
    for (let step = 1; step <= 6; step += 1) {
      await touch("touchMove", [{ x: from.x + ((to.x - from.x) * step) / 6, y: from.y + ((to.y - from.y) * step) / 6 }]);
    }
    await touch("touchEnd", []);
  };

  // Right to left: the next card. Left to right: back.
  await swipe({ x: 320, y: 420 }, { x: 80, y: 430 });
  await expect(position).toHaveText(/^2 sur/);
  await swipe({ x: 80, y: 420 }, { x: 320, y: 410 });
  await expect(position).toHaveText(/^1 sur/);

  // Vertical: the stage scrolls, the card stays.
  await swipe({ x: 200, y: 600 }, { x: 200, y: 300 });
  await expect(position).toHaveText(/^1 sur/);
  expect(await page.evaluate(() => document.querySelector("main")!.scrollTop)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollLeft)).toBe(0);
  await context.close();
});

test("measured contrast of the journey stages", async ({ page }) => {
  /** WCAG 2.x contrast of the element's text colour against the first opaque background behind it. */
  const contrastOf = (selector: string) =>
    page
      .locator(selector)
      .first()
      .evaluate((element) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const rgba = (color: string): [number, number, number, number] => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
          return [r ?? 0, g ?? 0, b ?? 0, (a ?? 0) / 255];
        };
        // Composite every translucent background up to the first opaque one.
        const layers: Array<[number, number, number, number]> = [];
        for (let node: Element | null = element; node; node = node.parentElement) {
          const layer = rgba(getComputedStyle(node).backgroundColor);
          if (layer[3] > 0) layers.push(layer);
          if (layer[3] >= 0.999) break;
        }
        let background: [number, number, number] = [255, 255, 255];
        for (const [r, g, b, a] of layers.reverse()) {
          background = [background[0] * (1 - a) + r * a, background[1] * (1 - a) + g * a, background[2] * (1 - a) + b * a];
        }
        const text = rgba(getComputedStyle(element).color);
        const foreground: [number, number, number] = [
          background[0] * (1 - text[3]) + text[0] * text[3],
          background[1] * (1 - text[3]) + text[1] * text[3],
          background[2] * (1 - text[3]) + text[2] * text[3],
        ];
        const luminance = ([r, g, b]: [number, number, number]) => {
          const channel = (value: number) => {
            const c = value / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
        };
        const [a, b] = [luminance(foreground), luminance(background)];
        return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
      });
  const t = (id: string) => `[data-testid="${id}"]`;
  const measured: Record<string, number> = {};
  const record = async (name: string, selector: string) => {
    // Under reduced motion every transition lasts 0.01 ms: a style read in the very frame
    // of a change still returns the previous colours. Let that frame pass.
    await page.waitForTimeout(120);
    measured[name] = await contrastOf(selector);
  };

  await openVoice(page);
  await confirmTrip(page);
  await record("done: search (primary) in the dock", t("done-search"));
  await record("done: scenario toggle (muted)", t("scenario-toggle"));
  await searchProposals(page, { search: "adjustments" });
  await expectStage(page, "destinations");
  await page.waitForTimeout(400);
  await record("journey: heading", t("stage-heading"));
  await record("journey: server message", t("journey-message"));
  await record("journey: simulation label", `${t("journey-notices")} li`);
  await record("destinations: card title", "article h2");
  await record("destinations: why it fits", t("destination-why"));
  await record("destinations: travel time chip (accent)", t("destination-travel"));
  await record("destinations: section title (muted) on card", "article h3");
  await record("destinations: place note (muted) on card", "article section li p:last-child");
  await record("destinations: activity chip, not chosen", '[data-testid^="activity-"] span:last-child');
  await record("destinations: activities hint (muted) on card", t("activities-hint"));
  await record("carousel: position", t("destinations-carousel-position"));
  await record("carousel: keyboard hint (muted)", t("destinations-carousel-keys"));
  await record("dock: secondary action", t("journey-modify"));
  await record("dock: primary action", t("destination-choose"));
  await page.locator('[data-testid^="activity-"]').first().click();
  await record("destinations: activity chip, chosen (accent)", '[data-testid^="activity-"][aria-pressed="true"] span:last-child');
  await page.locator('[data-testid^="activity-"]').first().click();
  await dock(page).getByTestId("destination-choose").click();

  await expectStage(page, "adjustments");
  await page.waitForTimeout(400);
  await record("adjustments: reason", t("adjustments-reason"));
  await record("adjustments: option label", '[data-testid^="adjustment-adj_"] span.text-lg');
  await record("adjustments: unlocks", t("adjustment-unlocks"));
  await record("adjustments: consent sentence", t("adjustments-consent"));
  await page.locator('[data-testid^="adjustment-adj_"]').first().click();
  await record("adjustments: selected option (accent)", '[data-testid^="adjustment-adj_"][data-selected="true"] span.text-lg');
  await dock(page).getByTestId("adjustment-accept").click();

  await expectStage(page, "itineraries");
  await page.waitForTimeout(400);
  await record("itinerary: times", `${t("timeline-outbound")} p`);
  await record("itinerary: line (muted) on card", `${t("timeline-outbound")} p:last-child`);
  await record("itinerary: free time chip (accent)", t("itinerary-free-time"));
  await record("itinerary: check label", `${t("itinerary-checks")} li`);
  await dock(page).getByTestId("itinerary-choose").click();

  await expectStage(page, "review");
  await page.waitForTimeout(400);
  await record("review: nothing booked yet", t("review-not-booked"));
  await record("review: accepted adjustment", `${t("review-accepted")} li`);
  await dock(page).getByTestId("review-send").click();

  await expectStage(page, "booking_pending");
  await record("pending: reference", t("booking-reference"));
  await record("pending: step state (muted)", `${t("pending-step-answer")} span:last-child`);
  await dock(page).getByTestId("booking-check").click();

  await expectStage(page, "booked");
  await page.waitForTimeout(400);
  await record("booked: reference on success surface", t("booking-reference"));
  await dock(page).getByTestId("booked-open-file").click();
  await expectStage(page, "travel_file");
  await page.waitForTimeout(400);
  await record("file: timetable line", `${t("file-schedule")} li`);
  await record("file: section title (muted) on card", `${t("file-schedule")} h2`);
  await dock(page).getByTestId("file-feedback").click();

  await expectStage(page, "feedback");
  await page.waitForTimeout(400);
  await record("feedback: rating, not chosen", `${t("feedback-rating-3")} span:last-child`);
  await record("feedback: hint (muted)", t("feedback-hint"));
  await page.getByTestId("feedback-rating-4").click();
  await record("feedback: rating, chosen (primary)", `${t("feedback-rating-4")} span:last-child`);
  await dock(page).getByTestId("feedback-send").click();
  await expectStage(page, "closed");
  await page.waitForTimeout(400);
  await record("closed: rating", `${t("closed-feedback")} p`);

  test.info().annotations.push({ type: "contrast", description: JSON.stringify(measured) });
  console.log(`contrast ${JSON.stringify(measured, null, 2)}`);
  for (const [pair, ratio] of Object.entries(measured)) {
    expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
  }
});
