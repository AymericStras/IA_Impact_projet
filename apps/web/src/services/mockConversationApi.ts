/**
 * Demo service (NEXT_PUBLIC_DEMO_MODE=true): a small deterministic state
 * machine that plays the server's role, without any AI model or network.
 *
 * It reproduces the `ConversationResponse` contract and the French templates of
 * `services/api/app/prompts/dialogue_policy.md`. The "extraction" relies on
 * deliberately simple regular expressions: this is demo scaffolding, clearly
 * labelled in the UI, not a model capability.
 */

import { fr } from "@/i18n/fr";
import { DEFAULT_CLIENT_CONFIG } from "@/lib/env";
import { formatConstraint, formatDate } from "@/lib/format";
import { readJson, storageKey, takeFlag, writeJson } from "@/lib/storage";
import type {
  ConfirmedRequirements,
  ConversationResponse,
  ConversationState,
  DateTimeRequirement,
  FieldName,
  Message,
  PartialDateTime,
  PartialRequirements,
  PendingClarification,
  RequirementValue,
  SendMessageBody,
  TeachingType,
  TimeConstraint,
} from "@/types/contracts";
import { ApiError, type ConversationService } from "./types";

// ---------------------------------------------------------------------------
// Templates (copied from dialogue_policy.md, the backend's source of truth)
// ---------------------------------------------------------------------------

const T = {
  welcome:
    "Bonjour ! Décrivez-moi votre projet de sortie pédagogique : combien de participants, quand partir et revenir, et sur quel thème. Vous pouvez écrire ou parler.",
  askParticipants: "Combien de personnes participeront à la sortie, élèves et accompagnateurs compris ?",
  clarifyStudentsOnly: (students: number) =>
    `Combien d'accompagnateurs participeront à la sortie avec les ${students} élèves ?`,
  askDeparture: "Quel jour et à quelle heure souhaitez-vous partir ?",
  askDepartureTime: (date: string) => `À quelle heure souhaitez-vous partir le ${date} ?`,
  askReturn: "Quel jour et à quelle heure souhaitez-vous être de retour ?",
  askReturnTime: (date: string) => `À quelle heure souhaitez-vous être de retour le ${date} ?`,
  askTeaching: "Quelle est la matière ou le thème pédagogique de cette sortie ?",
  clarifyRelativeDate: "Pouvez-vous me préciser la date exacte ?",
  clarifyVagueQuantity: "Pouvez-vous me donner le nombre exact de participants ?",
  conflict: (old: string, label: string) =>
    `J'ai noté ${old} pour ${label}, mais vous indiquez maintenant autre chose. Quelle valeur dois-je retenir ?`,
  invalidReturnBeforeDeparture: (ret: string, dep: string) =>
    `L'heure de retour (${ret}) est antérieure au départ (${dep}). Pouvez-vous corriger l'heure de retour ?`,
  summarize: (participants: number, dep: string, ret: string, theme: string) =>
    `J'ai bien compris votre projet : ${participants} participants, départ le ${dep}, retour le ${ret}, thème : ${theme}. Pouvez-vous vérifier ces informations avant de continuer ?`,
  acknowledge:
    "Merci, votre projet est confirmé. Je transmets ces informations pour la préparation de l'itinéraire.",
  reopen: (label: string, value: string, summary: string) => `Très bien, j'ai mis à jour ${label} : ${value}. ${summary}`,
  // Prefix used when a chat message overwrites an already known value.
  replaced: (changes: string) => `C'est noté, j'ai mis à jour ${changes}. `,
  nothingNew: "Je n'ai pas trouvé d'information sur votre projet dans ce message. ",
  providerError: "Désolé, je n'ai pas pu traiter votre message. Pouvez-vous réessayer ?",
  staleVersion: "Les informations ont été modifiées entre-temps. Rechargez le projet avant de modifier à nouveau.",
  confirmNotReady: "La confirmation n'est possible qu'une fois le récapitulatif complet et vérifié.",
  exportNotReady: "Le projet n'est pas encore confirmé.",
  notFound: "Conversation introuvable.",
  emptyMessage: "Le message est vide.",
  invalidValue: "La valeur fournie n'est pas valide.",
  participantsLabel: "le nombre de participants",
  departureLabel: "le départ",
  returnLabel: "le retour",
  teachingLabel: "le thème pédagogique",
};

const FIELD_LABELS: Record<FieldName, string> = {
  participants_count: T.participantsLabel,
  departure: T.departureLabel,
  return: T.returnLabel,
  teaching_type: T.teachingLabel,
};

// "Dictated" sentences returned by the simulated transcription (script from docs/DEMO.md).
const CANNED_TRANSCRIPTS = {
  full: "Bonjour, je voudrais organiser une sortie le 12 novembre. J'ai 27 élèves et 3 accompagnateurs, on partirait vers 8 h. Je suis professeur d'histoire, on travaille sur le Moyen Âge.",
  returnOnly: "Nous aimerions être rentrés avant 17 h.",
  correction: "Finalement, nous serons 32.",
};

// ---------------------------------------------------------------------------
// Heuristic French parsing (demo only)
// ---------------------------------------------------------------------------

const NUMBER_WORDS: Record<string, number> = {
  deux: 2,
  trois: 3,
  quatre: 4,
  cinq: 5,
  six: 6,
  sept: 7,
  huit: 8,
  neuf: 9,
  dix: 10,
  onze: 11,
  douze: 12,
  treize: 13,
  quatorze: 14,
  quinze: 15,
  seize: 16,
  "dix-sept": 17,
  "dix-huit": 18,
  "dix-neuf": 19,
  vingt: 20,
  "vingt-cinq": 25,
  trente: 30,
  quarante: 40,
  cinquante: 50,
  soixante: 60,
};

const MONTHS: Record<string, number> = {
  janvier: 1,
  fevrier: 2,
  mars: 3,
  avril: 4,
  mai: 5,
  juin: 6,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  decembre: 12,
};

const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];

const SUBJECTS: Array<[RegExp, string]> = [
  [/\bhistoire(?:-geo(?:graphie)?)?\b/, "Histoire"],
  [/\bgeographie\b|\bgeo\b/, "Géographie"],
  [/\bsvt\b|sciences de la vie/, "SVT"],
  [/\bphysique(?:-chimie)?\b|\bchimie\b/, "Physique-chimie"],
  [/\bmathematiques\b|\bmaths?\b/, "Mathématiques"],
  [/\bfrancais\b|\blettres\b/, "Français"],
  [/\barts? plastiques?\b/, "Arts plastiques"],
  [/\bmusique\b|education musicale/, "Musique"],
  [/\bemc\b|education civique|enseignement moral/, "EMC"],
  [/\banglais\b/, "Anglais"],
  [/\bespagnol\b/, "Espagnol"],
  [/\ballemand\b/, "Allemand"],
  [/\boccitan\b/, "Occitan"],
  [/\blatin\b/, "Latin"],
  [/\btechnologie\b|\btechno\b/, "Technologie"],
  [/\beps\b|education physique/, "EPS"],
  [/\bphilosophie\b|\bphilo\b/, "Philosophie"],
  [/\bses\b|sciences economiques/, "SES"],
  [/\bsciences\b/, "Sciences"],
];

const THEMES: Array<[RegExp, string]> = [
  [/moyen[- ]age/, "Moyen Âge"],
  [/revolution francaise|\brevolution\b/, "Révolution française"],
  [/revolution industrielle|industrialisation/, "Révolution industrielle"],
  [/\bantiquite\b|gallo-romain|\bromains?\b/, "Antiquité"],
  [/\bprehistoire\b/, "Préhistoire"],
  [/\brenaissance\b/, "Renaissance"],
  [/premiere guerre mondiale|grande guerre/, "Première Guerre mondiale"],
  [/seconde guerre mondiale|deuxieme guerre mondiale/, "Seconde Guerre mondiale"],
  [/\bcathar/, "Catharisme"],
  [/canal du midi/, "Canal du Midi"],
  [/\barchitecture\b/, "Architecture"],
  [/\bpatrimoine\b/, "Patrimoine"],
  [/\bbiodiversite\b/, "Biodiversité"],
  [/\bgeologie\b|\bvolcans?\b/, "Géologie"],
  [/\bastronomie\b|\bespace\b/, "Astronomie"],
  [/\baeronautique\b|\baviation\b/, "Aéronautique"],
  [/\benergies?\b/, "Énergie"],
  [/\blittoral\b/, "Littoral"],
  [/\beau\b|\bhydrologie\b/, "L'eau"],
];

const ROLE_RETURN = /(retour|rentr|reven|revien|de retour)/;
const ROLE_DEPARTURE = /(depart|part|aller|rendez-vous|rdv|debut)/;

const CORRECTION =
  /\b(finalement|en fait|plutot|non,|pardon|je me suis trompe|correction|erreur|changement|au lieu de|ce sera|ce ne sera pas|rectifi|modifi|remplac)/;

const VAGUE_QUANTITY =
  /\b(une (trentaine|vingtaine|quarantaine|dizaine|quinzaine|cinquantaine)|environ \d+|a peu pres \d+|quelques|plusieurs)\b/;

const RELATIVE_DATE =
  /\b(mois prochain|semaine prochaine|bientot|prochainement|dans quelques (jours|semaines)|au printemps|cet hiver|cet automne|cet ete|un de ces jours|plus tard dans l'annee)\b/;

/** Index of the last match of a pattern inside a text window (-1 when absent). */
function lastMatchIndex(window: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, "g");
  let last = -1;
  for (const m of window.matchAll(global)) last = m.index ?? last;
  return last;
}

/** Lower-case without diacritics; indexes stay aligned with the original text. */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/’/g, "'");
}

/** Replaces spelled-out numbers with digits, for numeric parsing only. */
function digitize(norm: string): string {
  const pattern = new RegExp(
    `\\b(${Object.keys(NUMBER_WORDS)
      .sort((a, b) => b.length - a.length)
      .join("|")})\\b`,
    "g",
  );
  return norm.replace(pattern, (word) => String(NUMBER_WORDS[word] ?? word));
}

interface Token {
  index: number;
  end: number;
  kind: "date" | "time";
  date?: string;
  time?: string;
  constraint?: TimeConstraint;
}

interface Parsed {
  students?: number;
  accompanying?: number;
  total?: number;
  vagueQuantity: boolean;
  relativeDate: boolean;
  departure: Partial<PartialDateTime>;
  return: Partial<PartialDateTime>;
  teaching?: Partial<TeachingType>;
  correction: boolean;
  bareNumber?: number;
  nothing: boolean;
}

function parisToday(now: Date): { iso: string; year: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const iso = `${get("year")}-${get("month")}-${get("day")}`;
  const weekdayShort = get("weekday");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekdayShort);
  return { iso, year: Number(get("year")), weekday: weekday < 0 ? 0 : weekday };
}

function isoFrom(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function constraintBefore(text: string, index: number): TimeConstraint {
  const window = text.slice(Math.max(0, index - 28), index);
  if (/(au plus tard|avant|pas apres|maximum|dernier delai)\s*(a\s*)?$/.test(window)) return "latest";
  if (/(vers|environ|autour de|aux alentours de|a peu pres|approximativement)\s*$/.test(window)) return "approximate";
  if (/(a partir de|apres|pas avant|au plus tot|des)\s*$/.test(window)) return "earliest";
  return "exact";
}

function collectTokens(digits: string, now: Date): { tokens: Token[]; relativeDate: boolean } {
  const tokens: Token[] = [];
  const today = parisToday(now);

  const monthNames = Object.keys(MONTHS).join("|");
  const dateRe = new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${monthNames})(?:\\s+(\\d{4}))?\\b`, "g");
  for (const m of digits.matchAll(dateRe)) {
    const day = Number(m[1]);
    const month = MONTHS[m[2] ?? ""] ?? 0;
    const explicitYear = m[3] ? Number(m[3]) : null;
    let iso = isoFrom(explicitYear ?? today.year, month, day);
    if (iso && !explicitYear && iso < today.iso) iso = isoFrom(today.year + 1, month, day);
    if (iso) tokens.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "date", date: iso });
  }

  const numericDateRe = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g;
  for (const m of digits.matchAll(numericDateRe)) {
    const explicitYear = m[3] ? Number(m[3]) : null;
    let iso = isoFrom(explicitYear ?? today.year, Number(m[2]), Number(m[1]));
    if (iso && !explicitYear && iso < today.iso) iso = isoFrom(today.year + 1, Number(m[2]), Number(m[1]));
    if (iso) tokens.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "date", date: iso });
  }

  const relativeDayRe = /\b(apres-demain|demain|(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)( prochain)?)\b/g;
  for (const m of digits.matchAll(relativeDayRe)) {
    let iso: string;
    if (m[1] === "demain") iso = addDays(today.iso, 1);
    else if (m[1] === "apres-demain") iso = addDays(today.iso, 2);
    else {
      const target = WEEKDAYS.indexOf(m[2] ?? "");
      const delta = (target - today.weekday + 7) % 7 || 7;
      iso = addDays(today.iso, delta);
    }
    tokens.push({ index: m.index ?? 0, end: (m.index ?? 0) + m[0].length, kind: "date", date: iso });
  }

  const timeRe = /\b(\d{1,2})\s*(?:h\b|heures?\b|:)\s*(\d{2})?\b/g;
  for (const m of digits.matchAll(timeRe)) {
    const hours = Number(m[1]);
    const minutes = m[2] ? Number(m[2]) : 0;
    if (hours > 23 || minutes > 59) continue;
    // "12/11" is a date, not a time: skip matches already covered by a date token.
    const index = m.index ?? 0;
    if (tokens.some((t) => index >= t.index && index < t.end)) continue;
    tokens.push({
      index,
      end: index + m[0].length,
      kind: "time",
      time: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`,
      constraint: constraintBefore(digits, index),
    });
  }
  for (const m of digits.matchAll(/\bmidi\b/g)) {
    const index = m.index ?? 0;
    tokens.push({ index, end: index + 4, kind: "time", time: "12:00", constraint: constraintBefore(digits, index) });
  }

  tokens.sort((a, b) => a.index - b.index);
  return { tokens, relativeDate: RELATIVE_DATE.test(digits) && !tokens.some((t) => t.kind === "date") };
}

function parseUtterance(text: string, current: PartialRequirements, now: Date): Parsed {
  const norm = normalize(text);
  const digits = digitize(norm);
  const parsed: Parsed = {
    vagueQuantity: false,
    relativeDate: false,
    departure: {},
    return: {},
    correction: CORRECTION.test(norm),
    nothing: true,
  };

  const bare = /^\s*(\d+)\s*(?:personnes|participants|accompagnateurs?|adultes?|eleves)?\s*[.!]?\s*$/.exec(digits);
  if (bare) parsed.bareNumber = Number(bare[1]);

  // Participants
  if (VAGUE_QUANTITY.test(norm)) parsed.vagueQuantity = true;
  const classes = /(\d+)\s*classes?\s*de\s*(\d+)/.exec(digits);
  const students = /(\d+)\s*(?:eleves?|enfants|collegiens|lyceens|ecoliers|jeunes)\b/.exec(digits);
  const accompanying =
    /(\d+)\s*(?:accompagnateurs?|accompagnants?|adultes?|enseignants?|professeurs?|profs?|parents?|collegues?|aesh)\b/.exec(
      digits,
    );
  const total =
    /(?:nous\s+(?:sommes|serons|serions)|on\s+(?:est|sera|serait)|sommes|serons)\s+(\d+)\b(?!\s*(?:eleves|accompagnateurs|adultes|classes))/.exec(
      digits,
    ) ??
    /(\d+)\s*(?:personnes|participants)\b/.exec(digits) ??
    /(\d+)\s*au\s+total/.exec(digits);
  if (classes) parsed.students = Number(classes[1]) * Number(classes[2]);
  else if (students) parsed.students = Number(students[1]);
  if (accompanying) parsed.accompanying = Number(accompanying[1]);
  if (total) parsed.total = Number(total[1]);
  if (/\b(aucun|pas d'|sans)\s*(accompagnateur|adulte)/.test(norm)) parsed.accompanying = 0;

  // Dates and times, assigned to departure or return based on the preceding keywords.
  const { tokens, relativeDate } = collectTokens(digits, now);
  parsed.relativeDate = relativeDate;
  let role: "departure" | "return" | null = null;
  let previousEnd = 0;
  for (const token of tokens) {
    const window = digits.slice(previousEnd, token.index);
    const lastReturn = lastMatchIndex(window, ROLE_RETURN);
    const lastDeparture = lastMatchIndex(window, ROLE_DEPARTURE);
    if (lastReturn >= 0 && lastReturn >= lastDeparture) role = "return";
    else if (lastDeparture >= 0) role = "departure";
    let target: "departure" | "return" | null = role;
    if (!target) {
      const part = token.kind;
      const departureHas = current.departure?.[part] ?? parsed.departure[part];
      target = departureHas ? "return" : "departure";
      role = target;
    }
    if (token.kind === "date") parsed[target].date = token.date ?? null;
    else {
      parsed[target].time = token.time ?? null;
      parsed[target].constraint = token.constraint ?? "exact";
    }
    previousEnd = token.end;
  }

  // Subject / theme
  const subject = SUBJECTS.find(([re]) => re.test(norm))?.[1];
  let theme = THEMES.find(([re]) => re.test(norm))?.[1];
  if (!theme) {
    const m =
      /(?:sur le theme d[eu]|sur la thematique d[eu]|autour d[eu]|autour des|theme\s*:|travaillons sur|travaille sur|travailler sur|etudions|on etudie|nous etudions|au programme\s*:?|a propos d[eu])\s+(?:le |la |les |l')?([^.,;!?]+)/.exec(
        norm,
      );
    if (m?.[1]) {
      const start = (m.index ?? 0) + m[0].length - m[1].length;
      const raw = text.slice(start, start + m[1].length).trim();
      if (raw.length > 1 && raw.length < 80) theme = raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }
  if (subject || theme) parsed.teaching = { subject, theme };

  parsed.nothing =
    parsed.students === undefined &&
    parsed.accompanying === undefined &&
    parsed.total === undefined &&
    !parsed.vagueQuantity &&
    !parsed.relativeDate &&
    tokens.length === 0 &&
    !parsed.teaching &&
    parsed.bareNumber === undefined;
  return parsed;
}

// ---------------------------------------------------------------------------
// Merge, validation and state machine (simplified equivalent of the backend domain)
// ---------------------------------------------------------------------------

interface StoredConversation {
  response: ConversationResponse;
  pending: PendingClarification | null;
  processed: Record<string, ConversationResponse>;
  messageCounter: number;
}

function isComplete(value: PartialDateTime | null | undefined): value is DateTimeRequirement {
  return !!value && value.date !== null && value.time !== null && value.constraint !== null;
}

function computeMissing(req: PartialRequirements, returnInvalid: boolean): FieldName[] {
  const missing: FieldName[] = [];
  if (req.participants_count === null) missing.push("participants_count");
  if (!isComplete(req.departure)) missing.push("departure");
  if (!isComplete(req.return) || returnInvalid) missing.push("return");
  if (!req.teaching_type || (!req.teaching_type.subject && !req.teaching_type.theme)) missing.push("teaching_type");
  return missing;
}

function returnBeforeDeparture(req: PartialRequirements): boolean {
  if (!isComplete(req.departure) || !isComplete(req.return)) return false;
  return `${req.return.date}T${req.return.time}` <= `${req.departure.date}T${req.departure.time}`;
}

function describeDateTime(value: DateTimeRequirement, now: Date, withYear = false): string {
  return `${formatDate(value.date, now, withYear)} ${formatConstraint(value.constraint, value.time)}`;
}

function describeTeaching(value: TeachingType): string {
  if (value.subject && value.theme) return `${value.subject} (${value.theme})`;
  return value.subject ?? value.theme ?? fr.panel.missing;
}

function describeValue(field: FieldName, req: PartialRequirements, now: Date): string {
  switch (field) {
    case "participants_count":
      return req.participants_count === null ? fr.panel.missing : `${req.participants_count} participants`;
    case "departure":
      return isComplete(req.departure) ? describeDateTime(req.departure, now) : fr.panel.missing;
    case "return":
      return isComplete(req.return) ? describeDateTime(req.return, now) : fr.panel.missing;
    case "teaching_type":
      return req.teaching_type ? describeTeaching(req.teaching_type) : fr.panel.missing;
  }
}

function cloneRequirements(req: PartialRequirements): PartialRequirements {
  return JSON.parse(JSON.stringify(req)) as PartialRequirements;
}

interface MergeResult {
  requirements: PartialRequirements;
  changed: FieldName[];
  pending: PendingClarification | null;
  conflict: { field: FieldName; old: string } | null;
  /** Known values overwritten by this turn, with their previous description. */
  replaced: Array<{ field: FieldName; old: string }>;
  /** True for a panel edit (PATCH), false for a chat message. */
  viaPanel: boolean;
}

function mergeDateTime(
  current: PartialDateTime | null,
  patch: Partial<PartialDateTime>,
  correction: boolean,
  completeBefore: boolean,
): { value: PartialDateTime | null; changed: boolean; conflict: boolean } {
  if (patch.date === undefined && patch.time === undefined) return { value: current, changed: false, conflict: false };
  const next: PartialDateTime = {
    date: patch.date ?? current?.date ?? null,
    time: patch.time ?? current?.time ?? null,
    constraint: patch.time !== undefined ? (patch.constraint ?? "exact") : (current?.constraint ?? null),
  };
  const differs = JSON.stringify(next) !== JSON.stringify(current);
  if (!differs) return { value: current, changed: false, conflict: false };
  // An already complete value is only replaced on an explicit correction.
  if (completeBefore && !correction) return { value: current, changed: false, conflict: true };
  return { value: next, changed: true, conflict: false };
}

function merge(current: PartialRequirements, parsed: Parsed, pending: PendingClarification | null, now: Date): MergeResult {
  const req = cloneRequirements(current);
  const changed: FieldName[] = [];
  let nextPending: PendingClarification | null = pending;
  let conflict: MergeResult["conflict"] = null;
  const replaced: MergeResult["replaced"] = [];
  const noteReplaced = (field: FieldName, wasKnown: boolean) => {
    if (wasKnown) replaced.push({ field, old: describeValue(field, current, now) });
  };
  // A pending clarification on a field is permission to replace it.
  const correction = parsed.correction || pending !== null;

  // Participants
  const students = parsed.students;
  let accompanying = parsed.accompanying;
  let total = parsed.total;
  if (parsed.bareNumber !== undefined && students === undefined && accompanying === undefined && total === undefined) {
    if (pending?.kind === "students_only") accompanying = parsed.bareNumber;
    else if (pending?.field === "participants_count" || current.participants_count === null) total = parsed.bareNumber;
    else if (correction) total = parsed.bareNumber;
    else if (pending === null) total = parsed.bareNumber;
  }
  if (parsed.vagueQuantity && students === undefined && total === undefined) {
    nextPending = { field: "participants_count", kind: "vague_quantity" };
  }
  if (students !== undefined || accompanying !== undefined || total !== undefined) {
    const breakdown = {
      students: students ?? current.participants_breakdown?.students ?? null,
      accompanying: accompanying ?? current.participants_breakdown?.accompanying ?? null,
    };
    let nextTotal: number | null = null;
    if (total !== undefined) nextTotal = total;
    else if (breakdown.students !== null && breakdown.accompanying !== null) {
      nextTotal = breakdown.students + breakdown.accompanying;
    }
    const keepBreakdown =
      total === undefined ||
      (breakdown.students !== null && breakdown.accompanying !== null && breakdown.students + breakdown.accompanying === total);

    if (nextTotal !== null && nextTotal >= 1) {
      if (current.participants_count !== null && current.participants_count !== nextTotal && !correction) {
        conflict = { field: "participants_count", old: describeValue("participants_count", current, now) };
        nextPending = { field: "participants_count", kind: "conflict" };
      } else {
        if (current.participants_count !== nextTotal) {
          changed.push("participants_count");
          noteReplaced("participants_count", current.participants_count !== null);
        }
        req.participants_count = nextTotal;
        req.participants_breakdown = keepBreakdown && (breakdown.students !== null || breakdown.accompanying !== null) ? breakdown : null;
        if (nextPending?.field === "participants_count") nextPending = null;
      }
    } else if (students !== undefined && accompanying === undefined && total === undefined) {
      // "25 élèves" alone: students ≠ participants, ask for accompanying adults.
      req.participants_breakdown = { students, accompanying: breakdown.accompanying };
      if (current.participants_count !== null && !correction) {
        // A total is already known: keep it, no clarification needed.
      } else {
        req.participants_count = null;
        if (current.participants_count !== null) changed.push("participants_count");
        nextPending = { field: "participants_count", kind: "students_only" };
      }
    }
  }

  // Dates
  for (const field of ["departure", "return"] as const) {
    const patch = { ...parsed[field] };
    if (field === "return" && patch.time !== undefined && patch.date === undefined && !current.return?.date) {
      // Return time without a date: same day as the departure when known (demo rule).
      const departureDate = parsed.departure.date ?? req.departure?.date ?? null;
      if (departureDate) patch.date = departureDate;
    }
    const before = isComplete(current[field]);
    const result = mergeDateTime(req[field], patch, correction, before);
    if (result.conflict && isComplete(current[field])) {
      conflict = {
        field,
        old: describeDateTime(current[field] as DateTimeRequirement, now),
      };
      nextPending = { field, kind: "conflict" };
    } else if (result.changed) {
      req[field] = result.value;
      changed.push(field);
      noteReplaced(field, before);
      if (nextPending?.field === field) nextPending = null;
    }
  }
  if (parsed.relativeDate) {
    const field: FieldName = isComplete(req.departure) || req.departure?.date ? "return" : "departure";
    if (!req[field]?.date) nextPending = { field, kind: "relative_date_unresolved" };
  }

  // Subject / theme
  if (parsed.teaching) {
    const next: TeachingType = {
      subject: parsed.teaching.subject ?? (correction ? null : current.teaching_type?.subject ?? null),
      theme: parsed.teaching.theme ?? (correction ? null : current.teaching_type?.theme ?? null),
    };
    if (JSON.stringify(next) !== JSON.stringify(current.teaching_type)) {
      req.teaching_type = next;
      changed.push("teaching_type");
      noteReplaced("teaching_type", Boolean(current.teaching_type?.subject || current.teaching_type?.theme));
      if (nextPending?.field === "teaching_type") nextPending = null;
    }
  }

  return { requirements: req, changed, pending: nextPending, conflict, replaced, viaPanel: false };
}

interface Decision {
  state: ConversationState;
  message: string;
  missing: FieldName[];
  pending: PendingClarification | null;
  ready: boolean;
}

function decide(
  previousState: ConversationState,
  req: PartialRequirements,
  merge: MergeResult,
  nothingNew: boolean,
  now: Date,
): Decision {
  const invalidReturn = returnBeforeDeparture(req);
  const missing = computeMissing(req, invalidReturn);
  const wasComplete = ["AWAITING_CONFIRMATION", "CONFIRMED", "EDITING", "HANDOFF"].includes(previousState);
  let pending = merge.pending;
  const acknowledged = merge.replaced
    .map((r) => `${FIELD_LABELS[r.field]} : ${describeValue(r.field, req, now)} (au lieu de ${r.old})`)
    .join(" ; ");
  const prefix = (acknowledged && !merge.viaPanel ? T.replaced(acknowledged) : "") + (nothingNew ? T.nothingNew : "");

  if (invalidReturn && isComplete(req.return) && isComplete(req.departure)) {
    pending = { field: "return", kind: "return_before_departure" };
    return {
      state: "ASKING_USER",
      message: T.invalidReturnBeforeDeparture(
        formatConstraint(req.return.constraint, req.return.time),
        describeDateTime(req.departure, now),
      ),
      missing,
      pending,
      ready: false,
    };
  }

  if (merge.conflict) {
    return {
      state: "ASKING_USER",
      message: T.conflict(merge.conflict.old, FIELD_LABELS[merge.conflict.field]),
      missing,
      pending,
      ready: false,
    };
  }

  if (pending) {
    let message: string;
    switch (pending.kind) {
      case "students_only":
        message = T.clarifyStudentsOnly(req.participants_breakdown?.students ?? 0);
        break;
      case "vague_quantity":
        message = T.clarifyVagueQuantity;
        break;
      case "relative_date_unresolved":
        message = T.clarifyRelativeDate;
        break;
      default:
        message = T.conflict(describeValue(pending.field, req, now), FIELD_LABELS[pending.field]);
    }
    return { state: "ASKING_USER", message: prefix + message, missing, pending, ready: false };
  }

  if (missing.length > 0) {
    const first = missing[0] as FieldName;
    let question: string;
    switch (first) {
      case "participants_count":
        question = T.askParticipants;
        break;
      case "departure":
        question = req.departure?.date && !req.departure.time ? T.askDepartureTime(formatDate(req.departure.date, now)) : T.askDeparture;
        break;
      case "return": {
        // The return date is implied by a known departure date, so only the time is asked.
        const date = req.return?.date ?? req.departure?.date ?? null;
        question = date && !req.return?.time ? T.askReturnTime(formatDate(date, now)) : T.askReturn;
        break;
      }
      case "teaching_type":
        question = T.askTeaching;
        break;
    }
    return { state: wasComplete ? "EDITING" : "COLLECTING", message: prefix + question, missing, pending: null, ready: false };
  }

  const departure = req.departure as DateTimeRequirement;
  const ret = req.return as DateTimeRequirement;
  const teaching = req.teaching_type as TeachingType;
  const changedField = merge.changed[0];
  const summaryText = T.summarize(
    req.participants_count as number,
    describeDateTime(departure, now, true),
    describeDateTime(ret, now, true),
    describeTeaching(teaching),
  );
  const message =
    merge.viaPanel && changedField
      ? T.reopen(FIELD_LABELS[changedField], describeValue(changedField, req, now), summaryText)
      : prefix + summaryText;
  return { state: "AWAITING_CONFIRMATION", message, missing: [], pending: null, ready: true };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface MockOptions {
  /** Simulated latency of text responses (ms). */
  latencyMs?: number;
  /** Simulated transcription latency (ms). */
  audioLatencyMs?: number;
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Persist across reloads (localStorage). */
  persist?: boolean;
}

const STORAGE_KEY = storageKey("demo.conversations");
/**
 * One-shot switch for demos and visual tests: when this localStorage key exists, the next
 * message fails once with a provider error (state unchanged), then the key is removed.
 */
export const DEMO_FAIL_NEXT_KEY = storageKey("demo.fail_next");

function delay(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

function newId(prefix: string): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function createMockConversationService(options: MockOptions = {}): ConversationService {
  const latencyMs = options.latencyMs ?? 700;
  const audioLatencyMs = options.audioLatencyMs ?? 1500;
  const now = options.now ?? (() => new Date());
  const persist = options.persist ?? true;

  let store: Record<string, StoredConversation> | null = null;

  function load(): Record<string, StoredConversation> {
    if (store) return store;
    store = (persist ? readJson<Record<string, StoredConversation>>(STORAGE_KEY) : null) ?? {};
    return store;
  }

  function save(): void {
    if (persist && store) writeJson(STORAGE_KEY, store);
  }

  function find(id: string): StoredConversation {
    const conv = load()[id];
    if (!conv) throw new ApiError(404, "Introuvable", T.notFound, "CONVERSATION_NOT_FOUND");
    return conv;
  }

  function message(conv: StoredConversation, role: Message["role"], content: string, source?: Message["source"]): Message {
    conv.messageCounter += 1;
    const msg: Message = {
      id: `msg_${String(conv.messageCounter).padStart(3, "0")}`,
      role,
      content,
      created_at: now().toISOString(),
    };
    if (source) msg.source = source;
    return msg;
  }

  function publicResponse(conv: StoredConversation, extra: Partial<ConversationResponse> = {}): ConversationResponse {
    return { ...JSON.parse(JSON.stringify(conv.response)), ...extra } as ConversationResponse;
  }

  function applyDecision(conv: StoredConversation, req: PartialRequirements, decision: Decision, bumpVersion: boolean): void {
    const r = conv.response;
    r.requirements = req;
    r.state = decision.state;
    r.missing_fields = decision.missing;
    r.pending_clarification = decision.pending;
    r.ready_for_confirmation = decision.ready;
    r.assistant_message = decision.message;
    r.confirmed_requirements = null;
    if (bumpVersion) r.version += 1;
    r.messages.push(message(conv, "assistant", decision.message));
    conv.pending = decision.pending;
  }

  return {
    async getConfig() {
      return { ...DEFAULT_CLIENT_CONFIG };
    },

    async create() {
      await delay(latencyMs / 2);
      const id = newId("conv_demo");
      const conv: StoredConversation = {
        response: {
          conversation_id: id,
          state: "COLLECTING",
          version: 0,
          assistant_message: T.welcome,
          requirements: {
            participants_count: null,
            participants_breakdown: null,
            departure: null,
            return: null,
            teaching_type: null,
          },
          missing_fields: ["participants_count", "departure", "return", "teaching_type"],
          pending_clarification: null,
          ready_for_confirmation: false,
          transcript: null,
          confirmed_requirements: null,
          messages: [],
        },
        pending: null,
        processed: {},
        messageCounter: 0,
      };
      conv.response.messages.push(message(conv, "assistant", T.welcome));
      load()[id] = conv;
      save();
      return publicResponse(conv);
    },

    async get(conversationId) {
      await delay(latencyMs / 3);
      const conv = find(conversationId);
      return publicResponse(conv, { assistant_message: null, transcript: null });
    },

    async sendMessage(conversationId, body: SendMessageBody) {
      await delay(latencyMs);
      const conv = find(conversationId);
      const content = body.content.trim();
      if (!content) throw new ApiError(400, "Message vide", T.emptyMessage, "EMPTY_MESSAGE");
      // Idempotency: the same client_message_id never replays the patch.
      const already = conv.processed[body.client_message_id];
      if (already) return JSON.parse(JSON.stringify(already)) as ConversationResponse;
      if (takeFlag(DEMO_FAIL_NEXT_KEY)) throw new ApiError(502, "Service indisponible", T.providerError, "PROVIDER_ERROR");

      conv.response.messages.push(message(conv, "user", content, body.source));
      const current = conv.response.requirements;
      const parsed = parseUtterance(content, current, now());
      const merged = merge(current, parsed, conv.pending, now());
      const decision = decide(conv.response.state, merged.requirements, merged, parsed.nothing, now());
      applyDecision(conv, merged.requirements, decision, merged.changed.length > 0);
      const response = publicResponse(conv, { transcript: null });
      conv.processed[body.client_message_id] = response;
      save();
      return response;
    },

    async sendAudio(conversationId, audio) {
      await delay(audioLatencyMs);
      const conv = find(conversationId);
      void audio;
      const req = conv.response.requirements;
      let transcript = CANNED_TRANSCRIPTS.full;
      if (conv.response.ready_for_confirmation || conv.response.state === "CONFIRMED") transcript = CANNED_TRANSCRIPTS.correction;
      else if (isComplete(req.departure) && !isComplete(req.return)) transcript = CANNED_TRANSCRIPTS.returnOnly;
      return publicResponse(conv, { assistant_message: null, transcript });
    },

    async editField(conversationId, field, value, expectedVersion) {
      await delay(latencyMs / 2);
      const conv = find(conversationId);
      if (expectedVersion !== conv.response.version) throw new ApiError(409, "Version obsolète", T.staleVersion, "VERSION_CONFLICT");
      const req = cloneRequirements(conv.response.requirements);
      let summary: string;
      switch (field) {
        case "participants_count": {
          const count = value as RequirementValue<"participants_count">;
          if (!Number.isInteger(count) || count < 1) throw new ApiError(422, "Valeur invalide", T.invalidValue, "VALIDATION_ERROR");
          const breakdown = req.participants_breakdown ?? null;
          const consistent =
            breakdown && breakdown.students !== null && breakdown.accompanying !== null && breakdown.students + breakdown.accompanying === count;
          req.participants_count = count;
          req.participants_breakdown = consistent ? breakdown : null;
          summary = `${fr.fields.participants_count.label} : ${count}`;
          break;
        }
        case "departure":
        case "return": {
          const dateField = field as "departure" | "return";
          const dt = value as RequirementValue<"departure">;
          if (!isComplete(dt)) throw new ApiError(422, "Valeur invalide", T.invalidValue, "VALIDATION_ERROR");
          req[dateField] = { ...dt };
          summary = `${fr.fields[dateField].label} : ${describeDateTime(dt, now())}`;
          break;
        }
        case "teaching_type": {
          const tt = value as RequirementValue<"teaching_type">;
          if (!tt.subject && !tt.theme) throw new ApiError(422, "Valeur invalide", T.invalidValue, "VALIDATION_ERROR");
          req.teaching_type = { subject: tt.subject || null, theme: tt.theme || null };
          summary = `${fr.fields.teaching_type.label} : ${describeTeaching(req.teaching_type)}`;
          break;
        }
      }
      conv.response.messages.push(message(conv, "user", summary, "edit"));
      const pending = conv.pending?.field === field ? null : conv.pending;
      const mergeResult: MergeResult = { requirements: req, changed: [field], pending, conflict: null, replaced: [], viaPanel: true };
      const decision = decide(conv.response.state, req, mergeResult, false, now());
      applyDecision(conv, req, decision, true);
      save();
      return publicResponse(conv, { transcript: null });
    },

    async confirm(conversationId, expectedVersion) {
      await delay(latencyMs / 2);
      const conv = find(conversationId);
      if (conv.response.state !== "AWAITING_CONFIRMATION") throw new ApiError(409, "Confirmation impossible", T.confirmNotReady, "NOT_AWAITING_CONFIRMATION");
      if (expectedVersion !== conv.response.version) throw new ApiError(409, "Version obsolète", T.staleVersion, "VERSION_CONFLICT");
      const req = conv.response.requirements;
      const confirmed: ConfirmedRequirements = {
        schema_version: "1.0",
        conversation_id: conv.response.conversation_id,
        status: "confirmed",
        timezone: "Europe/Paris",
        confirmed_at: now().toISOString(),
        requirements: {
          participants_count: req.participants_count as number,
          participants_breakdown: req.participants_breakdown ?? null,
          departure: req.departure as DateTimeRequirement,
          return: req.return as DateTimeRequirement,
          teaching_type: req.teaching_type as TeachingType,
        },
      };
      conv.response.state = "CONFIRMED";
      conv.response.ready_for_confirmation = false;
      conv.response.assistant_message = T.acknowledge;
      conv.response.confirmed_requirements = confirmed;
      conv.response.messages.push(message(conv, "assistant", T.acknowledge));
      save();
      return publicResponse(conv, { transcript: null });
    },

    async exportConfirmed(conversationId) {
      await delay(latencyMs / 3);
      const conv = find(conversationId);
      if (!conv.response.confirmed_requirements) throw new ApiError(409, "Non confirmé", T.exportNotReady, "NOT_CONFIRMED");
      return JSON.parse(JSON.stringify(conv.response.confirmed_requirements)) as ConfirmedRequirements;
    },
  };
}

/** Default instance used by the app in demo mode. */
export const mockConversationApi: ConversationService = createMockConversationService();
