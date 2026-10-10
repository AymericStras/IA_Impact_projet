import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationResponse } from "@/types/contracts";
import type { Itinerary, Journey, TravelFile } from "@/types/journey";
import type { JourneyService } from "./journeyTypes";
import type { ApiError, ConversationService } from "./types";

// Vitest runs from apps/web; the shared contracts live two levels up.
const CONTRACTS_DIR = resolve(process.cwd(), "../../packages/contracts");
const load = <T = object>(name: string): T => JSON.parse(readFileSync(join(CONTRACTS_DIR, name), "utf8")) as T;

const NOW = new Date("2026-10-10T10:00:00+02:00");
const FIRST = (station: string) =>
  `Bonjour, je voudrais organiser une sortie le 12 novembre au départ de ${station}. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge.`;

let validateJourney: (data: unknown) => boolean;
let validateTravelFile: (data: unknown) => boolean;
const errorsOf = (validate: unknown) => JSON.stringify((validate as { errors?: unknown }).errors, null, 2);

beforeAll(() => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validateJourney = ajv.compile(load("journey.schema.json"));
  validateTravelFile = ajv.compile(load("travel_file.schema.json"));
});

let journeys: JourneyService;
let conversations: ConversationService;
let counter = 0;

/** The mocks simulate latency with timers: run them, then hand back the result or the error. */
async function settled<T>(promise: Promise<T>): Promise<T> {
  const guarded = promise.then(
    (value) => ({ ok: true as const, value }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  await vi.runAllTimersAsync();
  const outcome = await guarded;
  if (outcome.ok) return outcome.value;
  throw outcome.error;
}

/** Every journey the mock returns must be valid against the shared contract. */
async function call(promise: Promise<Journey>): Promise<Journey> {
  const journey = await settled(promise);
  expect(validateJourney(journey), errorsOf(validateJourney)).toBe(true);
  return journey;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await settled(promise);
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the call to be rejected");
}

/** Fresh module instances reading the same localStorage: what a page reload does. */
async function reload(): Promise<void> {
  vi.resetModules();
  journeys = (await import("./mockJourneyApi")).mockJourneyApi;
  conversations = (await import("./mockConversationApi")).mockConversationApi;
}

const say = (id: string, content: string) =>
  settled(conversations.sendMessage(id, { content, client_message_id: `cmid_${++counter}`, source: "text" }));

async function confirmed(station = "Toulouse Matabiau", returnTime = "Avant 17 h."): Promise<ConversationResponse> {
  const created = await settled(conversations.create());
  await say(created.conversation_id, FIRST(station));
  const ready = await say(created.conversation_id, returnTime);
  expect(ready.ready_for_confirmation).toBe(true);
  const done = await settled(conversations.confirm(created.conversation_id, ready.version));
  expect(done.state).toBe("CONFIRMED");
  return done;
}

const TWO = ["carcassonne-1", "carcassonne-2"];
const clock = (isoDateTime: string) => isoDateTime.slice(11, 16);
const withoutIds = (itinerary: Itinerary) => ({ ...itinerary, id: "" });

beforeEach(async () => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  counter = 0;
  await reload();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("mockJourneyApi", () => {
  it("exports the journey service and nothing else", async () => {
    expect(Object.keys(await import("./mockJourneyApi"))).toEqual(["mockJourneyApi"]);
  });

  it("refuses to search before the confirmation and knows no journey before a search", async () => {
    const created = await settled(conversations.create());
    const early = await failure(journeys.start(created.conversation_id));
    expect([early.status, early.code]).toEqual([409, "INVALID_STATE"]);
    expect(early.detail).toBe("Confirmez d'abord vos informations avant de rechercher des propositions.");

    const { conversation_id: id } = await confirmed();
    const none = await failure(journeys.get(id));
    expect([none.status, none.code]).toEqual([409, "INVALID_STATE"]);
    expect(none.detail).toBe("Aucune recherche n'est en cours pour ce projet.");

    const unknown = await failure(journeys.start("conv_unknown"));
    expect([unknown.status, unknown.code]).toEqual([404, "CONVERSATION_NOT_FOUND"]);
  });

  it("runs the whole journey: destinations → itineraries → review → booking → travel file → feedback", async () => {
    const conversation = await confirmed();
    const id = conversation.conversation_id;

    const started = await call(journeys.start(id));
    expect(started).toMatchObject({
      stage: "destinations",
      simulated: true,
      planner_mode: "simulated",
      requirements_version: conversation.version,
      search_scenario: "auto",
      booking_scenario: "confirmed",
      departure_stations: ["Toulouse Matabiau"],
    });
    expect(started.notices[0]).toMatch(/^Simulation : /);
    // Ranked by the theme: history / Moyen Âge puts Carcassonne first.
    expect(started.destinations.map((d) => d.id)).toEqual(["carcassonne", "albi", "sete", "castelnaudary"]);
    expect(started.destinations[0]?.activities.map((a) => a.id)).toEqual(["carcassonne-1", "carcassonne-2", "carcassonne-3"]);
    expect(started.destinations[0]?.places[1]).toEqual({
      title: "Château comtal",
      walk_minutes: 22,
      note: "Visite commentée possible pour les scolaires.",
    });

    const found = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    expect(found.stage).toBe("itineraries");
    expect(found.message).toBe("3 itinéraires possibles. Choisissez celui qui vous convient.");
    expect(found.itineraries.map((i) => i.label)).toEqual(["Journée complète", "Retour anticipé", "Départ décalé"]);
    for (const itinerary of found.itineraries) {
      // « vers 8 h » and « au plus tard à 17 h » are never violated.
      expect(clock(itinerary.outbound.departure) >= "08:00").toBe(true);
      expect(clock(itinerary.return.arrival) <= "17:00").toBe(true);
      expect(itinerary.outbound.departure).toMatch(/^2026-11-12T\d{2}:\d{2}\+01:00$/);
      expect(itinerary.activities).toHaveLength(2);
      expect(itinerary.checks.every((check) => check.ok)).toBe(true);
      expect(itinerary.simulated).toBe(true);
    }
    expect(found.itineraries[0]?.outbound).toMatchObject({ from_station: "Toulouse Matabiau", to_station: "Carcassonne" });
    expect(clock(found.itineraries[0]?.outbound.departure ?? "")).toBe("08:05");
    expect(clock(found.itineraries[0]?.return.arrival ?? "")).toBe("16:50");
    // Same figures as services/api/app/services/planner.py for this request.
    expect(found.itineraries.map((i) => [clock(i.outbound.departure), clock(i.return.arrival), i.free_minutes])).toEqual([
      ["08:05", "16:50", 191],
      ["08:05", "15:50", 131],
      ["08:35", "16:50", 161],
    ]);

    const chosen = found.itineraries[0] as Itinerary;
    const review = await call(journeys.chooseItinerary(id, chosen.id));
    expect(review).toMatchObject({ stage: "review", selected_itinerary_id: chosen.id, booking: null });
    expect(review.message).toContain("Rien n'est réservé tant que vous n'avez pas envoyé la demande.");

    const pending = await call(journeys.submitBooking(id));
    expect(pending.stage).toBe("booking_pending");
    expect(pending.booking).toMatchObject({ status: "pending", itinerary_id: chosen.id, simulated: true });
    expect(pending.booking?.reference).toMatch(/^SIM-[0-9A-F]{8}$/);

    const booked = await call(journeys.checkBooking(id));
    expect(booked.stage).toBe("booked");
    expect(booked.booking?.status).toBe("confirmed");
    expect(booked.booking?.message).toBe(`Réservation confirmée (simulation). Référence ${pending.booking?.reference}.`);

    const file = await settled(journeys.travelFile(id));
    expect(validateTravelFile(file), errorsOf(validateTravelFile)).toBe(true);
    expect(file.reference).toBe(pending.booking?.reference);
    expect(file.title).toBe("Sortie pédagogique — Cité médiévale de Carcassonne");
    expect(file.schedule[0]).toBe("8 h 05 — Départ de Toulouse Matabiau");
    expect(file.schedule).toHaveLength(6);
    expect(file.official_links).toEqual([]);
    expect(file.simulated).toBe(true);

    const closed = await call(journeys.giveFeedback(id, { rating: 4, comment: "Très bien." }));
    expect(closed).toMatchObject({ stage: "closed", feedback: { rating: 4, comment: "Très bien." } });
    expect(closed.message).toBe("Merci pour votre retour d'expérience.");
    // The travel file stays available after the feedback.
    expect((await settled(journeys.travelFile(id))).reference).toBe(file.reference);
  });

  it("matches the backend's examples for the adjustments scenario, then applies an accepted time change", async () => {
    const example = load<Journey>("examples/journey_adjustments.json");
    const bookedExample = load<Journey>("examples/journey_booked.json");
    const fileExample = load<TravelFile>("examples/travel_file.json");
    // The examples start from the city « Toulouse »: any of its stations.
    const conversation = await confirmed("Toulouse");
    const id = conversation.conversation_id;

    const started = await call(journeys.start(id, { search_scenario: "adjustments" }));
    expect(started.departure_stations).toEqual(example.departure_stations);
    expect(started.notices).toEqual(example.notices);
    expect(started.destinations).toEqual(example.destinations);

    const offered = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    expect(offered.stage).toBe("adjustments");
    expect(offered.message).toBe(example.message);
    expect(offered.strict_minutes).toBe(example.strict_minutes);
    expect(offered.itineraries).toEqual([]);
    const comparable = (journey: Journey) => journey.adjustments.map((adjustment) => ({ ...adjustment, id: "" }));
    // Several choices, each with what changes and how many itineraries it unlocks.
    expect(comparable(offered)).toEqual(comparable(example));
    expect(offered.adjustments.length).toBeGreaterThan(1);
    expect(new Set(offered.adjustments.map((a) => a.id)).size).toBe(offered.adjustments.length);

    // Nothing was applied by the offer itself.
    const untouched = await settled(conversations.get(id));
    expect(untouched.version).toBe(conversation.version);
    expect(untouched.requirements.return?.time).toBe("17:00");

    const later = offered.adjustments[0]!;
    expect(later.label).toBe("Retour à 17 h 30 au lieu de 17 h 00");
    const accepted = await call(journeys.acceptAdjustment(id, later.id));
    expect(accepted.stage).toBe("itineraries");
    expect(accepted.itineraries).toHaveLength(later.unlocks);
    expect(accepted.accepted_adjustments).toEqual([later]);
    expect(accepted.requirements_version).toBe(conversation.version + 1);
    expect(accepted.itineraries.map(withoutIds)).toEqual(bookedExample.itineraries.map(withoutIds));

    // The requirements changed and stayed confirmed: new version, two messages.
    const updated = await settled(conversations.get(id));
    expect(updated.state).toBe("CONFIRMED");
    expect(updated.version).toBe(conversation.version + 1);
    expect(updated.requirements.return).toEqual({ date: "2026-11-12", time: "17:30", constraint: "latest" });
    expect(updated.confirmed_requirements?.requirements.return.time).toBe("17:30");
    expect(updated.messages.slice(-2).map((m) => [m.role, m.source ?? null, m.content])).toEqual([
      ["user", "edit", "Ajustement accepté : Retour à 17 h 30 au lieu de 17 h 00."],
      ["assistant", null, "C'est noté : Retour à 17 h 30 au lieu de 17 h 00. Votre demande a été mise à jour."],
    ]);

    // An adjustment cannot be accepted twice.
    const twice = await failure(journeys.acceptAdjustment(id, later.id));
    expect([twice.status, twice.code]).toEqual([409, "INVALID_STATE"]);

    await call(journeys.chooseItinerary(id, accepted.itineraries[0]!.id));
    await call(journeys.submitBooking(id));
    const booked = await call(journeys.checkBooking(id));
    expect(booked.message).toBe(bookedExample.message);
    const file = await settled(journeys.travelFile(id));
    expect(validateTravelFile(file), errorsOf(validateTravelFile)).toBe(true);
    expect({ ...file, reference: "", itinerary: withoutIds(file.itinerary) }).toEqual({
      ...fileExample,
      reference: "",
      itinerary: withoutIds(fileExample.itinerary),
    });
  });

  it("accepting fewer activities or a nearer destination changes the choice, not the requirements", async () => {
    const conversation = await confirmed("Toulouse");
    const id = conversation.conversation_id;
    await call(journeys.start(id, { search_scenario: "adjustments" }));
    const offered = await call(journeys.chooseDestination(id, "carcassonne", TWO));

    const fewer = offered.adjustments.find((a) => a.kind === "fewer_activities")!;
    expect(fewer).toMatchObject({ changes: [], activity_ids: ["carcassonne-2"], unlocks: 3 });
    const single = await call(journeys.acceptAdjustment(id, fewer.id));
    expect(single).toMatchObject({ stage: "itineraries", selected_destination_id: "carcassonne", selected_activity_ids: ["carcassonne-2"] });
    expect(single.itineraries).toHaveLength(3);
    expect(single.requirements_version).toBe(conversation.version);
    expect((await settled(conversations.get(id))).version).toBe(conversation.version);

    // Search again: the nearer destination this time.
    await call(journeys.start(id, { search_scenario: "adjustments" }));
    const again = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    const nearer = again.adjustments.find((a) => a.kind === "other_destination")!;
    expect(nearer.label).toBe("Une destination plus proche : Canal du Midi à Castelnaudary (40 min de trajet)");
    const moved = await call(journeys.acceptAdjustment(id, nearer.id));
    expect(moved).toMatchObject({
      stage: "itineraries",
      selected_destination_id: "castelnaudary",
      selected_activity_ids: ["castelnaudary-1"],
    });
    expect(moved.itineraries).toHaveLength(nearer.unlocks);
    expect(moved.itineraries.every((i) => i.destination_id === "castelnaudary")).toBe(true);
    expect((await settled(conversations.get(id))).messages).toHaveLength(conversation.messages.length);
  });

  it("reaches the adjustments naturally when the day is too short, and no_match when nothing helps", async () => {
    const short = await confirmed("Toulouse Matabiau", "Avant 12 h.");
    await call(journeys.start(short.conversation_id));
    const offered = await call(journeys.chooseDestination(short.conversation_id, "carcassonne", ["carcassonne-1"]));
    expect(offered).toMatchObject({ stage: "adjustments", strict_minutes: 0, search_scenario: "auto" });
    expect(offered.adjustments.map((a) => [a.kind, a.label, a.unlocks])).toEqual([
      ["return_later", "Retour à 13 h 00 au lieu de 12 h 00", 1],
      ["departure_earlier", "Départ à 7 h 00 au lieu de 8 h 00", 1],
      ["other_destination", "Une destination plus proche : Canal du Midi à Castelnaudary (40 min de trajet)", 1],
      ["return_later", "Retour à 13 h 30 au lieu de 12 h 00", 2],
      ["departure_earlier", "Départ à 6 h 30 au lieu de 8 h 00", 2],
    ]);
    expect(offered.adjustments.every((a) => a.reason.includes("trop court pour les activités choisies"))).toBe(true);

    const hopeless = await confirmed("Toulouse Matabiau", "Avant 9 h 30.");
    await call(journeys.start(hopeless.conversation_id));
    const nothing = await call(journeys.chooseDestination(hopeless.conversation_id, "carcassonne", []));
    expect(nothing).toMatchObject({ stage: "no_match", adjustments: [], itineraries: [] });
    expect(nothing.message).toMatch(/^Aucun itinéraire n'a été trouvé pour ce choix/);
    // Still open: another destination can be tried from here.
    expect(nothing.destinations.length).toBeGreaterThan(0);
  });

  it("separates « no result » from a technical failure of the search", async () => {
    const { conversation_id: id } = await confirmed();
    const empty = await call(journeys.start(id, { search_scenario: "no_match" }));
    expect(empty).toMatchObject({ stage: "no_match", destinations: [], search_scenario: "no_match" });
    expect(empty.message).toMatch(/^Aucune destination ne correspond à votre demande\./);

    const broken = await failure(journeys.start(id, { search_scenario: "error" }));
    expect([broken.status, broken.code]).toEqual([502, "PLANNER_ERROR"]);
    expect(broken.detail).toContain("Cela ne signifie pas qu'aucun trajet n'existe");
    // The failure left the state untouched.
    expect(await call(journeys.get(id))).toEqual(empty);
  });

  it("booking: a technical failure keeps the review; a refusal happens once and offers the other itineraries", async () => {
    const { conversation_id: id } = await confirmed();
    await call(journeys.start(id, { booking_scenario: "error" }));
    const found = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    const review = await call(journeys.chooseItinerary(id, found.itineraries[0]!.id));
    const broken = await failure(journeys.submitBooking(id));
    expect([broken.status, broken.code]).toEqual([502, "BOOKING_ERROR"]);
    expect(broken.detail).toBe("Le service de réservation ne répond pas. Votre demande n'a pas été envoyée ; vous pouvez réessayer.");
    expect(await call(journeys.get(id))).toEqual(review);

    await call(journeys.start(id, { booking_scenario: "refused" }));
    const again = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    const first = again.itineraries[0]!;
    await call(journeys.chooseItinerary(id, first.id));
    await call(journeys.submitBooking(id));
    const refused = await call(journeys.checkBooking(id));
    expect(refused.stage).toBe("booking_refused");
    expect(refused.booking).toMatchObject({ status: "refused", itinerary_id: first.id });
    expect(refused.booking?.message).toBe("La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).");
    expect(refused.alternatives.map((i) => i.id)).toEqual(again.itineraries.slice(1).map((i) => i.id));
    expect(refused.message).toContain("Voici d'autres itinéraires possibles");
    expect(refused.booking_scenario).toBe("confirmed");
    // No travel file for a refused booking.
    expect((await failure(journeys.travelFile(id))).code).toBe("INVALID_STATE");

    const alternative = refused.alternatives[0]!;
    const review2 = await call(journeys.chooseItinerary(id, alternative.id));
    expect(review2).toMatchObject({ stage: "review", booking: null, selected_itinerary_id: alternative.id });
    await call(journeys.submitBooking(id));
    const booked = await call(journeys.checkBooking(id));
    expect(booked.stage).toBe("booked");
    expect((await settled(journeys.travelFile(id))).itinerary.id).toBe(alternative.id);
  });

  it("answers 409 INVALID_STATE to calls made in the wrong stage and leaves the state untouched", async () => {
    const { conversation_id: id } = await confirmed();
    const started = await call(journeys.start(id));
    const expectInvalid = async (promise: Promise<unknown>, detail: string, code = "INVALID_STATE", status = 409) => {
      const error = await failure(promise);
      expect([error.status, error.code, error.detail]).toEqual([status, code, detail]);
    };

    await expectInvalid(journeys.acceptAdjustment(id, "adj_x"), "Cet ajustement n'est plus proposé. Relancez la recherche.");
    await expectInvalid(journeys.chooseItinerary(id, "iti_x"), "Cet itinéraire n'est plus proposé. Relancez la recherche.");
    await expectInvalid(journeys.submitBooking(id), "Choisissez d'abord un itinéraire à réserver.");
    await expectInvalid(journeys.travelFile(id), "Le dossier de voyage est disponible une fois la réservation confirmée.");
    await expectInvalid(journeys.giveFeedback(id, { rating: 5 }), "Le retour d'expérience se donne après la sortie.");
    await expectInvalid(journeys.chooseDestination(id, "paris", []), "Cette destination n'est plus proposée. Relancez la recherche.");
    await expectInvalid(
      journeys.chooseDestination(id, "carcassonne", ["albi-1"]),
      "Cette activité n'existe pas pour la destination choisie.",
      "UNKNOWN_ACTIVITY",
    );
    // Checking a booking that is not waiting changes nothing.
    expect(await call(journeys.checkBooking(id))).toEqual(started);
    expect(await call(journeys.get(id))).toEqual(started);

    const found = await call(journeys.chooseDestination(id, "carcassonne", []));
    // No activity ticked means the first one.
    expect(found.itineraries[0]?.activities.map((a) => a.title)).toEqual(["Visite guidée des remparts"]);
    await call(journeys.chooseItinerary(id, found.itineraries[0]!.id));
    const pending = await call(journeys.submitBooking(id));
    await expectInvalid(
      journeys.chooseDestination(id, "albi", []),
      "Une demande de réservation est en cours : ce choix ne peut plus être modifié.",
    );
    await expectInvalid(journeys.chooseItinerary(id, found.itineraries[1]!.id), "Cet itinéraire n'est plus proposé. Relancez la recherche.");
    expect(await call(journeys.get(id))).toEqual(pending);

    await call(journeys.checkBooking(id));
    await expectInvalid(journeys.giveFeedback(id, { rating: 6 as 5 }), "Les données envoyées sont invalides.", "INVALID_BODY", 422);
    await expectInvalid(
      journeys.giveFeedback(id, { rating: 3, comment: "x".repeat(1001) }),
      "Les données envoyées sont invalides.",
      "INVALID_BODY",
      422,
    );
    expect((await call(journeys.giveFeedback(id, { rating: 3 }))).feedback).toEqual({ rating: 3, comment: null });
  });

  it("lets the teacher change destination from any open stage", async () => {
    const { conversation_id: id } = await confirmed();
    await call(journeys.start(id));
    const first = await call(journeys.chooseDestination(id, "carcassonne", TWO));
    const review = await call(journeys.chooseItinerary(id, first.itineraries[0]!.id));
    expect(review.stage).toBe("review");

    const other = await call(journeys.chooseDestination(id, "albi", ["albi-3"]));
    expect(other).toMatchObject({
      stage: "itineraries",
      selected_destination_id: "albi",
      selected_activity_ids: ["albi-3"],
      selected_itinerary_id: null,
    });
    expect(other.itineraries.every((i) => i.destination_id === "albi" && i.outbound.to_station === "Albi-Ville")).toBe(true);
  });

  it("expands a city into its stations and never proposes the city of departure", async () => {
    const toulouse = await confirmed("Toulouse");
    await call(journeys.start(toulouse.conversation_id));
    const found = await call(journeys.chooseDestination(toulouse.conversation_id, "carcassonne", TWO));
    expect(found.departure_stations).toEqual(["Toulouse Matabiau", "Toulouse Saint-Cyprien-Arènes", "Toulouse Saint-Agne"]);
    expect(found.itineraries.map((i) => i.outbound.from_station)).toEqual(found.departure_stations);
    expect(found.itineraries.map((i) => i.return.to_station)).toEqual(found.departure_stations);

    const local = await confirmed("Carcassonne");
    const started = await call(journeys.start(local.conversation_id));
    expect(started.departure_stations).toEqual(["Carcassonne"]);
    expect(started.destinations.map((d) => d.id)).toEqual(["albi", "sete", "castelnaudary", "montauban"]);
  });

  it("is stored with the demo conversation and dropped when the confirmation is lost", async () => {
    const conversation = await confirmed();
    const id = conversation.conversation_id;
    await call(journeys.start(id));
    const found = await call(journeys.chooseDestination(id, "carcassonne", TWO));

    // Survives a reload of the page (same localStorage, new module instances).
    await reload();
    expect(await call(journeys.get(id))).toEqual(found);

    // A panel edit clears the confirmation: the journey goes with it…
    const edited = await settled(conversations.editField(id, "participants_count", 32, conversation.version));
    expect(edited.state).toBe("AWAITING_CONFIRMATION");
    expect((await failure(journeys.get(id))).detail).toBe("Aucune recherche n'est en cours pour ce projet.");
    expect((await failure(journeys.chooseItinerary(id, found.itineraries[0]!.id))).code).toBe("INVALID_STATE");
    // …and does not come back with the next confirmation.
    await settled(conversations.confirm(id, edited.version));
    expect((await failure(journeys.get(id))).code).toBe("INVALID_STATE");
    const restarted = await call(journeys.start(id));
    expect(restarted).toMatchObject({ stage: "destinations", requirements_version: edited.version, itineraries: [] });
    await reload();
    expect(await call(journeys.get(id))).toEqual(restarted);

    // A chat message that reopens the project drops it as well.
    await say(id, "Finalement, nous serons 35.");
    expect((await failure(journeys.get(id))).code).toBe("INVALID_STATE");
  });
});
