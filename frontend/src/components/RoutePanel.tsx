import { WALK, type ErrorCode, type Mode, type Place, type Route } from "../api";
import { formatMinutes, useI18n } from "../i18n";
import Trame from "./Trame";

type Props = {
  places: Place[];
  from: string;
  to: string;
  setFrom: (v: string) => void;
  setTo: (v: string) => void;
  onSearch: () => void;
  modes: Mode[];
  excluded: string[];
  toggleMode: (mode: string) => void;
  loading: boolean;
  route: Route | null;
  error: ErrorCode | null;
};

const slug = (mode: string) => mode.replace(/\s+/g, "-").toLowerCase();

export default function RoutePanel({ places, from, to, setFrom, setTo, onSearch, modes, excluded, toggleMode, loading, route, error }: Props) {
  const { t } = useI18n();
  const [first, ...rest] = t.headline.split(" ");

  return (
    <>
      <form
        className="hero"
        onSubmit={(e) => {
          e.preventDefault();
          onSearch();
        }}
      >
        <h1>
          <u>{first}</u> {rest.join(" ")}
        </h1>
        <label className="field">
          <span className="dot dot-yellow" aria-hidden="true" />
          <span className="sr-only">{t.from}</span>
          <input list="place-names" value={from} onChange={(e) => setFrom(e.target.value)} placeholder={t.fromPh} autoComplete="off" />
        </label>
        <button
          type="button"
          className="swap"
          title={t.swap}
          aria-label={t.swap}
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          ⇅
        </button>
        <label className="field">
          <span className="dot dot-red" aria-hidden="true" />
          <span className="sr-only">{t.to}</span>
          <input list="place-names" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t.toPh} autoComplete="off" />
        </label>
        <datalist id="place-names">
          {places.map((p) => (
            <option key={p.id} value={p.name} />
          ))}
        </datalist>
        <fieldset className="modes">
          <legend>
            {t.transports} <small>{t.transportsHint}</small>
          </legend>
          {modes.map((m) => {
            const on = !excluded.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                className={`chip mode-${slug(m.id)}${on ? "" : " off"}`}
                onClick={() => toggleMode(m.id)}
              >
                <span className="chip-dot" aria-hidden="true" />
                {t.modes[m.id] ?? m.id}
              </button>
            );
          })}
        </fieldset>
        <button className="cta" type="submit" disabled={loading || !from.trim() || !to.trim()}>
          {loading ? t.searching : t.search}
        </button>
        <Trame className="hero-trame" rows={2} columns={30} />
      </form>

      <section className="panel-body" aria-live="polite">
        {error && <p className="alert">{t.errors[error]}</p>}
        {!error && !route && <p className="hint">{t.empty}</p>}
        {route && (
          <>
            <div className="total">
              <span className="total-label">{t.total}</span>
              <span className="total-value">{formatMinutes(route.minutes)}</span>
              <span className={route.transfers ? "total-sub" : "total-sub is-direct"}>
                {route.transfers ? t.transfers(route.transfers) : t.direct}
              </span>
            </div>
            <ol className="timeline">
              {route.legs.map((leg, i) => (
                <li key={i} className={i === 0 ? "first" : undefined}>
                  {i === 0 && route.access_minutes > 0 && <span className="change access">{t.access(formatMinutes(route.access_minutes))}</span>}
                  {i === 0 && <span className="stop">{leg.from}</span>}
                  {i > 0 && leg.wait_minutes > 0 && <span className="change">{t.change(formatMinutes(leg.wait_minutes))}</span>}
                  <span className="leg">
                    <span className={`mode mode-${slug(leg.mode)}`}>{t.modes[leg.mode] ?? leg.mode}</span>
                    <span className="leg-time">{formatMinutes(leg.minutes)}</span>
                    {leg.mode === WALK ? (
                      <span className="leg-meta">{leg.line}</span>
                    ) : (
                      <>
                        <span className="leg-meta">
                          {t.stopsCount(leg.stops.length - 2)} · {t.perDay(leg.trips_per_day ?? 0)}
                        </span>
                        {leg.line && <span className="leg-line">{leg.line}</span>}
                      </>
                    )}
                  </span>
                  <span className={i === route.legs.length - 1 ? "stop last" : "stop"}>{leg.to}</span>
                  {i === route.legs.length - 1 && route.egress_minutes > 0 && (
                    <span className="change access">{t.egress(formatMinutes(route.egress_minutes))}</span>
                  )}
                </li>
              ))}
            </ol>
            {route.transfers > 0 && <p className="estimate">{t.estimateNote}</p>}
          </>
        )}
      </section>
    </>
  );
}
