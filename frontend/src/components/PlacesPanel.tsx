import { useMemo, useState } from "react";
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

  const groups = useMemo(() => {
    const k = norm(q.trim());
    const out = new Map<string, Place[]>();
    for (const p of places) {
      if (!k && p.network === "lio") continue; // ~4 700 arrêts de car : seulement quand on cherche
      if (k && !norm(p.name).includes(k) && !norm(p.department).includes(k) && !norm(p.commune).includes(k)) continue;
      if (!out.has(p.department)) out.set(p.department, []);
      out.get(p.department)!.push(p);
    }
    return [...out.entries()].sort(([a], [b]) => a.localeCompare(b, "fr"));
  }, [places, q]);
  const count = groups.reduce((n, [, ps]) => n + ps.length, 0);

  return (
    <section className="places">
      <div className="hero hero-compact">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.filter} aria-label={t.filter} />
        <span className="places-count">{t.stations(count)}</span>
      </div>
      <div className="panel-body">
        {!q.trim() && <p className="hint places-hint">{t.placesHint}</p>}
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
