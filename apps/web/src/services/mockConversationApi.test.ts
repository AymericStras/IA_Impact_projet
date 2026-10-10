// @vitest-environment node
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ConfirmedRequirements, ConversationResponse } from "@/types/contracts";
import { createMockConversationService } from "./mockConversationApi";
import { ApiError } from "./types";

// Vitest runs from apps/web; the shared contracts live two levels up.
const CONTRACTS_DIR = resolve(process.cwd(), "../../packages/contracts");

function loadSchema(name: string): object {
  return JSON.parse(readFileSync(join(CONTRACTS_DIR, name), "utf8")) as object;
}

// Frozen Paris clock so relative dates ("12 novembre") resolve deterministically.
const NOW = () => new Date("2026-10-10T10:00:00+02:00");

let validateResponse: (data: unknown) => boolean;
let validateConfirmed: (data: unknown) => boolean;
let errorsOf: (validate: unknown) => string;

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validateResponse = ajv.compile(loadSchema("conversation_response.schema.json"));
  validateConfirmed = ajv.compile(loadSchema("requirements.schema.json"));
  errorsOf = (validate) => JSON.stringify((validate as { errors?: unknown }).errors, null, 2);
});

function expectValid(response: ConversationResponse) {
  expect(validateResponse(response), errorsOf(validateResponse)).toBe(true);
  if (response.confirmed_requirements) {
    expect(validateConfirmed(response.confirmed_requirements), errorsOf(validateConfirmed)).toBe(true);
  }
}

describe("mockConversationApi", () => {
  const service = createMockConversationService({ latencyMs: 0, audioLatencyMs: 0, now: NOW, persist: false });
  let counter = 0;
  const say = (id: string, content: string) =>
    service.sendMessage(id, { content, client_message_id: `cmid_${++counter}`, source: "text" });

  beforeEach(() => {
    counter = 0;
  });

  it("produces schema-valid responses across the full demo flow", async () => {
    const created = await service.create();
    expectValid(created);
    expect(created.state).toBe("COLLECTING");
    expect(created.messages[0]?.content).toMatch(/^Bonjour !/);
    const id = created.conversation_id;

    const first = await say(
      id,
      "Bonjour, je voudrais organiser une sortie le 12 novembre. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge.",
    );
    expectValid(first);
    expect(first.requirements.participants_count).toBe(30);
    expect(first.requirements.participants_breakdown).toEqual({ students: 27, accompanying: 3 });
    expect(first.requirements.departure).toEqual({ date: "2026-11-12", time: "08:00", constraint: "approximate" });
    expect(first.requirements.teaching_type).toEqual({ subject: "Histoire", theme: "Moyen Âge" });
    expect(first.missing_fields).toEqual(["return"]);
    expect(first.assistant_message).toBe("À quelle heure souhaitez-vous être de retour le jeudi 12 novembre ?");
    expect(first.version).toBe(1);

    const second = await say(id, "Avant 17 h.");
    expectValid(second);
    expect(second.requirements.return).toEqual({ date: "2026-11-12", time: "17:00", constraint: "latest" });
    expect(second.state).toBe("AWAITING_CONFIRMATION");
    expect(second.ready_for_confirmation).toBe(true);
    expect(second.assistant_message).toMatch(/^J'ai bien compris votre projet : 30 participants/);

    const edited = await service.editField(id, "participants_count", 32, second.version);
    expectValid(edited);
    expect(edited.requirements.participants_count).toBe(32);
    expect(edited.requirements.participants_breakdown).toBeNull();
    expect(edited.state).toBe("AWAITING_CONFIRMATION");
    expect(edited.assistant_message).toMatch(/^Très bien, j'ai mis à jour le nombre de participants/);
    expect(edited.messages.at(-2)?.source).toBe("edit");

    const confirmed = await service.confirm(id, edited.version);
    expectValid(confirmed);
    expect(confirmed.state).toBe("CONFIRMED");
    const payload = confirmed.confirmed_requirements as ConfirmedRequirements;
    expect(payload.schema_version).toBe("1.0");
    expect(payload.requirements.return.constraint).toBe("latest");
    expect(payload.requirements.participants_count).toBe(32);

    const exported = await service.exportConfirmed(id);
    expect(validateConfirmed(exported), errorsOf(validateConfirmed)).toBe(true);

    // A correction after confirmation reopens the loop and clears the snapshot.
    const reopened = await say(id, "Finalement nous serons 35.");
    expectValid(reopened);
    expect(reopened.requirements.participants_count).toBe(35);
    // Same acknowledgement prefix as the backend when a known value is overwritten.
    expect(reopened.assistant_message).toMatch(
      /^C'est noté, j'ai mis à jour le nombre de participants : 35 participants \(au lieu de 32 participants\)\. J'ai bien compris votre projet/,
    );
    expect(reopened.state).toBe("AWAITING_CONFIRMATION");
    expect(reopened.confirmed_requirements).toBeNull();
  });

  it("asks for accompanying adults when only students are given", async () => {
    const { conversation_id: id } = await service.create();
    const res = await say(id, "J'ai 25 élèves.");
    expectValid(res);
    expect(res.requirements.participants_count).toBeNull();
    expect(res.state).toBe("ASKING_USER");
    expect(res.pending_clarification).toEqual({ field: "participants_count", kind: "students_only" });
    expect(res.assistant_message).toBe("Combien d'accompagnateurs participeront à la sortie avec les 25 élèves ?");

    const next = await say(id, "3");
    expectValid(next);
    expect(next.requirements.participants_count).toBe(28);
    expect(next.pending_clarification).toBeNull();
    expect(next.state).toBe("COLLECTING");
  });

  it("asks a clarification for vague quantities and relative dates", async () => {
    const { conversation_id: id } = await service.create();
    const vague = await say(id, "Nous serons une trentaine.");
    expectValid(vague);
    expect(vague.requirements.participants_count).toBeNull();
    expect(vague.assistant_message).toBe("Pouvez-vous me donner le nombre exact de participants ?");

    const relative = await say(id, "Le mois prochain.");
    expectValid(relative);
    expect(relative.requirements.departure).toBeNull();
    expect(relative.assistant_message).toBe("Pouvez-vous me préciser la date exacte ?");
  });

  it("rejects a return earlier than the departure", async () => {
    const { conversation_id: id } = await service.create();
    const res = await say(id, "Nous sommes 20, départ le 3 mars à 9 h et retour le 3 mars à 8 h, en SVT.");
    expectValid(res);
    expect(res.state).toBe("ASKING_USER");
    expect(res.assistant_message).toMatch(/^L'heure de retour \(à 8 h 00\) est antérieure au départ \(.*à 9 h 00\)\. Pouvez-vous corriger l'heure de retour \?$/);
    expect(res.missing_fields).toContain("return");
  });

  it("is idempotent on client_message_id and rejects stale versions", async () => {
    const { conversation_id: id } = await service.create();
    const body = { content: "Nous sommes 20.", client_message_id: "same", source: "text" as const };
    const a = await service.sendMessage(id, body);
    const b = await service.sendMessage(id, body);
    expect(b).toEqual(a);
    expect(b.version).toBe(1);

    await expect(service.editField(id, "participants_count", 21, 0)).rejects.toMatchObject({
      status: 409,
      code: "VERSION_CONFLICT",
      kind: "conflict",
    });
    await expect(service.confirm(id, a.version)).rejects.toBeInstanceOf(ApiError);
    await expect(service.exportConfirmed(id)).rejects.toMatchObject({ status: 409 });
    await expect(service.get("conv_unknown")).rejects.toMatchObject({ status: 404, code: "CONVERSATION_NOT_FOUND" });
  });

  it("exposes the same config shape as the API", async () => {
    await expect(service.getConfig()).resolves.toEqual({
      max_audio_seconds: 120,
      max_audio_bytes: 10_485_760,
      max_message_chars: 4_000,
      timezone: "Europe/Paris",
    });
  });

  it("returns a canned transcript without extracting", async () => {
    const created = await service.create();
    const res = await service.sendAudio(created.conversation_id, new Blob([]));
    expectValid(res);
    expect(res.assistant_message).toBeNull();
    expect(res.transcript).toMatch(/27 élèves et 3 accompagnateurs/);
    expect(res.requirements.participants_count).toBeNull();
    expect(res.version).toBe(0);
  });
});
