import { expect, test, type Page } from "@playwright/test";
import {
  TRANSCRIPT_FULL,
  TRANSCRIPT_RETURN,
  TYPED_FULL,
  expectStage,
  failNextMessage,
  holdToTalk,
  openVoice,
  pressTalk,
  speak,
  tapTalk,
  talkButton,
} from "./voice-helpers";

/**
 * Functional journeys of the voice flow (`/vocal`), in demo mode with Chromium's fake
 * microphone: the recording is real (getUserMedia → MediaRecorder → upload), the
 * transcription and the extraction are the scripted mock.
 *
 * Emulation only: desktop Chromium, a synthetic beep as the voice, a mouse as the finger.
 */

const row = (page: Page, field: string) => page.getByTestId(`sheet-row-${field}`);
const value = (page: Page, field: string) => page.getByTestId(`sheet-row-${field}-value`);

/** User messages the demo "server" has stored — what was really sent. */
async function storedUserMessages(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => name.includes("demo.conversations"));
    if (!key) return [];
    const store = JSON.parse(window.localStorage.getItem(key) ?? "{}") as Record<
      string,
      { response: { messages: Array<{ role: string; content: string }> } }
    >;
    return Object.values(store).flatMap((conversation) =>
      conversation.response.messages.filter((message) => message.role === "user").map((message) => message.content),
    );
  });
}

test("voice path: ask → hold → release → think → sheet → complete by voice → confirm → done → JSON", async ({ page }) => {
  await openVoice(page);

  // ask: one short question (not the chat welcome paragraph), five empty dots, a real button with a text label.
  await expect(page.getByTestId("stage-heading")).toHaveText("Décrivez votre sortie.");
  await expect(page.getByTestId("stage-heading")).toBeFocused();
  await expect(page.getByTestId("progress-dots")).toHaveAttribute("data-known", "0");
  await expect(page.getByTestId("progress-dots").locator("span")).toHaveCount(5);
  await expect(talkButton(page)).toHaveAccessibleName("Parler");
  await expect(talkButton(page)).toHaveAttribute("aria-pressed", "false");

  // listen: the screen turns to the accent surface; state is given in words and a timer.
  await pressTalk(page);
  await expectStage(page, "listen");
  await expect(page.getByTestId("voice-shell")).toHaveAttribute("data-tone", "accent");
  await expect(page.getByTestId("stage-heading")).toHaveText("Je vous écoute");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour terminer");
  await expect(talkButton(page)).toHaveAttribute("aria-pressed", "true");
  await expect(talkButton(page)).toHaveAccessibleName("Terminer");
  await expect(page.getByTestId("voice-timer")).toHaveText("0:01");
  await page.waitForTimeout(600);
  await page.mouse.up();

  // think: two real steps, and the transcript before the sheet.
  await expectStage(page, "think");
  await expect(page.getByTestId("think-step-transcribing")).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("think-step-understanding")).toHaveAttribute("data-state", "waiting");
  await expect(page.getByTestId("think-transcript")).toContainText(TRANSCRIPT_FULL);
  await expect(page.getByTestId("think-step-transcribing")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("think-step-understanding")).toHaveAttribute("data-state", "active");

  // sheet: five rows from the server state; the missing one carries the server's question.
  await expectStage(page, "sheet");
  await expect(page.getByTestId("stage-heading")).toBeFocused();
  await expect(page.getByTestId("sheet-rows").locator("> li")).toHaveCount(5);
  await expect(value(page, "participants_count")).toHaveText("30 participants");
  await expect(value(page, "departure_station")).toHaveText("Toulouse Matabiau");
  await expect(value(page, "departure")).toHaveText("jeudi 12 novembre, vers 8 h 00");
  await expect(value(page, "teaching_type")).toHaveText("Histoire — Moyen Âge");
  await expect(row(page, "return")).toHaveAttribute("data-state", "missing");
  await expect(row(page, "return")).toHaveAttribute("data-asked", "true");
  await expect(page.getByTestId("sheet-row-return-question")).toContainText("À quelle heure souhaitez-vous être de retour le jeudi 12 novembre ?");
  await expect(page.locator('[data-testid^="sheet-row-"][data-asked="true"]')).toHaveCount(1);
  await expect(page.getByTestId("progress-dots")).toHaveAttribute("data-known", "4");
  await expect(page.getByTestId("sheet-status")).toHaveText("Il manque : Retour");
  await expect(page.getByTestId("sheet-confirm")).toBeDisabled();
  await expect(page.getByTestId("transcript-text")).toContainText(TRANSCRIPT_FULL);

  // Complete the missing field by voice, from the sheet.
  await holdToTalk(page);
  await expectStage(page, "think");
  await expect(page.getByTestId("think-transcript")).toContainText(TRANSCRIPT_RETURN);
  await expectStage(page, "sheet");
  await expect(value(page, "return")).toHaveText("jeudi 12 novembre, au plus tard à 17 h 00");
  await expect(page.locator('[data-testid^="sheet-row-"][data-state="known"]')).toHaveCount(5);
  await expect(page.locator('[data-testid^="sheet-row-"][data-asked="true"]')).toHaveCount(0);
  await expect(page.getByTestId("sheet-message")).toContainText("J'ai bien compris votre projet");
  await expect(page.getByTestId("sheet-status")).toHaveText("Tout est renseigné. Vérifiez, puis confirmez.");

  // Nothing is confirmed until the explicit action.
  await expectStage(page, "sheet");
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
  await page.getByTestId("sheet-confirm").click();

  // done: success, the five values, the payload on demand.
  await expectStage(page, "done");
  await expect(page.getByTestId("stage-heading")).toHaveText("Sortie confirmée");
  await expect(page.getByTestId("stage-heading")).toBeFocused();
  await expect(page.getByTestId("done-summary").locator("dd")).toHaveCount(5);
  await expect(page.getByTestId("done-value-departure_station")).toContainText("Toulouse Matabiau");
  await expect(page.getByTestId("done-json-pre")).toHaveCount(0);
  await page.getByTestId("done-json-toggle").click();
  const json = JSON.parse((await page.getByTestId("done-json-pre").textContent()) ?? "{}");
  expect(json).toMatchObject({
    schema_version: "1.1",
    status: "confirmed",
    timezone: "Europe/Paris",
    requirements: {
      participants_count: 30,
      departure_station: "Toulouse Matabiau",
      departure: { date: "2026-11-12", time: "08:00", constraint: "approximate" },
      return: { date: "2026-11-12", time: "17:00", constraint: "latest" },
      teaching_type: { subject: "Histoire", theme: "Moyen Âge" },
    },
  });

  // Two spoken turns, each sent once, with source "audio".
  expect(await storedUserMessages(page)).toHaveLength(2);
});

test("text-only path, by keyboard alone: write → think → sheet → confirm → done", async ({ page }) => {
  await openVoice(page);

  await page.getByTestId("write-instead").focus();
  await page.keyboard.press("Enter");
  const field = page.getByLabel("Votre réponse");
  await expect(field).toBeFocused();
  await page.keyboard.type("Bonjour,");
  // Shift+Enter breaks the line and sends nothing.
  await page.keyboard.press("Shift+Enter");
  await expectStage(page, "ask");
  await field.fill(TYPED_FULL);
  await page.keyboard.press("Enter");

  // A typed answer has nothing to transcribe: one step only.
  await expectStage(page, "think");
  await expect(page.getByTestId("think-step-transcribing")).toHaveCount(0);
  await expect(page.getByTestId("think-step-understanding")).toHaveAttribute("data-state", "active");
  await expect(page.getByTestId("think-transcript")).toContainText("Vous avez écrit");

  await expectStage(page, "sheet");
  await expect(page.locator('[data-testid^="sheet-row-"][data-state="known"]')).toHaveCount(5);
  await expect(value(page, "departure_station")).toHaveText("Toulouse Matabiau");

  // Edit a field with the keyboard, then confirm with the keyboard.
  await page.getByRole("button", { name: "Modifier : Gare de départ" }).focus();
  await page.keyboard.press("Enter");
  const station = page.getByRole("textbox", { name: "Gare de départ" });
  await expect(station).toBeFocused();
  await station.fill("Montpellier Saint-Roch");
  await page.keyboard.press("Enter");
  await expect(value(page, "departure_station")).toHaveText("Montpellier Saint-Roch");
  await expect(page.getByRole("button", { name: "Modifier : Gare de départ" })).toBeFocused();

  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
  await page.getByTestId("sheet-confirm").focus();
  await page.keyboard.press("Enter");
  await expectStage(page, "done");
  await expect(page.getByTestId("done-value-departure_station")).toContainText("Montpellier Saint-Roch");

  await page.getByTestId("done-new").focus();
  await page.keyboard.press("Enter");
  await expectStage(page, "ask");
  await expect(page.getByTestId("progress-dots")).toHaveAttribute("data-known", "0");
});

test("keyboard voice: Space starts, Space finishes, Escape cancels", async ({ page }) => {
  await openVoice(page);

  await talkButton(page).focus();
  await page.keyboard.press("Space");
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-hint")).toHaveText("Touchez à nouveau pour terminer");
  // The control in use keeps the focus while listening.
  await expect(talkButton(page)).toBeFocused();
  await page.keyboard.press("Escape");
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-hint")).toHaveText("Enregistrement annulé. Rien n'a été envoyé.");
  await expect(talkButton(page)).toBeFocused();
  expect(await storedUserMessages(page)).toHaveLength(0);

  await page.keyboard.press("Space");
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await page.waitForTimeout(1_500);
  await page.keyboard.press("Space");
  await expectStage(page, "think");
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");
});

test("cancel: sliding away, the Annuler button, and nothing is ever uploaded", async ({ page }) => {
  await openVoice(page);

  // Slide out of the cancel radius: the screen says what releasing will do.
  const origin = await pressTalk(page);
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await page.waitForTimeout(700);
  await page.mouse.move(origin.x, origin.y - 220, { steps: 6 });
  await expect(page.getByTestId("listen-status")).toHaveText("Relâchez pour annuler : rien ne sera envoyé");
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour annuler");
  await expect(talkButton(page)).toHaveAccessibleName("Annuler");
  // Coming back disarms it.
  await page.mouse.move(origin.x, origin.y, { steps: 6 });
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour terminer");
  await page.mouse.move(origin.x, origin.y - 220, { steps: 6 });
  await page.mouse.up();
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-hint")).toHaveText("Enregistrement annulé. Rien n'a été envoyé.");

  // Tap to toggle, then the visible cancel button.
  await tapTalk(page);
  await expectStage(page, "listen");
  await page.waitForTimeout(900);
  await page.getByTestId("listen-cancel").click();
  await expectStage(page, "ask");

  await expect(page.getByTestId("progress-dots")).toHaveAttribute("data-known", "0");
  expect(await storedUserMessages(page)).toHaveLength(0);
});

test("a hidden tab interrupts the recording with a notice", async ({ page }) => {
  await openVoice(page);
  await tapTalk(page);
  await expectStage(page, "listen");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-hint")).toHaveText("L'enregistrement a été interrompu. Rien n'a été envoyé.");
});

test("too-short press is discarded with a hint; a quick tap toggles instead", async ({ page }) => {
  await openVoice(page);

  // Longer than the hold threshold (250 ms), shorter than a usable recording (~0.6 s).
  await pressTalk(page);
  await page.waitForTimeout(380);
  await page.mouse.up();
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-hint")).toHaveText("Maintenez le bouton pendant que vous parlez.");
  expect(await storedUserMessages(page)).toHaveLength(0);

  // A tap (shorter than the threshold) starts a recording that keeps running.
  await tapTalk(page);
  await expectStage(page, "listen");
  await expect(page.getByTestId("voice-hint")).toHaveCount(0);
  await expect(page.getByTestId("listen-hint")).toHaveText("Touchez à nouveau pour terminer");
  await page.waitForTimeout(1_500);
  await expectStage(page, "listen");
  await talkButton(page).click();
  await expectStage(page, "sheet");
});

test("touch: a finger holds to talk, slides away to cancel, and the page neither scrolls nor selects", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    permissions: ["microphone"],
    reducedMotion: "reduce",
    baseURL: "http://localhost:3200",
  });
  const page = await context.newPage();
  await openVoice(page);
  // Real touch points (pointerType "touch"), which Playwright's own API cannot hold down.
  const client = await context.newCDPSession(page);
  const box = await page.getByTestId("talk-disc").boundingBox();
  const x = Math.round(box!.x + box!.width / 2);
  const y = Math.round(box!.y + box!.height / 2);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: Array<{ x: number; y: number }>) =>
    client.send("Input.dispatchTouchEvent", { type, touchPoints: points });

  // Hold, speak, release.
  await touch("touchStart", [{ x, y }]);
  await expectStage(page, "listen");
  await expect(talkButton(page)).toHaveAttribute("data-mode", "hold");
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour terminer");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await page.waitForTimeout(1_500);
  // A long press selected nothing and the stage is still listening (no context menu took over).
  expect(await page.evaluate(() => window.getSelection()?.toString() ?? "")).toBe("");
  await expectStage(page, "listen");
  await touch("touchEnd", []);
  await expectStage(page, "think");
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");

  // From the sheet: hold, drag the finger far up. With `touch-action: none` the browser
  // does not turn the drag into a scroll (which would fire pointercancel), so this is a
  // cancel by the teacher, not an interruption.
  const sheetBox = await page.getByTestId("talk-disc").boundingBox();
  const sx = Math.round(sheetBox!.x + sheetBox!.width / 2);
  const sy = Math.round(sheetBox!.y + sheetBox!.height / 2);
  await touch("touchStart", [{ x: sx, y: sy }]);
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await page.waitForTimeout(700);
  for (const dy of [60, 120, 180, 240]) await touch("touchMove", [{ x: sx, y: sy - dy }]);
  await expect(page.getByTestId("listen-hint")).toHaveText("Relâchez pour annuler");
  await touch("touchEnd", []);
  await expectStage(page, "sheet");
  await expect(page.getByTestId("voice-hint")).toHaveText("Enregistrement annulé. Rien n'a été envoyé.");
  expect(await storedUserMessages(page)).toHaveLength(1);
  await context.close();
});

test("permission denied: explanation, text field offered, the flow continues in writing", async ({ page }) => {
  // The browser's refusal, made deterministic: getUserMedia rejects as Chromium does.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("Permission denied", "NotAllowedError"));
  });
  await openVoice(page);

  await talkButton(page).click();
  await expectStage(page, "ask");
  await expect(page.getByTestId("voice-mic-notice")).toContainText("L'accès au micro a été refusé");
  await expect(page.getByTestId("voice-mic-notice")).toContainText("autorisez le micro");
  // The button stays (the teacher may allow the microphone); text is ready.
  await expect(talkButton(page)).toBeVisible();
  const field = page.getByLabel("Votre réponse");
  await expect(field).toBeVisible();
  await field.fill("Nous serons 30 personnes au départ de la gare de Toulouse Matabiau.");
  await page.getByTestId("text-entry-send").click();
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");
  await expect(value(page, "departure_station")).toHaveText("Toulouse Matabiau");
});

test("error then retry: same request, no second recording", async ({ page }) => {
  await openVoice(page);
  await failNextMessage(page);

  await holdToTalk(page);
  await expectStage(page, "think");
  const failure = page.getByTestId("think-failure");
  await expect(failure).toContainText("Désolé, je n'ai pas pu traiter votre message.");
  await expect(failure).toContainText("Votre réponse est conservée : inutile de la répéter.");
  await expect(page.getByTestId("think-step-transcribing")).toHaveAttribute("data-state", "done");
  await expect(page.getByTestId("think-step-understanding")).toHaveAttribute("data-state", "failed");
  // What was heard stays on screen, and nothing was applied.
  await expect(page.getByTestId("think-transcript")).toContainText(TRANSCRIPT_FULL);
  expect(await storedUserMessages(page)).toHaveLength(0);

  // From here on the microphone must not be opened again.
  await page.evaluate(() => {
    const scope = window as unknown as { __micCalls: number };
    scope.__micCalls = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (constraints) => {
      scope.__micCalls += 1;
      return original(constraints);
    };
  });

  await page.getByTestId("think-retry").click();
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");
  expect(await page.evaluate(() => (window as unknown as { __micCalls: number }).__micCalls)).toBe(0);
  // Applied exactly once.
  const sent = await storedUserMessages(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain(TRANSCRIPT_FULL);
});

test("error then cancel: the text comes back editable instead of being lost", async ({ page }) => {
  await openVoice(page);
  await failNextMessage(page);
  await holdToTalk(page);
  await expect(page.getByTestId("think-failure")).toBeVisible();
  await page.getByTestId("think-failure").getByRole("button", { name: "Annuler" }).click();
  await expectStage(page, "ask");
  await expect(page.getByLabel("Votre réponse")).toHaveValue(new RegExp(TRANSCRIPT_FULL));
  expect(await storedUserMessages(page)).toHaveLength(0);
});

test("correct the transcript and send it again as text", async ({ page }) => {
  await openVoice(page);
  await speak(page);

  await page.getByRole("button", { name: "Corriger le texte" }).click();
  const editor = page.getByLabel("Texte à envoyer");
  await expect(editor).toBeFocused();
  await expect(editor).toHaveValue(new RegExp(TRANSCRIPT_FULL));
  await editor.fill("Nous rentrerons avant 17 h.");
  await page.getByTestId("transcript-editor-send").click();
  await expectStage(page, "think");
  await expectStage(page, "sheet");
  await expect(value(page, "return")).toHaveText("jeudi 12 novembre, au plus tard à 17 h 00");
  await expect(page.getByTestId("transcript-note")).toContainText("Vous avez écrit");
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
});

test("restore: the stage comes from the server state; a confirmed trip can be reopened", async ({ page }) => {
  await openVoice(page);
  await speak(page);

  await page.reload();
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");
  // After a reload the question is still on its row (taken from the history).
  await expect(page.getByTestId("sheet-row-return-question")).toContainText("À quelle heure souhaitez-vous être de retour");

  // Touch path: complete the missing field with its typed editor.
  await page.getByRole("button", { name: "Modifier : Retour" }).click();
  await page.getByLabel("Date de retour").fill("2026-11-12");
  await page.getByLabel("Heure de retour").fill("17:00");
  await page.getByLabel("Contrainte horaire du retour").selectOption("latest");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");

  await page.reload();
  await expectStage(page, "done");
  await expect(page.getByTestId("done-value-return")).toContainText("au plus tard à 17 h 00");

  // « Modifier »: back to the sheet; an edit reopens the trip and asks to confirm again.
  await page.getByTestId("done-modify").click();
  await expectStage(page, "sheet");
  await expect(page.getByTestId("sheet-status")).toHaveText("Cette sortie est déjà confirmée.");
  await expect(page.getByTestId("sheet-confirm")).toBeDisabled();
  await page.getByTestId("back-to-confirmation").click();
  await expectStage(page, "done");
  await page.getByTestId("done-modify").click();
  await page.getByRole("button", { name: "Modifier : Participants" }).click();
  await page.getByLabel("Nombre total de participants").fill("32");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(value(page, "participants_count")).toHaveText("32 participants");
  await expectStage(page, "sheet");
  await expect(page.getByTestId("sheet-confirm")).toBeEnabled();
  await page.getByTestId("sheet-confirm").click();
  await expectStage(page, "done");
  await expect(page.getByTestId("done-value-participants_count")).toContainText("32 participants");
});

test("the recording stops by itself at the server's limit, after a visible countdown", async ({ page }) => {
  // A controllable clock: timers and performance.now() follow it; the microphone is real.
  await page.clock.install({ time: new Date("2026-10-10T10:00:00+02:00") });
  await page.goto("/vocal");
  await expectStage(page, "ask");

  await tapTalk(page);
  await expectStage(page, "listen");
  await expect(page.getByTestId("listen-status")).toHaveText("Enregistrement en cours");
  await expect(page.getByTestId("listen-countdown")).toHaveCount(0);
  // Real time, so the fake microphone produces audio to upload.
  await page.waitForTimeout(1_200);

  // The demo limit is 120 s: jump to its last ten seconds.
  await page.clock.fastForward(112_000);
  await expect(page.getByTestId("listen-countdown")).toContainText("Fin de l'enregistrement dans");
  await expectStage(page, "listen");

  await page.clock.fastForward(9_000);
  await expectStage(page, "think");
  await expectStage(page, "sheet");
  await expect(value(page, "participants_count")).toHaveText("30 participants");
});

test("the voice visual: a canvas sized to its box at the device pixel ratio, a meter under reduced motion", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    permissions: ["microphone"],
    reducedMotion: "no-preference",
    baseURL: "http://localhost:3200",
  });
  const page = await context.newPage();
  await openVoice(page);

  await tapTalk(page);
  await expectStage(page, "listen");
  const canvas = page.getByTestId("voice-canvas");
  await expect(canvas).toBeVisible();
  await expect(page.getByTestId("voice-meter")).toHaveCount(0);

  const measure = () =>
    canvas.evaluate((element) => {
      const node = element as HTMLCanvasElement;
      const rect = node.getBoundingClientRect();
      return { width: node.width, height: node.height, cssWidth: rect.width, cssHeight: rect.height, ratio: window.devicePixelRatio };
    });
  const first = await measure();
  expect(first.ratio).toBe(3);
  expect(first.width).toBe(Math.round(first.cssWidth * 3));
  expect(first.height).toBe(Math.round(first.cssHeight * 3));

  // The shape is really drawn, and it moves with the (fake) voice: two frames differ.
  const frame = () =>
    canvas.evaluate((element) => {
      const node = element as HTMLCanvasElement;
      const data = node.getContext("2d")!.getImageData(0, 0, node.width, node.height).data;
      let painted = 0;
      let checksum = 0;
      for (let i = 3; i < data.length; i += 4 * 97) {
        if ((data[i] ?? 0) > 0) painted += 1;
        checksum = (checksum * 31 + (data[i] ?? 0)) % 1_000_003;
      }
      return { painted, checksum };
    });
  const before = await frame();
  expect(before.painted).toBeGreaterThan(100);
  await page.waitForTimeout(400);
  expect((await frame()).checksum).not.toBe(before.checksum);

  // Rotating the phone resizes the backing store with the box: never a stretched bitmap.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect.poll(async () => (await measure()).cssWidth).not.toBe(first.cssWidth);
  // The backing store follows on the next ResizeObserver delivery.
  await expect
    .poll(async () => {
      const rotated = await measure();
      return [rotated.width - Math.round(rotated.cssWidth * 3), rotated.height - Math.round(rotated.cssHeight * 3)];
    })
    .toEqual([0, 0]);
  expect((await frame()).painted).toBeGreaterThan(100);

  // Reduced motion: the shape gives way to a level meter.
  await page.getByTestId("listen-cancel").click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tapTalk(page);
  await expectStage(page, "listen");
  const meter = page.getByTestId("voice-meter");
  await expect(meter).toBeVisible();
  await expect(meter).toHaveAttribute("role", "meter");
  await expect(meter).toHaveAccessibleName("Niveau du micro");
  await expect(page.getByTestId("voice-canvas")).toHaveCount(0);
  await context.close();
});

test("every exit path releases the microphone", async ({ page }) => {
  // Counts live audio tracks handed out by getUserMedia.
  await page.addInitScript(() => {
    const scope = window as unknown as { __tracks: MediaStreamTrack[] };
    scope.__tracks = [];
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      scope.__tracks.push(...stream.getTracks());
      return stream;
    };
  });
  const live = () =>
    page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.filter((track) => track.readyState === "live").length);
  const opened = () => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.length);
  await openVoice(page);

  // Cancelled.
  await tapTalk(page);
  await expectStage(page, "listen");
  await expect.poll(live).toBe(1);
  await page.keyboard.press("Escape");
  await expectStage(page, "ask");
  await expect.poll(live).toBe(0);

  // Too short.
  await pressTalk(page);
  await page.waitForTimeout(380);
  await page.mouse.up();
  await expectStage(page, "ask");
  await expect.poll(live).toBe(0);

  // Completed.
  await speak(page);
  await expect.poll(live).toBe(0);
  expect(await opened()).toBe(3);
});

test("measured contrast on the accent surface and of the sheet's text pairs", async ({ page }) => {
  await openVoice(page);

  /** WCAG 2.x contrast of the element's text colour against the first opaque background behind it. */
  const contrastOf = (testId: string) =>
    page.getByTestId(testId).first().evaluate((element) => {
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

  const measured: Record<string, number> = {};
  const record = async (name: string, testId: string) => {
    measured[name] = await contrastOf(testId);
  };

  await record("ask: question on background", "stage-heading");
  await record("ask: idle hint (muted) on background", "talk-hint");
  await record("ask: secondary dock button", "write-instead");

  await tapTalk(page);
  await expectStage(page, "listen");
  // Wait for the surface colour transition to finish before measuring.
  await page.waitForTimeout(500);
  await record("listen: heading on accent surface", "stage-heading");
  await record("listen: status on accent surface", "listen-status");
  await record("listen: timer on accent surface", "voice-timer");
  await record("listen: hint on accent surface", "listen-hint");
  await record("listen: cancel button on accent surface", "listen-cancel");
  await record("listen: demo label on accent surface", "demo-badge");
  await record("listen: talk icon on inverted disc", "talk-disc");
  await page.waitForTimeout(900);
  await talkButton(page).click();

  await expectStage(page, "sheet");
  await record("sheet: value on card", "sheet-row-participants_count-value");
  await record("sheet: 'Renseigné' (success) on card", "sheet-row-participants_count-status");
  await record("sheet: 'À préciser' (muted) on asked row", "sheet-row-return-status");
  await record("sheet: question on asked row", "sheet-row-return-question");
  await record("sheet: status sentence", "sheet-status");
  await record("sheet: transcript text", "transcript-text");

  test.info().annotations.push({ type: "contrast", description: JSON.stringify(measured) });
  console.log(`contrast ${JSON.stringify(measured, null, 2)}`);
  for (const [pair, ratio] of Object.entries(measured)) {
    expect(ratio, pair).toBeGreaterThanOrEqual(4.5);
  }
});


test("controls remain legible and keyboard focus visible on light and navy surfaces", async ({ page }) => {
  await openVoice(page);
  const contrast = async (testId: string) => page.getByTestId(testId).evaluate((element) => {
    const style = getComputedStyle(element);
    const luminance = (color: string) => {
      const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((n) => {
        const value = n / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(style.color);
    const background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(await contrast("talk-disc")).toBeGreaterThanOrEqual(4.5);
  expect(await contrast("demo-badge")).toBeGreaterThanOrEqual(4.5);
  await page.getByTestId("classic-link").focus();
  await expect(page.getByTestId("classic-link")).toHaveCSS("outline-style", "solid");
  await expect(page.getByTestId("classic-link")).not.toHaveCSS("box-shadow", "none");
  await tapTalk(page);
  await expectStage(page, "listen");
  expect(await contrast("talk-disc")).toBeGreaterThanOrEqual(4.5);
  await page.getByTestId("listen-cancel").focus();
  await expect(page.getByTestId("listen-cancel")).toHaveCSS("outline-style", "solid");
  await expect(page.getByTestId("listen-cancel")).not.toHaveCSS("box-shadow", "none");
  await page.getByTestId("listen-cancel").click();
  await expectStage(page, "ask");
});
