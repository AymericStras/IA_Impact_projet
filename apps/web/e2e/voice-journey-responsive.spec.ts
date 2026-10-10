import { expect, test, type Page } from "@playwright/test";
import { MATRIX, applyFontScale, audit, auditVoiceLayout, expectReachable, type Viewport } from "./voice-audit";
import { confirmTrip, expectStage, openVoice, searchProposals, type Stage } from "./voice-helpers";

/**
 * Responsive guardrail of the journey stages of the voice flow (after confirmation): the
 * same programmatic audit and the same viewport matrix as `voice-responsive.spec.ts`, for
 * every new stage. No screenshots: same verdict on macOS and Linux.
 *
 * Per stage: the page never scrolls, nothing is clipped or outside the viewport, button
 * labels are whole, controls do not overlap, touch targets are 44 px, the stage heading is
 * in view on entry, and the actions of the stage — the primary one first of all — are in
 * the dock, fully visible and reachable without scrolling. What is longer than the stage
 * area scrolls inside it and every part of it can be brought into view.
 *
 * If a test fails here, the layout is broken at that size. Fix the layout.
 *
 * Emulation only: Chromium viewports, not real devices.
 */

/** Audits a journey stage: no talk button there, and its actions are pinned in the dock. */
async function auditStage(page: Page, viewport: Viewport, stage: Stage, state: string, pinned: string[], reachable: string[] = []): Promise<void> {
  await expectStage(page, stage);
  const more = page.getByTestId("actions-more");
  if (await more.isVisible()) {
    // Narrowest shells: two or more secondary actions are folded behind « Autres choix ».
    // Folded, the stage must keep real room; unfolded, every action must be there and whole.
    const primary = await page.locator('[data-testid="voice-dock"] [data-primary="true"]').getAttribute("data-testid");
    const folded = await audit(page, viewport, `${state} (other choices folded)`, { talk: false, pinned: ["actions-more", primary!] });
    expect.soft(folded.stageHeight, `${viewport.name} — ${state}: room left for the stage`).toBeGreaterThanOrEqual(viewport.height * 0.4);
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await audit(page, viewport, `${state} (other choices shown)`, { talk: false, pinned: [...pinned, "actions-more"] });
    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "false");
  } else {
    await audit(page, viewport, state, { talk: false, pinned });
  }
  for (const testId of reachable) await expectReachable(page, testId);
  // Back to the top, as on entry, for whatever comes next.
  await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
  // The audit looked at the stage it was meant to look at.
  await expectStage(page, stage);
}

/** Clicks a secondary action of the dock, unfolding « Autres choix » first where it is folded. */
async function choose(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId);
  if (!(await target.isVisible())) await page.getByTestId("actions-more").click();
  await target.click();
}

for (const viewport of MATRIX) {
  test.describe(`journey — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("search, destinations, adjustments, itineraries, review, booking, travel file, feedback, closed", async ({ page }) => {
      await openVoice(page);
      await applyFontScale(page, viewport);
      await confirmTrip(page);

      // done: the search in the dock, the scenarios open.
      await page.getByTestId("scenario-toggle").scrollIntoViewIfNeeded();
      await page.getByTestId("scenario-toggle").click();
      await page.getByTestId("scenario-search").selectOption("adjustments");
      await expect(page.getByTestId("done-search")).toBeEnabled();
      await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
      await auditStage(page, viewport, "done", "done + scenarios", ["done-search"], ["scenario-search", "scenario-booking", "done-modify", "done-new"]);
      await page.getByTestId("done-search").click();

      // destinations: first card, then the next one, with an activity ticked.
      await auditStage(page, viewport, "destinations", "destinations", ["destination-choose", "journey-modify"], [
        "journey-notices",
        "destinations-carousel-previous",
        "destinations-carousel-next",
        "destination-why",
        "activities-hint",
      ]);
      await page.getByTestId("destinations-carousel-next").click();
      await expect(page.getByTestId("destinations-carousel-position")).toHaveText(/^2 sur/);
      const chip = page.locator('[data-testid^="activity-"]').first();
      await chip.scrollIntoViewIfNeeded();
      await chip.click();
      await expect(chip).toHaveAttribute("aria-pressed", "true");
      await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
      await auditStage(page, viewport, "destinations", "destinations (second card, activity chosen)", ["destination-choose", "journey-modify"]);
      await page.getByTestId("destinations-carousel-previous").click();
      await page.getByTestId("destination-choose").click();

      // adjustments: every option reachable, one selected.
      await auditStage(page, viewport, "adjustments", "adjustments", ["adjustment-accept", "journey-destinations", "journey-modify"], [
        "journey-notices",
        "adjustments-reason",
        "adjustments-consent",
      ]);
      const options = page.locator('[data-testid^="adjustment-adj_"]');
      const count = await options.count();
      expect(count).toBeGreaterThan(1);
      for (let index = 0; index < count; index += 1) {
        await expectReachable(page, (await options.nth(index).getAttribute("data-testid"))!);
      }
      const later = options.filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" });
      await later.scrollIntoViewIfNeeded();
      await later.click();
      await expect(later).toHaveAttribute("data-selected", "true");
      await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
      await auditStage(page, viewport, "adjustments", "adjustments (one selected)", ["adjustment-accept", "journey-destinations", "journey-modify"]);
      await page.getByTestId("adjustment-accept").click();

      // itineraries: the timeline of the day.
      await auditStage(page, viewport, "itineraries", "itineraries", ["itinerary-choose", "journey-destinations", "journey-modify"], [
        "journey-notices",
        "timeline-outbound",
        "timeline-return",
        "itinerary-free-time",
        "itinerary-checks",
      ]);
      await page.getByTestId("itinerary-choose").click();

      // review: four actions in the dock.
      await auditStage(page, viewport, "review", "review", ["review-send", "review-other-itinerary", "journey-destinations", "journey-modify"], [
        "journey-notices",
        "review-not-booked",
        "review-itinerary",
        "review-accepted",
      ]);
      await page.getByTestId("review-send").click();

      // booking_pending (checked by itself after about 2.5 s: audited before that).
      await auditStage(page, viewport, "booking_pending", "booking pending", ["booking-check"], ["journey-notices", "booking-reference"]);
      await page.getByTestId("booking-check").click();

      // booked
      await auditStage(page, viewport, "booked", "booked", ["booked-open-file", "booked-feedback"], ["journey-notices", "booking-reference"]);
      await page.getByTestId("booked-open-file").click();

      // travel file
      await auditStage(page, viewport, "travel_file", "travel file", ["file-print", "file-back", "file-feedback"], [
        "journey-notices",
        "file-reference",
        "file-schedule",
        "file-places",
        "file-safety",
        "file-contacts",
      ]);
      await choose(page, "file-feedback");

      // feedback: nothing chosen, then a rating and a comment.
      await auditStage(page, viewport, "feedback", "feedback", ["feedback-send", "feedback-back"], [
        "feedback-rating-1",
        "feedback-rating-5",
        "feedback-comment",
      ]);
      await page.getByTestId("feedback-rating-4").scrollIntoViewIfNeeded();
      await page.getByTestId("feedback-rating-4").click();
      await page.getByTestId("feedback-comment").fill("Très clair. ".repeat(12));
      await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
      await auditStage(page, viewport, "feedback", "feedback (rated, with a comment)", ["feedback-send", "feedback-back"]);
      await page.getByTestId("feedback-send").click();

      // closed
      await auditStage(page, viewport, "closed", "closed", ["closed-new", "closed-open-file"], ["journey-notices", "closed-feedback"]);
    });

    test("no result, the restart notice, a technical error, a refused booking, the way back", async ({ page }) => {
      await openVoice(page);
      await applyFontScale(page, viewport);
      await confirmTrip(page);

      // no_match
      await searchProposals(page, { search: "no_match" });
      await auditStage(page, viewport, "no_match", "no match", ["journey-modify"], ["journey-notices", "journey-message"]);

      // An edit drops the journey: the sheet with the notice, talk button and confirmation in the dock.
      await choose(page, "journey-modify");
      await expectStage(page, "sheet");
      await page.getByRole("button", { name: "Modifier : Participants" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Modifier : Participants" }).click();
      await page.getByLabel("Nombre total de participants").fill("28");
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByTestId("search-restart-notice")).toBeVisible();
      await audit(page, viewport, "sheet + restart notice", { talk: true, pinned: ["talk-button", "sheet-confirm", "sheet-status"] });
      await page.getByTestId("sheet-confirm").click();
      await expectStage(page, "done");

      // A technical error on done.
      await searchProposals(page, { search: "error" });
      await expect(page.getByTestId("journey-error")).toBeVisible();
      await page.evaluate(() => document.querySelector("main")!.scrollTo({ top: 0 }));
      await auditStage(page, viewport, "done", "done + technical error", ["done-search"], ["journey-error", "journey-error-action"]);

      // A refused booking with its alternatives.
      await searchProposals(page, { search: "auto", booking: "refused" });
      await expectStage(page, "destinations");
      await page.getByTestId("destination-choose").click();
      await expectStage(page, "itineraries");
      await page.getByTestId("itinerary-choose").click();
      await expectStage(page, "review");
      await page.getByTestId("review-send").click();
      await expectStage(page, "booking_pending");
      await page.getByTestId("booking-check").click();
      await auditStage(page, viewport, "booking_refused", "booking refused", ["itinerary-choose", "journey-destinations", "journey-modify"], [
        "journey-notices",
        "refused-message",
        "timeline-outbound",
        "itinerary-checks",
      ]);

      // The destinations looked at again: three actions in the dock.
      await choose(page, "journey-destinations");
      await auditStage(page, viewport, "destinations", "destinations (looked at again)", ["destination-choose", "journey-modify", "journey-back"]);

      // The sheet of a confirmed request, opened from the journey.
      await choose(page, "journey-modify");
      await expectStage(page, "sheet");
      await audit(page, viewport, "sheet (from the journey)", { talk: true, pinned: ["talk-button", "sheet-confirm", "back-to-confirmation"] });
    });
  });
}

// Guard for the guard, on a journey stage: the shared audit must catch a broken dock there too.
test.describe("the audit detects broken journey layouts", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  test("each kind of breakage is reported", async ({ page }) => {
    await openVoice(page);
    await confirmTrip(page);
    await searchProposals(page);
    await expectStage(page, "destinations");
    const options = { touch: true, talkMinSize: null, pinned: ["destination-choose", "journey-modify"] };
    await page.waitForTimeout(300);
    expect((await page.evaluate(auditVoiceLayout, options)).issues).toEqual([]);

    const breakWith = async (css: string) => {
      const style = await page.addStyleTag({ content: css });
      await page.waitForTimeout(150);
      const { issues } = await page.evaluate(auditVoiceLayout, options);
      await style.evaluate((el) => (el as Element).remove());
      return issues.join("\n");
    };

    // The primary action pushed out of the screen, or scrolling away with the stage.
    expect(await breakWith('[data-testid="destination-choose"] { position: relative; left: 140px; }')).toContain("pinned control not fully visible: destination-choose");
    expect(await breakWith('[data-testid="voice-dock"] { transform: translateY(80px); }')).toContain("pinned control not fully visible");
    await page.evaluate(() => document.querySelector("main")!.append(document.querySelector('[data-testid="stage-actions"]')!));
    expect((await page.evaluate(auditVoiceLayout, options)).issues.join("\n")).toContain("pinned control scrolls with the stage: destination-choose");
    await page.evaluate(() => document.querySelector('[data-testid="voice-dock"] > div')!.append(document.querySelector('[data-testid="stage-actions"]')!));

    // A card wider than the screen; a clipped label; a small carousel button; the dock eating the stage.
    const wide = await breakWith('[data-testid^="destination-"] { min-width: 520px; }');
    expect(wide).toContain("stage content is wider than the stage area");
    expect(await breakWith('[data-testid="destination-choose"] { height: 44px; overflow: hidden; white-space: nowrap; width: 90px; flex: none !important; }')).toContain("button label clipped");
    expect(await breakWith('[data-testid="destinations-carousel-next"] { width: 30px !important; height: 30px !important; }')).toContain("touch target 30×30 px");
    expect(await breakWith('[data-testid="voice-dock"] { padding-top: 560px !important; }')).toContain("stage area too small");
    expect(await breakWith('[data-testid="journey-modify"] { margin-bottom: -30px; }')).toContain("pinned control is covered: journey-modify");
  });
});
