import { expect, test, type Page } from "@playwright/test";
import { FIRST_MESSAGE, chooseDestination, expectStage, openDemo, pickScenarios, send, setPanelExpanded } from "./helpers";
import { auditLayout, type AuditResult } from "./layout-audit";

/**
 * Responsive guardrail: programmatic layout assertions over a viewport matrix, in demo
 * mode. No screenshots, so it gives the same verdict on macOS and Linux and runs in CI
 * (`pnpm test:e2e:ci`).
 *
 * If a test fails here, the layout is broken at that size. Fix the layout. Never make it
 * pass by hiding content, removing a control, lowering a threshold or restricting zoom.
 *
 * Emulation only: these are Chromium viewports, not real devices (no real browser chrome,
 * on-screen keyboard, notch or Safari).
 */

interface Viewport {
  name: string;
  width: number;
  height: number;
  touch: boolean;
  /** Root font-size multiplier, simulating the OS / browser text-size setting. */
  fontScale?: number;
}

const MATRIX: Viewport[] = [
  { name: "320x568", width: 320, height: 568, touch: true },
  { name: "360x640", width: 360, height: 640, touch: true },
  { name: "390x844", width: 390, height: 844, touch: true },
  { name: "430x932", width: 430, height: 932, touch: true },
  { name: "568x320", width: 568, height: 320, touch: true },
  { name: "667x375", width: 667, height: 375, touch: true },
  { name: "844x390", width: 844, height: 390, touch: true },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "820x1180", width: 820, height: 1180, touch: true },
  { name: "1024x768", width: 1024, height: 768, touch: true },
  { name: "1280x720", width: 1280, height: 720, touch: false },
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "1920x1080", width: 1920, height: 1080, touch: false },
  { name: "390x844-font200", width: 390, height: 844, touch: true, fontScale: 2 },
  { name: "1280x720-font200", width: 1280, height: 720, touch: false, fontScale: 2 },
];

/** Minimum share of the viewport height left to the conversation (scrollable area). */
function minConversationRatio(viewport: Viewport): number {
  if (viewport.name === "844x390") return 0.55;
  if (viewport.name === "667x375" || viewport.name === "568x320") return 0.45;
  // Doubled text on a phone: the chrome legitimately takes more room, and font metrics differ by
  // a few points between platforms (36.7 % on macOS, 32.1 % on Linux CI for the same build).
  // 30 % keeps a real floor with margin on both instead of a threshold only one platform meets.
  if (viewport.fontScale && viewport.width < 768) return 0.3;
  return 0.35;
}

/**
 * The transcript preview is a transient editing form (title, multi-line field, two
 * buttons) that replaces the composer while the teacher corrects a dictation. It cannot be
 * as small as the composer, so this state has its own, lower floor for the conversation;
 * every other check of the audit applies unchanged.
 */
const TRANSCRIPT_PREVIEW_MIN_RATIO = 0.2;

/** Two columns from 48rem of effective width (768 px at the default text size). */
const TWO_COLUMN_MIN_REM = 48;

async function audit(
  page: Page,
  viewport: Viewport,
  state: string,
  expectComposer = true,
  conversationRatio = minConversationRatio(viewport),
): Promise<AuditResult> {
  // Let ResizeObserver-driven adjustments (placeholder, panel cap, scroll position) settle.
  await page.waitForTimeout(250);
  const result = await page.evaluate(auditLayout, {
    touch: viewport.touch,
    expectComposer,
    minConversationRatio: conversationRatio,
    twoColumnMinRem: TWO_COLUMN_MIN_REM,
  });
  expect.soft(result.issues, `${viewport.name} — ${state}`).toEqual([]);
  return result;
}

/**
 * Emulates the OS / browser text-size setting. Must be called BEFORE the page loads: the
 * setting is there from the first paint for a real user, and the thread decides where to
 * scroll on that first layout (a reply taller than the viewport is aligned to its start
 * and « Revenir en bas » is offered). Injecting the style afterwards left that decision
 * to a race, which made the result depend on the order of the tests.
 */
async function applyFontScale(page: Page, viewport: Viewport): Promise<void> {
  if (!viewport.fontScale) return;
  await page.addInitScript((percent) => {
    // A constructed stylesheet is not a DOM node: parsing and hydration cannot drop it.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`html { font-size: ${percent}% !important; }`);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, viewport.fontScale * 100);
}

for (const viewport of MATRIX) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("layout holds in every state", async ({ page }) => {
      await applyFontScale(page, viewport);
      await openDemo(page);
      if (viewport.fontScale) {
        expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBe(16 * viewport.fontScale);
      }

      const welcome = await audit(page, viewport, "welcome");
      test.info().annotations.push({
        type: "conversation-height",
        description: `${viewport.name}: ${welcome.conversationHeight} px = ${((100 * welcome.conversationHeight) / welcome.viewportHeight).toFixed(1)} %`,
      });

      // Help dialog.
      await page.getByRole("button", { name: "Aide" }).click();
      await expect(page.getByTestId("help-dialog")).toBeVisible();
      // The dialog opens at its beginning, even when it has to scroll.
      await expect(page.getByRole("heading", { name: "Comment décrire votre projet" })).toBeInViewport({ ratio: 1 });
      // The dialog is modal: the composer underneath is intentionally covered.
      await audit(page, viewport, "help dialog", false);
      await page.getByTestId("help-dialog").getByRole("button", { name: "Fermer" }).click();
      await expect(page.getByTestId("help-dialog")).toBeHidden();

      // Recorder open (recording): it replaces the composer.
      await page.getByTestId("microphone-button").click();
      const recorder = page.getByTestId("voice-recorder");
      await expect(recorder).toContainText("Enregistrement en cours");
      await expect(recorder).toBeInViewport({ ratio: 1 });
      await audit(page, viewport, "recorder open", false);
      // Transcript preview (editable text, two buttons): also replaces the composer.
      await recorder.getByRole("button", { name: "Arrêter" }).click();
      const preview = page.getByTestId("transcription-preview");
      await expect(page.getByLabel("Texte transcrit")).toHaveValue(/27 élèves/);
      await audit(page, viewport, "transcript preview", false, TRANSCRIPT_PREVIEW_MIN_RATIO);
      // When the shell scrolls as a whole (very large text), the buttons can be brought into
      // view. Not `ratio: 1`: scrollIntoViewIfNeeded stops within a fraction of a CSS pixel.
      await preview.getByRole("button", { name: "Envoyer" }).scrollIntoViewIfNeeded();
      await expect(preview.getByRole("button", { name: "Envoyer" })).toBeInViewport({ ratio: 0.98 });
      await preview.getByRole("button", { name: "Annuler" }).click();
      await expect(page.getByLabel("Votre message")).toBeVisible();

      // Complete + confirmation card.
      await send(page, FIRST_MESSAGE);
      await send(page, "Avant 17 h.");
      await expect(page.getByTestId("confirmation-card")).toBeVisible();
      await audit(page, viewport, "complete + confirmation card");

      // Inline editors: the station (single line) then the departure (the tallest one).
      await setPanelExpanded(page, true);
      await expect(page.getByTestId("requirements-panel").getByRole("heading", { level: 3 })).toHaveCount(5);
      await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
      await expect(page.getByRole("textbox", { name: "Gare de départ" })).toBeVisible();
      await audit(page, viewport, "station editor open");
      await page.getByRole("button", { name: "Annuler" }).click();
      await page.getByRole("button", { name: "Modifier : Départ" }).click();
      await expect(page.getByLabel("Date de départ")).toBeVisible();
      await audit(page, viewport, "inline editor open");
      // Every editor control can be brought into view (the panel layer scrolls).
      const save = page.getByRole("button", { name: "Enregistrer" });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport({ ratio: 1 });
      await page.getByRole("button", { name: "Annuler" }).click();
      await setPanelExpanded(page, false);

      // Confirmed + JSON.
      await page.getByTestId("confirm-button").click();
      await expect(page.getByTestId("confirmed-json")).toBeVisible();
      // The journey's start card follows the confirmed card: wait for it, it is part of this state.
      await expect(page.getByTestId("journey-start-button")).toBeVisible();
      await audit(page, viewport, "confirmed + JSON");

      // Journey after confirmation (docs/DESIGN.md §14). The adjustments scenario goes
      // through the most views: destinations → adjustments → itineraries → review → travel file.
      const journey = page.getByTestId("journey");
      const header = page.getByTestId("journey-header");
      await pickScenarios(page, { search: "adjustments" });
      await journey.getByLabel("Recherche", { exact: true }).scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey start + test scenario tool");
      await page.getByTestId("journey-start-button").click();

      await expectStage(page, "destinations");
      await expect(page.getByTestId("destination-card")).toHaveCount(4);
      await audit(page, viewport, "journey destinations");
      // Further down: the activity checkboxes and the button of a card.
      await page.getByTestId("destination-card").first().getByRole("button", { name: "Choisir cette destination" }).scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey destinations (activities)");
      await chooseDestination(page, "carcassonne", ["Visite guidée des remparts", "Atelier « vie au Moyen Âge »"]);

      await expectStage(page, "adjustments");
      await expect(page.getByTestId("adjustment-card")).toHaveCount(6);
      await audit(page, viewport, "journey adjustments");
      await page.getByTestId("journey-actions").scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey adjustments (actions)");
      // A view asked for again: the destinations, with the current choice marked.
      await page.getByRole("button", { name: "Choisir une autre destination" }).click();
      await expect(journey).toHaveAttribute("data-view", "destinations");
      await audit(page, viewport, "journey change of destination");
      await page.getByRole("button", { name: "Revenir à l'étape en cours" }).click();
      await page
        .getByTestId("adjustment-card")
        .filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" })
        .getByRole("button", { name: "Accepter cet ajustement" })
        .click();

      await expectStage(page, "itineraries");
      await expect(page.getByTestId("itinerary-card")).toHaveCount(1);
      await audit(page, viewport, "journey itineraries");
      await page.getByTestId("itinerary-card").getByRole("button", { name: "Choisir cet itinéraire" }).click();

      await expectStage(page, "review");
      await audit(page, viewport, "journey review");
      await page.getByTestId("booking-submit").scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey review (actions)");
      await page.getByTestId("booking-submit").click();

      await expectStage(page, "booked");
      const file = page.getByTestId("travel-file");
      await expect(file).toBeVisible();
      await audit(page, viewport, "journey booked");
      await file.scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey travel file");
      await file.getByRole("button", { name: "Imprimer le dossier" }).scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey travel file (end)");
      const form = page.getByTestId("feedback-form");
      await form.getByRole("button", { name: "Envoyer mon avis" }).scrollIntoViewIfNeeded();
      await audit(page, viewport, "journey feedback");
      // Every stage starts from its header: the simulation label is the first thing read.
      await form.getByRole("radio", { name: "5 sur 5" }).check();
      await form.getByRole("button", { name: "Envoyer mon avis" }).click();
      await expectStage(page, "closed");
      await expect(header).toBeVisible();
      await audit(page, viewport, "journey closed");
    });
  });
}

const LONG_CONTENT: Viewport[] = [
  { name: "320x568", width: 320, height: 568, touch: true },
  { name: "768x1024", width: 768, height: 1024, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844-font200", width: 390, height: 844, touch: true, fontScale: 2 },
];

for (const viewport of LONG_CONTENT) {
  test.describe(`long content — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("long values, long messages and the JSON block never widen the page", async ({ page }) => {
      const unbroken = `https://exemple.fr/${"ressources-pedagogiques-".repeat(9)}fin`;
      const longTheme = `${"Architecture médiévale des cités fortifiées d'Occitanie ".repeat(4)}${"x".repeat(72)}`.slice(0, 300);
      const longStation = `Saint-${"Bertrand-de-Comminges-".repeat(4)}`.slice(0, 80);
      expect(longStation).toHaveLength(80);
      const longMessage = "Nous préparons cette sortie depuis longtemps avec les collègues. ".repeat(63).slice(0, 4000);

      await applyFontScale(page, viewport);
      await openDemo(page);
      await send(page, FIRST_MESSAGE);
      await send(page, "Avant 17 h.");

      // A 300-character theme, entered through the panel.
      await setPanelExpanded(page, true);
      await page.getByRole("button", { name: "Modifier : Matière ou thème" }).click();
      await page.getByRole("textbox", { name: "Thème" }).fill(longTheme);
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByTestId("field-teaching_type-value")).toContainText("xxxxxxxx");
      // The longest station the server accepts (80 characters), mostly unbroken.
      await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
      await page.getByRole("textbox", { name: "Gare de départ" }).fill(longStation);
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByTestId("field-departure_station-value")).toHaveText(longStation);
      await audit(page, viewport, "long theme in the panel");
      await setPanelExpanded(page, false);

      // A long unbroken string and a 4000-character message.
      await send(page, unbroken);
      await send(page, longMessage);
      expect(longMessage).toHaveLength(4000);
      await audit(page, viewport, "long messages");

      // The JSON block carries the long theme and scrolls inside itself only.
      await page.getByTestId("confirm-button").click();
      const json = page.getByTestId("confirmed-json");
      await expect(json).toBeVisible();
      await audit(page, viewport, "JSON with long values");
      const pre = json.locator("pre");
      const box = await pre.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      expect(await pre.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    });
  });
}

// WCAG 1.4.10 reflow: 1280 px wide at 400 % zoom is a 320 CSS px wide viewport. Content
// must reflow to one column with vertical scrolling only. (1280×1024 → 320×256, 1280×720 → 320×180.)
for (const size of [
  { width: 320, height: 256 },
  { width: 320, height: 180 },
]) {
  test.describe(`reflow at 400 % zoom — ${size.width}x${size.height}`, () => {
    test.use({ viewport: size, hasTouch: false });

    test("everything stays reachable with vertical scrolling only", async ({ page }) => {
      await openDemo(page);
      const horizontal = () =>
        page.evaluate(() => {
          const shell = document.querySelector('[data-testid="app-shell"]')!;
          return {
            page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            shell: shell.scrollWidth - shell.clientWidth,
          };
        });
      expect(await horizontal()).toEqual({ page: 0, shell: 0 });

      // The conversation is never squeezed to nothing: the shell scrolls as a whole instead.
      const conversation = await page.getByTestId("conversation-area").evaluate((el) => el.clientHeight);
      expect(conversation).toBeGreaterThanOrEqual(120);

      const composer = page.getByLabel("Votre message");
      await composer.scrollIntoViewIfNeeded();
      await expect(composer).toBeInViewport({ ratio: 1 });
      await send(page, FIRST_MESSAGE);
      await expect(page.getByTestId("panel-progress")).toHaveText("4 / 5 informations");
      expect(await horizontal()).toEqual({ page: 0, shell: 0 });

      for (const control of [page.getByRole("button", { name: "Aide" }), page.getByTestId("panel-toggle"), page.getByTestId("send-button")]) {
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport({ ratio: 1 });
      }
    });
  });
}

// Guard for the guard: the audit must actually catch broken layouts. If someone weakens
// `auditLayout`, this test fails.
test.describe("the audit detects broken layouts", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const options = { touch: true, expectComposer: true, minConversationRatio: 0.35, twoColumnMinRem: TWO_COLUMN_MIN_REM };

  test("each kind of breakage is reported", async ({ page }) => {
    await openDemo(page);
    expect((await page.evaluate(auditLayout, options)).issues).toEqual([]);

    const breakWith = async (css: string) => {
      const style = await page.addStyleTag({ content: css });
      await page.waitForTimeout(150);
      const { issues } = await page.evaluate(auditLayout, options);
      await style.evaluate((el) => (el as Element).remove());
      return issues.join("\n");
    };

    // A message wider than the screen. The thread is a scroll container, so the shell does
    // not grow: the breakage shows as sideways scrolling INSIDE the thread and as a bubble
    // (a plain div holding the text) sticking out of the viewport.
    const wideMessage = await breakWith('[data-testid="message-assistant"] > div { min-width: 600px; }');
    expect(wideMessage).toContain("scrolls horizontally (");
    expect(wideMessage).toContain("div[conversation-scroll]");
    expect(wideMessage).toContain("outside the viewport horizontally (16..616 of 390): div");

    // Chrome wider than the screen: nothing absorbs it, the shell itself overflows.
    const wideChrome = await breakWith("header > div { min-width: 600px; }");
    expect(wideChrome).toContain("content is wider than the app shell");

    // The same inside the expanded panel layer (a second inner scroller).
    await page.getByTestId("panel-toggle").click();
    expect(await breakWith('[data-testid="field-departure"] { min-width: 600px; }')).toContain("div[panel-body]");
    await page.getByTestId("panel-toggle").click();

    // A control pushed off-screen.
    expect(await breakWith('[data-testid="send-button"] { position: relative; left: 80px; }')).toContain(
      "outside the viewport horizontally",
    );

    // Touch target too small.
    expect(await breakWith('[data-testid="microphone-button"] { min-width: 0 !important; min-height: 0 !important; width: 24px; height: 24px; }')).toContain(
      "touch target 24×24 px",
    );

    // Two controls on top of each other.
    expect(await breakWith('[data-testid="send-button"] { margin-left: -40px; }')).toContain("controls overlap");

    // A clipped button label.
    expect(await breakWith('[data-testid="panel-toggle"] { width: 60px; overflow: hidden; }')).toContain("button label clipped");

    // The conversation squeezed by oversized chrome.
    expect(await breakWith('[data-testid="composer-region"] { padding-top: 420px; }')).toContain("conversation area too small");

    // The composer pushed out of view or made unusably small.
    expect(await breakWith("#composer-input { min-height: 0 !important; height: 20px !important; padding: 0 !important; }")).toContain(
      "composer too short",
    );
    expect(await breakWith("header { padding-top: 700px; }")).toContain("composer not fully visible");

    // A placeholder that no longer fits.
    expect(await breakWith("#composer-input { flex: 0 0 60px !important; }")).toContain("placeholder does not fit");

    // Wrong column mode for the width.
    expect(await breakWith('[data-testid="panel-region"] { order: 5; }')).toContain("expected a single column");
  });
});
