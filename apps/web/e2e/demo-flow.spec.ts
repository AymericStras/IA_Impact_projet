import { expect, test } from "@playwright/test";
import { FIRST_MESSAGE, failNextMessage, openDemo, send, setPanelExpanded } from "./helpers";

// Functional flow in demo mode (mock service), run on the desktop, mobile, tablet and landscape projects.

test("text → question → panel update → edit → confirm → JSON visible", async ({ page }, testInfo) => {
  await openDemo(page);

  await send(page, FIRST_MESSAGE);
  await expect(page.getByTestId("message-assistant").last()).toContainText("À quelle heure souhaitez-vous être de retour");
  await expect(page.getByTestId("panel-progress")).toHaveText("4 / 5 informations");

  await send(page, "Avant 17 h.");
  const card = page.getByTestId("confirmation-card");
  if (testInfo.project.name === "landscape") {
    // 844×390: the summary and the card cannot both fit in the conversation area. The thread
    // then shows the START of the reply (nothing is skipped) and offers « Revenir en bas ».
    await expect(page.getByTestId("message-assistant").last()).toBeInViewport({ ratio: 1 });
    await page.getByTestId("scroll-to-bottom").click();
  }
  // The card must be entirely visible as soon as it appears: never under the composer.
  await expect(card).toBeInViewport({ ratio: 1 });
  await expect(card).toContainText("Vérifiez le récapitulatif dans « Votre projet »");
  await expect(page.getByLabel("Votre message")).toBeInViewport({ ratio: 1 });

  // "Modifier" on the card opens the panel (collapsed on mobile) and focuses its first edit button.
  await card.getByRole("button", { name: "Modifier" }).click();
  await expect(page.getByRole("button", { name: "Modifier : Participants" })).toBeFocused();
  await expect(page.getByTestId("field-participants_count-value")).toHaveText("30 participants");
  await expect(page.getByTestId("field-departure_station-value")).toHaveText("Toulouse Matabiau");
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
  await expect(json).toContainText('"schema_version": "1.1"');
  await expect(json).toContainText('"departure_station": "Toulouse Matabiau"');
  await expect(json).toContainText('"participants_count": 32');
  await expect(json).toContainText('"constraint": "latest"');
});

test("the departure station is asked when missing and can be edited in the panel", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByTestId("panel-progress")).toHaveText("0 / 5 informations");

  await send(page, "Nous serons 30, départ le 12 novembre vers 8 h, retour avant 17 h, en histoire.");
  await expect(page.getByTestId("message-assistant").last()).toHaveText(/De quelle gare souhaitez-vous partir \?/);
  await expect(page.getByTestId("panel-progress")).toHaveText("4 / 5 informations");
  await expect(page.getByTestId("confirmation-card")).toHaveCount(0);

  await setPanelExpanded(page, true);
  // Second row, right after the participants.
  await expect(page.getByTestId("requirements-panel").getByRole("heading", { level: 3 })).toHaveText([
    "Participants",
    "Gare de départ",
    "Départ",
    "Retour",
    "Matière ou thème",
  ]);
  await expect(page.getByTestId("field-departure_station")).toHaveAttribute("data-state", "missing");
  await expect(page.getByTestId("field-departure_station-value")).toHaveText("À préciser");

  await page.getByRole("button", { name: "Modifier : Gare de départ" }).click();
  const input = page.getByRole("textbox", { name: "Gare de départ" });
  await expect(input).toBeFocused();
  await expect(page.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
  await input.fill("  Montpellier Saint-Roch  ");
  await page.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByTestId("field-departure_station")).toHaveAttribute("data-state", "known");
  await expect(page.getByTestId("field-departure_station-value")).toHaveText("Montpellier Saint-Roch");
  await expect(page.getByTestId("panel-progress")).toHaveText("5 / 5 informations · complet");
  await setPanelExpanded(page, false);
  await expect(page.getByTestId("message-assistant").last()).toContainText("au départ de Montpellier Saint-Roch, départ le");
  await expect(page.getByTestId("confirmation-card")).toBeVisible();
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
  await expect(page.getByTestId("panel-progress")).toHaveText("0 / 5 informations");

  await page.getByTestId("error-retry").click();
  await expect(error).toBeHidden();
  await expect(page.getByTestId("message-user")).toHaveCount(1);
  await expect(page.getByTestId("panel-progress")).toHaveText("1 / 5 informations");
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

  await expect(page.getByTestId("panel-progress")).toHaveText("4 / 5 informations");
  await expect(page.getByTestId("message-user").last()).toContainText("Message dicté");
});

test("touch targets are at least 44 px on the mobile layout", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "touch layout only");
  await openDemo(page);
  await setPanelExpanded(page, true);

  const targets = [
    page.getByTestId("panel-toggle"),
    page.getByRole("button", { name: "Modifier : Participants" }),
    page.getByRole("button", { name: "Modifier : Gare de départ" }),
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
