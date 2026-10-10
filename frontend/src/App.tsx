import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, type Edge, type ErrorCode, type Place, type Route } from "./api";
import { useI18n } from "./i18n";
import Header from "./components/Header";
import MapView from "./components/MapView";
import RoutePanel from "./components/RoutePanel";
import PlacesPanel from "./components/PlacesPanel";
import ChatPanel from "./components/ChatPanel";
import { DiscoverySheet } from "./components/Discovery";
import type { Discovery } from "./data/discoveries";

type Tab = "route" | "places" | "chat";
const TAB_LABEL = { route: "tabRoute", places: "tabPlaces", chat: "tabChat" } as const;

export default function App() {
  const { t } = useI18n();
  const [places, setPlaces] = useState<Place[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [loadError, setLoadError] = useState<ErrorCode | null>(null);
  const [tab, setTab] = useState<Tab>("route");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [route, setRoute] = useState<Route | null>(null);
  const [routeError, setRouteError] = useState<ErrorCode | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const closeDiscovery = useCallback(() => setDiscovery(null), []);

  useEffect(() => {
    Promise.all([api.places(), api.network()])
      .then(([p, e]) => {
        setPlaces(p);
        setEdges(e);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.code : "network"));
  }, []);

  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  async function search(f = from, d = to) {
    if (!f.trim() || !d.trim()) return;
    setLoading(true);
    setRouteError(null);
    try {
      setRoute(await api.route(f.trim(), d.trim()));
      setSelected(null);
    } catch (e) {
      setRoute(null);
      setRouteError(e instanceof ApiError ? e.code : "network");
    } finally {
      setLoading(false);
    }
  }

  // Depuis la carte ou la liste des lieux : remplir départ / arrivée, et chercher dès que les deux sont là.
  // Fonction stable (lit départ / arrivée dans une ref) : la carte, mémoïsée, ne se redessine pas à chaque frappe.
  const typed = useRef({ from, to });
  typed.current = { from, to };
  const pick = useCallback((which: "from" | "to", name: string) => {
    const f = which === "from" ? name : typed.current.from;
    const d = which === "to" ? name : typed.current.to;
    setFrom(f);
    setTo(d);
    setTab("route");
    if (f && d) search(f, d);
  }, []);

  return (
    <div className="app">
      <Header />
      <main className="layout">
        <aside className="sidebar">
          <div className="tabs" role="tablist">
            {(["route", "places", "chat"] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "tab active" : "tab"} onClick={() => setTab(k)}>
                {t[TAB_LABEL[k]]}
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
              loading={loading}
              route={route}
              error={routeError}
            />
          ) : tab === "places" ? (
            <PlacesPanel places={places} byId={byId} selected={selected} onSelect={setSelected} onPick={pick} onOpenDiscovery={setDiscovery} />
          ) : (
            <ChatPanel />
          )}
          <p className="data-note">{t.dataNote}</p>
        </aside>
        <MapView places={places} edges={edges} byId={byId} route={route} selected={selected} onSelect={setSelected} onPick={pick} onOpenDiscovery={setDiscovery} />
      </main>
      {discovery && <DiscoverySheet d={discovery} station={byId.get(discovery.stationId)} onClose={closeDiscovery} onPick={pick} />}
    </div>
  );
}
