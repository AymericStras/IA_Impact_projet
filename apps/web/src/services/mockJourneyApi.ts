/**
 * Demo-mode journey after confirmation (NEXT_PUBLIC_DEMO_MODE=true): a scripted port of the
 * backend's simulation — `services/api/app/services/planner.py` (catalogue, itineraries,
 * adjustments, travel file) and the journey methods of `services/conversation.py` (stages,
 * French messages, error codes). See docs/PLANNER_CONTRACT.md.
 *
 * This is scaffolding so that demo mode shows every stage and branch; it is not a planner
 * and must not grow into one. Outputs stay valid against
 * `packages/contracts/journey.schema.json` and `travel_file.schema.json` (Ajv test).
 * The state lives with the demo conversation (localStorage) and is dropped with its
 * confirmation.
 */
import { formatTime } from "@/lib/format";
import type { CompleteRequirements, DateTimeRequirement } from "@/types/contracts";
import type {
  Adjustment,
  DestinationOption,
  Feedback,
  Itinerary,
  Journey,
  JourneyScenarios,
  RequirementChange,
  TimedActivity,
  TravelFile,
} from "@/types/journey";
import type { JourneyService } from "./journeyTypes";
import { mockJourneyBridge } from "./mockConversationApi";
import { ApiError } from "./types";

// ---------------------------------------------------------------------------
// French texts, copied from the backend (planner.py, conversation.py, main.py)
// ---------------------------------------------------------------------------

const T = {
  simulationNotice:
    "Simulation : destinations, horaires, lieux et réservation sont illustratifs, sans disponibilité réelle.",
  travelTimeNotice: "Les durées de trajet simulées ne dépendent pas de la gare de départ indiquée.",
  plannerUnavailable:
    "La recherche a rencontré un problème technique. Cela ne signifie pas qu'aucun trajet n'existe ; vos informations sont conservées, vous pouvez réessayer.",
  bookingUnavailable:
    "Le service de réservation ne répond pas. Votre demande n'a pas été envoyée ; vous pouvez réessayer.",
  notConfirmed: "Confirmez d'abord vos informations avant de rechercher des propositions.",
  noJourney: "Aucune recherche n'est en cours pour ce projet.",
  bookingInProgress: "Une demande de réservation est en cours : ce choix ne peut plus être modifié.",
  destinationGone: "Cette destination n'est plus proposée. Relancez la recherche.",
  unknownActivity: "Cette activité n'existe pas pour la destination choisie.",
  adjustmentGone: "Cet ajustement n'est plus proposé. Relancez la recherche.",
  itineraryGone: "Cet itinéraire n'est plus proposé. Relancez la recherche.",
  chooseItineraryFirst: "Choisissez d'abord un itinéraire à réserver.",
  travelFileNotReady: "Le dossier de voyage est disponible une fois la réservation confirmée.",
  feedbackTooEarly: "Le retour d'expérience se donne après la sortie.",
  invalidBody: "Les données envoyées sont invalides.",
  destinations: "Voici des destinations adaptées à votre thème. Choisissez une destination et vos activités.",
  noDestination:
    "Aucune destination ne correspond à votre demande. Vos informations sont conservées ; vous pouvez les modifier et relancer la recherche.",
  itineraries: (count: number) =>
    `${count} itinéraire${count > 1 ? "s" : ""} possible${count > 1 ? "s" : ""}. Choisissez celui qui vous convient.`,
  adjustments:
    "Aucun itinéraire ne correspond exactement à votre demande. Voici ce qui deviendrait possible ; rien n'est modifié sans votre accord.",
  noMatch:
    "Aucun itinéraire n'a été trouvé pour ce choix, même avec des ajustements raisonnables. Choisissez une autre destination ou modifiez votre demande.",
  review:
    "Vérifiez une dernière fois l'itinéraire avant d'envoyer la demande de réservation. Rien n'est réservé tant que vous n'avez pas envoyé la demande.",
  bookingPending: "Demande envoyée au service de réservation. En attente de confirmation.",
  bookingRefused: "La demande n'a pas pu être confirmée (simulation : plus de places pour ce groupe).",
  refusedWithAlternatives:
    "La réservation n'a pas été confirmée. Voici d'autres itinéraires possibles ; vous pouvez aussi modifier votre demande.",
  refusedWithoutAlternatives:
    "La réservation n'a pas été confirmée. Choisissez une autre destination ou modifiez votre demande.",
  bookingConfirmed: (reference: string) => `Réservation confirmée (simulation). Référence ${reference}.`,
  booked: "Votre réservation est confirmée. Votre dossier de voyage est prêt.",
  thanks: "Merci pour votre retour d'expérience.",
  reason: (city: string) =>
    `Le temps disponible à ${city} entre l'arrivée et le départ du train de retour est trop court pour les activités choisies.`,
  returnLater: (after: string, before: string) => `Retour à ${formatTime(after)} au lieu de ${formatTime(before)}`,
  departureEarlier: (after: string, before: string) => `Départ à ${formatTime(after)} au lieu de ${formatTime(before)}`,
  fewerActivities: (title: string) => `Une seule activité : ${title}`,
  otherDestination: (title: string, minutes: number) =>
    `Une destination plus proche : ${title} (${minutes} min de trajet)`,
  fullDay: "Journée complète",
  earlyReturn: "Retour anticipé",
  lateDeparture: "Départ décalé",
  line: (from: string, to: string) => `liO ${from} – ${to} (horaire simulé)`,
  checkTimes: "Horaires de départ et de retour respectés",
  checkCapacity: (count: number) => `Capacité pour ${count} participants (simulée)`,
  checkWalk: (minutes: number) => `Lieux à ${minutes} minutes à pied de la gare au plus`,
  checkOnSite: "Temps sur place suffisant pour les activités choisies",
  fileTitle: (title: string) => `Sortie pédagogique — ${title}`,
  safetyAdvice: [
    "Compter les élèves à chaque montée et descente de train.",
    "Prévoir la liste des participants et les numéros d'urgence des familles.",
    "Désigner un adulte en tête et un adulte en fin de groupe pour les trajets à pied.",
    "Arriver en gare 20 minutes avant le départ.",
  ],
  usefulContacts: [
    "Accueil groupes de la gare de départ (coordonnées fournies par le module de réservation)",
    "Lieu d'accueil sur place (coordonnées fournies par le module d'activités)",
    "Numéro d'urgence européen : 112",
  ],
};

const WALK_BUFFER_MINUTES = 15;
const MAX_SHIFT_MINUTES = 90;
/** Simulated latency of every call (ms): long enough for the pending states to be seen. */
const LATENCY_MS = 300;

// ---------------------------------------------------------------------------
// Illustrative catalogue (same data as planner.py)
// ---------------------------------------------------------------------------

const CITY_STATIONS: Record<string, string[]> = {
  toulouse: ["Toulouse Matabiau", "Toulouse Saint-Cyprien-Arènes", "Toulouse Saint-Agne"],
  montpellier: ["Montpellier Saint-Roch", "Montpellier Sud de France"],
  nimes: ["Nîmes Centre", "Nîmes Pont-du-Gard"],
  albi: ["Albi-Ville", "Albi-Madeleine"],
  narbonne: ["Narbonne"],
  perpignan: ["Perpignan"],
  montauban: ["Montauban Ville-Bourbon"],
  carcassonne: ["Carcassonne"],
  beziers: ["Béziers"],
  tarbes: ["Tarbes"],
  rodez: ["Rodez"],
};

interface CatalogueEntry {
  slug: string;
  city: string;
  station: string;
  travelMinutes: number;
  keywords: string[];
  title: string;
  match: string;
  /** [title, walking minutes, note] */
  places: Array<[string, number, string]>;
  /** [title, description, duration in minutes] */
  activities: Array<[string, string, number]>;
}

const CATALOGUE: CatalogueEntry[] = [
  {
    slug: "carcassonne",
    city: "Carcassonne",
    station: "Carcassonne",
    travelMinutes: 55,
    keywords: ["moyen age", "medieval", "histoire", "chateau", "fortifi", "croisade"],
    title: "Cité médiévale de Carcassonne",
    match: "Une cité fortifiée pour aborder le Moyen Âge sur le terrain.",
    places: [
      ["Cité et remparts", 20, "Accueil des groupes sur réservation ; horaires à confirmer."],
      ["Château comtal", 22, "Visite commentée possible pour les scolaires."],
    ],
    activities: [
      ["Visite guidée des remparts", "Parcours commenté des fortifications.", 90],
      ["Atelier « vie au Moyen Âge »", "Atelier pédagogique en demi-groupes.", 75],
      ["Jeu de piste dans la cité", "Enquête par équipes dans les ruelles.", 60],
    ],
  },
  {
    slug: "albi",
    city: "Albi",
    station: "Albi-Ville",
    travelMinutes: 65,
    keywords: ["architecture", "art", "cathedrale", "patrimoine", "peinture", "histoire"],
    title: "Albi, cité épiscopale",
    match: "Un ensemble en brique pour travailler l'architecture et le patrimoine.",
    places: [
      ["Cathédrale Sainte-Cécile", 12, "Entrée libre ; visite de groupe à annoncer."],
      ["Musée Toulouse-Lautrec", 14, "Créneaux scolaires sur réservation."],
    ],
    activities: [
      ["Lecture d'architecture à la cathédrale", "Observation guidée du gothique méridional.", 75],
      ["Parcours dans la cité épiscopale", "Croquis et relevés en petits groupes.", 90],
      ["Atelier au musée", "Analyse d'œuvres avec un médiateur.", 60],
    ],
  },
  {
    slug: "sete",
    city: "Sète",
    station: "Sète",
    travelMinutes: 125,
    keywords: ["svt", "biodiversite", "sciences", "ecologie", "environnement", "mer", "biologie"],
    title: "Sète et l'étang de Thau",
    match: "Un milieu lagunaire pour étudier la biodiversité et les écosystèmes.",
    places: [
      ["Étang de Thau", 18, "Site naturel ; accès libre, médiation sur réservation."],
      ["Musée de la mer", 20, "Accueil des classes en matinée."],
    ],
    activities: [
      ["Découverte de l'étang de Thau", "Observation du milieu avec un médiateur.", 105],
      ["Atelier d'analyse de l'eau", "Mesures simples et interprétation.", 75],
    ],
  },
  {
    slug: "castelnaudary",
    city: "Castelnaudary",
    station: "Castelnaudary",
    travelMinutes: 40,
    keywords: ["geographie", "canal", "eau", "territoire", "amenagement", "technologie", "patrimoine"],
    title: "Canal du Midi à Castelnaudary",
    match: "Un ouvrage d'aménagement pour relier géographie, histoire et technique.",
    places: [
      ["Grand Bassin", 10, "Accès libre toute l'année."],
      ["Écluses de Saint-Roch", 15, "Démonstration possible selon la navigation."],
    ],
    activities: [
      ["Le Grand Bassin et les écluses", "Lecture de paysage et fonctionnement des écluses.", 75],
      ["Atelier cartographie", "Tracé du canal et repérage sur carte.", 60],
    ],
  },
  {
    slug: "montauban",
    city: "Montauban",
    station: "Montauban Ville-Bourbon",
    travelMinutes: 35,
    keywords: ["francais", "litterature", "arts plastiques", "musee", "dessin", "sculpture", "art"],
    title: "Montauban, musée Ingres Bourdelle",
    match: "Un musée pour travailler le dessin, la sculpture et le récit.",
    places: [
      ["Musée Ingres Bourdelle", 15, "Créneaux scolaires sur réservation."],
      ["Place Nationale", 12, "Espace public ; accès libre."],
    ],
    activities: [
      ["Visite du musée", "Parcours thématique avec un médiateur.", 75],
      ["Atelier de pratique", "Croquis et écriture à partir des œuvres.", 75],
    ],
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .toLowerCase();
}

/** Deterministic id; the backend uses SHA-256, any stable digest does for the demo. */
function digest(text: string, length: number): string {
  let out = "";
  for (let seed = 0; out.length < length; seed += 1) {
    let hash = 0x811c9dc5 ^ seed;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    out += (hash >>> 0).toString(16).padStart(8, "0");
  }
  return out.slice(0, length);
}

function stableId(prefix: string, ...parts: Array<string | number>): string {
  return `${prefix}_${digest(parts.join("|"), 10)}`;
}

/**
 * Wall-clock time in Paris, as minutes on a UTC-based scale: enough for same-day arithmetic.
 * (A shift across a daylight-saving change would be off by an hour; the demo has no such case.)
 */
function wall(date: string, time: string): number {
  return Date.parse(`${date}T${time}:00Z`) / 60_000;
}

function hhmm(minutes: number): string {
  return new Date(minutes * 60_000).toISOString().slice(11, 16);
}

const offsetFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "longOffset" });

/** "2026-11-12T08:05+01:00": local ISO date-time with the Paris offset, to the minute. */
function iso(minutes: number): string {
  const instant = new Date(minutes * 60_000);
  const zone = offsetFormatter.formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  const offset = /([+-]\d{2}:\d{2})/.exec(zone)?.[1] ?? "+00:00";
  return `${instant.toISOString().slice(0, 16)}${offset}`;
}

function delay(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
}

function invalidState(detail: string): ApiError {
  return new ApiError(409, "État invalide", detail, "INVALID_STATE");
}

// ---------------------------------------------------------------------------
// Simulation (port of planner.py)
// ---------------------------------------------------------------------------

function departureStations(stationOrCity: string): string[] {
  return CITY_STATIONS[fold(stationOrCity).trim()] ?? [stationOrCity];
}

function activityId(entry: CatalogueEntry, index: number): string {
  return `${entry.slug}-${index + 1}`;
}

function toOption(entry: CatalogueEntry): DestinationOption {
  return {
    id: entry.slug,
    city: entry.city,
    station: entry.station,
    title: entry.title,
    theme_match: entry.match,
    travel_minutes: entry.travelMinutes,
    places: entry.places.map(([title, walk_minutes, note]) => ({ title, walk_minutes, note })),
    activities: entry.activities.map(([title, description, duration_minutes], index) => ({
      id: activityId(entry, index),
      title,
      description,
      duration_minutes,
    })),
  };
}

/** Destinations ranked by keyword match with the subject and theme; the origin is excluded. */
function recommendDestinations(requirements: CompleteRequirements): DestinationOption[] {
  const teaching = requirements.teaching_type;
  const wanted = fold([teaching.subject, teaching.theme].filter(Boolean).join(" "));
  const origins = new Set(departureStations(requirements.departure_station).map(fold));
  const score = (entry: CatalogueEntry) => entry.keywords.filter((keyword) => wanted.includes(keyword)).length;
  return CATALOGUE.filter((entry) => !origins.has(fold(entry.station)) && !origins.has(fold(entry.city)))
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => score(b.entry) - score(a.entry) || a.index - b.index)
    .slice(0, 4)
    .map(({ entry }) => toOption(entry));
}

/** The simulated train time for a requested time: it never violates the constraint. */
function anchor(requirement: DateTimeRequirement, outbound: boolean): number {
  const shift = {
    exact: 0,
    approximate: outbound ? 5 : -5,
    earliest: 10,
    latest: -10,
  }[requirement.constraint];
  return wall(requirement.date, requirement.time) + shift;
}

function chosenActivities(entry: CatalogueEntry, activityIds: string[]): Array<[string, number]> {
  const byId = new Map(entry.activities.map(([title, , minutes], index) => [activityId(entry, index), [title, minutes]] as const));
  if (activityIds.some((id) => !byId.has(id))) {
    throw new ApiError(409, "Activité inconnue", T.unknownActivity, "UNKNOWN_ACTIVITY");
  }
  const ids = activityIds.length > 0 ? activityIds : [activityId(entry, 0)];
  return ids.map((id) => [...(byId.get(id) as readonly [string, number])] as [string, number]);
}

/**
 * Feasible itineraries for one destination and the chosen activities (empty when none fits).
 * `strictMinutes` is the test lever of the `adjustments` scenario: extra time needed on site.
 */
function buildItineraries(
  requirements: CompleteRequirements,
  destinationId: string,
  activityIds: string[],
  strictMinutes: number,
): Itinerary[] {
  const entry = CATALOGUE.find((candidate) => candidate.slug === destinationId);
  if (!entry) throw new ApiError(409, "Destination inconnue", T.destinationGone, "UNKNOWN_DESTINATION");
  const activities = chosenActivities(entry, activityIds);
  const planned = activities.reduce((sum, [, minutes]) => sum + minutes, 0);
  const needed = planned + strictMinutes;
  const walk = Math.max(...entry.places.map(([, minutes]) => minutes));
  const leave = anchor(requirements.departure, true);
  const back = anchor(requirements.return, false);
  const origins = departureStations(requirements.departure_station);

  const variants: Array<[string, number, number]> = [[T.fullDay, 0, 0]];
  if (requirements.return.constraint === "latest" || requirements.return.constraint === "approximate") {
    variants.push([T.earlyReturn, 0, -60]);
  }
  if (requirements.departure.constraint === "earliest" || requirements.departure.constraint === "approximate") {
    variants.push([T.lateDeparture, 30, 0]);
  }

  const itineraries: Itinerary[] = [];
  variants.forEach(([label, leaveShift, backShift], index) => {
    const depart = leave + leaveShift;
    const arriveHome = back + backShift;
    const arriveThere = depart + entry.travelMinutes;
    const leaveThere = arriveHome - entry.travelMinutes;
    const onSite = leaveThere - arriveThere - 2 * walk - WALK_BUFFER_MINUTES;
    if (onSite < needed) return;
    const origin = origins[index % origins.length] as string;
    const free = Math.max(0, onSite - planned);
    const gap = Math.min(60, Math.floor(free / Math.max(1, activities.length)));
    let cursor = arriveThere + walk + WALK_BUFFER_MINUTES;
    const timed: TimedActivity[] = activities.map(([title, minutes]) => {
      const end = cursor + minutes;
      const activity = { title, start: iso(cursor), end: iso(end) };
      cursor = end + gap;
      return activity;
    });
    itineraries.push({
      id: stableId("iti", entry.slug, label, iso(depart), iso(arriveHome), ...activityIds),
      destination_id: entry.slug,
      title: entry.title,
      label,
      outbound: {
        line: T.line(origin, entry.city),
        from_station: origin,
        to_station: entry.station,
        departure: iso(depart),
        arrival: iso(arriveThere),
      },
      return: {
        line: T.line(entry.city, origin),
        from_station: entry.station,
        to_station: origin,
        departure: iso(leaveThere),
        arrival: iso(arriveHome),
      },
      activities: timed,
      free_minutes: free,
      checks: [
        { label: T.checkTimes, ok: true },
        { label: T.checkCapacity(requirements.participants_count), ok: true },
        { label: T.checkWalk(walk), ok: true },
        { label: T.checkOnSite, ok: true },
      ],
      participants_count: requirements.participants_count,
      simulated: true,
    });
  });
  return itineraries;
}

function shifted(
  requirements: CompleteRequirements,
  field: "departure" | "return",
  minutes: number,
): { requirements: CompleteRequirements; change: RequirementChange } {
  const current = requirements[field];
  const after = hhmm(wall(current.date, current.time) + minutes);
  return {
    requirements: { ...requirements, [field]: { ...current, time: after } },
    change: { field, before: current.time, after },
  };
}

/** Several concrete ways to make the request feasible; only those that really unlock itineraries. */
function proposeAdjustments(
  requirements: CompleteRequirements,
  destinationId: string,
  activityIds: string[],
  strictMinutes: number,
): Adjustment[] {
  const entry = CATALOGUE.find((candidate) => candidate.slug === destinationId) as CatalogueEntry;
  const reason = T.reason(entry.city);
  const options: Adjustment[] = [];
  const add = (
    kind: Adjustment["kind"],
    label: string,
    unlocked: Itinerary[],
    extra: Pick<Adjustment, "changes" | "destination_id" | "activity_ids">,
  ) => {
    if (unlocked.length === 0) return;
    options.push({ id: stableId("adj", kind, label), kind, label, reason, unlocks: unlocked.length, ...extra });
  };

  const sameDayLimit = wall(requirements.return.date, "23:00");
  for (const minutes of [30, 60, MAX_SHIFT_MINUTES]) {
    if (wall(requirements.return.date, requirements.return.time) + minutes > sameDayLimit) continue;
    const { requirements: changed, change } = shifted(requirements, "return", minutes);
    add("return_later", T.returnLater(change.after, change.before), buildItineraries(changed, destinationId, activityIds, strictMinutes), {
      changes: [change],
      destination_id: null,
      activity_ids: null,
    });
  }
  const earliestDeparture = wall(requirements.departure.date, "06:00");
  for (const minutes of [30, 60, MAX_SHIFT_MINUTES]) {
    if (wall(requirements.departure.date, requirements.departure.time) - minutes < earliestDeparture) continue;
    const { requirements: changed, change } = shifted(requirements, "departure", -minutes);
    add(
      "departure_earlier",
      T.departureEarlier(change.after, change.before),
      buildItineraries(changed, destinationId, activityIds, strictMinutes),
      { changes: [change], destination_id: null, activity_ids: null },
    );
  }
  const chosenIds = activityIds.length > 0 ? activityIds : [activityId(entry, 0)];
  if (chosenIds.length > 1) {
    const duration = (id: string) => (chosenActivities(entry, [id])[0] as [string, number])[1];
    const shortest = chosenIds.reduce((best, id) => (duration(id) < duration(best) ? id : best));
    const title = (chosenActivities(entry, [shortest])[0] as [string, number])[0];
    add("fewer_activities", T.fewerActivities(title), buildItineraries(requirements, destinationId, [shortest], strictMinutes), {
      changes: [],
      destination_id: null,
      activity_ids: [shortest],
    });
  }
  for (const other of recommendDestinations(requirements)) {
    if (other.id === destinationId || other.travel_minutes >= entry.travelMinutes) continue;
    const first = [(other.activities[0] as DestinationOption["activities"][number]).id];
    add(
      "other_destination",
      T.otherDestination(other.title, other.travel_minutes),
      buildItineraries(requirements, other.id, first, strictMinutes),
      { changes: [], destination_id: other.id, activity_ids: first },
    );
  }
  // Keep the list readable: the smallest change of each kind first, then the larger ones.
  const primary: Adjustment[] = [];
  for (const option of options) {
    if (primary.every((kept) => kept.kind !== option.kind)) primary.push(option);
  }
  return [...primary, ...options.filter((option) => !primary.includes(option))].slice(0, 6);
}

function bookingReference(conversationId: string, itineraryId: string): string {
  return `SIM-${digest(`${conversationId}|${itineraryId}`, 8).toUpperCase()}`;
}

function buildTravelFile(requirements: CompleteRequirements, itinerary: Itinerary, reference: string): TravelFile {
  const entry = CATALOGUE.find((candidate) => candidate.slug === itinerary.destination_id) as CatalogueEntry;
  // The itinerary's date-times are local Paris times: the clock time is read as written.
  const at = (value: string) => formatTime(value.slice(11, 16));
  return {
    reference,
    title: T.fileTitle(entry.title),
    requirements,
    itinerary,
    places: entry.places.map(([title, walk_minutes, note]) => ({ title, walk_minutes, note })),
    schedule: [
      `${at(itinerary.outbound.departure)} — Départ de ${itinerary.outbound.from_station}`,
      `${at(itinerary.outbound.arrival)} — Arrivée à ${itinerary.outbound.to_station}`,
      ...itinerary.activities.map((activity) => `${at(activity.start)} – ${at(activity.end)} — ${activity.title}`),
      `${at(itinerary.return.departure)} — Départ de ${itinerary.return.from_station}`,
      `${at(itinerary.return.arrival)} — Retour à ${itinerary.return.to_station}`,
    ],
    safety_advice: [...T.safetyAdvice],
    useful_contacts: [...T.usefulContacts],
    official_links: [],
    simulated: true,
  };
}

// ---------------------------------------------------------------------------
// Stages (port of the journey methods of conversation.py)
// ---------------------------------------------------------------------------

const OPEN_STAGES: Array<Journey["stage"]> = ["destinations", "itineraries", "adjustments", "no_match", "review", "booking_refused"];

/** Itineraries for the current choice, or the adjustments that would make it work. */
function search(journey: Journey, requirements: CompleteRequirements): void {
  const destinationId = journey.selected_destination_id ?? "";
  const activityIds = journey.selected_activity_ids;
  journey.itineraries = buildItineraries(requirements, destinationId, activityIds, journey.strict_minutes);
  journey.adjustments = [];
  journey.selected_itinerary_id = null;
  journey.booking = null;
  journey.alternatives = [];
  if (journey.itineraries.length > 0) {
    journey.stage = "itineraries";
    journey.message = T.itineraries(journey.itineraries.length);
    return;
  }
  journey.adjustments = proposeAdjustments(requirements, destinationId, activityIds, journey.strict_minutes);
  if (journey.adjustments.length > 0) {
    journey.stage = "adjustments";
    journey.message = T.adjustments;
  } else {
    journey.stage = "no_match";
    journey.message = T.noMatch;
  }
}

/** The journey in progress and the confirmed requirements it was computed for. */
function current(conversationId: string): { journey: Journey; requirements: CompleteRequirements } {
  const { confirmed, journey } = mockJourneyBridge.read(conversationId);
  if (!confirmed || !journey) throw invalidState(T.noJourney);
  return { journey, requirements: confirmed.requirements };
}

function saved(conversationId: string, journey: Journey): Journey {
  mockJourneyBridge.saveJourney(conversationId, journey);
  return JSON.parse(JSON.stringify(journey)) as Journey;
}

export const mockJourneyApi: JourneyService = {
  async start(conversationId, scenarios: JourneyScenarios = {}) {
    await delay();
    const { confirmed, version } = mockJourneyBridge.read(conversationId);
    if (!confirmed) throw invalidState(T.notConfirmed);
    const scenario = scenarios.search_scenario ?? "auto";
    if (scenario === "error") throw new ApiError(502, "Service indisponible", T.plannerUnavailable, "PLANNER_ERROR");
    const noDestination = scenario === "no_match";
    return saved(conversationId, {
      conversation_id: conversationId,
      stage: noDestination ? "no_match" : "destinations",
      requirements_version: version,
      planner_mode: "simulated",
      simulated: true,
      departure_stations: departureStations(confirmed.requirements.departure_station),
      notices: [T.simulationNotice, T.travelTimeNotice],
      message: noDestination ? T.noDestination : T.destinations,
      destinations: noDestination ? [] : recommendDestinations(confirmed.requirements),
      selected_destination_id: null,
      selected_activity_ids: [],
      itineraries: [],
      adjustments: [],
      accepted_adjustments: [],
      selected_itinerary_id: null,
      booking: null,
      alternatives: [],
      feedback: null,
      search_scenario: scenario,
      booking_scenario: scenarios.booking_scenario ?? "confirmed",
      strict_minutes: 0,
    });
  },

  async get(conversationId) {
    await delay();
    return current(conversationId).journey;
  },

  async chooseDestination(conversationId, destinationId, activityIds) {
    await delay();
    const { journey, requirements } = current(conversationId);
    if (!OPEN_STAGES.includes(journey.stage)) throw invalidState(T.bookingInProgress);
    if (journey.destinations.every((destination) => destination.id !== destinationId)) throw invalidState(T.destinationGone);
    journey.selected_destination_id = destinationId;
    journey.selected_activity_ids = [...activityIds];
    journey.strict_minutes = 0;
    if (journey.search_scenario === "adjustments" && journey.accepted_adjustments.length === 0) {
      // Test lever: raise the time needed on site just enough that nothing fits as asked.
      for (let extra = 15; extra <= 600; extra += 15) {
        if (buildItineraries(requirements, destinationId, activityIds, extra).length === 0) {
          journey.strict_minutes = extra;
          break;
        }
      }
    }
    search(journey, requirements);
    return saved(conversationId, journey);
  },

  async acceptAdjustment(conversationId, adjustmentId) {
    await delay();
    const { journey } = current(conversationId);
    const chosen = journey.adjustments.find((adjustment) => adjustment.id === adjustmentId);
    if (journey.stage !== "adjustments" || !chosen) throw invalidState(T.adjustmentGone);
    if (chosen.destination_id != null) journey.selected_destination_id = chosen.destination_id;
    if (chosen.activity_ids != null) journey.selected_activity_ids = [...chosen.activity_ids];
    if (chosen.changes.length > 0) {
      // Explicit consent to the before/after values: only now do the requirements change.
      journey.requirements_version = mockJourneyBridge.applyAcceptedChanges(conversationId, chosen.changes, chosen.label);
    }
    journey.accepted_adjustments.push(chosen);
    const confirmed = mockJourneyBridge.read(conversationId).confirmed;
    if (!confirmed) throw invalidState(T.noJourney);
    search(journey, confirmed.requirements);
    return saved(conversationId, journey);
  },

  async chooseItinerary(conversationId, itineraryId) {
    await delay();
    const { journey } = current(conversationId);
    const offered = [...journey.itineraries, ...journey.alternatives];
    if (
      !["itineraries", "review", "booking_refused"].includes(journey.stage) ||
      offered.every((itinerary) => itinerary.id !== itineraryId)
    ) {
      throw invalidState(T.itineraryGone);
    }
    journey.selected_itinerary_id = itineraryId;
    journey.booking = null;
    journey.stage = "review";
    journey.message = T.review;
    return saved(conversationId, journey);
  },

  async submitBooking(conversationId) {
    await delay();
    const { journey } = current(conversationId);
    if (journey.stage !== "review" || journey.selected_itinerary_id === null) throw invalidState(T.chooseItineraryFirst);
    if (journey.booking_scenario === "error") {
      throw new ApiError(502, "Service indisponible", T.bookingUnavailable, "BOOKING_ERROR");
    }
    journey.booking = {
      reference: bookingReference(conversationId, journey.selected_itinerary_id),
      status: "pending",
      itinerary_id: journey.selected_itinerary_id,
      message: T.bookingPending,
      simulated: true,
    };
    journey.stage = "booking_pending";
    journey.message = journey.booking.message;
    return saved(conversationId, journey);
  },

  async checkBooking(conversationId) {
    await delay();
    const { journey } = current(conversationId);
    // Nothing to wait for: the stage already tells what happened.
    if (journey.stage !== "booking_pending" || !journey.booking) return journey;
    const booking = journey.booking;
    if (journey.booking_scenario === "refused") {
      booking.status = "refused";
      booking.message = T.bookingRefused;
      journey.alternatives = journey.itineraries.filter((itinerary) => itinerary.id !== booking.itinerary_id);
      journey.stage = "booking_refused";
      journey.message = journey.alternatives.length > 0 ? T.refusedWithAlternatives : T.refusedWithoutAlternatives;
      journey.booking_scenario = "confirmed"; // the simulated refusal happens once
    } else {
      booking.status = "confirmed";
      booking.message = T.bookingConfirmed(booking.reference);
      journey.stage = "booked";
      journey.message = T.booked;
    }
    return saved(conversationId, journey);
  },

  async travelFile(conversationId) {
    await delay();
    const { journey, requirements } = current(conversationId);
    const booking = journey.booking;
    const itinerary = booking
      ? [...journey.itineraries, ...journey.alternatives].find((candidate) => candidate.id === booking.itinerary_id)
      : undefined;
    if (!["booked", "closed"].includes(journey.stage) || !booking || !itinerary) throw invalidState(T.travelFileNotReady);
    return buildTravelFile(requirements, itinerary, booking.reference);
  },

  async giveFeedback(conversationId, feedback: Feedback) {
    await delay();
    const { journey } = current(conversationId);
    const comment = feedback.comment ?? null;
    if (![1, 2, 3, 4, 5].includes(feedback.rating) || (comment !== null && comment.length > 1000)) {
      throw new ApiError(422, "Données invalides", T.invalidBody, "INVALID_BODY");
    }
    if (!["booked", "closed"].includes(journey.stage)) throw invalidState(T.feedbackTooEarly);
    journey.feedback = { rating: feedback.rating, comment };
    journey.stage = "closed";
    journey.message = T.thanks;
    return saved(conversationId, journey);
  },
};
