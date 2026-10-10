import { useEffect, useRef, useState } from "react";
import type { Place } from "../api";
import { useI18n } from "../i18n";
import { creditOf, distanceKm, imageOf, type Discovery } from "../data/discoveries";

// Photo du lieu ; si elle manque (pas encore téléchargée, hors ligne), un aplat aux couleurs de la charte
export function DiscoveryImage({ d, className }: { d: Discovery; className?: string }) {
  const { t, locale } = useI18n();
  const [failed, setFailed] = useState(false);
  return failed ? (
    <div className={`disc-img disc-img-empty cat-${d.category} ${className ?? ""}`} aria-hidden="true">
      <span>{t.categories[d.category]}</span>
    </div>
  ) : (
    <img className={`disc-img ${className ?? ""}`} src={imageOf(d)} alt={d.title[locale]} loading="lazy" onError={() => setFailed(true)} />
  );
}

// A straight-line distance cannot establish a pedestrian route or a duration for a school group.
export function useDistanceLabel() {
  const { locale } = useI18n();
  return (d: Discovery, station: Place | undefined) => {
    if (!station) return "";
    const km = distanceKm(d, station);
    const label = km.toLocaleString(locale, { maximumFractionDigits: 1 });
    return locale === "fr" ? `${label} km à vol d’oiseau de ${station.name} · accès à pied à vérifier` : `${label} km in a straight line from ${station.name} · walking route unverified`;
  };
}

type CardProps = { d: Discovery; station: Place | undefined; onOpen: (d: Discovery) => void; layout: "tile" | "row" };

// Vignette cliquable : « tile » dans le carrousel, « row » sous une gare sélectionnée
export function DiscoveryCard({ d, station, onOpen, layout }: CardProps) {
  const { locale } = useI18n();
  const distance = useDistanceLabel();
  return (
    <button className={`disc-card disc-${layout}`} onClick={() => onOpen(d)}>
      <DiscoveryImage d={d} />
      <span className="disc-text">
        <strong>{d.title[locale]}</strong>
        <span className="disc-distance">{distance(d, station)}</span>
        <span className="disc-summary">{d.summary[locale]}</span>
      </span>
    </button>
  );
}

type SheetProps = {
  d: Discovery;
  station: Place | undefined;
  onClose: () => void;
  onPick: (which: "from" | "to", name: string) => void;
};

// Fiche complète d'un lieu, en surimpression ; Échap ou un clic sur le fond la ferment
export function DiscoverySheet({ d, station, onClose, onPick }: SheetProps) {
  const { t, locale } = useI18n();
  const distance = useDistanceLabel();
  const closeBtn = useRef<HTMLButtonElement>(null);
  const credit = creditOf(d);

  useEffect(() => {
    closeBtn.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [d, onClose]);

  const pick = (which: "from" | "to") => {
    if (!station) return;
    onPick(which, station.name);
    onClose();
  };

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <article className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-hero">
          <DiscoveryImage d={d} />
          <button ref={closeBtn} className="sheet-close" onClick={onClose} aria-label={t.close}>
            ×
          </button>
          {credit && (
            <a className="sheet-credit" href={credit.source} target="_blank" rel="noreferrer">
              {t.photoBy(credit.author)}
              {credit.license && ` · ${credit.license}`}
            </a>
          )}
        </div>
        <div className="sheet-body">
          <div className="sheet-tags">
            <span className={`disc-cat cat-${d.category}`}>{t.categories[d.category]}</span>
            <span className="disc-era">{d.era[locale]}</span>
          </div>
          <h2 id="sheet-title">{d.title[locale]}</h2>
          {station && <p className="sheet-distance">{distance(d, station)}</p>}
          <p className="sheet-lead">{d.summary[locale]}</p>
          {d.description.map((para, i) => (
            <p key={i}>{para[locale]}</p>
          ))}
          <aside className="sheet-fact">
            <strong>{t.didYouKnow}</strong>
            <p>{d.didYouKnow[locale]}</p>
          </aside>
          {station && (
            <div className="sheet-actions">
              <button onClick={() => pick("from")}>{t.leaveFromStation}</button>
              <button onClick={() => pick("to")}>{t.goToStation}</button>
            </div>
          )}
        </div>
      </article>
    </div>
  );
}
