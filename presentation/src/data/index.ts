// Données du diapo, produites par scripts/build-data.py (network.json, photos.json — ne pas les éditer à la main).
import networkJson from "./network.json";
import photosJson from "./photos.json";

/** Gare : x, y dans le repère 1000 × 820 de la carte, nom */
export type Station = [x: number, y: number, name: string];

export interface Leg {
  line: string;
  from: string;
  to: string;
  minutes: number;
  /** attente avant ce tronçon (correspondance), en minutes */
  wait: number;
  perDay: number;
  /** indices dans `stations`, du départ à l'arrivée */
  stops: number[];
}

export interface Network {
  /** contour de l'Occitanie, chemin SVG */
  outline: string;
  stations: Station[];
  edges: [number, number][];
  /** code UIC → indice de gare */
  ids: Record<string, number>;
  spots: Record<string, [number, number]>;
  route: { from: string; to: string; minutes: number; legs: Leg[] };
}

export interface Credit {
  author: string;
  license: string;
  source?: string;
  file: string;
}

export interface Scenery {
  id: string;
  title: string;
  file: string;
  author: string;
  license: string;
  /** un lieu à voir (et pas seulement un paysage) */
  place: boolean;
}

export interface Idea {
  title: string;
  city: string;
  minutes: number;
  transfers: number;
  file: string;
  author: string;
  license: string;
}

interface Photos {
  PHOTOS: Record<string, Credit>;
  SCENERY: Scenery[];
  MODEL: Credit & { title: string };
  MODELS: Record<string, Credit>;
  IDEAS: Idea[];
}

export const NETWORK = networkJson as unknown as Network;
const photos = photosJson as unknown as Photos;
export const { PHOTOS, SCENERY, MODELS, IDEAS } = photos;

export const ST = NETWORK.stations;
export const ROUTE = NETWORK.route;
