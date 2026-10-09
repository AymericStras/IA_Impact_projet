import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Edge, type ErrorCode, type LioNetwork, type Mode, type Place, type Route } from "./api";
import { useI18n } from "./i18n";
import Header from "./components/Header";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import PlacesPanel from "./components/PlacesPanel";

type Tab = "route" | "places";

export default function App() {
  const { t } = useI18n();
  const [places, setPlaces] = useState<Place[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [modes, setModes] = useState<Mode[]>([]);
  const [networks, setNetworks] = useState<LioNetwork[]>([]);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [tab, setTab] = useState<Tab>("route");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]); // types de transport désactivés
  const [excludedNetworks, setExcludedNetworks] = useState<string[]>([]); // réseaux liO désactivés

  useEffect(() => {
    Promise.all([api.places(), api.network(), api.modes(), api.networks()])
      .then(([p, e, m, n]) => {
        setNetworks(n);
        setPlaces(p);
        setEdges(e);
        setModes(m);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.code : "network"));
  }, []);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  // Carte : on masque les liaisons des modes et réseaux désactivés, et les arrêts de car qui n'ont plus de liaison
  const visibleEdges = useMemo(
    () => edges.filter((e) => !excluded.includes(e.mode) && !excludedNetworks.includes(e.network)),
    [edges, excluded, excludedNetworks],
  );
  const visiblePlaces = useMemo(() => {
    if (!excluded.includes("Car liO") && !excludedNetworks.length) return places;
    const served = new Set(visibleEdges.flatMap((e) => [e.from_id, e.to_id]));
    return places.filter((p) => p.network !== "lio" || served.has(p.id));
  }, [places, visibleEdges, excluded, excludedNetworks]);

  async function search(f = from, d = to, without = excluded, withoutNetworks = excludedNetworks) {
    if (!f.trim() || !d.trim()) return;
    setLoading(true);
    setRouteError(null);
    try {
      setRoute(await api.route(f.trim(), d.trim(), without, withoutNetworks));
      setSelected(null);
    } catch (e) {
      setRoute(null);
      setRouteError(e instanceof ApiError ? e.code : "network");
    } finally {
      setLoading(false);
    }
  }

  // Depuis la carte ou la liste des lieux : remplir départ / arrivée, et chercher dès que les deux sont là
  function pick(which: "from" | "to", name: string) {
    const f = which === "from" ? name : from;
    const d = which === "to" ? name : to;
    setFrom(f);
    setTo(d);
    setTab("route");
    if (f && d) search(f, d);
  }

  return (
    <div className="app">
      <Header />
      <main className="layout">
        <aside className="sidebar">
          <div className="tabs" role="tablist">
            {(["route", "places"] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
                {k === "route" ? t.tabRoute : t.tabPlaces}
              </button>
            ))}
          </div>
          {loadError && <p className="alert">{t.errors[loadError]}</p>}
          {tab === "route" ? (
            <RoutePanel
              places={places}
              from={from}
              to={to}
              setFrom={setFrom}
              setTo={setTo}
              onSearch={() => search()}
              modes={modes}
              excluded={excluded}
              toggleMode={(m) => {
                const next = excluded.includes(m) ? excluded.filter((x) => x !== m) : [...excluded, m];
                setExcluded(next);
                if (route || routeError) search(from, to, next); // relancer avec le nouveau filtre
              }}
              networks={networks}
              excludedNetworks={excludedNetworks}
              setExcludedNetworks={(next) => {
                setExcludedNetworks(next);
                if (route || routeError) search(from, to, excluded, next);
              }}
              loading={loading}
              route={route}
              error={routeError}
            />
          ) : (
            <PlacesPanel places={places} selected={selected} onSelect={setSelected} onPick={pick} />
          )}
          <p className="data-note">{t.dataNote}</p>
        </aside>
        <MapView
          places={visiblePlaces}
          edges={visibleEdges} byId={byId} route={route} selected={selected} onSelect={setSelected} onPick={pick} />
      </main>
    </div>
  );
}
