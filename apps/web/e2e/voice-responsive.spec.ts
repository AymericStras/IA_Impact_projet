import { expect, test, type Page } from "@playwright/test";
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

/** Phone held sideways: the only case where the talk disc may be 64 px instead of 72. */
function isShortLandscape(viewport: Viewport): boolean {
  return viewport.width > viewport.height && viewport.height <= 430;
}

interface AuditOptions {
  touch: boolean;
  /** The talk button must be present, whole, on top and at least this large (px). */
  talkMinSize: number | null;
  /** Test ids of controls that must be fully visible and reachable without scrolling. */
  pinned: string[];
}

interface AuditResult {
  issues: string[];
  talkSize: number | null;
  stageHeight: number;
}

/**
 * Runs INSIDE the page (`page.evaluate`): must stay self-contained, no imports and no
 * closures over module scope. Returns human-readable problems; none means the layout holds.
 */
function auditVoiceLayout(options: AuditOptions): AuditResult {
  const issues: string[] = [];
  const vw = document.documentElement.clientWidth;
  const vh = window.innerHeight;

  const rectOf = (el: Element) => el.getBoundingClientRect();
  const name = (el: Element) =>
    `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || el.getAttribute("data-testid") || "").trim().replace(/\s+/g, " ").slice(0, 40)}"`;
  const isVisible = (el: Element) => {
    const r = rectOf(el);
    const cs = getComputedStyle(el);
    // Screen-reader-only elements are clipped to 1 px: not part of the visual layout.
    return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  /** Content of the one intentionally horizontally scrollable region (the JSON block). */
  const inScrollRegion = (el: Element) => el.closest("[data-scroll-x]") !== null && !el.matches("[data-scroll-x]");
  const fullyInViewport = (el: Element) => {
    const r = rectOf(el);
    return r.top >= -0.5 && r.left >= -0.5 && r.bottom <= vh + 0.5 && r.right <= vw + 0.5;
  };
  const inViewport = (el: Element) => {
    const r = rectOf(el);
    return r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  };
  /** True when the element is what a tap at its centre would actually hit. */
  const isExposed = (el: Element) => {
    const r = rectOf(el);
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    if (x < 0 || x > vw || y < 0 || y > vh) return false;
    const top = document.elementFromPoint(x, y);
    if (!top) return false;
    if (top === el || el.contains(top)) return true;
    // Disabled buttons let pointer events through: accept them when what lies beneath is their own container.
    return (el as HTMLButtonElement).disabled === true && top.contains(el);
  };

  const shell = document.querySelector('[data-testid="voice-shell"]');
  const main = document.querySelector("main");
  if (!shell || !main) return { issues: ["voice shell or stage area is missing"], talkSize: null, stageHeight: 0 };

  // 1. The page never scrolls: the shell is exactly the viewport and only the stage area scrolls.
  if (document.documentElement.scrollWidth > vw + 1) issues.push(`page scrolls horizontally (${document.documentElement.scrollWidth} > ${vw})`);
  if (document.documentElement.scrollHeight > vh + 1) issues.push(`page scrolls vertically (${document.documentElement.scrollHeight} > ${vh})`);
  const shellRect = rectOf(shell);
  if (Math.abs(shellRect.height - vh) > 1 || Math.abs(shellRect.width - vw) > 1) {
    issues.push(`shell is ${Math.round(shellRect.width)}×${Math.round(shellRect.height)}, viewport ${vw}×${vh}`);
  }
  if (shell.scrollWidth > shell.clientWidth + 1) issues.push(`content is wider than the shell (${shell.scrollWidth} > ${shell.clientWidth})`);
  if (main.scrollWidth > main.clientWidth + 1) issues.push(`stage content is wider than the stage area (${main.scrollWidth} > ${main.clientWidth})`);

  // 2. The stage area keeps a usable size and scrolls when its content is taller.
  const stageHeight = main.clientHeight;
  if (stageHeight < Math.min(160, vh * 0.4)) issues.push(`stage area too small: ${stageHeight} px of ${vh}`);
  if (main.scrollHeight > main.clientHeight + 1 && !["auto", "scroll"].includes(getComputedStyle(main).overflowY)) {
    issues.push("stage content is taller than its area and cannot scroll");
  }

  // 3. Nothing sticks out horizontally and no text is cut by its box.
  const reported = new Set<string>();
  for (const el of document.querySelectorAll("button, a[href], input, textarea, select, p, h1, h2, h3, span, li, label, pre, dt, dd, summary, canvas")) {
    if (!isVisible(el) || inScrollRegion(el)) continue;
    const r = rectOf(el);
    if (r.left < -1 || r.right > vw + 1) {
      const key = `outside:${name(el)}`;
      if (!reported.has(key)) {
        reported.add(key);
        issues.push(`outside the viewport horizontally (${Math.round(r.left)}..${Math.round(r.right)} of ${vw}): ${name(el)}`);
      }
    }
    const cs = getComputedStyle(el);
    const clipsX = cs.overflowX === "hidden" || cs.overflowX === "clip";
    if (clipsX && !el.matches("[data-scroll-x], textarea, input") && el.scrollWidth > el.clientWidth + 1) {
      issues.push(`text clipped horizontally: ${name(el)}`);
    }
  }

  // 4. Buttons show their whole label.
  for (const button of document.querySelectorAll("button, a[href]")) {
    if (!isVisible(button)) continue;
    if (button.scrollWidth > button.clientWidth + 1 || button.scrollHeight > button.clientHeight + 1) {
      issues.push(`button label clipped: ${name(button)}`);
    }
  }

  // 5. The stage heading is in view when the stage is entered. A notice or an error, when
  //    there is one, comes first and may take that place: then it must be in view instead.
  const heading = document.querySelector('[data-testid="stage-heading"]');
  const banners = document.querySelector('[data-testid="voice-banners"]');
  if (!heading || !isVisible(heading)) issues.push("stage heading is missing");
  else if (main.scrollTop === 0 && !inViewport(banners ?? heading)) issues.push("stage heading is not in view");

  // 6. The talk button: whole, on top, large enough.
  let talkSize: number | null = null;
  const talk = document.querySelector('[data-testid="talk-button"]');
  const disc = document.querySelector('[data-testid="talk-disc"]');
  if (options.talkMinSize !== null) {
    if (!talk || !disc || !isVisible(talk)) {
      issues.push("talk button is missing");
    } else {
      const r = rectOf(disc);
      talkSize = Math.min(r.width, r.height);
      if (talkSize < options.talkMinSize - 0.5) issues.push(`talk disc is ${Math.round(r.width)}×${Math.round(r.height)} px (< ${options.talkMinSize})`);
      if (Math.abs(r.width - r.height) > 1) issues.push(`talk disc is not round: ${Math.round(r.width)}×${Math.round(r.height)}`);
      if (!fullyInViewport(talk)) {
        const t = rectOf(talk);
        issues.push(`talk button not fully visible (${Math.round(t.left)},${Math.round(t.top)} → ${Math.round(t.right)},${Math.round(t.bottom)} in ${vw}×${vh})`);
      }
      if (!isExposed(disc)) issues.push("talk button is covered by another element");
      const label = talk.querySelector("span:last-child");
      if (!label || !isVisible(label) || !(label.textContent ?? "").trim()) issues.push("talk button has no visible text label");
    }
  }

  // 7. Pinned controls (dock) are reachable without scrolling.
  for (const id of options.pinned) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el || !isVisible(el)) issues.push(`pinned control is missing: ${id}`);
    else {
      if (!fullyInViewport(el)) issues.push(`pinned control not fully visible: ${id}`);
      if (!isExposed(el)) issues.push(`pinned control is covered: ${id}`);
      if (main.contains(el)) issues.push(`pinned control scrolls with the stage: ${id}`);
    }
  }

  // 8. No two reachable controls overlap. What scrolls inside the stage area is only
  //    visible within it: compare the visible parts.
  const mainRect = rectOf(main);
  const shownRect = (el: Element) => {
    const r = rectOf(el);
    if (!main.contains(el)) return r;
    return {
      left: Math.max(r.left, mainRect.left),
      right: Math.min(r.right, mainRect.right),
      top: Math.max(r.top, mainRect.top),
      bottom: Math.min(r.bottom, mainRect.bottom),
    };
  };
  const controls = [...document.querySelectorAll("button, a[href], input, textarea, select, summary")].filter(
    (el) => isVisible(el) && inViewport(el) && isExposed(el),
  );
  for (let i = 0; i < controls.length; i++) {
    for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i]!;
      const b = controls[j]!;
      if (a.contains(b) || b.contains(a)) continue;
      const ra = shownRect(a);
      const rb = shownRect(b);
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > 2 && overlapY > 2) issues.push(`controls overlap: ${name(a)} and ${name(b)}`);
    }
  }

  // 9. The dock never covers the stage area, text included.
  const dock = document.querySelector('[data-testid="voice-dock"]');
  if (dock) {
    const rd = rectOf(dock);
    const rm = rectOf(main);
    const overlapX = Math.min(rd.right, rm.right) - Math.max(rd.left, rm.left);
    const overlapY = Math.min(rd.bottom, rm.bottom) - Math.max(rd.top, rm.top);
    if (overlapX > 1 && overlapY > 1) issues.push("the dock overlaps the stage area");
    if (!fullyInViewport(dock)) issues.push("the dock is not fully inside the viewport");
    if (dock.scrollHeight > dock.clientHeight + 1 || dock.scrollWidth > dock.clientWidth + 1) issues.push("the dock clips its content");
  }

  // 10. Touch: 44 px targets, 16 px fields (iOS zooms the page below that).
  if (options.touch) {
    for (const el of controls) {
      const r = rectOf(el);
      if (r.width < 43.5 || r.height < 43.5) issues.push(`touch target ${Math.round(r.width)}×${Math.round(r.height)} px (< 44): ${name(el)}`);
    }
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (!isVisible(el)) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size < 16) issues.push(`field text is ${size} px (< 16): ${name(el)}`);
    }
  }

  return { issues, talkSize, stageHeight };
}

async function audit(page: Page, viewport: Viewport, state: string, expectations: { talk: boolean; pinned?: string[] }): Promise<AuditResult> {
  // Let the stage transition, ResizeObservers and the scroll reset settle.
  await page.waitForTimeout(250);
  const result = await page.evaluate(auditVoiceLayout, {
    touch: viewport.touch,
    talkMinSize: expectations.talk ? (isShortLandscape(viewport) ? 64 : 72) : null,
    pinned: expectations.pinned ?? [],
  });
  expect.soft(result.issues, `${viewport.name} — ${state}`).toEqual([]);
  return result;
}

async function applyFontScale(page: Page, viewport: Viewport): Promise<void> {
  if (!viewport.fontScale) return;
  await page.addStyleTag({ content: `html { font-size: ${viewport.fontScale * 100}% !important; }` });
}

/**
 * Every part of the stage can be brought into view by scrolling the stage area: its top,
 * then its bottom (with very large text one row can be taller than the area itself).
 */
async function expectReachable(page: Page, testId: string): Promise<void> {
  const target = page.getByTestId(testId).first();
  await expect(target).toBeAttached();
  const verdict = await target.evaluate((element) => {
    const area = document.querySelector("main")!.getBoundingClientRect();
    element.scrollIntoView({ block: "start" });
    const top = element.getBoundingClientRect();
    const topShown = top.top >= area.top - 1 && top.top < area.bottom && top.left >= area.left - 1 && top.right <= area.right + 1;
    element.scrollIntoView({ block: "end" });
    const bottom = element.getBoundingClientRect();
    const bottomShown = bottom.bottom <= area.bottom + 1 && bottom.bottom > area.top;
    // Whole when it fits; otherwise both ends must be reachable in turn.
    const fits = top.height <= area.height;
    const whole = bottom.top >= area.top - 1 && bottom.bottom <= area.bottom + 1;
    return { topShown, bottomShown, whole: !fits || whole };
  });
  expect(verdict, `${testId} can be scrolled into view`).toEqual({ topShown: true, bottomShown: true, whole: true });
}

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
      await audit(page, viewport, "done", { talk: false });
      await expectReachable(page, "done-modify");
      await expectReachable(page, "done-new");
      await page.getByTestId("done-json-toggle").scrollIntoViewIfNeeded();
      await page.getByTestId("done-json-toggle").click();
      await expect(page.getByTestId("done-json-pre")).toBeVisible();
      await audit(page, viewport, "done + JSON", { talk: false });
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
