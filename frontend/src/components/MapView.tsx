import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MlMap } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
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

// Moteur cartographique : MapLibre GL (rendu WebGL) sur un fond vectoriel de l'Occitanie seule, servi par le
// site (public/basemap, voir scripts/fetch-basemap.sh). Réseau, gares et itinéraire sont des couches de la
// carte, pas des éléments HTML : le GPU les dessine, et MapLibre gère seul le chevauchement des noms.
maplibregl.addProtocol("pmtiles", new Protocol().tile);

const NAVY = "#0f2149";
const RED = "#c90c0f";
const YELLOW = "#ffd500";
const RAIL = "#7d879c";
const WHITE = "#ffffff";

// Toutes les gares ont leur icône à tous les zooms, plus petite quand on dézoome ; la taille dit aussi la
// fréquentation. Seuls les noms se masquent : les couches sont empilées par importance, MapLibre place
// d'abord celles du dessus et cache le nom de toute gare qui chevaucherait une gare ou un nom déjà placé.
type Tier = "major" | "medium" | "minor";
const TIERS: Tier[] = ["minor", "medium", "major"]; // du dessous au dessus
const tierOf = (p: Place): Tier => (p.trips_per_day >= 60 ? "major" : p.trips_per_day >= 20 ? "medium" : "minor");
const LABEL_FROM_ZOOM: Record<Tier, number> = { major: 6, medium: 10, minor: 12 };
const BADGE_PX: Record<Tier | "important", number> = { important: 30, major: 26, medium: 22, minor: 18 };
const TEXT_PX: Record<Tier | "important", number> = { important: 14, major: 13.5, medium: 12, minor: 11 };
// Échelle des pastilles selon le zoom : minuscules sur la vue de toute la région, pleine taille à partir du zoom 12
const SHRINK: [zoom: number, scale: number][] = [[6, 0.38], [9, 0.65], [12, 1]];

// Pastilles de gare : dessinées une fois sur un canvas, une par état
const BADGE = 30; // taille de référence, réduite par icon-size
const BADGES = {
  default: { bg: NAVY, fg: WHITE, border: WHITE },
  start: { bg: YELLOW, fg: NAVY, border: WHITE },
  end: { bg: RED, fg: WHITE, border: WHITE },
  change: { bg: WHITE, fg: NAVY, border: NAVY },
  route: { bg: WHITE, fg: RED, border: RED },
};
type Badge = keyof typeof BADGES;
// Pictogramme « train » (Material Icons, Apache 2.0)
const TRAIN_PATH =
  "M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm3.5-7H6V6h5v4zm2 0V6h5v4h-5zm3.5 7c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z";

function badgeImage({ bg, fg, border }: (typeof BADGES)[Badge]) {
  const ratio = 2, pad = 4, size = (BADGE + pad * 2) * ratio;
  const ctx = Object.assign(document.createElement("canvas"), { width: size, height: size }).getContext("2d")!;
  ctx.scale(ratio, ratio);
  ctx.translate(pad, pad);
  ctx.shadowColor = "rgba(15, 33, 73, .45)";
  ctx.shadowBlur = 3;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, BADGE, BADGE, 8);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = border;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.roundRect(1.15, 1.15, BADGE - 2.3, BADGE - 2.3, 7);
  ctx.stroke();
  const glyph = 19;
  ctx.translate((BADGE - glyph) / 2, (BADGE - glyph) / 2);
  ctx.scale(glyph / 24, glyph / 24);
  ctx.fillStyle = fg;
  ctx.fill(new Path2D(TRAIN_PATH));
  return { image: ctx.getImageData(0, 0, size, size), pixelRatio: ratio };
}

type State = "" | "is-dimmed" | "is-start" | "is-end" | "is-change" | "is-selected" | "is-on-route";
const badgeOf: Record<State, Badge> = {
  "": "default", "is-dimmed": "default", "is-start": "start", "is-end": "end", "is-selected": "end", "is-change": "change", "is-on-route": "route",
};

// Nom affiché : toujours pour les gares importantes (sauf les simples arrêts du trajet), sinon à partir de
// labelZoom. MapLibre n'accepte le zoom qu'en tête d'expression, d'où un palier par niveau de LABEL_FROM_ZOOM.
const nameField = () => {
  const at = (z: number) => ["case", ["any", ["get", "alwaysName"], [">=", z, ["get", "labelZoom"]]], ["get", "name"], ""];
  return ["step", ["zoom"], at(0), 6, at(6), 10, at(10), 12, at(12)] as unknown as maplibregl.ExpressionSpecification;
};

const offsets = (size: number, scale: number) =>
  ["match", ["get", "badgePx"], ...Object.values(BADGE_PX).flatMap((px) => [px, ["literal", [((px * scale) / 2 + 3) / size, 0]]]), ["literal", [1, 0]]];

const fc = <G extends GeoJSON.Geometry>(features: GeoJSON.Feature<G>[]): GeoJSON.FeatureCollection<G> => ({ type: "FeatureCollection", features });
const line = (coords: [number, number][], properties: Record<string, unknown>): GeoJSON.Feature<GeoJSON.LineString> => ({
  type: "Feature", properties, geometry: { type: "LineString", coordinates: coords },
});
const lonLat = (p: Place): [number, number] => [p.lon, p.lat];

const BASE = `${location.origin}${import.meta.env.BASE_URL}basemap`;
const STATION_LAYERS = ["lio-stops", ...TIERS.map((t) => `st-${t}`), "st-route", "st-important"];

function buildStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    glyphs: `${BASE}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${BASE}/sprites/light`,
    sources: {
      protomaps: {
        type: "vector",
        url: `pmtiles://${BASE}/occitanie.pmtiles`,
        attribution: '<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap</a> · <a href="https://protomaps.com">Protomaps</a>',
      },
    },
    // Fond très épuré : les points d'intérêt et les bâtiments ne servent à rien ici et coûtent au rendu
    layers: layers("protomaps", namedFlavor("light"), { lang: "fr" }).filter((l) => !/^(pois|buildings)/.test(l.id)),
  };
}

function addOverlays(map: MlMap) {
  for (const [name, colors] of Object.entries(BADGES)) map.addImage(`badge-${name}`, ...Object.values(badgeImage(colors)) as [ImageData, { pixelRatio: number }]);
  const empty = fc([]);
  for (const id of ["network", "route", "stations", "stops"]) map.addSource(id, { type: "geojson", data: empty });
  map.addSource("mask", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: OUTSIDE_MASK } } });

  // Hors région : grisé, frontière en pointillés
  map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": "#e9ebf0", "fill-opacity": 0.85 } });
  map.addLayer({
    id: "border", type: "line", source: { type: "geojson", data: line(OCCITANIE, {}) },
    paint: { "line-color": NAVY, "line-width": 1.5, "line-opacity": 0.5, "line-dasharray": [4, 3.3] },
  });

  // Voies : un trait gris bordé de blanc, comme les lignes ferroviaires de Google Maps. Les cars dessous, les trains par-dessus
  const round = { "line-cap": "round", "line-join": "round" } as const;
  map.addLayer({ id: "net-casing", type: "line", source: "network", filter: ["==", ["get", "kind"], "train"], layout: round, paint: { "line-color": WHITE, "line-width": 6, "line-opacity": 0.9 } });
  map.addLayer({ id: "net-lio", type: "line", source: "network", filter: ["==", ["get", "kind"], "lio"], layout: round, paint: { "line-color": NAVY, "line-width": 1, "line-opacity": 0.35 } });
  map.addLayer({ id: "net-coach", type: "line", source: "network", filter: ["==", ["get", "kind"], "coach"], layout: round, paint: { "line-color": NAVY, "line-width": 1.5, "line-opacity": 0.6, "line-dasharray": [1.3, 4] } });
  map.addLayer({ id: "net-train", type: "line", source: "network", filter: ["==", ["get", "kind"], "train"], layout: round, paint: { "line-color": RAIL, "line-width": 3, "line-opacity": 0.75 } });

  // Itinéraire : rouge (pointillés marine pour la marche) sur un liseré blanc
  map.addLayer({ id: "route-casing", type: "line", source: "route", layout: round, paint: { "line-color": WHITE, "line-width": 11 } });
  map.addLayer({ id: "route-ride", type: "line", source: "route", filter: ["!", ["get", "walk"]], layout: round, paint: { "line-color": RED, "line-width": 6 } });
  map.addLayer({ id: "route-walk", type: "line", source: "route", filter: ["get", "walk"], layout: round, paint: { "line-color": NAVY, "line-width": 4, "line-dasharray": [0, 2] } });

  const dim = ["case", ["get", "dim"], 0.45, 1] as maplibregl.ExpressionSpecification;
  // Arrêts de car (base complète seulement) : un simple point, ils sont des milliers
  map.addLayer({
    id: "lio-stops", type: "circle", source: "stops",
    paint: { "circle-radius": ["case", ["get", "on"], 4.5, 2], "circle-color": WHITE, "circle-stroke-color": NAVY, "circle-stroke-width": 1, "circle-stroke-opacity": ["case", ["get", "on"], 1, 0.5] },
  });
  const symbol = (id: string, filter: maplibregl.FilterSpecification, size: number, important: boolean): maplibregl.LayerSpecification => ({
    id, type: "symbol", source: "stations", filter,
    layout: {
      "icon-image": ["concat", "badge-", ["get", "badge"]],
      "icon-size": ["interpolate", ["linear"], ["zoom"], ...SHRINK.flatMap(([z, k]) => [z, ["*", k / BADGE, ["get", "badgePx"]]])] as unknown as maplibregl.ExpressionSpecification,
      "icon-allow-overlap": true,
      "icon-ignore-placement": false,
      "text-field": nameField(),
      "text-font": ["Noto Sans Medium"],
      "text-size": size,
      "text-anchor": "left",
      // Nom à droite de la pastille, 3 px après son bord (en em de la taille du texte), qui suit la pastille quand elle rétrécit
      "text-offset": ["interpolate", ["linear"], ["zoom"], ...SHRINK.flatMap(([z, k]) => [z, offsets(size, k)])] as unknown as maplibregl.ExpressionSpecification,
      "text-optional": true,
      "text-allow-overlap": important,
      "symbol-sort-key": ["-", ["get", "trips"]],
    },
    paint: { "text-color": NAVY, "text-halo-color": WHITE, "text-halo-width": 1.6, "icon-opacity": dim, "text-opacity": dim },
  });
  const plain = ["!", ["get", "important"]] as maplibregl.ExpressionSpecification;
  for (const t of TIERS) map.addLayer(symbol(`st-${t}`, ["all", plain, ["==", ["get", "tier"], t]], TEXT_PX[t], false));
  map.addLayer(symbol("st-route", ["==", ["get", "state"], "is-on-route"], TEXT_PX.major, false));
  map.addLayer(symbol("st-important", ["all", ["get", "important"], ["!=", ["get", "state"], "is-on-route"]], TEXT_PX.important, true));
}

// Fiche de gare : contenu React rendu dans la bulle MapLibre
function StationCard({ card, onPick, close }: { card: Place; onPick: Props["onPick"]; close: () => void }) {
  const { t } = useI18n();
  return (
    <div className="popup">
      <span className="popup-kind">
        {card.network === "lio" ? t.modes["Car liO"] : t.station} · {card.department}
      </span>
      <strong>{card.name}</strong>
      {card.trips_per_day > 0 && <span className="popup-freq">{t.trainsPerDay(card.trips_per_day)}</span>}
      {card.lines.length > 0 && (
        <ul className="popup-lines">
          {card.lines.slice(0, 4).map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <div className="popup-actions">
        <button onClick={() => { onPick("from", card.name); close(); }}>{t.leaveFrom}</button>
        <button onClick={() => { onPick("to", card.name); close(); }}>{t.goTo}</button>
      </div>
    </div>
  );
}

export default memo(function MapView({ places, edges, byId, route, selected, onSelect, onPick }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<MlMap | null>(null);
  const [card, setCard] = useState<Place | null>(null);
  const popup = useRef<maplibregl.Popup | null>(null);
  const popupBody = useMemo(() => document.createElement("div"), []);
  // Les gestionnaires d'événements de la carte sont posés une fois : ils lisent les données via des refs
  const latest = useRef({ byId, onSelect });
  latest.current = { byId, onSelect };

  useEffect(() => {
    const m = new maplibregl.Map({
      container: box.current!,
      style: buildStyle(),
      bounds: OCCITANIE_BOUNDS,
      maxBounds: OCCITANIE_BOUNDS,
      minZoom: 6,
      maxZoom: 17,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
    });
    m.touchZoomRotate.disableRotation();
    m.on("load", () => {
      addOverlays(m);
      setMap(m);
    });
    m.on("click", STATION_LAYERS, (e) => {
      const p = latest.current.byId.get(e.features?.[0]?.properties.id);
      if (!p) return;
      latest.current.onSelect(p.id);
      setCard(p);
    });
    m.on("mouseenter", STATION_LAYERS, () => (m.getCanvas().style.cursor = "pointer"));
    m.on("mouseleave", STATION_LAYERS, () => (m.getCanvas().style.cursor = ""));
    return () => m.remove();
  }, []);

  // Une seule ligne par paire de gares et par type de service (A→B et B→A confondus)
  const network = useMemo(() => {
    const seen = new Set<string>();
    const out: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    for (const e of edges) {
      const kind = e.mode === "Car liO" ? "lio" : COACH_MODES.has(e.mode) ? "coach" : "train";
      const key = [e.from_id, e.to_id].sort().join("-") + kind;
      const a = byId.get(e.from_id), b = byId.get(e.to_id);
      if (seen.has(key) || !a || !b) continue;
      seen.add(key);
      out.push(line([lonLat(a), lonLat(b)], { kind }));
    }
    return fc(out);
  }, [edges, byId]);

  useEffect(() => {
    (map?.getSource("network") as GeoJSONSource | undefined)?.setData(network);
  }, [map, network]);

  // Réseau estompé quand un itinéraire est affiché
  useEffect(() => {
    if (!map) return;
    const dimmed = route !== null;
    map.setPaintProperty("net-casing", "line-opacity", dimmed ? 0.4 : 0.9);
    map.setPaintProperty("net-train", "line-opacity", dimmed ? 0.3 : 0.75);
    map.setPaintProperty("net-coach", "line-opacity", dimmed ? 0.3 : 0.6);
    map.setPaintProperty("net-lio", "line-opacity", dimmed ? 0.3 : 0.35);
  }, [map, route]);

  // Itinéraire + état de chaque gare (départ, arrivée, correspondance, desservie, estompée)
  useEffect(() => {
    if (!map) return;
    const legs = (route?.legs ?? []).map((l) =>
      line(l.stops.map((id) => byId.get(id)).filter((p): p is Place => !!p).map(lonLat), { walk: l.mode === WALK }),
    );
    (map.getSource("route") as GeoJSONSource).setData(fc(legs));

    const onRoute = new Set(route?.legs.flatMap((l) => l.stops) ?? []);
    const changes = new Set(route?.legs.slice(1).map((l) => l.from_id) ?? []);
    const startId = route?.legs[0]?.from_id;
    const endId = route?.legs[route.legs.length - 1]?.to_id;
    const stations: GeoJSON.Feature<GeoJSON.Point>[] = [];
    const stops: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const p of places) {
      const geometry: GeoJSON.Point = { type: "Point", coordinates: lonLat(p) };
      if (p.network === "lio") {
        stops.push({ type: "Feature", geometry, properties: { id: p.id, on: onRoute.has(p.id) } });
        continue;
      }
      const tier = tierOf(p);
      const state: State =
        p.id === startId ? "is-start" : p.id === endId ? "is-end" : changes.has(p.id) ? "is-change"
          : p.id === selected ? "is-selected" : onRoute.has(p.id) ? "is-on-route" : route ? "is-dimmed" : "";
      const important = state !== "" && state !== "is-dimmed";
      const big = important && state !== "is-on-route";
      stations.push({
        type: "Feature",
        geometry,
        properties: {
          id: p.id, name: p.name, tier, state, important, trips: p.trips_per_day,
          badge: badgeOf[state], badgePx: big ? BADGE_PX.important : BADGE_PX[tier],
          dim: state === "is-dimmed", alwaysName: big, labelZoom: LABEL_FROM_ZOOM[tier],
        },
      });
    }
    (map.getSource("stations") as GeoJSONSource).setData(fc(stations));
    (map.getSource("stops") as GeoJSONSource).setData(fc(stops));
  }, [map, places, byId, route, selected]);

  // Recadre la carte sur l'itinéraire, ou vole vers le lieu sélectionné
  useEffect(() => {
    if (!map) return;
    if (selected) {
      const p = byId.get(selected);
      if (p) map.flyTo({ center: lonLat(p), zoom: Math.max(map.getZoom(), 12), duration: 800 });
    } else if (route && route.legs.length) {
      const bounds = new maplibregl.LngLatBounds();
      for (const l of route.legs) for (const id of l.stops) {
        const p = byId.get(id);
        if (p) bounds.extend(lonLat(p));
      }
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60, duration: 800 });
    }
  }, [map, route, selected, byId]);

  // Une seule fiche partagée, ouverte sur la gare cliquée
  useEffect(() => {
    popup.current?.remove();
    popup.current = null;
    if (!map || !card) return;
    const p = new maplibregl.Popup({ offset: card.network === "lio" ? 6 : 16, className: "station-card", maxWidth: "280px" })
      .setLngLat(lonLat(card) as LngLatLike)
      .setDOMContent(popupBody)
      .addTo(map);
    p.on("close", () => setCard((c) => (c === card ? null : c)));
    popup.current = p;
  }, [map, card, popupBody]);

  return (
    <div className="map">
      <div ref={box} className="map-canvas" />
      {card && createPortal(<StationCard card={card} onPick={onPick} close={() => setCard(null)} />, popupBody)}
    </div>
  );
});
