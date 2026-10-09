import { useDeferredValue, useMemo, useState } from "react";
import type { Place } from "../api";
import { useI18n } from "../i18n";

type Props = {
  places: Place[];
  selected: string | null;
  onSelect: (id: string) => void;
  onPick: (which: "from" | "to", name: string) => void;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export default function PlacesPanel({ places, selected, onSelect, onPick }: Props) {
  const { t } = useI18n();
  const [q, setQ] = useState("");

  // Texte normalisé calculé une fois par lieu ; la liste suit la saisie en différé pour ne pas bloquer le champ
  const searchable = useMemo(() => places.map((p) => ({ p, text: norm(`${p.name}\n${p.department}\n${p.commune}`) })), [places]);
  const query = useDeferredValue(q);

  const groups = useMemo(() => {
    const k = norm(query.trim());
    const out = new Map<string, Place[]>();
    for (const { p, text } of searchable) {
      if (!k && p.network === "lio") continue; // ~4 700 arrêts de car : seulement quand on cherche
      if (k && !text.includes(k)) continue;
      if (!out.has(p.department)) out.set(p.department, []);
      out.get(p.department)!.push(p);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b, "fr"));
  }, [searchable, query]);
  const count = groups.reduce((n, [, ps]) => n + ps.length, 0);

  return (
    <section className="places">
      <div className="hero hero-compact">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.filter} aria-label={t.filter} />
        <span className="places-count">{t.stations(count)}</span>
      </div>
      <div className="panel-body">
        {!q.trim() && places.some((p) => p.network === "lio") && <p className="hint places-hint">{t.placesHint}</p>}
        {groups.map(([dep, ps]) => (
          <div key={dep} className="dep">
            <h2>
              <span className="pill" aria-hidden="true" />
              {dep}
              <small>{ps.length}</small>
            </h2>
            <ul>
              {ps.map((p) => (
                <li key={p.id} className={p.id === selected ? "place active" : "place"}>
                  <button className="place-name" onClick={() => onSelect(p.id)}>
                    {p.name}
                  </button>
                  {p.id === selected && (
                    <span className="place-actions">
                      <button onClick={() => onPick("from", p.name)}>{t.leaveFrom}</button>
                      <button onClick={() => onPick("to", p.name)}>{t.goTo}</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
