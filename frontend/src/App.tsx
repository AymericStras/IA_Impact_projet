import { useEffect, useMemo, useState } from "react";
import { api, ApiError, type Edge, type ErrorCode, type Mode, type Place, type Route } from "./api";
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
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [tab, setTab] = useState<Tab>("route");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]); // types de transport désactivés

  useEffect(() => {
    Promise.all([api.places(), api.network(), api.modes()])
      .then(([p, e, m]) => {
        setPlaces(p);
        setEdges(e);
        setModes(m);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.code : "network"));
  }, []);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  async function search(f = from, d = to, without = excluded) {
    if (!f.trim() || !d.trim()) return;
    setLoading(true);
    setRouteError(null);
    try {
      setRoute(await api.route(f.trim(), d.trim(), without));
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
              loading={loading}
              route={route}
              error={routeError}
            />
          ) : (
            <PlacesPanel places={places} selected={selected} onSelect={setSelected} onPick={pick} />
          )}
          <p className="data-note">{t.dataNote}</p>
        </aside>
        <MapView places={places} edges={excluded.length ? edges.filter((e) => !excluded.includes(e.mode)) : edges} byId={byId} route={route} selected={selected} onSelect={setSelected} onPick={pick} />
      </main>
    </div>
  );
}
