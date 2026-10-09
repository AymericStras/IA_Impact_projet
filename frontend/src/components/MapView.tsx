import { useEffect, useMemo, useState } from "react";
import { CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import type { LatLngTuple } from "leaflet";
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
const YELLOW = "#ffd500";

// Recadre la carte sur l'itinéraire, ou vole vers le lieu sélectionné
function Camera({ route, selected, byId }: Pick<Props, "route" | "selected" | "byId">) {
  const map = useMap();
  useEffect(() => {
    if (selected) {
      const p = byId.get(selected);
      if (p) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 11), { duration: 0.8 });
    } else if (route && route.legs.length) {
      const pts = route.legs.flatMap((l) => l.stops.map((id) => byId.get(id))).filter(Boolean) as Place[];
      map.flyToBounds(pts.map((p) => [p.lat, p.lon] as LatLngTuple), { padding: [60, 60], duration: 0.8 });
    }
  }, [route, selected, byId, map]);
  return null;
}

export default function MapView({ places, edges, byId, route, selected, onSelect, onPick }: Props) {
  const { t } = useI18n();

  // Une seule ligne par paire de gares et par type de service (A→B et B→A confondus)
  const lines = useMemo(() => {
    const seen = new Set<string>();
    const out: { key: string; pts: LatLngTuple[]; kind: "train" | "coach" | "lio" }[] = [];
    for (const e of edges) {
      const kind = e.mode === "Car liO" ? "lio" : COACH_MODES.has(e.mode) ? "coach" : "train";
      const key = [e.from_id, e.to_id].sort().join("-") + kind;
      const a = byId.get(e.from_id), b = byId.get(e.to_id);
      if (seen.has(key) || !a || !b) continue;
      seen.add(key);
      out.push({ key, kind, pts: [[a.lat, a.lon], [b.lat, b.lon]] });
    }
    // Les cars d'abord, les trains par-dessus
    return out.sort((x, y) => (x.kind === "train" ? 1 : 0) - (y.kind === "train" ? 1 : 0));
  }, [edges, byId]);

  const routePts = useMemo(() => {
    // Une polyligne par leg, qui passe par toutes les gares desservies
    return (route?.legs ?? []).map((l) => ({
      walk: l.mode === WALK,
      pts: l.stops.map((id) => byId.get(id)).filter(Boolean).map((p) => [p!.lat, p!.lon] as LatLngTuple),
    }));
  }, [route, byId]);

  const onRoute = useMemo(() => new Set(route?.legs.flatMap((l) => l.stops) ?? []), [route]);
  const changes = useMemo(() => new Set(route?.legs.slice(1).map((l) => l.from_id) ?? []), [route]);
  const startId = route?.legs[0]?.from_id;
  const endId = route?.legs[route.legs.length - 1]?.to_id;
  // Une seule popup partagée : 5 000 arrêts avec chacun la sienne alourdiraient beaucoup la carte
  const [popup, setPopup] = useState<Place | null>(null);
  const style = { train: { weight: 2.5, opacity: 0.55, dash: undefined }, coach: { weight: 1.5, opacity: 0.5, dash: "2 6" }, lio: { weight: 1, opacity: 0.28, dash: undefined } };

  return (
    <div className="map">
      <MapContainer center={[43.75, 2.6]} zoom={8} zoomControl={false} preferCanvas>
        <TileLayer
          className="tiles"
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          maxZoom={18}
        />
        {lines.map((l) => (
          <Polyline
            key={l.key}
            positions={l.pts}
            pathOptions={{ color: NAVY, weight: style[l.kind].weight, opacity: route ? 0.18 : style[l.kind].opacity, dashArray: style[l.kind].dash, lineCap: "round" }}
          />
        ))}
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
        {places.map((p) => {
          const isEnd = p.id === startId || p.id === endId;
          const isChange = changes.has(p.id);
          const lio = p.network === "lio";
          const highlighted = isEnd || isChange || onRoute.has(p.id) || p.id === selected;
          const fill = p.id === startId ? YELLOW : p.id === endId ? RED : p.id === selected ? YELLOW : "#fff";
          return (
            <CircleMarker
              key={p.id}
              center={[p.lat, p.lon]}
              radius={isEnd || p.id === selected ? 8 : isChange ? 7 : onRoute.has(p.id) ? 4.5 : lio ? 2 : 3.5}
              pathOptions={{
                color: NAVY,
                weight: isEnd || isChange ? 3 : lio && !highlighted ? 1 : 1.5,
                opacity: lio && !highlighted ? 0.5 : 1,
                fillColor: fill,
                fillOpacity: 1,
              }}
              eventHandlers={{
                click: () => {
                  onSelect(p.id);
                  setPopup(p);
                },
              }}
            >
              {(!lio || highlighted) && <Tooltip direction="top" offset={[0, -6]}>{p.name}</Tooltip>}
            </CircleMarker>
          );
        })}
        {popup && (
          <Popup position={[popup.lat, popup.lon]} eventHandlers={{ remove: () => setPopup(null) }}>
            <div className="popup">
              <strong>{popup.name}</strong>
              <span>
                {popup.network === "lio" ? t.modes["Car liO"] : "SNCF"} · {popup.department}
              </span>
              <div className="popup-actions">
                <button onClick={() => { onPick("from", popup.name); setPopup(null); }}>{t.leaveFrom}</button>
                <button onClick={() => { onPick("to", popup.name); setPopup(null); }}>{t.goTo}</button>
              </div>
            </div>
          </Popup>
        )}
        <Camera route={route} selected={selected} byId={byId} />
      </MapContainer>
    </div>
  );
}
