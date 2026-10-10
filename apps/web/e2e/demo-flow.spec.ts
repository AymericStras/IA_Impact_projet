import { expect, test } from "@playwright/test";
import { FIRST_MESSAGE, failNextMessage, openDemo, send, setPanelExpanded } from "./helpers";

// Functional flow in demo mode (mock service), run on the desktop and mobile projects.

test("text → question → panel update → edit → confirm → JSON visible", async ({ page }) => {
  await openDemo(page);

  await send(page, FIRST_MESSAGE);
  await expect(page.getByTestId("message-assistant").last()).toContainText("À quelle heure souhaitez-vous être de retour");
  await expect(page.getByTestId("panel-progress")).toHaveText("3 / 4 informations");

  await send(page, "Avant 17 h.");
  const card = page.getByTestId("confirmation-card");
  // The card must be entirely visible as soon as it appears: never under the composer.
  await expect(card).toBeInViewport({ ratio: 1 });
  await expect(card).toContainText("Vérifiez le récapitulatif dans « Votre projet »");
  await expect(page.getByLabel("Votre message")).toBeInViewport({ ratio: 1 });

  // "Modifier" on the card opens the panel (collapsed on mobile) and focuses its first edit button.
  await card.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByRole("button", { name: "Modifier : Participants" })).toBeFocused();
  await expect(page.getByTestId("field-participants_count-value")).toHaveText("30 participants");
  await expect(page.getByTestId("field-return-value")).toContainText("au plus tard à 17 h 00");

  await page.getByRole("button", { name: "Modifier : Participants" }).click();
  await page.getByLabel("Nombre total de participants").fill("32");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("field-participants_count-value")).toHaveText("32 participants");
  // The stale "27 élèves et 3 accompagnateurs" line must not survive a different total.
  await expect(page.getByTestId("field-participants_count")).not.toContainText("27 élèves");
  await expect(page.getByTestId("message-assistant").last()).toContainText(
    "Très bien, j'ai mis à jour le nombre de participants : 32 participants.",
  );

  await setPanelExpanded(page, false);
  await page.getByTestId("confirm-button").click();

  await expect(page.getByTestId("confirmation-done")).toBeVisible();
  const json = page.getByTestId("confirmed-json");
  // After confirming, the thread scrolls so the confirmation and the JSON block are on screen.
  await expect(page.getByTestId("message-assistant").last()).toBeInViewport();
  await expect(json).toBeInViewport();
  await expect(json).toContainText('"schema_version": "1.0"');
  await expect(json).toContainText('"participants_count": 32');
  await expect(json).toContainText('"constraint": "latest"');
});

test("the thread follows new messages unless the user scrolled up", async ({ page }) => {
  await openDemo(page);
  await send(page, FIRST_MESSAGE);
  await send(page, "Avant 17 h.");
  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("confirmation-done")).toBeVisible();

  const scroller = page.getByTestId("conversation-scroll");
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  const jump = page.getByTestId("scroll-to-bottom");
  await expect(jump).toBeVisible();
  await expect(jump).toHaveText("Revenir en bas");

  await jump.click();
  await expect(jump).toBeHidden();
  const distance = await scroller.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight);
  expect(distance).toBeLessThanOrEqual(24);

  // Sending a message always brings the newest content back into view.
  await scroller.evaluate((el) => {
    el.scrollTop = 0;
  });
  await send(page, "Finalement, nous serons 35.");
  await expect(page.getByTestId("message-assistant").last()).toBeInViewport();
  await expect(page.getByTestId("message-assistant").last()).toContainText("C'est noté, j'ai mis à jour le nombre de participants");
});

test("a failed message keeps its bubble and succeeds on « Réessayer »", async ({ page }) => {
  await openDemo(page);
  await failNextMessage(page);

  const composer = page.getByLabel("Votre message");
  await composer.fill("Nous serons 30.");
  await composer.press("Enter");

  const error = page.getByTestId("error-message");
  await expect(error).toContainText("Désolé, je n'ai pas pu traiter votre message.");
  await expect(error).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  await expect(page.getByTestId("panel-progress")).toHaveText("0 / 4 informations");

  await page.getByTestId("error-retry").click();
  await expect(error).toBeHidden();
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  await expect(page.getByTestId("panel-progress")).toHaveText("1 / 4 informations");
});

test("voice: record → editable transcript → sent as a message", async ({ page }) => {
  await openDemo(page);
  await page.getByTestId("microphone-button").click();
  await expect(page.getByTestId("voice-recorder")).toContainText("Enregistrement en cours");
  await page.getByRole("button", { name: "Arrêter" }).click();

  const transcript = page.getByLabel("Texte transcrit");
  await expect(transcript).toHaveValue(/27 élèves et 3 accompagnateurs/);
  await expect(page.getByTestId("transcription-preview")).toBeInViewport({ ratio: 1 });
  await page.getByTestId("transcription-preview").getByRole("button", { name: "Envoyer" }).click();

  await expect(page.getByTestId("panel-progress")).toHaveText("3 / 4 informations");
  await expect(page.getByTestId("message-user").last()).toContainText("Message dicté");
});

test("touch targets are at least 44 px on the mobile layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "touch layout only");
  await openDemo(page);
  await setPanelExpanded(page, true);

  const targets = [
    page.getByTestId("panel-toggle"),
    page.getByRole("button", { name: "Modifier : Participants" }),
    page.getByTestId("microphone-button"),
    page.getByTestId("send-button"),
    page.getByRole("button", { name: "Aide" }),
    page.getByRole("button", { name: "Nouvelle conversation" }),
  ];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
});

test("keyboard focus is always visible", async ({ page }) => {
  await openDemo(page);
  const mic = page.getByTestId("microphone-button");
  await page.getByLabel("Votre message").focus();
  await page.keyboard.press("Tab");
  await expect(mic).toBeFocused();
  const outline = await mic.evaluate((el) => {
    const style = getComputedStyle(el);
    return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  expect(outline.style).toBe("solid");
  expect(outline.width).toBeGreaterThanOrEqual(2);
});
