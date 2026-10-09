import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Marker, Polygon, Polyline, Popup, TileLayer, useMap, useMapEvents } from "react-leaflet";
import L, { type LatLngTuple } from "leaflet";
import { OCCITANIE, OCCITANIE_BOUNDS, OUTSIDE_MASK } from "../occitanie";
import { COACH_MODES, WALK, type Edge, type Place, type Route } from "../api";
import { useI18n } from "../i18n";

type Props = {
  places: Place[];
  edges: Edge[];
  byId: Map<string, Place>;
  route: Route | null;
  selected: string | null;
  onSelect: (id: string) => void;
  onPick: (which: "from" | "to", name: string) => void;
};

const NAVY = "#0f2149";
const RED = "#c90c0f";
const RAIL = "#7d879c";

// Comme sur Google Maps, une gare apparaît d'autant plus tôt (en dézoomant) qu'elle est fréquentée, et on
// place icônes et noms par ordre d'importance en sautant ceux qui en chevaucheraient un déjà placé
// (une gare dont l'icône ne tient pas devient un simple point).
type Tier = "major" | "medium" | "minor";
const tierOf = (p: Place): Tier => (p.trips_per_day >= 60 ? "major" : p.trips_per_day >= 20 ? "medium" : "minor");
const ICON_FROM_ZOOM: Record<Tier, number> = { major: 0, medium: 9, minor: 10 };
const LABEL_FROM_ZOOM: Record<Tier, number> = { major: 8, medium: 10, minor: 12 };
const ICON_PX: Record<Tier, number> = { major: 30, medium: 26, minor: 22 }; // boîte d'encombrement, marge comprise
const LABEL_CHAR_PX: Record<Tier, number> = { major: 8, medium: 7, minor: 6.5 };

type Box = { x1: number; y1: number; x2: number; y2: number };
const overlaps = (a: Box, b: Box) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

// Pictogramme « train » (Material Icons, Apache 2.0)
const TRAIN_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/></svg>';

// Réseau de fond : non cliquable (évite à Leaflet de tester chaque tronçon au survol de la souris)
type Kind = "train" | "coach" | "lio";
const lineStyles = (dimmed: boolean): Record<Kind | "casing", L.PathOptions> => ({
  casing: { color: "#fff", weight: 6, opacity: dimmed ? 0.4 : 0.9, lineCap: "round", interactive: false },
  train: { color: RAIL, weight: 3, opacity: dimmed ? 0.3 : 0.75, lineCap: "round", interactive: false },
  coach: { color: NAVY, weight: 1.5, opacity: dimmed ? 0.3 : 0.6, dashArray: "2 6", lineCap: "round", interactive: false },
  lio: { color: NAVY, weight: 1, opacity: dimmed ? 0.3 : 0.35, lineCap: "round", interactive: false },
});

const MASK_STYLE: L.PathOptions = { stroke: false, fillColor: "#e9ebf0", fillOpacity: 0.85, interactive: false };
const BORDER_STYLE: L.PathOptions = { color: NAVY, weight: 1.5, opacity: 0.5, dashArray: "6 5", interactive: false };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// Les icônes sont des divIcon (HTML) mises en cache : une par combinaison nom / taille / état / étiquette
const iconCache = new Map<string, L.DivIcon>();
function stationIcon(name: string, tier: Tier, state: string, showIcon: boolean, showLabel: boolean) {
  const key = `${name}|${tier}|${state}|${showIcon}|${showLabel}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const badge = showIcon ? `<span class="st-badge">${TRAIN_SVG}</span>` : `<span class="st-dot"></span>`;
    const label = showLabel ? `<span class="st-label">${escapeHtml(name)}</span>` : "";
    icon = L.divIcon({
      className: "st-icon",
      html: `<div class="st st-${tier} ${state}">${badge}${label}</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

// Recalcule le placement à chaque fin de zoom ou de déplacement
function useView() {
  const map = useMap();
  const [view, setView] = useState(0);
  useMapEvents({ zoomend: () => setView((v) => v + 1), moveend: () => setView((v) => v + 1) });
  return { map, zoom: map.getZoom(), view };
}

// Recadre la carte sur l'itinéraire, ou vole vers le lieu sélectionné
function Camera({ route, selected, byId }: Pick<Props, "route" | "selected" | "byId">) {
  const map = useMap();
  useEffect(() => {
    if (selected) {
      const p = byId.get(selected);
      if (p) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 12), { duration: 0.8 });
    } else if (route && route.legs.length) {
      const pts = route.legs.flatMap((l) => l.stops.map((id) => byId.get(id))).filter(Boolean) as Place[];
      map.flyToBounds(pts.map((p) => [p.lat, p.lon] as LatLngTuple), { padding: [60, 60], duration: 0.8 });
    }
  }, [route, selected, byId, map]);
  return null;
}

type Layers = Pick<Props, "places" | "route" | "selected"> & {
  onRoute: Set<string>;
  changes: Set<string>;
  onClick: (p: Place) => void;
};

// Un marqueur mémoïsé : au changement de zoom ou d'itinéraire, seuls ceux dont l'apparence change sont touchés
const StationMarker = memo(function StationMarker({ p, icon, zIndex, onClick }: { p: Place; icon: L.DivIcon; zIndex: number; onClick: (p: Place) => void }) {
  const handlers = useMemo(() => ({ click: () => onClick(p) }), [p, onClick]);
  return <Marker position={[p.lat, p.lon]} icon={icon} zIndexOffset={zIndex} eventHandlers={handlers} title={p.name} alt={p.name} />;
});

const StopMarker = memo(function StopMarker({ p, on, onClick }: { p: Place; on: boolean; onClick: (p: Place) => void }) {
  const handlers = useMemo(() => ({ click: () => onClick(p) }), [p, onClick]);
  const options = useMemo(() => ({ color: NAVY, weight: 1, opacity: on ? 1 : 0.5, fillColor: "#fff", fillOpacity: 1 }), [on]);
  return <CircleMarker center={[p.lat, p.lon]} radius={on ? 4.5 : 2} pathOptions={options} eventHandlers={handlers} />;
});

function Stations({ places, route, selected, onRoute, changes, onClick }: Layers) {
  const { map, zoom, view } = useView();
  const startId = route?.legs[0]?.from_id;
  const endId = route?.legs[route.legs.length - 1]?.to_id;
  const stateOf = (p: Place) =>
    p.id === startId ? "is-start" : p.id === endId ? "is-end" : changes.has(p.id) ? "is-change"
      : p.id === selected ? "is-selected" : onRoute.has(p.id) ? "is-on-route" : route ? "is-dimmed" : "";
  const isImportant = (state: string) => state !== "" && state !== "is-dimmed";

  // Placement glouton : départ / arrivée / correspondances d'abord, puis par fréquentation décroissante.
  // Une icône qui chevauche une boîte déjà prise devient un point ; un nom qui chevauche est masqué.
  const layout = useMemo(() => {
    const priority = (p: Place) => (isImportant(stateOf(p)) ? 1e6 : 0) + p.trips_per_day;
    const order = places.filter((p) => p.network !== "lio").sort((a, b) => priority(b) - priority(a));
    const taken: Box[] = [];
    const out = new Map<string, { icon: boolean; label: boolean }>();
    const bounds = map.getBounds().pad(0.2);
    for (const p of order) {
      if (!bounds.contains([p.lat, p.lon])) {
        out.set(p.id, { icon: false, label: false });
        continue;
      }
      const tier = tierOf(p);
      const important = isImportant(stateOf(p));
      const { x, y } = map.latLngToContainerPoint([p.lat, p.lon]);
      const half = ICON_PX[tier] / 2;
      const iconBox = { x1: x - half, y1: y - half, x2: x + half, y2: y + half };
      const icon = important || (zoom >= ICON_FROM_ZOOM[tier] && !taken.some((b) => overlaps(b, iconBox)));
      if (icon) taken.push(iconBox);
      const width = p.name.length * LABEL_CHAR_PX[tier];
      const labelBox = { x1: x + half - 2, y1: y - 9, x2: x + half + width, y2: y + 9 };
      const wantsLabel = (important && stateOf(p) !== "is-on-route") || zoom >= LABEL_FROM_ZOOM[tier];
      const label = icon && wantsLabel && (important || !taken.some((b) => overlaps(b, labelBox)));
      if (label) taken.push(labelBox);
      out.set(p.id, { icon, label });
    }
    return out;
    // view = la carte a bougé : on replace tout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, route, selected, changes, onRoute, zoom, view, map]);

  // Les plus fréquentées dessinées en dernier, au-dessus
  const sorted = useMemo(() => [...places].sort((a, b) => a.trips_per_day - b.trips_per_day), [places]);

  return (
    <>
      {sorted.map((p) => {
        // Arrêts de car (base complète seulement) : un simple point, ils sont des milliers
        if (p.network === "lio") return <StopMarker key={p.id} p={p} on={onRoute.has(p.id)} onClick={onClick} />;
        const tier = tierOf(p);
        const state = stateOf(p);
        const important = isImportant(state);
        const { icon: showIcon, label: showLabel } = layout.get(p.id) ?? { icon: false, label: false };
        return (
          <StationMarker
            key={p.id}
            p={p}
            icon={stationIcon(p.name, tier, state, showIcon, showLabel)}
            zIndex={important ? 1000 : tier === "major" ? 500 : tier === "medium" ? 200 : 0}
            onClick={onClick}
          />
        );
      })}
    </>
  );
}

export default memo(function MapView({ places, edges, byId, route, selected, onSelect, onPick }: Props) {
  const { t } = useI18n();

  // Une seule ligne par paire de gares et par type de service (A→B et B→A confondus), regroupées en
  // une polyligne multiple par type : 4 couches Leaflet au lieu d'une par tronçon
  const lines = useMemo(() => {
    const seen = new Set<string>();
    const out: Record<Kind, LatLngTuple[][]> = { train: [], coach: [], lio: [] };
    for (const e of edges) {
      const kind = e.mode === "Car liO" ? "lio" : COACH_MODES.has(e.mode) ? "coach" : "train";
      const key = [e.from_id, e.to_id].sort().join("-") + kind;
      const a = byId.get(e.from_id), b = byId.get(e.to_id);
      if (seen.has(key) || !a || !b) continue;
      seen.add(key);
      out[kind].push([[a.lat, a.lon], [b.lat, b.lon]]);
    }
    return out;
  }, [edges, byId]);

  const routePts = useMemo(
    () =>
      (route?.legs ?? []).map((l) => ({
        walk: l.mode === WALK,
        pts: l.stops.map((id) => byId.get(id)).filter(Boolean).map((p) => [p!.lat, p!.lon] as LatLngTuple),
      })),
    [route, byId],
  );
  const onRoute = useMemo(() => new Set(route?.legs.flatMap((l) => l.stops) ?? []), [route]);
  const changes = useMemo(() => new Set(route?.legs.slice(1).map((l) => l.from_id) ?? []), [route]);

  // Une seule fiche partagée, ouverte sur la gare cliquée
  const [card, setCard] = useState<Place | null>(null);
  const onClick = useCallback(
    (p: Place) => {
      onSelect(p.id);
      setCard(p);
    },
    [onSelect],
  );
  const dimmed = route !== null;
  const lineStyle = useMemo(() => lineStyles(dimmed), [dimmed]);

  return (
    <div className="map">
      {/* Seule l'Occitanie compte : la carte ne sort pas de la région et ne charge pas de tuiles au-delà */}
      <MapContainer center={[43.75, 2.6]} zoom={8} minZoom={7} maxBounds={OCCITANIE_BOUNDS} maxBoundsViscosity={1} zoomControl={false} preferCanvas>
        <TileLayer
          bounds={OCCITANIE_BOUNDS}
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={19}
        />
        <Polygon positions={OUTSIDE_MASK} pathOptions={MASK_STYLE} />
        <Polyline positions={OCCITANIE} pathOptions={BORDER_STYLE} />
        {/* Voies : un trait gris bordé de blanc, comme les lignes ferroviaires de Google Maps. Les cars dessous, les trains par-dessus */}
        <Polyline positions={lines.train} pathOptions={lineStyle.casing} />
        <Polyline positions={lines.lio} pathOptions={lineStyle.lio} />
        <Polyline positions={lines.coach} pathOptions={lineStyle.coach} />
        <Polyline positions={lines.train} pathOptions={lineStyle.train} />
        {routePts.map((l, i) => (
          <Polyline key={`casing-${i}`} positions={l.pts} pathOptions={{ color: "#fff", weight: 11, opacity: 1, lineCap: "round", lineJoin: "round" }} />
        ))}
        {routePts.map((l, i) => (
          <Polyline
            key={`route-${i}`}
            positions={l.pts}
            pathOptions={{ color: l.walk ? NAVY : RED, weight: l.walk ? 4 : 6, opacity: 1, dashArray: l.walk ? "1 8" : undefined, lineCap: "round", lineJoin: "round" }}
          />
        ))}
        <Stations
          places={places}
          route={route}
          selected={selected}
          onRoute={onRoute}
          changes={changes}
          onClick={onClick}
        />
        {card && (
          <Popup
            position={[card.lat, card.lon]}
            offset={[0, card.network === "lio" ? -4 : -14]}
            className="station-card"
            eventHandlers={{ remove: () => setCard(null) }}
          >
            <div className="popup">
              <span className="popup-kind">
                {card.network === "lio" ? t.modes["Car liO"] : t.station} · {card.department}
              </span>
              <strong>{card.name}</strong>
              {card.trips_per_day > 0 && <span className="popup-freq">{t.trainsPerDay(card.trips_per_day)}</span>}
              {card.lines.length > 0 && (
                <ul className="popup-lines">
                  {card.lines.slice(0, 4).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
              <div className="popup-actions">
                <button onClick={() => { onPick("from", card.name); setCard(null); }}>{t.leaveFrom}</button>
                <button onClick={() => { onPick("to", card.name); setCard(null); }}>{t.goTo}</button>
              </div>
            </div>
          </Popup>
        )}
        <Camera route={route} selected={selected} byId={byId} />
      </MapContainer>
    </div>
  );
});
