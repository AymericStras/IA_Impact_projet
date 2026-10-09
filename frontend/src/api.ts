// Client du backend FastAPI. En dev, Vite relaie /api vers uvicorn (voir vite.config.ts) ;
// en prod, VITE_API_URL pointe vers l'API déployée.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

export type Place = { id: string; name: string; lat: number; lon: number; department: string; commune: string; network: "sncf" | "lio" };
export type Edge = { from_id: string; to_id: string; mode: string; network: string; minutes: number };
// Réseau de cars liO : un par département (« liO 34 ») + les lignes régionales (« liO TIL »)
export type LioNetwork = { id: string; department: string; missions: number };
// Un leg = un trajet direct (même train ou même car), stops = toutes les gares desservies, extrémités comprises
export type Leg = {
  mode: string;
  network: string; // réseau liO (« liO 34 »), vide pour la SNCF et la marche
  line: string;
  from: string;
  to: string;
  from_id: string;
  to_id: string;
  minutes: number;
  wait_minutes: number; // changement + attente estimée avant ce leg (0 pour le premier)
  stops: string[];
  trips_per_day: number | null; // null pour la marche
};
export type Mode = { id: string; links: number; missions: number };
export type Route = {
  from: string;
  to: string;
  minutes: number;
  ride_minutes: number;
  access_minutes: number; // pour rejoindre le premier arrêt quand on a demandé une ville
  egress_minutes: number;
  transfers: number;
  legs: Leg[];
};
export const WALK = "Marche";
export const COACH_MODES = new Set(["Car TER", "Car liO", "Car à réservation"]);
export type ErrorCode = "unknown_place" | "no_route" | "same_place" | "unknown_mode" | "unknown_network" | "network";

export class ApiError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

async function get<T>(path: string, params?: URLSearchParams): Promise<T> {
  const qs = params ? "?" + params : "";
  let res: Response;
  try {
    res = await fetch(BASE + path + qs);
  } catch {
    throw new ApiError("network");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.detail?.code ?? "network");
  return body as T;
}

export const api = {
  places: () => get<{ places: Place[] }>("/places").then((r) => r.places),
  network: () => get<{ edges: Edge[] }>("/network").then((r) => r.edges),
  modes: () => get<{ modes: Mode[] }>("/modes").then((r) => r.modes),
  networks: () => get<{ networks: LioNetwork[] }>("/networks").then((r) => r.networks),
  // exclude : types de transport à ignorer, excludeNetworks : réseaux liO à ignorer (?exclude=…&exclude_network=…)
  route: (from: string, to: string, exclude: string[] = [], excludeNetworks: string[] = []) => {
    const params = new URLSearchParams({ from, to });
    exclude.forEach((m) => params.append("exclude", m));
    excludeNetworks.forEach((n) => params.append("exclude_network", n));
    return get<Route>("/route", params);
  },
};
