import { LOCALES, useI18n, type Locale } from "../i18n";
import Trame from "./Trame";

export default function Header() {
  const { t, locale, setLocale } = useI18n();
  return (
    <header className="header">
      <div className="brand">
        <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
          <circle cx="22" cy="20" r="13" fill="none" stroke="var(--navy)" strokeWidth="6" />
          <circle cx="5" cy="34" r="4" fill="var(--yellow)" />
          <circle cx="36" cy="5" r="4" fill="var(--red)" />
        </svg>
        <div>
          <div className="brand-name">
            {t.brand} <span>{t.brandSub}</span>
          </div>
          <div className="brand-tagline">{t.tagline}</div>
        </div>
      </div>
      <Trame className="header-trame" rows={3} columns={26} palette={["var(--red)", "var(--yellow)", "var(--navy)"]} />
      <label className="lang">
        <span className="sr-only">{t.language}</span>
        <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
          {Object.keys(LOCALES).map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
      </label>
    </header>
  );
}
