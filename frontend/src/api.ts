// Client du backend FastAPI. En dev, Vite relaie /api vers uvicorn (voir vite.config.ts) ;
// en prod, VITE_API_URL pointe vers l'API déployée.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

export type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  department: string;
  commune: string;
  network: "sncf" | "lio";
  trips_per_day: number; // passages par jour (jour de référence), sert à la taille de l'icône
  lines: string[]; // lignes qui s'y arrêtent, les plus fréquentes d'abord
};
export type Edge = { from_id: string; to_id: string; mode: string; network: string; minutes: number };

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
  times: number[]; // minutes depuis le départ du leg, à chaque arrêt de `stops`
  trips_per_day: number | null; // null pour la marche
};
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
export type ErrorCode = "unknown_place" | "no_route" | "same_place" | "network";

export class ApiError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

async function get<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const qs = params ? "?" + params : "";
  let res: Response;
  const timeout = new AbortController();
  const abort = () => timeout.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) timeout.abort();
  const timer = window.setTimeout(abort, 20000);
  try {
    res = await fetch(BASE + path + qs, { signal: timeout.signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError("network");
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(body?.detail?.code ?? "network");
  return body as T;
}

export const api = {
  places: () => get<{ places: Place[] }>("/places").then((r) => r.places),
  network: () => get<{ edges: Edge[] }>("/network").then((r) => r.edges),
  route: (from: string, to: string) => get<Route>("/route", new URLSearchParams({ from, to })),
  info: () => get<{ feed_version: string; valid_from: string; valid_until: string; reference_day: string }>("/info"),
  modes: (signal?: AbortSignal) => get<{ modes: { id: string }[] }>("/modes", undefined, signal).then((r) => r.modes),
  schoolRoute: async (from: string, to: string, excluded: string[], signal?: AbortSignal) => {
    const params = new URLSearchParams({ from, to, transfer_min: "15" });
    excluded.forEach((mode) => params.append("exclude", mode));
    const route = await get<Route>("/route", params, signal);
    // Even when the full dataset is enabled, never show TGV, Intercités or coaches in a school proposal.
    if (route.legs.some((leg) => leg.mode !== "Train TER" && leg.mode !== WALK)) throw new ApiError("no_route");
    return route;
  },
};
