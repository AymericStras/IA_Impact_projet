// Le pitch : la problématique (trois exigences), les sept fonctionnalités classées en trois temps du voyage,
// une slide par fonctionnalité (avec la ligne des sept stations en haut), puis la démo.
import { Fragment } from "react";
import { Icon, Trame, Words } from "../components/primitives";
import { Net } from "../components/Net";
import { VIDEOS } from "../data";
import type { SlideDef } from "../engine/deck";
import { STEP } from "../engine/enter";
import { enterNet } from "../engine/net";
import { $, $$, A, BACK, easeIO, html } from "../engine/util";
import { T } from "../textes";

// ── 01 · La problématique : la question, puis les trois exigences qui y répondent ──
export const problematic: SlideDef = {
  id: "problematique", tone: "light", cls: "s-pb", trans: "zoom",
  Body: () => (
    <>
      <div className="bignum" data-in="zoom" data-d={1} data-idle="float" aria-hidden="true">?</div>
      <div className="kicker" data-in="flap">{T.pbKick}</div>
      <Words className="title" data-d={1} text={T.pbTitle} />
      <div className="pillars">
        {T.pillars.map(([ico, title, text], i) => (
          <article key={title} className="pillar" data-in="pop" data-d={7 + i * 3}>
            <div className="pillar-in" data-idle="float">
              <span className="pillar-n">{`0${i + 1}`}</span>
              <Icon name={ico} className="ico" />
              <h3>{title}</h3>
              <p dangerouslySetInnerHTML={html(text)} />
            </div>
          </article>
        ))}
      </div>
    </>
  ),
};

// ── 02 · Les fonctionnalités, en trois gares : un petit train parcourt la ligne et allume la colonne où il passe ──
export const featureMap: SlideDef = {
  id: "fonctionnalites", tone: "dark", cls: "s-ft", trans: "train",
  Body: () => (
    <>
      <div className="kicker" data-in="flap">{T.ftKick}</div>
      <Words className="title" data-d={1} text={T.ftTitle} />
      <div className="ft">
        <div className="ft-line" data-in="mask" data-d={5}><i className="ft-train" /></div>
        {T.groups.map(([color, name, when, items], g) => (
          <section key={name} className={`ft-col c-${color}`}>
            <i className="ft-stop" data-in="pop" data-d={6 + g * 3} />
            <header data-in="up" data-d={7 + g * 3}><b>{name}</b><small>{when}</small></header>
            {items.map(([ico, title, text], i) => (
              <div key={title} className="ft-item" data-in="left" data-d={10 + g * 3 + i}>
                <Icon name={ico} className="ico" /><div><h4>{title}</h4><p>{text}</p></div>
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  ),
  enter: ({ el, t0, run }) => {
    const train = $(el, ".ft-train"), line = $(el, ".ft-line"), cols = $$(el, ".ft-col");
    const W = line.offsetWidth, stops = cols.map((c) => c.offsetLeft + $(c, ".ft-stop").offsetLeft + 18);
    const RUN = 7000, PAUSE = 900, start = performance.now() + t0 + 20 * STEP;
    run.tick((now) => {
      const t = now - start;
      if (t < 0) return;
      const x = easeIO(Math.min(1, (t % (RUN + PAUSE)) / RUN)) * W;
      train.style.transform = `translateX(${x}px)`;
      cols.forEach((c, i) => c.classList.toggle("hot", Math.abs(x - stops[i]) < 140));
    });
  },
};

// ── La ligne des sept stations, en haut de chaque slide de fonctionnalité : on sait où on en est ──
const STATIONS = T.groups.flatMap(([color, , , items]) => items.map(([, title]) => [color, title] as const));

function FeatRail({ cur }: { cur: number }) {
  return (
    <div className="feat-rail" data-in="mask" data-d={3} aria-hidden="true">
      {STATIONS.map(([color, title], i) => (
        <Fragment key={title}>
          {i > 0 && STATIONS[i - 1][0] !== color && <span className="fr-gap" />}
          <span className={`fr-st c-${color}${i === cur ? " on" : ""}${i < cur ? " done" : ""}`}>
            <i />{i === cur && <b>{title}</b>}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

/** La slide d'une fonctionnalité, avec la ligne des stations par-dessus (le reste de la slide ne change pas) */
export const withRail = (def: SlideDef, cur: number): SlideDef => {
  const B = def.Body;
  return { ...def, Body: () => <><B /><FeatRail cur={cur} /></> };
};

// ── Préparer · La carte : le réseau se dessine, les trains y circulent ──
export const mapSlide: SlideDef = {
  id: "carte", tone: "dark", cls: "s-network s-map", trans: "cube",
  Body: () => (
    <>
      <div className="col">
        <div className="kicker" data-in="flap">{T.mapKick}</div>
        <Words className="title" data-d={1} text={T.mapTitle} />
        <p className="lead" data-in="up" data-d={4} dangerouslySetInnerHTML={html(T.mapLead)} />
        <div className="stats small">
          {([[259, T.stat1], [403, T.stat2], [13, T.mapStat3]] as const).map(([n, label], i) => (
            <div key={label} className="stat" data-in="up" data-d={6 + i}><b data-count={n} /><span>{label}</span></div>
          ))}
        </div>
      </div>
      <Net kind="map" />
    </>
  ),
  enter: ({ el, t0, run }) => enterNet(run, $<SVGSVGElement>(el, ".net-map:not(.net-ov)"), t0 + 300, { draw: 2400, trains: 14 }),
};

// ── Préparer · Indice de confiance : quatre piliers pondérés, des vetos, une note sur 100 ──
const level = (n: number) => (n >= 85 ? "high" : n >= 70 ? "medium" : "low");
const SCORE = Math.round(T.trustPillars.reduce((a, [, w, v]) => a + (w * v) / 100, 0));

export const trust: SlideDef = {
  id: "confiance", tone: "light", cls: "s-trust", trans: "zoom",
  Body: () => (
    <>
      <div className="col">
        <div className="kicker" data-in="flap">{T.trustKick}</div>
        <Words className="title" data-d={1} text={T.trustTitle} />
        <div className="tp">
          {T.trustPillars.map(([name, w, v], i) => (
            <div key={name} className="tp-row" data-in="left" data-d={6 + i}>
              <span className="tp-name">{name}</span>
              <span className="tp-w">{w} %</span>
              <div className="tp-track"><i className={`rel-${level(v)}`} style={{ width: `${v}%` }} /></div>
              <b className={`rel-${level(v)}`}>{v}</b>
            </div>
          ))}
        </div>
        <div className="tv" data-in="up" data-d={11}>
          <span className="tag">{T.trustVetoTag}</span>
          {T.trustVetos.map((v) => <span key={v} className="tv-chip">{v}</span>)}
        </div>
      </div>
      <div className="gauge" data-in="pop" data-d={4}>
        <div className="gauge-ring" data-idle="float">
          <svg viewBox="0 0 200 200" aria-hidden="true">
            <circle className="g-bg" cx="100" cy="100" r="84" pathLength={1} />
            <circle className={`g-val rel-${level(SCORE)}`} cx="100" cy="100" r="84" pathLength={1} />
          </svg>
          <div className="g-num"><b data-count={SCORE} /><small>/ 100</small></div>
        </div>
        <div className={`g-level rel-${level(SCORE)}`}><i />{T.trustLevel}</div>
        <small className="g-label">{T.trustScore}</small>
        <div className="g-deps">
          {T.trustDeps.map(([h, n], i) => (
            <span key={h} className={`g-dep rel-${level(n)}${i === 0 ? " on" : ""}`}><strong>{h}</strong><span>{n}</span></span>
          ))}
        </div>
      </div>
    </>
  ),
  enter: ({ el, t0 }) => {
    const ring = $(el, ".g-val"), d = t0 + 4 * STEP + 400;
    A(ring, [{ strokeDashoffset: 1 }, { strokeDashoffset: 1 - SCORE / 100 }], { duration: 1800, delay: d, easing: "cubic-bezier(.2,.8,.2,1)" });
    $$(el, ".tp-track i").forEach((b, i) => A(b, [{ transform: "scaleX(0)" }, { transform: "none" }], { duration: 1100, delay: t0 + (6 + i) * STEP + 500 }));
    $$(el, ".g-dep").forEach((c, i) => A(c, [{ opacity: 0, transform: "translateY(20px)" }, { opacity: 1, transform: "none" }], { duration: 500, delay: d + 1400 + i * 140, easing: BACK }));
  },
};

// ── 03 · Démo : l'écran du site arrive et rejoue la simulation en boucle, le temps de basculer sur le vrai site ──
export const demo: SlideDef = {
  id: "demo", tone: "red-bg", cls: "s-demo", trans: "train",
  Body: () => (
    <>
      <div className="col">
        <div className="kicker" data-in="flap">{T.demoKick}</div>
        <Words as="h1" className="title huge" data-d={2} text={T.demoTitle} />
        <p className="lead" data-in="up" data-d={6} dangerouslySetInnerHTML={html(T.demoLead)} />
        <div className="demo-live" data-in="pop" data-d={8} data-idle="pulse"><i className="live" />{T.demoLive}</div>
        <Trame rows={3} cols={24} palette={["yellow", "white", "navy"]} data-in="trame" data-d={9} data-idle="drift" />
      </div>
      <div className="demo-screen" data-in="screen" data-d={3}>
        <div className="demo-float" data-idle="float">
          <div className="screen-bar"><i /><i /><i /><span>occitanie-en-train</span></div>
          <video muted loop playsInline preload="auto" src={VIDEOS.simulation?.file} />
        </div>
      </div>
    </>
  ),
  enter: ({ el, t0, run }) => {
    const v = $<HTMLVideoElement>(el, "video");
    v.pause(); v.currentTime = 0;
    run.later(t0 + 1200, () => void v.play().catch(() => {}));
  },
  leave: (el) => el.querySelector("video")?.pause(),
};
