import { expect, test } from "@playwright/test";
import { MATRIX, applyFontScale, audit, auditVoiceLayout, expectReachable, type AuditOptions, type Viewport } from "./voice-audit";
import { TYPED_FULL, expectStage, openVoice, pressTalk, speak, talkButton } from "./voice-helpers";

/**
 * Responsive guardrail of the voice flow: programmatic layout assertions for every stage
 * over the viewport matrix, in demo mode. No screenshots, so it gives the same verdict on
 * macOS and Linux and can run in CI.
 *
 * If a test fails here, the layout is broken at that size. Fix the layout. Never make it
 * pass by hiding content, removing a control, lowering a threshold or restricting zoom.
 *
 * Emulation only: Chromium viewports, not real devices (no browser chrome, on-screen
 * keyboard, notch or Safari). Safe-area insets cannot be emulated here.
 */

for (const viewport of MATRIX) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("every stage holds", async ({ page }) => {
      await openVoice(page, { fixedLevel: 0.6 });
      await applyFontScale(page, viewport);

      // ask
      const ask = await audit(page, viewport, "ask", { talk: true, pinned: ["talk-button", "write-instead", "see-sheet"] });
      test.info().annotations.push({
        type: "layout",
        description: `${viewport.name}: talk disc ${ask.talkSize} px, stage area ${ask.stageHeight} px`,
      });

      // ask with the text field open
      await page.getByTestId("write-instead").click();
      await expect(page.getByLabel("Votre réponse")).toBeVisible();
      await audit(page, viewport, "ask + text field", { talk: true, pinned: ["talk-button", "see-sheet"] });
      await expectReachable(page, "text-entry-send");
      await page.getByTestId("text-entry").getByRole("button", { name: "Annuler" }).click();

      // The talk button must not move when the screen changes under the finger.
      const before = await page.getByTestId("talk-disc").boundingBox();

      // listen — reduced motion (level meter), pointer held
      await pressTalk(page);
      await expectStage(page, "listen");
      await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
      await expect(page.getByTestId("voice-meter")).toBeVisible();
      await audit(page, viewport, "listen (meter)", { talk: true, pinned: ["talk-button", "listen-cancel"] });
      const during = await page.getByTestId("talk-disc").boundingBox();
      expect.soft(Math.abs((during?.x ?? 0) - (before?.x ?? 0)), `${viewport.name} — talk button moved horizontally`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs((during?.y ?? 0) - (before?.y ?? 0)), `${viewport.name} — talk button moved vertically`).toBeLessThanOrEqual(1);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      await expectStage(page, "ask");
      await page.getByTestId("voice-hint").getByRole("button", { name: "Fermer" }).click();

      // listen — animated shape (canvas, frozen level), then release → think
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await pressTalk(page);
      await expectStage(page, "listen");
      await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
      const canvas = page.getByTestId("voice-canvas");
      await expect(canvas).toBeVisible();
      await audit(page, viewport, "listen (shape)", { talk: true, pinned: ["talk-button", "listen-cancel"] });
      const box = await canvas.boundingBox();
      expect.soft(Math.min(box?.width ?? 0, box?.height ?? 0), `${viewport.name} — voice shape has room`).toBeGreaterThanOrEqual(96);
      await page.waitForTimeout(900);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.mouse.up();

      // think (transcript shown)
      await expectStage(page, "think");
      await expect(page.getByTestId("think-transcript")).toBeVisible();
      await audit(page, viewport, "think", { talk: false });

      // sheet — partial, with the server's question on its row
      await expectStage(page, "sheet");
      await audit(page, viewport, "sheet (partial)", { talk: true, pinned: ["talk-button", "sheet-confirm", "sheet-status"] });
      for (const field of ["participants_count", "departure_station", "departure", "return", "teaching_type"]) {
        await expectReachable(page, `sheet-row-${field}`);
      }
      await expectReachable(page, "transcript-note");
      const onSheet = await page.getByTestId("talk-disc").boundingBox();

      // sheet — typed editor open (date + time + constraint: the tallest)
      await page.getByRole("button", { name: "Modifier : Retour" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Modifier : Retour" }).click();
      await expect(page.getByLabel("Date de retour")).toBeVisible();
      await audit(page, viewport, "sheet (editor open)", { talk: true, pinned: ["talk-button", "sheet-confirm"] });
      const save = page.getByRole("button", { name: "Enregistrer" });
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeInViewport({ ratio: 0.98 });
      await expect(page.getByLabel("Contrainte horaire du retour")).toBeVisible();
      await page.getByTestId("sheet-editor-return").getByRole("button", { name: "Annuler" }).click();

      // sheet → listen keeps the button in place too
      await pressTalk(page);
      await expectStage(page, "listen");
      const fromSheet = await page.getByTestId("talk-disc").boundingBox();
      expect.soft(Math.abs((fromSheet?.x ?? 0) - (onSheet?.x ?? 0)), `${viewport.name} — talk button moved horizontally (sheet)`).toBeLessThanOrEqual(1);
      expect.soft(Math.abs((fromSheet?.y ?? 0) - (onSheet?.y ?? 0)), `${viewport.name} — talk button moved vertically (sheet)`).toBeLessThanOrEqual(1);
      await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
      await page.waitForTimeout(1_500);
      await page.mouse.up();

      // sheet — ready for confirmation
      await expectStage(page, "sheet");
      await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
      await audit(page, viewport, "sheet (ready)", { talk: true, pinned: ["talk-button", "sheet-confirm", "sheet-status"] });

      // done, then with the JSON open
      await page.getByTestId("sheet-confirm").click();
      await expectStage(page, "done");
      // In demo mode the planner is simulated: the search of proposals is in the dock.
      await audit(page, viewport, "done", { talk: false, pinned: ["done-search"] });
      await expectReachable(page, "done-modify");
      await expectReachable(page, "done-new");
      await page.getByTestId("done-json-toggle").scrollIntoViewIfNeeded();
      await page.getByTestId("done-json-toggle").click();
      await expect(page.getByTestId("done-json-pre")).toBeVisible();
      await audit(page, viewport, "done + JSON", { talk: false, pinned: ["done-search"] });
      // The JSON scrolls inside itself only.
      const pre = await page.getByTestId("done-json-pre").boundingBox();
      expect(pre!.x).toBeGreaterThanOrEqual(0);
      expect(pre!.x + pre!.width).toBeLessThanOrEqual(viewport.width + 1);
    });
  });
}

const LONG_CONTENT: Viewport[] = [
  { name: "320x568", width: 320, height: 568, touch: true },
  { name: "844x390", width: 844, height: 390, touch: true },
  { name: "1440x900", width: 1440, height: 900, touch: false },
  { name: "390x844-font200", width: 390, height: 844, touch: true, fontScale: 2 },
];

for (const viewport of LONG_CONTENT) {
  test.describe(`long content — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("long values and long messages never widen the page or hide the dock", async ({ page }) => {
      const unbroken = `https://exemple.fr/${"ressources-pedagogiques-".repeat(9)}fin`;
      const longTheme = `${"Architecture médiévale des cités fortifiées d'Occitanie ".repeat(4)}${"x".repeat(72)}`.slice(0, 300);
      const longStation = "Saint-Rémy-en-Bouzemont-Saint-Genest-et-Isson-Gare-Routière-Centrale-Nord-Extérieur".slice(0, 80);

      await openVoice(page);
      await applyFontScale(page, viewport);

      // A long typed answer, shown on the think screen then in « Vous avez écrit ».
      await page.getByTestId("write-instead").click();
      await page.getByLabel("Votre réponse").fill(`${TYPED_FULL} ${unbroken} ${"Nous préparons cette sortie depuis longtemps. ".repeat(40)}`);
      await audit(page, viewport, "ask + long draft", { talk: true, pinned: ["talk-button", "see-sheet"] });
      await page.getByTestId("text-entry-send").scrollIntoViewIfNeeded();
      await page.getByTestId("text-entry-send").click();
      await expectStage(page, "think");
      await audit(page, viewport, "think + long text", { talk: false });
      await expectStage(page, "sheet");
      await audit(page, viewport, "sheet + long transcript", { talk: true, pinned: ["talk-button", "sheet-confirm", "sheet-status"] });

      // An 80-character station and a 300-character theme, entered through the editors.
      await page.getByRole("button", { name: "Modifier : Gare de départ" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
      await page.getByRole("textbox", { name: "Gare de départ" }).fill(longStation);
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByTestId("sheet-row-departure_station-value")).toHaveText(longStation);
      await page.getByRole("button", { name: "Modifier : Matière ou thème" }).scrollIntoViewIfNeeded();
      await page.getByRole("button", { name: "Modifier : Matière ou thème" }).click();
      await page.getByRole("textbox", { name: "Thème" }).fill(longTheme);
      await page.getByRole("button", { name: "Enregistrer" }).click();
      await expect(page.getByTestId("sheet-row-teaching_type-value")).toContainText("xxxxxxxx");
      await audit(page, viewport, "sheet + long values", { talk: true, pinned: ["talk-button", "sheet-confirm", "sheet-status"] });

      await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
      await page.getByTestId("sheet-confirm").click();
      await expectStage(page, "done");
      await page.getByTestId("done-json-toggle").scrollIntoViewIfNeeded();
      await page.getByTestId("done-json-toggle").click();
      await audit(page, viewport, "done + JSON with long values", { talk: false });
      expect(await page.getByTestId("done-json-pre").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    });
  });
}

// Notices and errors take room at the top of the stage: they must not push the dock away.
for (const viewport of [MATRIX[0]!, MATRIX[4]!, MATRIX[13]!]) {
  test.describe(`notices — ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.touch });

    test("a denied microphone and a discarded recording keep the layout", async ({ page }) => {
      await page.addInitScript(() => {
        const scope = window as unknown as { __denyMic?: boolean };
        const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = (constraints) =>
          scope.__denyMic ? Promise.reject(new DOMException("Permission denied", "NotAllowedError")) : original(constraints);
      });
      await openVoice(page);
      await applyFontScale(page, viewport);

      await pressTalk(page);
      await page.waitForTimeout(380);
      await page.mouse.up();
      await expect(page.getByTestId("voice-hint")).toBeVisible();
      await audit(page, viewport, "ask + hint", { talk: true, pinned: ["talk-button", "write-instead", "see-sheet"] });

      await page.evaluate(() => ((window as unknown as { __denyMic?: boolean }).__denyMic = true));
      await talkButton(page).click();
      await expect(page.getByTestId("voice-mic-notice")).toBeVisible();
      await expect(page.getByLabel("Votre réponse")).toBeVisible();
      await audit(page, viewport, "ask + microphone refused + text field", { talk: true, pinned: ["talk-button", "see-sheet"] });
      await expectReachable(page, "text-entry-send");
    });
  });
}

// Guard for the guard: the audit must actually catch broken layouts. If someone weakens
// `auditVoiceLayout`, this test fails.
test.describe("the audit detects broken layouts", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

  const options: AuditOptions = { touch: true, talkMinSize: 72, pinned: ["talk-button", "sheet-confirm"] };

  test("each kind of breakage is reported", async ({ page }) => {
    await openVoice(page);
    await speak(page);
    await page.waitForTimeout(250);
    expect((await page.evaluate(auditVoiceLayout, options)).issues).toEqual([]);

    const breakWith = async (css: string) => {
      const style = await page.addStyleTag({ content: css });
      await page.waitForTimeout(150);
      const { issues } = await page.evaluate(auditVoiceLayout, options);
      await style.evaluate((el) => (el as Element).remove());
      return issues.join("\n");
    };

    // Content wider than the screen.
    const wide = await breakWith('[data-testid="sheet-row-departure"] { min-width: 600px; }');
    expect(wide).toContain("stage content is wider than the stage area");
    expect(wide).toContain("outside the viewport horizontally");

    // The page itself scrolling.
    expect(await breakWith('[data-testid="voice-shell"] { height: 1200px !important; }')).toContain("page scrolls vertically");

    // Talk button too small, pushed out, or covered.
    expect(await breakWith('[data-testid="talk-disc"] { width: 56px !important; height: 56px !important; }')).toContain("talk disc is 56×56 px");
    expect(await breakWith('[data-testid="voice-dock"] { transform: translateY(70px); }')).toContain("talk button not fully visible");
    expect(await breakWith('main { position: relative; z-index: 5; margin-bottom: -160px; }')).toContain("talk button is covered");

    // A pinned control that scrolled away or is hidden behind something.
    expect(await breakWith('[data-testid="sheet-confirm"] { position: relative; left: 90px; }')).toContain("pinned control not fully visible: sheet-confirm");

    // Two controls on top of each other.
    expect(await breakWith('[data-testid="restart-button"] { margin-left: -20px; }')).toContain("controls overlap");
    // A control hidden behind another one.
    expect(await breakWith('[data-testid="sheet-confirm"] { margin-right: 130px; }')).toContain("pinned control is covered: sheet-confirm");

    // A clipped button label.
    expect(await breakWith('[data-testid="sheet-confirm"] { width: 40px; overflow: hidden; white-space: nowrap; }')).toContain("button label clipped");

    // Touch target too small.
    expect(await breakWith('[data-testid="classic-link"] { min-width: 0 !important; min-height: 0 !important; width: 24px; height: 24px; }')).toContain(
      "touch target 24×24 px",
    );

    // The stage squeezed by oversized chrome.
    expect(await breakWith('[data-testid="voice-shell"] > header { padding-top: 620px !important; }')).toContain("stage area too small");

    // A field that iOS would zoom into.
    await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
    expect(await breakWith("input { font-size: 14px !important; }")).toContain("field text is 14 px");
  });
});
