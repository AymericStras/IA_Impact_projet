import { api, ApiError, type Route } from "./api";
import { DISCOVERIES, type Discovery } from "./data/discoveries";

export type SchoolProject = {
  establishment: string; origin: string; level: string; className: string;
  theme: string; students: number; adults: number; date: string;
  departure: string; returnBy: string; budget: string; accessibility: string;
};
export const INITIAL_PROJECT: SchoolProject = {
  establishment: "Lycée Bellevue · Toulouse", origin: "Toulouse Matabiau", level: "Lycée",
  className: "Seconde", theme: "Patrimoine & histoire", students: 30, adults: 3,
  date: "2026-11-05", departure: "09:00", returnBy: "16:00", budget: "", accessibility: "",
};
export const CLASSES: Record<string, string[]> = {
  Primaire: ["CP", "CE1", "CE2", "CM1", "CM2"], Collège: ["6e", "5e", "4e", "3e"], Lycée: ["Seconde", "Première", "Terminale"],
};
export const THEMES = ["Patrimoine & histoire", "Arts & culture", "Sciences & nature", "Tous les thèmes"];
export type Proposal = { discovery: Discovery; outbound: Route; inbound: Route; sourceVersion: string | null };
export type SchoolRequest = {
  id: string; createdAt: string; fingerprint: string; project: SchoolProject; proposal: Proposal;
  status: "À examiner"; demo: true; feedback?: { satisfaction: string; clarity: string; preparation: string; relevance: string; comment: string };
};
const KEY = "lio.school-requests.v1";
export const SCHOOL_SOURCES: Record<string, string> = {
  "musee-lautrec": "https://www.musee-toulouse-lautrec.com/",
  "sainte-cecile": "https://www.albi-tourisme.fr/",
  "cite-carcassonne": "https://www.remparts-carcassonne.fr/enseignants",
  "chateau-foix": "https://www.sites-touristiques-ariege.fr/chateau-de-foix/",
  "musee-fabre": "https://museefabre.montpellier3m.fr/",
};
export const FEATURED = ["musee-lautrec", "cite-carcassonne", "chateau-foix"];
export function candidates(theme: string): Discovery[] {
  const categories = theme === THEMES[0] ? ["heritage", "museum"] : theme === THEMES[1] ? ["museum", "heritage"] : theme === THEMES[2] ? ["nature", "engineering"] : ["heritage", "museum", "nature", "engineering"];
  return [...DISCOVERIES].filter((d) => categories.includes(d.category)).sort((a, b) => {
    const priority = (d: Discovery) => (FEATURED.includes(d.id) ? FEATURED.indexOf(d.id) : 10) + (theme === THEMES[1] && d.category !== "museum" ? 20 : 0);
    return priority(a) - priority(b);
  });
}
export function validateProject(p: SchoolProject): string | null {
  if (!p.establishment.trim() || !p.origin.trim() || !p.date || !p.className || !p.theme || !p.departure || !p.returnBy) return "Complétez les champs obligatoires du projet.";
  if (!Number.isInteger(p.students) || !Number.isInteger(p.adults) || p.students < 1 || p.adults < 1) return "Indiquez au moins un élève et un accompagnateur, avec des nombres entiers.";
  const total = p.students + p.adults;
  if (total > 50) return `${total} voyageurs : la limite est de 50, accompagnateurs compris. Ajustez l’effectif avant de continuer.`;
  if (total < 6) return "Cette offre concerne les groupes de 6 à 50 voyageurs.";
  if (p.departure >= p.returnBy) return "L’heure de retour doit être postérieure au départ.";
  if (p.budget && (!Number.isFinite(Number(p.budget)) || Number(p.budget) < 0)) return "Le budget doit être un montant positif.";
  return null;
}
export const duration = (minutes: number) => {
  const n = Math.round(minutes);
  return n < 60 ? `${n} min` : `${Math.floor(n / 60)} h${n % 60 ? ` ${String(n % 60).padStart(2, "0")}` : ""}`;
};
export const dateLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Uses the team's existing GET /route, once in each direction. Dates and capacity are not supported by that API.
export async function searchSchoolTrips(project: SchoolProject, places: Map<string, { name: string }>, sourceVersion: string | null, signal: AbortSignal) {
  const modes = await api.modes(signal);
  const excluded = modes.filter((m) => m.id !== "Train TER" && m.id !== "Marche").map((m) => m.id);
  const results: Proposal[] = [];
  const seen = new Set<string>();
  let unavailable = 0;
  for (const discovery of candidates(project.theme)) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const place = places.get(discovery.stationId);
    if (!place || seen.has(discovery.stationId)) continue;
    seen.add(discovery.stationId);
    try {
      const [outbound, inbound] = await Promise.all([
        api.schoolRoute(project.origin, place.name, excluded, signal),
        api.schoolRoute(place.name, project.origin, excluded, signal),
      ]);
      // Coarse necessary condition only; this is never presented as timetable feasibility.
      const span = (v: string) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3));
      if (outbound.minutes + inbound.minutes >= span(project.returnBy) - span(project.departure)) continue;
      results.push({ discovery, outbound, inbound, sourceVersion });
      if (results.length === 3) break;
    } catch (e) {
      if (signal.aborted) throw e;
      if (!(e instanceof ApiError) || e.code === "network" || e.code === "unknown_place") throw e;
      unavailable++;
    }
  }
  return { results, unavailable };
}
export function loadRequests(): SchoolRequest[] {
  const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
  if (!Array.isArray(parsed)) throw new Error("Dossiers locaux illisibles.");
  return parsed.filter((r): r is SchoolRequest => !!r && typeof r === "object" && typeof r.id === "string" && r.demo === true && !!r.project && !!r.proposal?.discovery && !!r.proposal?.outbound && !!r.proposal?.inbound);
}
export function saveRequest(project: SchoolProject, proposal: Proposal): SchoolRequest {
  const all = loadRequests();
  const fingerprint = JSON.stringify({ project, proposal });
  const existing = all.find((r) => r.fingerprint === fingerprint);
  if (existing) return existing;
  const request: SchoolRequest = { id: `DEMO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, createdAt: new Date().toISOString(), fingerprint, project, proposal, status: "À examiner", demo: true };
  localStorage.setItem(KEY, JSON.stringify([request, ...all]));
  return request;
}
export function saveFeedback(id: string, feedback: NonNullable<SchoolRequest["feedback"]>) {
  const all = loadRequests();
  localStorage.setItem(KEY, JSON.stringify(all.map((r) => r.id === id ? { ...r, feedback } : r)));
}
