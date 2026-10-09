// Client du backend FastAPI. En dev, Vite relaie /api vers uvicorn (voir vite.config.ts) ;
// en prod, VITE_API_URL pointe vers l'API déployée.
const BASE = import.meta.env.VITE_API_URL ?? "/api";

export type Place = { id: string; name: string; lat: number; lon: number; department: string; commune: string };
export type Edge = { from_id: string; to_id: string; mode: string; minutes: number };
export type Step = { from: string; to: string; from_id: string; to_id: string; minutes: number; mode: string };
export type Route = { from: string; to: string; minutes: number; steps: Step[] };
export type ErrorCode = "unknown_place" | "no_route" | "same_place" | "network";

export class ApiError extends Error {
  constructor(public code: ErrorCode) {
    super(code);
  }
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? "?" + new URLSearchParams(params) : "";
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
  route: (from: string, to: string) => get<Route>("/route", { from, to }),
};
