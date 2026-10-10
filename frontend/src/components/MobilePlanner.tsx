import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, PUBLIC_SNAPSHOT, type Edge, type Place } from "../api";
import { DISCOVERIES, type Discovery } from "../data/discoveries";
import { CLASSES, FEATURED, INITIAL_PROJECT, THEMES, dateLabel, duration, loadRequests, saveRequest, searchSchoolTrips, validateProject, type Proposal, type SchoolProject, type SchoolRequest } from "../school";
import { groupFare, GROUP_FARE_SOURCE, GROUP_FARE_CHECKED, GROUP_FARE_TIERS } from "../school-fares";
import { Assistant, BrandTracks, FareEstimate, Icon, Modal, Photo, Recap, Smile, TrainIllustration } from "./SchoolPlanner";
import MapView from "./MapView";

type Screen = "project" | "summary" | "ideas" | "map" | "detail" | "requests" | "saved";
const STEPS = ["La classe", "Le départ", "La journée"];
const FEATURED_PLACES = FEATURED.map((id) => DISCOVERIES.find((d) => d.id === id)!).filter(Boolean);

export default function MobilePlanner() {
  const [project, setProject] = useState<SchoolProject>({ ...INITIAL_PROJECT });
  const [screen, setScreen] = useState<Screen>("project"), [step, setStep] = useState(0);
  const [places, setPlaces] = useState<Place[]>([]), [edges, setEdges] = useState<Edge[]>([]);
  const [source, setSource] = useState<string | null>(null), [loadError, setLoadError] = useState(false);
  const [loadingData, setLoadingData] = useState(true), [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Proposal[] | null>(null), [active, setActive] = useState<Proposal | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [requests, setRequests] = useState<SchoolRequest[]>([]), [saved, setSaved] = useState<SchoolRequest | null>(null);
  const [error, setError] = useState(""), [storageError, setStorageError] = useState("");
  const [modal, setModal] = useState<"assistant" | "fares" | "compare" | null>(null);
  const [inspiration, setInspiration] = useState<Discovery | null>(null), [compare, setCompare] = useState<string[]>([]);
  const [detailBack, setDetailBack] = useState<Screen>("ideas");
  const pending = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  const total = project.students + project.adults;
  const perTrain = groupFare(project.students, project.adults);
  const mapDiscoveries = useMemo(() => results?.map((p) => p.discovery) ?? FEATURED_PLACES, [results]);

  const refreshRequests = useCallback(() => {
    try { setRequests(loadRequests()); setStorageError(""); }
    catch { setStorageError("Les demandes locales sont indisponibles. Aucun dossier n’a été écrasé."); }
  }, []);
  const loadData = useCallback(async () => {
    setLoadingData(true); setLoadError(false);
    try {
      const [stations, network, info] = await Promise.all([api.places(), api.network(), api.info()]);
      setPlaces(stations); setEdges(network.filter((edge) => edge.mode === "Train TER")); setSource(info.feed_version);
    } catch { setLoadError(true); }
    finally { setLoadingData(false); }
  }, []);
  useEffect(() => { void loadData(); refreshRequests(); window.addEventListener("storage", refreshRequests); return () => { pending.current?.abort(); window.removeEventListener("storage", refreshRequests); }; }, [loadData, refreshRequests]);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: "auto" }); }, [screen, step]);
  useEffect(() => { if (error) { errorMessage.current?.scrollIntoView({ block: "center" }); errorMessage.current?.focus({ preventScroll: true }); } }, [error]);

  function update(next: SchoolProject) {
    pending.current?.abort(); setLoading(false); setProject(next); setResults(null); setActive(null);
    setSaved(null); setCompare([]); setError(""); setSelectedStation(null);
  }
  function change<K extends keyof SchoolProject>(key: K, value: SchoolProject[K]) { update({ ...project, [key]: value }); }
  function go(next: Screen) { setScreen(next); setError(""); if (next === "requests") refreshRequests(); }
  function advance() {
    if (step === 2) {
      const invalid = validateProject(project);
      if (invalid) { setError(invalid); return; }
      setScreen("summary");
    } else setStep((current) => current + 1);
    setError("");
  }
  function edit(nextStep: number) { setStep(nextStep); go("project"); }
  async function simulate() {
    if (loading) return;
    const invalid = validateProject(project);
    if (invalid) { setError(invalid); return; }
    if (loadError || !places.length) { setError("Reconnectez le moteur de trajets pour lancer la simulation."); return; }
    pending.current?.abort(); const controller = new AbortController(); pending.current = controller;
    setLoading(true); setError(""); setSaved(null); setResults(null); setActive(null); setCompare([]);
    try {
      const found = await searchSchoolTrips(project, byId, source, controller.signal);
      if (controller.signal.aborted) return;
      setResults(found.results); setActive(found.results[0] ?? null); setSelectedStation(null); setScreen("ideas");
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof ApiError && failure.code === "unknown_place" ? "Cette gare n’est pas reconnue. Revenez à l’étape Départ pour choisir une gare proposée." : "Le calcul est indisponible pour le moment. Votre projet est conservé ; réessayez.");
    } finally { if (!controller.signal.aborted) setLoading(false); }
  }
  function inspect(proposal: Proposal) { setActive(proposal); setSaved(null); setDetailBack(screen); go("detail"); }
  const openDiscovery = useCallback((discovery: Discovery) => setInspiration(discovery), []);
  const pick = useCallback((which: "from" | "to", name: string) => {
    if (which === "to") { setError(`Gare repérée : ${name}. Choisissez une idée de visite dans la liste.`); return; }
    pending.current?.abort(); setLoading(false); setProject((current) => ({ ...current, origin: name }));
    setResults(null); setActive(null); setSaved(null); setCompare([]); setSelectedStation(null); setError(""); setStep(1); setScreen("project");
  }, []);
  function register() {
    if (!active) return;
    try { const record = saveRequest(project, active); setSaved(record); refreshRequests(); setScreen("saved"); }
    catch { setStorageError("Enregistrement impossible dans ce navigateur. Aucune demande confirmée : vous pouvez imprimer le récapitulatif."); }
  }
  function openRequest(record: SchoolRequest) {
    pending.current?.abort(); setLoading(false); setProject(record.project); setResults([record.proposal]);
    setActive(record.proposal); setSaved(record); setCompare([]); setDetailBack("requests"); go("detail");
  }

  const titles: Record<Screen, string> = {
    project: ["La classe prend le large.", "D’où part l’aventure ?", "On organise la journée."][step],
    summary: "Tout est prêt pour explorer.", ideas: results ? `${results.length} idée${results.length > 1 ? "s" : ""} pour votre classe.` : "De quoi éveiller la curiosité.",
    map: "Votre sortie sur la carte.", detail: "Une journée à découvrir.", requests: "Votre carnet de sorties.", saved: "Une sortie prend forme !",
  };
  const navScreen = screen === "summary" ? "project" : screen === "detail" ? detailBack : screen === "saved" ? "requests" : screen;
  const showAction = screen === "project" || screen === "summary" || screen === "detail" || screen === "saved";

  return <div className="mp-stage"><div className="school-app mp-shell">
    <a className="skip-link" href="#mobile-content">Aller au contenu</a>
    <header className="mp-header"><button className="mp-brand" onClick={() => go("project")} aria-label="liO Sorties scolaires, mon projet"><span className="lio-wordmark" aria-hidden="true"><i />liO<b /></span><span>Sorties scolaires<small>L’Occitanie, grandeur classe.</small></span></button><a className="mp-desktop" href="/">Version<br />ordinateur ↗</a></header>
    <div className="mp-demo"><span><i />{PUBLIC_SNAPSHOT ? "Démo · trajets précalculés" : "Prototype mobile"}</span><span>Aucune réservation réelle</span></div>
    <main id="mobile-content" className={`mp-main ${showAction ? "has-action" : ""} ${screen === "map" ? "map-view" : ""}`}>
      <section className={`mp-hero ${screen === "project" ? "illustrated" : "compact"}`}>
        <p className="eyebrow">{screen === "project" ? "APPRENDRE AILLEURS, VOYAGER ENSEMBLE" : screen === "map" ? "L’OCCITANIE EN TRAIN liO" : "LE TRAIN, LE LIEN, LA DÉCOUVERTE"}</p>
        <h1 ref={heading} tabIndex={-1}>{titles[screen]}</h1>
        {screen === "project" ? <><BrandTracks /><TrainIllustration /></> : <Smile />}
      </section>

      {loadError && <div className="mp-message school-alert" role="alert">Le moteur de trajets ne répond pas. Vous pouvez préparer votre projet.<button onClick={() => void loadData()}>Réessayer la connexion</button></div>}
      {error && <p ref={errorMessage} tabIndex={-1} className="mp-message school-alert" role="alert">{error}</p>}
      {storageError && <p className="mp-message school-alert" role="alert">{storageError}</p>}

      {screen === "project" && <>
        <ol className="mp-steps" aria-label="Les trois étapes du projet">{STEPS.map((label, index) => <li key={label} className={index <= step ? "reached" : ""} aria-current={index === step ? "step" : undefined}><span>{index < step ? <Icon name="check" size={12} /> : index + 1}</span>{label}</li>)}</ol>
        <form id="mobile-project" ref={form} className="mp-content mp-form" onSubmit={(event) => { event.preventDefault(); advance(); }}>
          <div className="mp-section-title"><h2>{["Qui part à la découverte ?", "On se retrouve où ?", "Quel est votre programme ?"][step]}</h2><span>{step + 1}/3</span></div>
          {step === 0 && <>
            <label className="school-field">Votre établissement<input required autoComplete="organization" value={project.establishment} onChange={(event) => change("establishment", event.target.value)} /></label>
            <p className="mp-hint">Exemple fictif avec le lycée Bellevue de Toulouse.</p>
            <div className="form-row"><label className="school-field">Niveau<select value={project.level} onChange={(event) => update({ ...project, level: event.target.value, className: CLASSES[event.target.value][0] })}>{Object.keys(CLASSES).map((level) => <option key={level}>{level}</option>)}</select></label><label className="school-field">Classe<select value={project.className} onChange={(event) => change("className", event.target.value)}>{CLASSES[project.level].map((name) => <option key={name}>{name}</option>)}</select></label></div>
            <fieldset className="mp-themes"><legend>Ce que vous voulez explorer</legend>{THEMES.map((theme, index) => <label key={theme} className={project.theme === theme ? "selected" : ""}><input type="radio" name="mobile-theme" value={theme} checked={project.theme === theme} onChange={() => change("theme", theme)} /><Icon name={["book", "spark", "leaf", "pin"][index]} size={23} /><span>{theme}</span><Icon name="check" size={15} /></label>)}</fieldset>
            <button className="mp-assistant" type="button" onClick={() => setModal("assistant")}><Icon name="spark" /><span>Plutôt envie de nous raconter ?<small>L’assistant de démonstration vous aide.</small></span><Icon name="arrow" size={17} /></button>
          </>}
          {step === 1 && <>
            <label className="school-field">Gare de départ<span className="input-icon"><Icon name="pin" size={19} /><input list="mobile-stations" required value={project.origin} onChange={(event) => change("origin", event.target.value)} autoComplete="off" /></span></label>
            <datalist id="mobile-stations">{places.filter((place) => place.network === "sncf").map((place) => <option key={place.id} value={place.name} />)}</datalist>
            <p className="mp-hint">Choisissez une gare dans les suggestions.</p>
            <div className="mp-departure"><div><i /><span>Départ de la classe<strong>{project.establishment}</strong></span></div><p>Accès à la gare à organiser avec votre groupe.</p><div><i /><span>Embarquement en train liO<strong>{project.origin || "Votre gare à choisir"}</strong></span></div></div>
            <div className="mp-tip"><Smile /><p>Un musée, une cité, un château…<br /><strong>Les idées arrivent juste après votre projet.</strong></p></div>
          </>}
          {step === 2 && <>
            <div className="form-row"><label className="school-field">Élèves<input type="number" inputMode="numeric" required min="1" max="50" value={Number.isFinite(project.students) ? project.students : ""} onChange={(event) => change("students", event.target.valueAsNumber)} /></label><label className="school-field">Accompagnateurs<input type="number" inputMode="numeric" required min="1" max="50" value={Number.isFinite(project.adults) ? project.adults : ""} onChange={(event) => change("adults", event.target.valueAsNumber)} /></label></div>
            <p className={`mp-total ${perTrain === null ? "invalid" : ""}`} aria-live="polite"><Icon name="group" size={18} />{Number.isFinite(total) ? total : "—"} voyageurs <span>6 à 50, adultes compris</span></p>
            <label className="school-field">Date souhaitée<input type="date" required value={project.date} onInput={(event) => change("date", event.currentTarget.value)} /></label>
            <div className="form-row"><label className="school-field">Départ après<input type="time" required value={project.departure} onInput={(event) => change("departure", event.currentTarget.value)} /></label><label className="school-field">Retour avant<input type="time" required value={project.returnBy} onInput={(event) => change("returnBy", event.currentTarget.value)} /></label></div>
            <button className="mp-fare" type="button" onClick={() => setModal("fares")}><span><small>LE TARIF DE VOTRE GROUPE</small><strong>{perTrain === null ? "Effectif à compléter" : `${perTrain} € par train emprunté`}</strong><span>Élèves et accompagnateurs compris · conditions ↗</span></span><Smile /></button>
            <details className="mp-more"><summary>Budget & besoins particuliers <span>+</span></summary><label className="school-field">Budget total souhaité (€)<input type="number" min="0" inputMode="decimal" value={project.budget} placeholder="Facultatif" onChange={(event) => change("budget", event.target.value)} /></label><label className="school-field">Besoins d’accessibilité<textarea rows={3} placeholder="Sans noms ni données médicales" value={project.accessibility} onChange={(event) => change("accessibility", event.target.value)} /></label></details>
          </>}
        </form>
      </>}

      {screen === "summary" && <div className="mp-content"><p className="mp-lead">Un dernier regard sur votre projet, et place aux idées.</p>
        <section className="mp-summary"><div><Icon name="book" /><h2>Votre classe</h2><button onClick={() => edit(0)}>Modifier</button></div><p><strong>{project.establishment}</strong><br />{project.className} · {project.theme}</p></section>
        <section className="mp-summary"><div><Icon name="pin" /><h2>Votre départ</h2><button onClick={() => edit(1)}>Modifier</button></div><p><strong>{project.origin}</strong><br />Accès établissement–gare à organiser.</p></section>
        <section className="mp-summary"><div><Icon name="group" /><h2>Votre journée</h2><button onClick={() => edit(2)}>Modifier</button></div><p><strong>{dateLabel(project.date)}</strong> · {project.departure}–{project.returnBy}<br />{project.students} élèves + {project.adults} accompagnateurs</p><p className="mp-hint">Budget : {project.budget ? `${project.budget} € souhaités` : "non renseigné"}. Accessibilité : {project.accessibility || "à préciser"}.</p></section>
        <button className="mp-fare" onClick={() => setModal("fares")}><span><small>PETITS PRIX, GRANDES DÉCOUVERTES</small><strong>{perTrain === null ? "Tarif à préciser" : `${perTrain} € par train pour le groupe`}</strong><span>Un forfait à chaque train emprunté. En savoir plus ↗</span></span><Smile /></button>
        <p className="mp-hint"><Icon name="shield" size={15} /> La simulation estime les trajets. Horaires datés, disponibilité et devis restent à confirmer.</p>
        {loading && <div className="mp-loading" role="status"><span className="spinner" /><strong>Nous explorons les aller-retours…</strong><span>Votre moteur calcule les deux sens du voyage.</span></div>}
      </div>}

      {screen === "ideas" && <div className="mp-content"><div className="mp-results-context"><span>{project.className} · {project.origin}</span><button onClick={() => edit(0)}>Modifier</button></div>
        <div className="mp-results-tools"><button onClick={() => go("map")}><Icon name="pin" size={18} />Voir la grande carte</button>{results && <button disabled={compare.length !== 2} onClick={() => setModal("compare")}>Comparer ({compare.length}/2)</button>}</div>
        {results?.length === 0 ? <div className="mp-empty"><Icon name="pin" size={34} /><h2>Essayons une autre piste.</h2><p>Aucun aller-retour proposé pour ces critères. Cela ne prouve pas l’absence de trains réels.</p><button className="primary-btn" onClick={() => edit(1)}>Modifier mon projet</button></div> : <div className="mp-ideas">{(results?.map((proposal) => proposal.discovery) ?? FEATURED_PLACES).map((discovery, index) => {
          const proposal = results?.find((candidate) => candidate.discovery.id === discovery.id);
          return <article className="mp-idea" key={discovery.id}><div className="mp-idea-photo"><Photo d={discovery} /><span className="mp-idea-number">0{index + 1}</span></div><div className="mp-idea-body"><p className="eyebrow"><Icon name="pin" size={13} />{byId.get(discovery.stationId)?.commune ?? "Occitanie"}</p><h2>{discovery.title.fr}</h2><p>{discovery.summary.fr}</p>
            {proposal ? <><div className="mp-trip-info"><span><Icon name="train" size={17} />≈ {duration(proposal.outbound.minutes)} à l’aller</span><span>{proposal.outbound.transfers ? `${proposal.outbound.transfers} correspondance(s)` : "Trajet direct"}</span></div><FareEstimate project={project} proposal={proposal} compact /></> : <p className="mp-hint">Idée à explorer. Simulez votre projet pour obtenir les trajets.</p>}
            <button className="mp-card-cta" onClick={() => proposal ? inspect(proposal) : setInspiration(discovery)}>{proposal ? "Découvrir cette sortie" : "Découvrir le lieu"}<Icon name="arrow" /></button>
            {proposal && <label className="mp-compare"><input type="checkbox" aria-label={`Comparer ${discovery.title.fr}`} checked={compare.includes(discovery.id)} disabled={compare.length === 2 && !compare.includes(discovery.id)} onChange={() => setCompare((current) => current.includes(discovery.id) ? current.filter((id) => id !== discovery.id) : [...current, discovery.id].slice(0,2))} />Comparer cette sortie</label>}
          </div></article>;
        })}</div>}
        <p className="mp-hint">Horaires, accueil du lieu, marche et accessibilité à vérifier. Aucun billet réservé.</p>
      </div>}

      {screen === "map" && <div className="mp-map-screen"><button className="mp-back-inline" onClick={() => go("ideas")}>← Revenir aux idées</button>
        {results && results.length > 0 && <div className="mp-map-choices" aria-label="Choisir le trajet affiché">{results.map((proposal) => <button key={proposal.discovery.id} className={active?.discovery.id === proposal.discovery.id ? "selected" : ""} aria-pressed={active?.discovery.id === proposal.discovery.id} onClick={() => { setActive(proposal); setSelectedStation(null); }}>{proposal.discovery.title.fr}</button>)}</div>}
        <div className="mp-map"><MapView places={places} edges={edges} byId={byId} route={active?.outbound ?? null} selected={selectedStation} onSelect={setSelectedStation} onPick={pick} onOpenDiscovery={openDiscovery} discoveries={mapDiscoveries} /><div className="mp-map-key"><i />{active ? "Trajet aller · schématique" : "Réseau liO · liaisons schématiques"}</div></div>
        {active && <div className="mp-map-caption"><div><strong>{active.discovery.title.fr}</strong><span>≈ {duration(active.outbound.minutes)} à l’aller · horaires à confirmer</span></div><button onClick={() => inspect(active)} aria-label="Voir le détail de la sortie affichée"><Icon name="arrow" /></button></div>}
      </div>}

      {screen === "detail" && active && <div className="mp-detail"><button className="mp-back-inline" onClick={() => go(detailBack)}>← {detailBack === "requests" ? "Mes demandes" : detailBack === "map" ? "La carte" : "Mes idées de sorties"}</button><div className="mp-detail-photo"><Photo d={active.discovery} /></div><div className="mp-content"><Recap project={project} proposal={active} request={saved} /><button className="mp-print" onClick={() => window.print()}><Icon name="print" />Imprimer le récapitulatif</button></div></div>}

      {screen === "saved" && saved && <div className="mp-content mp-confirmation"><Smile /><h2>Votre projet est conservé.</h2><p>La demande de démonstration est enregistrée dans ce navigateur.</p><div><span>VOTRE RÉFÉRENCE</span><strong>{saved.id}</strong><span className="verification-tag">À examiner</span></div><p className="mp-hint">Aucun dossier transmis à SNCF, aucune place réservée. Vous pouvez retrouver ce projet dans « Demandes ».</p></div>}

      {screen === "requests" && <div className="mp-content"><p className="mp-hint">Vos dossiers de démonstration restent dans ce navigateur. Ils sont partagés avec la version ordinateur sur cet appareil.</p>{requests.length === 0 ? <div className="mp-empty"><Icon name="book" size={32} /><h2>Votre première sortie vous attend.</h2><p>Préparez un projet puis enregistrez une demande.</p><button className="primary-btn" onClick={() => edit(0)}>Préparer une sortie</button></div> : requests.map((record) => <article className="mp-request" key={record.id}><span className="verification-tag">{record.status}</span><h2>{record.proposal.discovery.title.fr}</h2><p>{record.project.establishment}<br />{dateLabel(record.project.date)} · {record.project.students + record.project.adults} voyageurs</p><small>{record.id}</small><button className="mp-card-cta" onClick={() => openRequest(record)}>Consulter ma demande<Icon name="arrow" /></button></article>)}</div>}
    </main>

    {showAction && <div className="mp-action">
      {screen === "project" && <>{step > 0 && <button className="mp-back" onClick={() => { setStep((current) => current - 1); setError(""); }} aria-label="Étape précédente">←</button>}<button className="primary-btn" type="submit" form="mobile-project">{step === 2 ? "Vérifier mon projet" : "Continuer"}<Icon name="arrow" /></button></>}
      {screen === "summary" && <button className="primary-btn" onClick={() => void simulate()} disabled={loading || loadingData}>{loading ? <><span className="spinner" />Simulation en cours…</> : <>Simuler ma sortie<Icon name="arrow" /></>}</button>}
      {screen === "detail" && active && (saved ? <button className="primary-btn" onClick={() => go("requests")}>Retrouver mes demandes<Icon name="arrow" /></button> : <button className="primary-btn" onClick={register}>Enregistrer la demande de démo<Icon name="arrow" /></button>)}
      {screen === "saved" && <button className="primary-btn" onClick={() => go("requests")}>Retrouver ma demande<Icon name="arrow" /></button>}
    </div>}
    <nav className="mp-nav" aria-label="Navigation mobile">{([
      ["project", "book", "Projet"], ["ideas", "spark", "Idées"], ["map", "pin", "Carte"], ["requests", "group", "Demandes"],
    ] as const).map(([target, icon, label]) => <button key={target} className={navScreen === target ? "selected" : ""} aria-current={navScreen === target ? "page" : undefined} onClick={() => go(target)}><span><Icon name={icon} size={22} />{target === "requests" && requests.length > 0 && <i>{requests.length}</i>}</span>{label}</button>)}</nav>

    {modal === "assistant" && <Modal title="Racontez-nous votre projet." onClose={() => setModal(null)}><Assistant project={project} onApply={(next) => { update(next); setModal(null); }} /></Modal>}
    {modal === "fares" && <Modal title="Le tarif pour toute la classe." onClose={() => setModal(null)}><div className="fare-modal-intro"><Smile /><p><strong>À partir de 1 € par personne.</strong><br />Un forfait pour tout le groupe, à chaque train emprunté.</p></div><table className="fare-table"><caption>Élèves et accompagnateurs compris</caption><thead><tr><th scope="col">Voyageurs</th><th scope="col">Par train</th></tr></thead><tbody>{GROUP_FARE_TIERS.map((tier) => <tr key={tier.min} className={total >= tier.min && total <= tier.max ? "current" : ""}><th scope="row">{tier.min} à {tier.max}</th><td>{tier.price} €</td></tr>)}</tbody></table><p className="notice">33 voyageurs : 40 € par train, soit 80 € pour un aller-retour direct. Une correspondance peut ajouter un forfait.</p><p className="microcopy">Établissements d’Occitanie, groupes de 6 à 50, entre 9 h et 16 h hors vacances scolaires. Demandez le devis entre 3 mois et 21 jours avant la sortie. Éligibilité, exclusions et disponibilité à vérifier auprès de SNCF.</p><a className="secondary-btn" href={GROUP_FARE_SOURCE} target="_blank" rel="noreferrer">Conditions officielles SNCF ↗</a><p className="microcopy fare-checked">Vérifié le {GROUP_FARE_CHECKED}.</p></Modal>}
    {modal === "compare" && <Modal title="Deux idées, à vous de choisir." onClose={() => setModal(null)}><div className="mp-comparison">{results?.filter((proposal) => compare.includes(proposal.discovery.id)).map((proposal) => <article key={proposal.discovery.id}><Photo d={proposal.discovery} /><h2>{proposal.discovery.title.fr}</h2><p>Aller ≈ {duration(proposal.outbound.minutes)} · retour ≈ {duration(proposal.inbound.minutes)}</p><p>Correspondances : {proposal.outbound.transfers} à l’aller, {proposal.inbound.transfers} au retour.</p><FareEstimate project={project} proposal={proposal} compact /><p className="mp-hint">Horaires, capacité et accueil à vérifier.</p><button className="secondary-btn" onClick={() => { setModal(null); inspect(proposal); }}>Voir cette sortie<Icon name="arrow" /></button></article>)}</div></Modal>}
    {inspiration && <Modal title={inspiration.title.fr} onClose={() => setInspiration(null)}><div className="mp-inspiration-photo"><Photo d={inspiration} /></div><p>{inspiration.summary.fr}</p><p className="notice">Idée du catalogue de démonstration. Accueil scolaire, ouverture et accès à pied à vérifier.</p><button className="primary-btn" onClick={() => { const proposal = results?.find((candidate) => candidate.discovery.id === inspiration.id); setInspiration(null); if (proposal) inspect(proposal); else edit(0); }}>{results?.some((candidate) => candidate.discovery.id === inspiration.id) ? "Voir cette sortie" : "Préparer mon projet"}<Icon name="arrow" /></button></Modal>}
    {active && <div className="print-area"><h1>liO · Projet de sortie scolaire</h1><Recap project={project} proposal={active} request={saved} /></div>}
  </div></div>;
}
