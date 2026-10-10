import { expect, type Page } from "@playwright/test";

export const FIRST_MESSAGE =
  "Bonjour, je voudrais organiser une sortie le 12 novembre au départ de Toulouse Matabiau. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge.";

/** Same key as DEMO_FAIL_NEXT_KEY in src/services/mockConversationApi.ts (root base path). */
const FAIL_NEXT_KEY = "lio.demo.fail_next";

/**
 * Opens the demo with everything that could vary between runs pinned down:
 * - the clock (message timestamps, `confirmed_at`, "current year" for dates);
 * - random ids (conversation id shown in the JSON block).
 */
export async function openDemo(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date("2026-10-10T10:00:00+02:00"));
  await page.addInitScript(() => {
    let counter = 0;
    crypto.randomUUID = () =>
      `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}` as `${string}-${string}-${string}-${string}-${string}`;
  });
  await page.goto("/");
  await expect(page.getByTestId("demo-badge")).toBeVisible();
  await expect(page.getByTestId("message-assistant").first()).toContainText("Bonjour !");
  await page.evaluate(() => document.fonts.ready);
}

/** Types a message, sends it with Enter and waits for the assistant's reply. */
export async function send(page: Page, text: string): Promise<void> {
  const replies = page.getByTestId("message-assistant");
  const before = await replies.count();
  const composer = page.getByLabel("Votre message");
  await composer.fill(text);
  await composer.press("Enter");
  await expect(replies).toHaveCount(before + 1);
}

/** On mobile the panel is collapsed by default; on desktop this is a no-op. */
export async function setPanelExpanded(page: Page, expanded: boolean): Promise<void> {
  const toggle = page.getByTestId("panel-toggle");
  if (!(await toggle.isVisible())) return;
  if ((await toggle.getAttribute("aria-expanded")) !== String(expanded)) await toggle.click();
}

/** Makes the next message fail once with a provider error (mock-only switch). */
export async function failNextMessage(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.setItem(key, "1"), FAIL_NEXT_KEY);
}

/** Waits for transient UI (the "Mis à jour" tick) to disappear and parks the mouse. */
export async function settle(page: Page): Promise<void> {
  await expect(page.getByText("Mis à jour", { exact: true })).toHaveCount(0, { timeout: 10_000 });
  await page.mouse.move(0, 0);
}
