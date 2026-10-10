import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Edge, type Place, type Route } from "../api";
import { DISCOVERIES, creditOf, imageOf, type Discovery } from "../data/discoveries";
import { CLASSES, FEATURED, INITIAL_PROJECT, SCHOOL_SOURCES, THEMES, dateLabel, duration, loadRequests, saveFeedback, saveRequest, searchSchoolTrips, validateProject, type Proposal, type SchoolProject, type SchoolRequest } from "../school";
import MapView from "./MapView";

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    arrow: <><path d="M4 12h15m-6-6 6 6-6 6" /></>,
    train: <><rect x="5" y="3" width="14" height="15" rx="4" /><path d="M5 11h14M12 3v8M8 18l-2 3m10-3 2 3" /><path d="M8 14h1m6 0h1" /></>,
    pin: <><path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z" /><circle cx="12" cy="10" r="2" /></>,
    book: <><path d="M12 5v15M3 4c3-1 6-1 9 1 3-2 6-2 9-1v15c-3-1-6-1-9 1-3-2-6-2-9-1Z" /></>,
    group: <><circle cx="9" cy="7" r="3" /><path d="M3 20v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6m2 10v-3a6 6 0 0 0-2-4" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6l4 2" /></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6ZM20 2v4m-2-2h4" /></>,
    shield: <><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z" /><path d="m8 12 3 3 5-6" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    leaf: <><path d="M20 3C6 1 2 9 7 15s14 1 13-12ZM4 21 16 8" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    print: <><path d="M7 8V3h10v5M7 17H3V9h18v8h-4M7 14h10v7H7Z" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.pin}</svg>;
}

function Modal({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current!; d.showModal(); return () => d.close(); }, []);
  return <dialog ref={ref} className={`school-dialog ${wide ? "wide" : ""}`} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-labelledby="dialog-title">
    <div className="dialog-head"><h2 id="dialog-title">{title}</h2><button className="icon-btn" aria-label="Fermer" onClick={onClose}><Icon name="close" /></button></div>
    <div className="dialog-body">{children}</div>
  </dialog>;
}

function Photo({ d, className = "" }: { d: Discovery; className?: string }) {
  const credit = creditOf(d);
  return <div className={`school-photo ${className}`}><img src={imageOf(d)} alt={d.title.fr} loading="lazy" />{credit && <a className="photo-credit" href={credit.source} target="_blank" rel="noreferrer" title={`${credit.author} · ${credit.license}`}>© {credit.author} · {credit.license}</a>}</div>;
}

function TripLegs({ title, route }: { title: string; route: Route }) {
  return <section className="trip-direction"><div className="section-line"><h3>{title}</h3><span>≈ {duration(route.minutes)}</span></div>
    <ol className="school-timeline">{route.legs.map((leg, index) => <li key={`${leg.from_id}-${index}`}><strong>{leg.from}</strong>
      <p><Icon name="train" size={16} />{leg.mode === "Train TER" ? "Train liO" : leg.mode} · ≈ {duration(leg.minutes)}{leg.wait_minutes > 0 && ` · changement et attente ≈ ${duration(leg.wait_minutes)}`}</p>
      <span>{leg.to}</span></li>)}</ol>
    <small>Durée estimée par le moteur. Horaires datés et correspondances à valider.</small>
  </section>;
}

function VerificationNotes() {
  return <div className="verification-grid">
    <section><Icon name="shield" /><h3>Confiance</h3><strong>À compléter</strong><p>Horaires datés, autorisation des groupes et places disponibles à vérifier. Aucun score calculé pour l’instant.</p></section>
    <section><Icon name="pin" /><h3>Marche & accessibilité</h3><strong>Accès gare–site à vérifier</strong><p>Aller et retour à documenter au rythme du groupe. Préférence : 20 min maximum par session. Nombre de sessions et cumul indisponibles.</p></section>
    <section><Icon name="leaf" /><h3>Empreinte carbone</h3><strong>Estimation indisponible</strong><p>Le calcul train/voiture sera affiché avec ses distances, ses hypothèses et ses sources.</p></section>
  </div>;
}

function Recap({ project, proposal, request }: { project: SchoolProject; proposal: Proposal; request?: SchoolRequest | null }) {
  return <div className="recap"><p className="eyebrow">{request ? request.id : "MON PROJET DE SORTIE"}</p><h2>{proposal.discovery.title.fr}</h2>
    <p>{project.establishment} · {project.className} · {project.students + project.adults} voyageurs</p>
    <dl className="recap-grid"><div><dt>Date souhaitée</dt><dd>{dateLabel(project.date)}</dd></div><div><dt>Thème</dt><dd>{project.theme}</dd></div>
      <div><dt>Départ réel</dt><dd>{project.establishment}</dd></div><div><dt>Gare choisie</dt><dd>{project.origin}</dd></div>
      <div><dt>Créneau souhaité</dt><dd>{project.departure} — {project.returnBy}</dd></div><div><dt>Effectif</dt><dd>{project.students} élèves + {project.adults} adultes</dd></div>
      <div><dt>Budget total</dt><dd>{project.budget ? `${project.budget} € (souhaité, non vérifié)` : "Non renseigné"}</dd></div><div><dt>Accessibilité</dt><dd>{project.accessibility || "À préciser avec le groupe"}</dd></div></dl>
    <div className="journey-columns"><TripLegs title="Aller" route={proposal.outbound} /><TripLegs title="Retour" route={proposal.inbound} /></div>
    <VerificationNotes />
    <p className="notice">Demande d’étude de démonstration. Aucune place réservée, aucun envoi à SNCF. Les accès établissement–gare, les marches, l’accueil du lieu, les horaires, le délai de devis de 21 jours et le créneau de l’offre restent à vérifier.</p>
    <p className="microcopy">Source des durées : moteur Dijkstra de l’équipe, données GTFS {proposal.sourceVersion ?? "version non renseignée"}. La date choisie n’est pas traitée par ce moteur. Le scénario historique de février–juin 2026 nécessite un autre jeu de données.</p>
    {SCHOOL_SOURCES[proposal.discovery.id] && <a href={SCHOOL_SOURCES[proposal.discovery.id]} target="_blank" rel="noreferrer">Consulter le site du lieu ↗</a>}
  </div>;
}

function Assistant({ project, onApply }: { project: SchoolProject; onApply: (p: SchoolProject) => void }) {
  const [text, setText] = useState("Une sortie patrimoine au départ de Toulouse pour une seconde, avec 30 élèves et 3 accompagnateurs.");
  const [suggestion, setSuggestion] = useState<SchoolProject | null>(null);
  function analyze() {
    const next = { ...project };
    const pupils = text.match(/(\d+)\s*[ée]l[èe]ves/i), adults = text.match(/(\d+)\s*(?:adultes|accompagnateurs)/i);
    if (pupils) next.students = Number(pupils[1]);
    if (adults) next.adults = Number(adults[1]);
    if (/toulouse/i.test(text)) next.origin = "Toulouse Matabiau";
    for (const [level, names] of Object.entries(CLASSES)) for (const name of names) if (text.toLocaleLowerCase().includes(name.toLocaleLowerCase())) { next.level = level; next.className = name; }
    if (/patrimoine|histoire/i.test(text)) next.theme = THEMES[0];
    else if (/arts|culture/i.test(text)) next.theme = THEMES[1];
    else if (/sciences|nature/i.test(text)) next.theme = THEMES[2];
    setSuggestion(next);
  }
  return <><p className="notice">Assistant de démonstration à règles simples. Le chatbot de l’équipe n’est pas encore connecté. Il ne calcule ni trajet ni disponibilité.</p>
    <label className="school-field">Décrivez votre projet<textarea rows={4} value={text} onChange={(e) => { setText(e.target.value); setSuggestion(null); }} /></label>
    <button className="primary-btn" onClick={analyze}>Préparer les champs <Icon name="spark" /></button>
    {suggestion && <div className="assistant-review"><h3>Relisez avant d’appliquer</h3><p>{suggestion.origin} · {suggestion.className}<br />{suggestion.students} élèves + {suggestion.adults} accompagnateurs<br />{suggestion.theme}</p><p className="microcopy">Seuls le niveau, les effectifs, Toulouse et les thèmes ci-dessus sont reconnus. Les autres champs restent inchangés et modifiables.</p><button className="secondary-btn" onClick={() => onApply(suggestion)}>Appliquer au formulaire</button></div>}
  </>;
}

export default function SchoolPlanner({ onNetwork }: { onNetwork: () => void }) {
  const [project, setProject] = useState<SchoolProject>({ ...INITIAL_PROJECT });
  const [places, setPlaces] = useState<Place[]>([]), [edges, setEdges] = useState<Edge[]>([]);
  const [source, setSource] = useState<string | null>(null), [loadError, setLoadError] = useState(false);
  const [loadingData, setLoadingData] = useState(true), [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Proposal[] | null>(null), [error, setError] = useState("");
  const [active, setActive] = useState<Proposal | null>(null), [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [modal, setModal] = useState<"assistant" | "compare" | "details" | "about" | "feedback" | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [view, setView] = useState<"prepare" | "requests" | "agent">("prepare");
  const [requests, setRequests] = useState<SchoolRequest[]>([]), [saved, setSaved] = useState<SchoolRequest | null>(null);
  const [compare, setCompare] = useState<string[]>([]), [filter, setFilter] = useState("all"), [mobileMap, setMobileMap] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<SchoolRequest | null>(null);
  const [storageError, setStorageError] = useState(""), [feedbackSaved, setFeedbackSaved] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);

  const refreshRequests = useCallback(() => {
    try { setRequests(loadRequests()); setStorageError(""); } catch { setStorageError("La sauvegarde locale est indisponible ou illisible. Aucun dossier ne sera écrasé ; vous pouvez imprimer votre récapitulatif."); }
  }, []);
  useEffect(() => { refreshRequests(); window.addEventListener("storage", refreshRequests); return () => { window.removeEventListener("storage", refreshRequests); pending.current?.abort(); }; }, [refreshRequests]);
  const loadData = useCallback(async () => {
    setLoadingData(true); setLoadError(false);
    try { const [p, e, info] = await Promise.all([api.places(), api.network(), api.info()]); setPlaces(p); setEdges(e.filter((edge) => edge.mode === "Train TER")); setSource(info.feed_version); }
    catch { setLoadError(true); }
    finally { setLoadingData(false); }
  }, []);
  useEffect(() => { void loadData(); }, [loadData]);
  function update(next: SchoolProject) {
    pending.current?.abort(); setLoading(false); setProject(next); setResults(null); setActive(null); setSaved(null); setCompare([]); setError("");
  }
  function change<K extends keyof SchoolProject>(key: K, value: SchoolProject[K]) { update({ ...project, [key]: value }); }
  const total = project.students + project.adults;
  async function search() {
    const invalid = validateProject(project);
    if (invalid) { setError(invalid); return; }
    if (loadError || !places.length) { setError("La connexion au moteur de trajets est nécessaire. Réessayez depuis le message au-dessus du formulaire."); return; }
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(""); setSaved(null); setActive(null); setResults(null); setCompare([]); setFilter("all");
    try {
      const { results: found } = await searchSchoolTrips(project, byId, source, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found); setActive(found[0] ?? null); setSelectedStation(null);
      setTimeout(() => resultsHeading.current?.focus(), 0);
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof ApiError && e.code === "unknown_place" ? "La gare de départ n’est pas reconnue. Choisissez un nom dans la liste proposée." : "Le calcul est momentanément indisponible. Votre formulaire est conservé ; vous pouvez réessayer.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function register() {
    if (!active) return;
    try { const record = saveRequest(project, active); setSaved(record); setModal(null); refreshRequests(); }
    catch { setStorageError("Le navigateur n’a pas pu conserver la demande. Aucune confirmation d’enregistrement ; imprimez le récapitulatif ou libérez de l’espace puis réessayez."); }
  }
  const pick = useCallback((which: "from" | "to", name: string) => {
    if (which === "from") { pending.current?.abort(); setProject((p) => ({ ...p, origin: name })); setResults(null); setActive(null); setSaved(null); setCompare([]); setLoading(false); }
    else setError(`Gare repérée : ${name}. Choisissez un lieu pédagogique dans les propositions pour préparer une sortie.`);
  }, []);
  const openDiscovery = useCallback((d: Discovery) => { setDiscovery(d); setModal("details"); }, []);
  const selectedResults = (results ?? []).filter((p) => compare.includes(p.discovery.id));
  const visible = (results ?? []).filter((p) => filter !== "direct" || (!p.outbound.transfers && !p.inbound.transfers));
  const featured = FEATURED.map((id) => DISCOVERIES.find((d) => d.id === id)!).filter(Boolean);
  const mapDiscoveries = useMemo(() => results?.map((p) => p.discovery) ?? featured, [results]);
  const step = saved ? 3 : modal === "details" && active ? 2 : active ? 1 : 0;
  function inspect(p: Proposal) { setActive(p); setDiscovery(p.discovery); setModal("details"); }
  function reviewRequest(r: SchoolRequest) { pending.current?.abort(); setLoading(false); setProject(r.project); setResults([r.proposal]); setCompare([]); setActive(r.proposal); setDiscovery(r.proposal.discovery); setSaved(r); setModal("details"); }

  return <div className="school-app">
    <a className="skip-link" href="#school-main">Aller au contenu</a>
    <header className="school-header">
      <button className="school-brand" onClick={() => setView("prepare")} aria-label="liO Sorties scolaires, accueil"><span className="lio-wordmark" aria-hidden="true"><i />liO<b /></span><span className="brand-divider" /><span>Sorties scolaires<small>L’Occitanie, grandeur classe.</small></span></button>
      <nav aria-label="Navigation principale"><button className={view === "prepare" ? "selected" : ""} onClick={() => setView("prepare")}>Préparer une sortie</button><button className={view === "requests" ? "selected" : ""} onClick={() => { setView("requests"); refreshRequests(); }}>Mes demandes{requests.length > 0 && <span className="count">{requests.length}</span>}</button></nav>
      <button className={`agent-link ${view === "agent" ? "selected" : ""}`} onClick={() => { setView("agent"); refreshRequests(); }}><Icon name="shield" size={18} /><span>Espace agent</span><small>DÉMO</small></button>
    </header>
    <div className="prototype-strip"><span><i />Prototype du hackathon · aucune réservation réelle</span><button onClick={() => setModal("about")}>À propos des données <span aria-hidden="true">↗</span></button></div>

    {view === "prepare" ? <main id="school-main" className="school-main">
      <section className="school-intro"><div><p className="eyebrow">APPRENDRE AILLEURS, VOYAGER ENSEMBLE</p><h1>La prochaine leçon<br />se passe <span>en Occitanie<i /></span>.</h1><p>Un projet pédagogique. Des idées de sorties. Le train pour les relier.</p></div>
        <div className="intro-signature"><Icon name="train" size={28} /><div>Le voyage fait<br /><strong>partie de la découverte.</strong></div></div></section>
      <ol className="school-progress" aria-label="Étapes de préparation">{["Mon projet", "Mes idées de sorties", "Le récapitulatif", "Ma demande"].map((label, index) => <li key={label} className={index <= step ? "current" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Icon name="check" size={14} /> : `0${index + 1}`}</span>{label}</li>)}</ol>
      <div className="planner-grid">
        <aside className="project-panel" aria-labelledby="project-title">
          <div className="panel-title"><span className="icon-tile"><Icon name="book" /></span><div><h2 id="project-title">Votre projet</h2><p>On commence par votre classe.</p></div></div>
          <button className="assistant-entry" onClick={() => setModal("assistant")}><Icon name="spark" /><span>Décrire mon projet<small>Avec l’assistant de démonstration</small></span><Icon name="arrow" size={17} /></button>
          {loadError && <div className="school-alert" role="alert">Le moteur de trajets ne répond pas.<button onClick={() => void loadData()}>Réessayer la connexion</button></div>}
          <form onSubmit={(e) => { e.preventDefault(); void search(); }}>
            <label className="school-field">Établissement ou lieu de départ<input required value={project.establishment} onChange={(e) => change("establishment", e.target.value)} /></label>
            <label className="school-field">Gare de départ<span className="input-icon"><Icon name="pin" size={17} /><input required list="school-stations" value={project.origin} onChange={(e) => change("origin", e.target.value)} /></span></label>
            <datalist id="school-stations">{places.filter((p) => p.network === "sncf").map((p) => <option key={p.id} value={p.name} />)}</datalist>
            <p className="field-help">L’accès de l’établissement à la gare reste à organiser.</p>
            <div className="form-row"><label className="school-field">Niveau<select value={project.level} onChange={(e) => update({ ...project, level: e.target.value, className: CLASSES[e.target.value][0] })}>{Object.keys(CLASSES).map((v) => <option key={v}>{v}</option>)}</select></label>
              <label className="school-field">Classe<select value={project.className} onChange={(e) => change("className", e.target.value)}>{CLASSES[project.level].map((v) => <option key={v}>{v}</option>)}</select></label></div>
            <label className="school-field">Ce que vous voulez explorer<select value={project.theme} onChange={(e) => change("theme", e.target.value)}>{THEMES.map((v) => <option key={v}>{v}</option>)}</select></label>
            <div className="form-row"><label className="school-field">Élèves<input type="number" required min="1" max="50" value={project.students} onChange={(e) => change("students", e.target.valueAsNumber)} /></label><label className="school-field">Accompagnateurs<input type="number" required min="1" max="50" value={project.adults} onChange={(e) => change("adults", e.target.valueAsNumber)} /></label></div>
            <p className={`group-total ${total > 50 || total < 6 ? "invalid" : ""}`} aria-live="polite"><Icon name="group" size={16} />{Number.isFinite(total) ? total : "—"} voyageurs au total <span>6 à 50 maximum</span></p>
            <label className="school-field">Date souhaitée<input type="date" required value={project.date} onInput={(e) => change("date", e.currentTarget.value)} /></label>
            <div className="form-row"><label className="school-field">Départ après<input type="time" required value={project.departure} onInput={(e) => change("departure", e.currentTarget.value)} /></label><label className="school-field">Retour avant<input type="time" required value={project.returnBy} onInput={(e) => change("returnBy", e.currentTarget.value)} /></label></div>
            <details className="more-preferences"><summary>Budget & besoins particuliers <span>+</span></summary><label className="school-field">Budget total souhaité (€)<input type="number" min="0" value={project.budget} placeholder="Facultatif" onChange={(e) => change("budget", e.target.value)} /></label><label className="school-field">Besoins d’accessibilité<textarea rows={2} placeholder="Sans noms ni données médicales" value={project.accessibility} onChange={(e) => change("accessibility", e.target.value)} /></label></details>
            {error && <p role="alert" className="school-alert">{error}</p>}
            <button className="primary-btn find-trips" type="submit" disabled={loading || loadingData}>{loading ? "Recherche des aller-retours…" : loadingData ? "Connexion au réseau…" : "Trouver des idées de sorties"}{loading ? <span className="spinner" /> : <Icon name="arrow" size={19} />}</button>
            <p className="form-footnote">Exemple fictif avec un lycée réel.<br />La date et le retour restent à valider par l’équipe.</p>
          </form>
        </aside>

        <section className="exploration" aria-label="Carte et idées de sorties">
          <div className="mobile-view-switch"><button className={!mobileMap ? "selected" : ""} onClick={() => setMobileMap(false)}>Les idées de sorties</button><button className={mobileMap ? "selected" : ""} onClick={() => setMobileMap(true)}>Voir la carte</button></div>
          <div className={`school-map-wrap ${mobileMap ? "show-mobile" : ""}`}><MapView places={places} edges={edges} byId={byId} route={active?.outbound ?? null} selected={selectedStation} onSelect={setSelectedStation} onPick={pick} onOpenDiscovery={openDiscovery} discoveries={mapDiscoveries} />
            <div className="map-label"><span className="map-label-icon"><Icon name="train" /></span><div><strong>L’Occitanie en train liO</strong><small>{places.length ? `${places.length} gares dans le jeu de données` : "Explorez la région"}</small></div></div>
            <div className="map-legend"><span><i className="legend-line" />Liaisons schématiques</span><span><i className="legend-dot" />Lieux à découvrir</span><button onClick={onNetwork}>Explorer le réseau ↗</button></div>
          </div>
          {saved ? <section className="saved-panel" aria-live="polite"><span className="success-icon"><Icon name="check" size={26} /></span><p className="eyebrow">VOTRE PROJET EST CONSERVÉ</p><h2>Une nouvelle sortie se dessine.</h2><p>La demande <strong>{saved.id}</strong> est enregistrée dans ce navigateur, avec le statut « À examiner ».</p><p className="microcopy">Démonstration locale : aucun dossier transmis à SNCF, aucune place réservée.</p><div className="button-row"><button className="primary-btn" onClick={() => { setView("agent"); refreshRequests(); }}>Retrouver le dossier agent <Icon name="arrow" /></button><button className="secondary-btn" onClick={() => window.print()}><Icon name="print" />Imprimer</button></div></section> : <>
            <div className="results-title"><div><p className="eyebrow">{results ? "VOS PREMIÈRES PISTES" : "L’OCCITANIE COMME SALLE DE CLASSE"}</p><h2 ref={resultsHeading} tabIndex={-1}>{results ? `${results.length} idée${results.length > 1 ? "s" : ""} pour votre classe` : "Des découvertes à portée de train"}</h2></div><span className="region-tag">100 % Occitanie</span></div>
            {results && <div className="result-tools"><div className="filter-pills"><button className={filter === "all" ? "selected" : ""} onClick={() => setFilter("all")}>Toutes les idées</button><button className={filter === "direct" ? "selected" : ""} onClick={() => setFilter("direct")}>Sans correspondance</button></div><button className="compare-btn" disabled={compare.length < 2} onClick={() => setModal("compare")}>Comparer ({compare.length}/2)</button></div>}
            {loading ? <div className="loading-results" role="status"><span className="spinner" /><h3>Nous explorons les possibilités…</h3><p>Le moteur de votre équipe calcule l’aller et le retour séparément.</p></div> : <div className="proposal-grid">{(results ? visible.map((p) => p.discovery) : featured).map((d, index) => {
              const proposal = visible.find((p) => p.discovery.id === d.id);
              return <article className={`proposal-card ${active?.discovery.id === d.id ? "active" : ""}`} key={d.id}><div className="card-image"><Photo d={d} /><span className="card-category">{d.category === "museum" ? "Arts & culture" : "Patrimoine & histoire"}</span></div><div className="card-content"><span className="card-location"><Icon name="pin" size={13} />{byId.get(d.stationId)?.commune ?? "Occitanie"}<span>0{index + 1}</span></span><h3>{d.title.fr}</h3><p>{d.summary.fr}</p>
                {proposal ? <><div className="trip-meta"><span><Icon name="train" size={16} />≈ {duration(proposal.outbound.minutes)}</span><span>{proposal.outbound.transfers ? `${proposal.outbound.transfers} correspondance(s)` : "Trajet direct"}</span></div><span className="verification-tag">Horaires & accueil à vérifier</span></> : <div className="inspiration-label">Une idée pour nourrir votre projet</div>}
                <div className="card-actions"><button onClick={() => proposal ? inspect(proposal) : openDiscovery(d)}>{proposal ? "Voir cette sortie" : "Découvrir le lieu"}<Icon name="arrow" size={17} /></button>{proposal && <label className="compare-check"><input type="checkbox" checked={compare.includes(d.id)} disabled={compare.length === 2 && !compare.includes(d.id)} onChange={() => setCompare((old) => old.includes(d.id) ? old.filter((id) => id !== d.id) : [...old, d.id].slice(0, 2))} aria-label={`Comparer ${d.title.fr}`} /><span>Comparer</span></label>}</div>
              </div></article>;
            })}</div>}
            {results && !visible.length && !loading && <div className="empty-state"><Icon name="pin" size={32} /><h3>{results.length ? "Aucune proposition sans correspondance" : "Aucun aller-retour proposé pour ce projet"}</h3><p>Essayez une autre gare, un autre thème ou un créneau plus large. Cela ne prouve pas une absence de trains réels.</p><button className="secondary-btn" onClick={() => results.length ? setFilter("all") : document.querySelector<HTMLInputElement>('input[list="school-stations"]')?.focus()}>{results.length ? "Afficher toutes les idées" : "Modifier mon départ"}</button></div>}
            {results && results.length > 0 && <p className="results-note"><Icon name="shield" size={16} />Aller-retour estimé, sans validation des horaires à la date choisie. Disponibilité, budget et accessibilité restent à vérifier.</p>}
          </>}
          <div className="trust-strip"><span><Icon name="book" />Du sens pour votre classe</span><span><Icon name="train" />Le réseau train liO</span><span><Icon name="shield" />Des informations transparentes</span></div>
        </section>
      </div>
    </main> : <main id="school-main" className="requests-page"><p className="eyebrow">{view === "agent" ? "ESPACE AGENT · DÉMONSTRATION" : "VOTRE CARNET DE SORTIES"}</p><h1>{view === "agent" ? "Les sorties prennent forme." : "Mes demandes de sortie."}</h1><p className="page-lead">{view === "agent" ? "Retrouvez le même dossier et les vérifications à effectuer." : "Chaque projet conserve sa référence et son récapitulatif."}</p><div className="notice">Dossiers de démonstration conservés uniquement dans ce navigateur. Aucun accès aux outils SNCF et aucune transmission. Utilisez des informations fictives.</div>
      {storageError && <p className="school-alert" role="alert">{storageError}</p>}
      {!requests.length ? <div className="empty-state"><Icon name="book" size={36} /><h2>Votre première sortie vous attend.</h2><p>Préparez un projet et enregistrez une demande de démonstration.</p><button className="primary-btn" onClick={() => setView("prepare")}>Préparer une sortie <Icon name="arrow" /></button></div> : <div className="request-list">{requests.map((r) => <article className="request-card" key={r.id}><img src={imageOf(r.proposal.discovery)} alt="" /><div><p className="eyebrow">{r.id} <span className="verification-tag">{r.status}</span></p><h2>{r.proposal.discovery.title.fr}</h2><p>{r.project.establishment} · {r.project.className}</p><p className="microcopy">{dateLabel(r.project.date)} · {r.project.students + r.project.adults} voyageurs · retour souhaité avant {r.project.returnBy}</p>{view === "agent" && <p className="agent-checklist">À vérifier : trains datés, capacité groupe, accueil, accès à pied et devis.</p>}</div><div className="request-actions"><button className="secondary-btn" onClick={() => reviewRequest(r)}>Consulter le dossier <Icon name="arrow" /></button><button className="text-button" onClick={() => { setFeedbackTarget(r); setFeedbackSaved(false); setModal("feedback"); }}>{r.feedback ? "Revoir mon retour" : "Simuler le retour enseignant"}</button></div></article>)}</div>}
    </main>}
    <footer className="school-footer"><span><strong>liO</strong> · Le train, le lien, la découverte.</span><button onClick={() => setModal("about")}>Sources & limites du prototype</button><span>Hackathon IA & mobilité · 2026</span></footer>

    {modal === "assistant" && <Modal title="Racontez-nous votre projet." onClose={() => setModal(null)}><Assistant project={project} onApply={(p) => { update(p); setModal(null); }} /></Modal>}
    {modal === "about" && <Modal title="Un prototype, des informations transparentes." onClose={() => setModal(null)}><div className="about-copy"><h3>Ce qui fonctionne</h3><p>Le formulaire, la carte, les durées aller-retour issues de l’API Python de votre équipe, la comparaison, l’impression et les dossiers enregistrés localement.</p><h3>Ce qui reste à connecter</h3><p>Le chatbot IA, la sauvegarde serveur, les horaires datés, le catalogue pédagogique validé, les scores de confiance et le calcul carbone.</p><h3>Le scénario et ses sources</h3><p>Exemple fictif d’une seconde du <a href="https://bellevue-toulouse.mon-ent-occitanie.fr/le-lycee-bellevue/adresse/" target="_blank" rel="noreferrer">lycée Bellevue à Toulouse</a>. Le lycée existe ; il ne participe pas à une réservation dans cette démonstration.</p><p>Date suggérée : 5 novembre 2026, jour de référence du jeu de données présent dans le dépôt. Source GTFS : {source ?? "indisponible"}. Le moteur estime les durées et ne garantit aucun départ à cette date. La démonstration historique prévue au printemps 2026 reste à raccorder aux données historiques.</p><p>Les descriptions et photos proviennent du catalogue du dépôt. Les durées de marche, conditions scolaires et visites historiques ne sont pas vérifiées. Crédits photographiques disponibles sur chaque image.</p><h3>La direction artistique</h3><p>Inspirée de <a href="https://arnaudfuret-design.fr/project/lio/" target="_blank" rel="noreferrer">l’identité liO présentée par Arnaud Furet</a>. Prototype du hackathon, sans validation officielle SNCF.</p></div></Modal>}
    {modal === "compare" && <Modal title="Deux idées. À vous de choisir." onClose={() => setModal(null)} wide><div className="comparison">{selectedResults.map((p) => <article key={p.discovery.id}><Photo d={p.discovery} /><h3>{p.discovery.title.fr}</h3><p>{p.discovery.summary.fr}</p><dl><div><dt>Aller estimé</dt><dd>{duration(p.outbound.minutes)}</dd></div><div><dt>Retour estimé</dt><dd>{duration(p.inbound.minutes)}</dd></div><div><dt>Correspondances aller / retour</dt><dd>{p.outbound.transfers} / {p.inbound.transfers}</dd></div><div><dt>Marche / accueil scolaire</dt><dd>À vérifier</dd></div><div><dt>Capacité / horaires datés</dt><dd>À vérifier</dd></div><div><dt>Confiance / carbone</dt><dd>Non calculés</dd></div></dl><button className="primary-btn" onClick={() => inspect(p)}>Explorer cette sortie <Icon name="arrow" /></button></article>)}</div></Modal>}
    {modal === "details" && discovery && <Modal title={saved && active?.discovery.id === discovery.id ? "Votre dossier de démonstration" : "Une idée de sortie pour votre classe"} onClose={() => setModal(null)} wide><Photo d={discovery} className="detail-photo" />
      {active?.discovery.id === discovery.id ? <><Recap project={project} proposal={active} request={saved} />{storageError && <p role="alert" className="school-alert">{storageError}</p>}<div className="detail-actions"><button className="secondary-btn" onClick={() => window.print()}><Icon name="print" />Imprimer le récapitulatif</button>{!saved && <button className="primary-btn" onClick={register}>Enregistrer la demande de démo <Icon name="arrow" /></button>}{saved && <span className="verification-tag">{saved.status} · sauvegarde locale</span>}</div></> : <div className="inspiration-detail"><p className="eyebrow">IDÉE À EXPLORER · {discovery.era.fr}</p><h2>{discovery.title.fr}</h2><p className="page-lead">{discovery.summary.fr}</p>{discovery.description.map((p, i) => <p key={i}>{p.fr}</p>)}<p className="notice">Contenu du catalogue de démonstration. Accueil scolaire, activités, ouverture et accès gare–site restent à documenter. Lancez une recherche pour obtenir des estimations de trajet.</p><button className="primary-btn" onClick={() => { setModal(null); void search(); }}>Explorer les sorties pour mon projet <Icon name="arrow" /></button></div>}
    </Modal>}
    {modal === "feedback" && feedbackTarget && <Modal title="Après la sortie : votre retour" onClose={() => setModal(null)}><p className="notice">Après-voyage simulé · {feedbackTarget.id}. Cet avis est fictif et reste dans ce navigateur.</p>{feedbackSaved ? <div role="status" className="empty-state"><Icon name="check" size={32} /><h3>Votre retour de démonstration est conservé.</h3></div> : <form onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); try { saveFeedback(feedbackTarget.id, { satisfaction: String(data.get("satisfaction")), clarity: String(data.get("clarity")), preparation: String(data.get("preparation")), relevance: String(data.get("relevance")), comment: String(data.get("comment")) }); setFeedbackSaved(true); refreshRequests(); } catch { setStorageError("Le retour n’a pas pu être enregistré dans le navigateur."); } }}>
      {([ ["satisfaction", "Satisfaction globale"], ["clarity", "Clarté des informations"], ["preparation", "Facilité de préparation"], ["relevance", "Pertinence pédagogique"] ] as const).map(([key, label]) => <label key={key} className="school-field">{label}<select name={key} defaultValue={feedbackTarget.feedback?.[key] ?? ""} required><option value="" disabled>Choisir une note</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n} / 5</option>)}</select></label>)}<label className="school-field">Un commentaire fictif<textarea rows={3} name="comment" maxLength={1000} defaultValue={feedbackTarget.feedback?.comment ?? ""} /></label>{storageError && <p role="alert" className="school-alert">{storageError}</p>}<button className="primary-btn">Conserver ce retour</button></form>}</Modal>}
    {active && <div className="print-area"><h1>liO · Projet de sortie scolaire</h1><Recap project={project} proposal={active} request={saved} /></div>}
  </div>;
}
