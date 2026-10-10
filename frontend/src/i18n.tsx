import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const en = {
  brand: "Occitanie",
  brandSub: "by rail",
  tagline: "Find the fastest train between two places in Occitanie",
  tabRoute: "Itinerary",
  headline: "Where to?",
  tabPlaces: "Places",
  tabChat: "Assistant",
  chatTitle: "Ask the assistant",
  chatSoon: "The travel assistant is coming soon. You will be able to ask it questions about your trips in Occitanie.",
  from: "From",
  to: "To",
  fromPh: "Departure city or station",
  toPh: "Destination city or station",
  swap: "Swap",
  search: "Find my route",
  searching: "Searching…",
  total: "Total travel time",
  direct: "Direct",
  transfers: (n: number) => `${n} change${n > 1 ? "s" : ""}`,
  stopsCount: (n: number) => (n === 0 ? "non-stop" : `${n} stop${n > 1 ? "s" : ""}`),
  perDay: (n: number) => `${n}/day`,
  change: (m: string) => `Change · about ${m}`,
  access: (m: string) => `Getting there · about ${m}`,
  egress: (m: string) => `Into town · about ${m}`,
  placesHint: "Showing train stations. Type to search the liO coach stops too.",
  estimateNote: "Average estimate: changes include the typical wait for the next departure.",
  filter: "Search a station or department",
  stations: (n: number) => `${n} station${n > 1 ? "s" : ""}`,
  leaveFrom: "Leave from here",
  station: "Train station",
  trainsPerDay: (n: number) => `${n} train${n > 1 ? "s" : ""} a day`,
  goTo: "Go here",
  department: "Department",
  modes: { "Train TER": "TER train", "Car TER": "TER coach", "Car liO": "liO coach", Marche: "Walk", "Car à réservation": "On-demand coach", INTERCITES: "Intercités", "INTERCITES de nuit": "Night Intercités", "TGV INOUI": "TGV INOUI", OUIGO: "OUIGO", Navette: "Shuttle" } as Record<string, string>,
  errors: {
    unknown_place: "We don't know this place. Pick a station from the list.",
    no_route: "No connection between these two places in our data.",
    same_place: "Departure and destination are the same place.",
    network: "The routing server is not reachable. Is the backend running?",
  },
  empty: "Choose a departure and a destination, or click a station on the map.",
  dataNote: "Data: SNCF open data (timetables, station list). Map © OpenStreetMap contributors.",
  discoverTitle: "Worth a visit near the stations",
  discoverCount: (n: number) => `${n} place${n > 1 ? "s" : ""} to discover`,
  walkFrom: (min: number, station: string) => `${min} min walk from ${station}`,
  farFrom: (km: string, station: string) => `${km} km from ${station}`,
  walkZone: "20 min walk",
  didYouKnow: "Did you know?",
  learnMore: "Learn more",
  close: "Close",
  photoBy: (author: string) => `Photo: ${author}`,
  leaveFromStation: "Leave from this station",
  goToStation: "Take the train here",
  categories: { heritage: "Heritage", museum: "Museum", nature: "Nature", engineering: "Engineering" } as Record<string, string>,
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
  tabChat: "Assistant",
  chatTitle: "Demandez à l'assistant",
  chatSoon: "L'assistant de voyage arrive bientôt. Vous pourrez lui poser vos questions sur vos trajets en Occitanie.",
  from: "Départ",
  to: "Arrivée",
  fromPh: "Ville ou gare de départ",
  toPh: "Ville ou gare d'arrivée",
  swap: "Inverser",
  search: "Trouver mon trajet",
  searching: "Recherche…",
  total: "Durée totale du trajet",
  direct: "Direct",
  transfers: (n) => `${n} correspondance${n > 1 ? "s" : ""}`,
  stopsCount: (n) => (n === 0 ? "sans arrêt" : `${n} arrêt${n > 1 ? "s" : ""}`),
  perDay: (n) => `${n}/jour`,
  change: (m) => `Correspondance · environ ${m}`,
  access: (m) => `Rejoindre l'arrêt · environ ${m}`,
  egress: (m) => `Rejoindre le centre · environ ${m}`,
  placesHint: "Gares affichées. Tapez un nom pour chercher aussi parmi les arrêts de car liO.",
  estimateNote: "Estimation moyenne : les correspondances comptent l'attente habituelle du départ suivant.",
  filter: "Chercher une gare ou un département",
  stations: (n) => `${n} gare${n > 1 ? "s" : ""}`,
  leaveFrom: "Partir d'ici",
  station: "Gare",
  trainsPerDay: (n) => `${n} train${n > 1 ? "s" : ""} par jour`,
  goTo: "Aller ici",
  department: "Département",
  modes: { "Train TER": "Train TER", "Car TER": "Car TER", "Car liO": "Car liO", Marche: "À pied", "Car à réservation": "Car à réservation", INTERCITES: "Intercités", "INTERCITES de nuit": "Intercités de nuit", "TGV INOUI": "TGV INOUI", OUIGO: "OUIGO", Navette: "Navette" },
  errors: {
    unknown_place: "Ce lieu est inconnu. Choisissez une gare dans la liste.",
    no_route: "Aucune liaison entre ces deux lieux dans nos données.",
    same_place: "Le départ et l'arrivée sont le même lieu.",
    network: "Le serveur d'itinéraires ne répond pas. Le backend est-il lancé ?",
  },
  empty: "Choisissez un départ et une arrivée, ou cliquez sur une gare de la carte.",
  dataNote: "Données : open data SNCF (horaires, liste des gares). Carte © contributeurs OpenStreetMap.",
  discoverTitle: "À découvrir près des gares",
  discoverCount: (n) => `${n} lieu${n > 1 ? "x" : ""} à découvrir`,
  walkFrom: (min, station) => `À ${min} min à pied de ${station}`,
  farFrom: (km, station) => `À ${km} km de ${station}`,
  walkZone: "20 min à pied",
  didYouKnow: "Le saviez-vous ?",
  learnMore: "En savoir plus",
  close: "Fermer",
  photoBy: (author) => `Photo : ${author}`,
  leaveFromStation: "Partir de cette gare",
  goToStation: "Y aller en train",
  categories: { heritage: "Patrimoine", museum: "Musée", nature: "Nature", engineering: "Ouvrage d'art" },
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
