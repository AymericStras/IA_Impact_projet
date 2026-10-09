import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const en = {
  brand: "Occitanie",
  brandSub: "by rail",
  tagline: "Find the fastest train between two places in Occitanie",
  tabRoute: "Itinerary",
  headline: "Where to?",
  tabPlaces: "Places",
  from: "From",
  to: "To",
  fromPh: "Departure city or station",
  toPh: "Destination city or station",
  swap: "Swap",
  search: "Find my route",
  transports: "Transport",
  transportsHint: "Tap to leave a mode out",
  searching: "Searching…",
  total: "Total travel time",
  segments: (n: number) => `${n} segment${n > 1 ? "s" : ""}`,
  filter: "Search a station or department",
  stations: (n: number) => `${n} station${n > 1 ? "s" : ""}`,
  leaveFrom: "Leave from here",
  goTo: "Go here",
  department: "Department",
  modes: { "Train TER": "TER train", "Car TER": "TER coach", INTERCITES: "Intercités", "INTERCITES de nuit": "Night Intercités", "TGV INOUI": "TGV INOUI" } as Record<string, string>,
  errors: {
    unknown_place: "We don't know this place. Pick a station from the list.",
    no_route: "No connection between these two places in our data.",
    same_place: "Departure and destination are the same place.",
    unknown_mode: "One of the selected transport modes is unknown.",
    network: "The routing server is not reachable. Is the backend running?",
  },
  empty: "Choose a departure and a destination, or click a station on the map.",
  dataNote: "Data: SNCF open data (timetables, station list). Map © OpenStreetMap contributors.",
  language: "Language",
};
type Dict = typeof en;

const fr: Dict = {
  brand: "Occitanie",
  brandSub: "en train",
  tagline: "Trouvez le train le plus rapide entre deux lieux d'Occitanie",
  tabRoute: "Itinéraire",
  headline: "Où allez-vous ?",
  tabPlaces: "Lieux",
  from: "Départ",
  to: "Arrivée",
  fromPh: "Ville ou gare de départ",
  toPh: "Ville ou gare d'arrivée",
  swap: "Inverser",
  search: "Trouver mon trajet",
  transports: "Transports",
  transportsHint: "Touchez pour exclure un mode",
  searching: "Recherche…",
  total: "Durée totale du trajet",
  segments: (n) => `${n} tronçon${n > 1 ? "s" : ""}`,
  filter: "Chercher une gare ou un département",
  stations: (n) => `${n} gare${n > 1 ? "s" : ""}`,
  leaveFrom: "Partir d'ici",
  goTo: "Aller ici",
  department: "Département",
  modes: { "Train TER": "Train TER", "Car TER": "Car TER", INTERCITES: "Intercités", "INTERCITES de nuit": "Intercités de nuit", "TGV INOUI": "TGV INOUI" },
  errors: {
    unknown_place: "Ce lieu est inconnu. Choisissez une gare dans la liste.",
    no_route: "Aucune liaison entre ces deux lieux dans nos données.",
    same_place: "Le départ et l'arrivée sont le même lieu.",
    unknown_mode: "Un des modes de transport choisis est inconnu.",
    network: "Le serveur d'itinéraires ne répond pas. Le backend est-il lancé ?",
  },
  empty: "Choisissez un départ et une arrivée, ou cliquez sur une gare de la carte.",
  dataNote: "Données : open data SNCF (horaires, liste des gares). Carte © contributeurs OpenStreetMap.",
  language: "Langue",
};

export const LOCALES = { en, fr } as const;
export type Locale = keyof typeof LOCALES;

function detect(): Locale {
  try {
    const saved = localStorage.getItem("locale");
    if (saved && saved in LOCALES) return saved as Locale;
  } catch {
    /* stockage indisponible */
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of langs) {
    const short = l.slice(0, 2).toLowerCase();
    if (short in LOCALES) return short as Locale;
  }
  return "en";
}

const Ctx = createContext<{ t: Dict; locale: Locale; setLocale: (l: Locale) => void }>(null!);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detect);
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  const setLocale = (l: Locale) => {
    setLocaleState(l);
    try {
      localStorage.setItem("locale", l);
    } catch {
      /* stockage indisponible */
    }
  };
  return <Ctx.Provider value={{ t: LOCALES[locale], locale, setLocale }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);

export const formatMinutes = (m: number) => {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)} h ${String(r % 60).padStart(2, "0")}` : `${r} min`;
};
