import { expect, test } from "@playwright/test";
import {
  FIRST_MESSAGE,
  chooseDestination,
  confirmProject,
  expectSimulationLabel,
  expectStage,
  failNextMessage,
  openDemo,
  pickScenarios,
  send,
  setPanelExpanded,
  startJourney,
} from "./helpers";

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

// ----- Journey after confirmation (docs/PLANNER_CONTRACT.md), simulated by the demo mock -----

const TWO_ACTIVITIES = ["Visite guidée des remparts", "Atelier « vie au Moyen Âge »"];

test("journey: destinations → itineraries → review → booking → travel file → feedback", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  // The confirmed card and its JSON stay; the journey is added below them.
  await expect(page.getByTestId("confirmed-json")).toBeVisible();
  await expect(page.getByRole("button", { name: "Scénario de test" })).toHaveAttribute("aria-expanded", "false");
  // The start card sits under the JSON block; the confirmed card points to it.
  await page.getByTestId("journey-continue").click();
  await expect(page.getByTestId("journey-start-button")).toBeInViewport({ ratio: 1 });

  await startJourney(page);
  await expectStage(page, "destinations");
  await expectSimulationLabel(page);
  // A new stage is shown from its start, wherever the thread was.
  await expect(page.getByTestId("journey-header")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("journey-message")).toHaveText(
    "Voici des destinations adaptées à votre thème. Choisissez une destination et vos activités.",
  );
  const destinations = page.getByTestId("destination-card");
  await expect(destinations).toHaveCount(4);
  await expect(destinations.first()).toContainText("Cité médiévale de Carcassonne");
  await expect(destinations.first()).toContainText("55 min de trajet");
  await expect(destinations.first()).toContainText("22 min à pied de la gare");

  await chooseDestination(page, "carcassonne", TWO_ACTIVITIES);
  await expectStage(page, "itineraries");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("journey-header")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("journey-message")).toHaveText("3 itinéraires possibles. Choisissez celui qui vous convient.");
  const itineraries = page.getByTestId("itinerary-card");
  await expect(itineraries).toHaveCount(3);
  await expect(itineraries.first()).toContainText("Journée complète");
  await expect(itineraries.first().getByTestId("train-leg").first()).toContainText("8 h 05 Toulouse Matabiau");
  await expect(itineraries.first().getByTestId("train-leg").last()).toContainText("16 h 50 Toulouse Matabiau");
  await expect(itineraries.first()).toContainText("Horaires de départ et de retour respectés");
  // The journey lives inside the thread: it must not give the shell anything to scroll
  // (screen-reader-only text positioned outside the thread once did).
  expect(await page.getByTestId("app-shell").evaluate((el) => el.scrollHeight - el.clientHeight)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollHeight - document.documentElement.clientHeight)).toBe(0);

  await itineraries.first().getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("itinerary-card")).toHaveCount(1);
  await expect(page.getByTestId("review-not-booked")).toHaveText("Rien n'est réservé pour l'instant.");

  await page.getByTestId("booking-submit").click();
  await expectStage(page, "booking_pending");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("booking-reference")).toHaveText(/^Référence : SIM-[0-9A-F]{8}$/);
  await expect(page.getByRole("button", { name: "Vérifier la réponse" })).toBeVisible();
  // Choices are locked while the request is waiting.
  await expect(page.getByTestId("journey-actions")).toHaveCount(0);

  // The answer is looked up once automatically (about 2.5 s).
  await expectStage(page, "booked");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("booking-message")).toContainText("Réservation confirmée (simulation). Référence SIM-");
  const file = page.getByTestId("travel-file");
  await expect(file).toContainText("Sortie pédagogique — Cité médiévale de Carcassonne");
  await expect(file.getByTestId("travel-file-schedule").getByRole("listitem")).toHaveCount(6);
  await expect(file).toContainText("8 h 05 — Départ de Toulouse Matabiau");
  await expect(file).toContainText("Compter les élèves à chaque montée et descente de train.");
  await expect(file).toContainText("Numéro d'urgence européen : 112");
  // The file itself carries the simulation label: it is what gets printed.
  await expect(file.getByTestId("journey-notices")).toContainText("Simulation :");

  // Print: the button calls window.print(), and the print styles keep the file only.
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => {
      (window as unknown as { printed: number }).printed += 1;
    };
  });
  await file.getByRole("button", { name: "Imprimer le dossier" }).click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.emulateMedia({ media: "print" });
  await expect(file).toBeVisible();
  await expect(file.getByText("8 h 05 — Départ de Toulouse Matabiau")).toBeVisible();
  await expect(file.getByTestId("journey-notices")).toBeVisible();
  for (const hidden of [
    page.getByLabel("Votre message"),
    page.getByTestId("requirements-panel"),
    page.getByTestId("confirmed-json"),
    page.getByTestId("message-assistant").first(),
    page.getByTestId("feedback-form"),
    page.getByTestId("journey-header"),
    file.getByRole("button", { name: "Imprimer le dossier" }),
    page.getByRole("banner"),
  ]) {
    await expect(hidden).toBeHidden();
  }
  // The whole file is laid out on the page, not clipped by the app's scrolling shell.
  const printed = await file.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top + window.scrollY, height: r.height, scrollHeight: el.scrollHeight, clipped: document.documentElement.scrollHeight };
  });
  expect(printed.top).toBeLessThan(40);
  expect(printed.height).toBeGreaterThanOrEqual(printed.scrollHeight - 1);
  expect(printed.clipped).toBeGreaterThanOrEqual(Math.floor(printed.height));
  await page.emulateMedia({ media: "screen" });
  await expect(page.getByLabel("Votre message")).toBeVisible();

  // Feedback: a radio group that works with the keyboard, and an optional comment.
  const form = page.getByTestId("feedback-form");
  await expect(form.getByRole("button", { name: "Envoyer mon avis" })).toBeDisabled();
  await form.getByRole("radio", { name: "3 sur 5" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(form.getByRole("radio", { name: "4 sur 5" })).toBeChecked();
  await form.getByLabel("Commentaire (facultatif)").fill("Sortie très bien organisée.");
  await form.getByRole("button", { name: "Envoyer mon avis" }).click();
  await expectStage(page, "closed");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("journey-message")).toHaveText("Merci pour votre retour d'expérience.");
  await expect(page.getByTestId("feedback-given")).toContainText("Votre note : 4 sur 5");
  await expect(page.getByTestId("feedback-form")).toHaveCount(0);

  // The journey belongs to the conversation: a reload shows it again.
  await page.reload();
  await expectStage(page, "closed");
  await expect(page.getByTestId("travel-file")).toContainText("8 h 05 — Départ de Toulouse Matabiau");
});

test("journey: nothing fits → several adjustments, none applied without a click, the accepted one updates the panel", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  await startJourney(page, { search: "adjustments" });
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne", TWO_ACTIVITIES);

  await expectStage(page, "adjustments");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("journey-header")).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("journey-message")).toHaveText(
    "Aucun itinéraire ne correspond exactement à votre demande. Voici ce qui deviendrait possible ; rien n'est modifié sans votre accord.",
  );
  await expect(page.getByTestId("adjustment-reason")).toContainText("trop court pour les activités choisies");
  await expect(page.getByTestId("adjustment-consent")).toHaveText("Rien n'est modifié tant que vous n'avez pas accepté un ajustement.");
  // Not an error.
  await expect(page.getByTestId("error-message")).toHaveCount(0);

  // Several choices of several kinds, each one with what changes, what it unlocks and its own button.
  const cards = page.getByTestId("adjustment-card");
  await expect(cards).toHaveCount(6);
  await expect(cards.getByRole("button", { name: "Accepter cet ajustement" })).toHaveCount(6);
  await expect(page.getByTestId("adjustment-unlocks")).toHaveText([
    "1 itinéraire possible",
    "1 itinéraire possible",
    "3 itinéraires possibles",
    "3 itinéraires possibles",
    "2 itinéraires possibles",
    "3 itinéraires possibles",
  ]);
  expect(await cards.evaluateAll((els) => [...new Set(els.map((el) => el.getAttribute("data-kind")))])).toEqual([
    "return_later",
    "departure_earlier",
    "fewer_activities",
    "other_destination",
  ]);
  const later = cards.filter({ hasText: "Retour à 17 h 30 au lieu de 17 h 00" });
  await expect(later.getByTestId("adjustment-change")).toHaveText("Retour : 17 h 00 devient 17 h 30");
  await expect(page.getByRole("button", { name: "Choisir une autre destination" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Modifier ma demande" })).toBeVisible();

  // Offering is not applying: the request is unchanged.
  const userMessages = await page.getByTestId("message-user").count();
  await setPanelExpanded(page, true);
  await expect(page.getByTestId("field-return-value")).toContainText("au plus tard à 17 h 00");
  await setPanelExpanded(page, false);

  await later.getByRole("button", { name: "Accepter cet ajustement" }).click();
  await expectStage(page, "itineraries");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("itinerary-card")).toHaveCount(1);
  await expect(page.getByTestId("itinerary-card").getByTestId("train-leg").last()).toContainText("17 h 20 Toulouse Matabiau");

  // The acceptance is recorded in the conversation and the panel shows the new time; still confirmed.
  await expect(page.getByTestId("message-user")).toHaveCount(userMessages + 1);
  await expect(page.getByTestId("message-user").last()).toContainText("Ajustement accepté : Retour à 17 h 30 au lieu de 17 h 00.");
  await expect(page.getByTestId("message-assistant").last()).toContainText("Votre demande a été mise à jour.");
  await expect(page.getByTestId("confirmed-json")).toContainText('"time": "17:30"');
  await expect(page.getByTestId("confirmation-done")).toBeVisible();
  await setPanelExpanded(page, true);
  await expect(page.getByTestId("field-return-value")).toContainText("au plus tard à 17 h 30");
  await expect(page.getByTestId("panel-progress")).toHaveText("5 / 5 informations · complet");
});

test("journey: « no result » and a technical failure are two different things", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);

  // A failing search: an error block with the server's text and « Réessayer »; nothing else changes.
  await startJourney(page, { search: "error" });
  const error = page.getByTestId("journey").getByTestId("error-message");
  await expect(error).toContainText("La recherche a rencontré un problème technique. Cela ne signifie pas qu'aucun trajet n'existe");
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).toBeInViewport({ ratio: 1 });
  await expect(page.getByTestId("journey")).toHaveAttribute("data-stage", "start");
  await expect(page.getByTestId("journey-no-match")).toHaveCount(0);
  const errorLook = await error.evaluate((el) => getComputedStyle(el).borderTopColor);
  // « Réessayer » replays the same request: the simulated failure is still there.
  await error.getByRole("button", { name: "Réessayer" }).click();
  await expect(error).toContainText("problème technique");

  // No result: its own state, in plain words, without the error look.
  await startJourney(page, { search: "no_match" });
  await expectStage(page, "no_match");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("error-message")).toHaveCount(0);
  await expect(page.getByTestId("journey").getByRole("alert")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Aucune proposition" })).toBeVisible();
  await expect(page.getByTestId("journey-message")).toContainText("Aucune destination ne correspond à votre demande.");
  await expect(page.getByTestId("journey-no-match")).toHaveText("La recherche a bien fonctionné : il ne s'agit pas d'une erreur technique.");
  const noMatchLook = await page.getByTestId("journey-header").evaluate((el) => getComputedStyle(el).borderTopColor);
  expect(noMatchLook).not.toBe(errorLook);
  await expect(page.getByRole("button", { name: "Modifier ma demande" })).toBeVisible();

  // From there the search can be run again: a booking failure this time.
  await pickScenarios(page, { search: "auto", booking: "error" });
  await page.getByRole("button", { name: "Relancer la recherche" }).click();
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne");
  await expectStage(page, "itineraries");
  await page.getByTestId("itinerary-card").first().getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await page.getByTestId("booking-submit").click();
  const bookingError = page.getByTestId("journey").getByTestId("error-message");
  await expect(bookingError).toContainText("Le service de réservation ne répond pas. Votre demande n'a pas été envoyée ; vous pouvez réessayer.");
  await expect(bookingError.getByRole("button", { name: "Réessayer" })).toBeVisible();
  // The review is still there: nothing was sent, nothing was lost.
  await expectStage(page, "review");
  await expect(page.getByTestId("booking-submit")).toBeEnabled();
});

test("journey: a refused booking offers the other itineraries, and the alternative gets booked", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  await startJourney(page, { booking: "refused" });
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne", TWO_ACTIVITIES);
  await expectStage(page, "itineraries");
  await page.getByTestId("itinerary-card").first().getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await page.getByTestId("booking-submit").click();
  await expectStage(page, "booking_pending");
  // Asking instead of waiting for the automatic look-up.
  await page.getByRole("button", { name: "Vérifier la réponse" }).click();

  await expectStage(page, "booking_refused");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("booking-message")).toHaveText(
    "La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).",
  );
  await expect(page.getByTestId("error-message")).toHaveCount(0);
  const alternatives = page.getByTestId("itinerary-card");
  await expect(alternatives).toHaveCount(2);
  await expect(alternatives.first()).toContainText("Retour anticipé");
  await expect(page.getByTestId("travel-file")).toHaveCount(0);

  await alternatives.first().getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await expect(page.getByTestId("itinerary-card")).toContainText("Retour anticipé");
  await page.getByTestId("booking-submit").click();
  await expectStage(page, "booked");
  await expect(page.getByTestId("travel-file")).toContainText("15 h 50 — Retour à Toulouse Matabiau");
});

test("journey: the destination can be changed mid-way, from the itineraries and from the review", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  await startJourney(page);
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne", TWO_ACTIVITIES);
  await expectStage(page, "itineraries");

  await page.getByRole("button", { name: "Changer de destination" }).click();
  await expect(page.getByTestId("journey")).toHaveAttribute("data-view", "destinations");
  await expectSimulationLabel(page);
  await expect(page.getByTestId("journey-header")).toBeInViewport({ ratio: 1 });
  const current = page.locator('[data-testid="destination-card"][data-destination="carcassonne"]');
  await expect(current).toContainText("Destination actuelle");
  await expect(current.getByRole("checkbox", { checked: true })).toHaveCount(2);
  // Going back changes nothing.
  await page.getByRole("button", { name: "Revenir à l'étape en cours" }).click();
  await expect(page.getByTestId("itinerary-card")).toHaveCount(3);

  await page.getByRole("button", { name: "Changer de destination" }).click();
  await chooseDestination(page, "albi", ["Atelier au musée"]);
  await expectStage(page, "itineraries");
  await expect(page.getByTestId("journey")).toHaveAttribute("data-view", "stage");
  const itineraries = page.getByTestId("itinerary-card");
  await expect(itineraries.first()).toContainText("Albi, cité épiscopale");
  await expect(itineraries.first().getByTestId("train-leg").first()).toContainText("Albi-Ville");
  await expect(itineraries.first()).toContainText("Atelier au musée");

  // Also from the review, before anything is sent.
  await itineraries.first().getByRole("button", { name: "Choisir cet itinéraire" }).click();
  await expectStage(page, "review");
  await page.getByRole("button", { name: "Changer de destination" }).click();
  await chooseDestination(page, "castelnaudary");
  await expectStage(page, "itineraries");
  await expect(page.getByTestId("itinerary-card").first()).toContainText("Canal du Midi à Castelnaudary");
});

test("journey: editing a requirement mid-way drops the journey; the search restarts after a new confirmation", async ({ page }) => {
  await openDemo(page);
  await confirmProject(page);
  await startJourney(page);
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne", TWO_ACTIVITIES);
  await expectStage(page, "itineraries");

  // « Modifier ma demande » leads to the panel, where the existing editors do the work.
  await page.getByRole("button", { name: "Modifier ma demande" }).click();
  await expect(page.getByRole("button", { name: "Modifier : Participants" })).toBeFocused();
  await page.getByRole("button", { name: "Modifier : Participants" }).click();
  await page.getByLabel("Nombre total de participants").fill("32");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByTestId("field-participants_count-value")).toHaveText("32 participants");
  await setPanelExpanded(page, false);

  // The confirmation is gone and so is the journey: nothing stale stays on screen.
  await expect(page.getByTestId("journey")).toHaveCount(0);
  await expect(page.getByTestId("itinerary-card")).toHaveCount(0);
  await expect(page.getByTestId("confirmation-done")).toHaveCount(0);
  await expect(page.getByTestId("journey-interrupted")).toHaveText(
    "La recherche de propositions est interrompue : confirmez à nouveau vos informations pour la relancer.",
  );
  await expect(page.getByTestId("confirmation-card")).toBeVisible();

  await page.getByTestId("confirm-button").click();
  await expect(page.getByTestId("confirmation-done")).toBeVisible();
  await expect(page.getByTestId("journey-interrupted")).toHaveCount(0);
  // A fresh start, not the previous itineraries.
  await expect(page.getByTestId("journey")).toHaveAttribute("data-stage", "start");
  await expect(page.getByTestId("itinerary-card")).toHaveCount(0);
  await startJourney(page);
  await expectStage(page, "destinations");
  await chooseDestination(page, "carcassonne");
  await expectStage(page, "itineraries");
  await expect(page.getByTestId("itinerary-card").first()).toContainText("32 participants");
});
