import { ApiError, type Edge, type Place, type Route } from "./api";

type Metadata = {
  schema: number;
  aliases: Record<string, number>;
  places: Place[];
  edges: Edge[];
  modes: { id: string }[];
  info: { feed_version: string; valid_from: string; valid_until: string; reference_day: string };
};
type Row = (Route | { error: "same_place" } | null)[];
let metadata: Promise<Metadata> | undefined;
const rows = new Map<string, Promise<Row>>();
const normalize = (value: string) => value.normalize("NFKD").replace(/[^\x00-\x7F]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

async function read(path: string) {
  const response = await fetch(`/demo-routes/${path}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new ApiError("network");
  return response;
}

export async function getSnapshot<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  try {
    metadata ??= read("index.json").then((r) => r.json()).catch((error) => { metadata = undefined; throw error; });
    const data = await metadata;
    signal?.throwIfAborted();
    if (data.schema !== 1) throw new ApiError("network");
    let result: unknown;
    switch (path) {
      case "/places": result = { places: data.places }; break;
      case "/network": result = { edges: data.edges }; break;
      case "/info": result = data.info; break;
      case "/modes": result = { modes: data.modes }; break;
      case "/route": {
        const from = data.aliases[normalize(params?.get("from") ?? "")];
        const to = data.aliases[normalize(params?.get("to") ?? "")];
        if (from === undefined || to === undefined) throw new ApiError("unknown_place");
        if (params?.getAll("exclude").includes("Train TER")) throw new ApiError("no_route");
        const margin = params?.get("transfer_min") ?? "5";
        if (!["5", "15"].includes(margin)) throw new ApiError("network");
        const key = `${margin}/${from}.bin`;
        if (!rows.has(key)) {
          if (rows.size >= 12) rows.delete(rows.keys().next().value!);
          const request = read(key).then(async (response) => {
            if (!response.body) throw new ApiError("network");
            return await new Response(response.body.pipeThrough(new DecompressionStream("gzip"))).json() as Row;
          }).catch((error) => { rows.delete(key); throw error; });
          rows.set(key, request);
        }
        const row = await rows.get(key)!;
        signal?.throwIfAborted();
        const route = row[to];
        if (!route) throw new ApiError("no_route");
        if ("error" in route) throw new ApiError(route.error);
        result = route;
        break;
      }
      default: throw new ApiError("network");
    }
    return result as T;
  } catch (error) {
    if (signal?.aborted || error instanceof ApiError) throw error;
    throw new ApiError("network");
  }
}
