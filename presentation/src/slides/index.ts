// L'ordre du diapo. Une slide retirée ici disparaît du diapo (son code reste dans son fichier).
import type { SlideDef } from "../engine/deck";
import { FLAGS } from "../engine/util";
import { cover, intro3d, intro3dFull, problem, stage, staffRoom, storyLowpoly, storyPhotos } from "./opening";
import {
  assistant, discover, follow3d, overview, route, school, search, sim, solution,
  videoPlaces, videoRoute, videoSchool, videoSim, windowSlide,
} from "./features";
import { demo, featureMap, mapSlide, problematic, trust, withRail } from "./pitch";
import { blank, data, engine, network, next, qr, reliable, stack, thanks } from "./technical";

// ?lite : sans les scènes WebGL (intros, « Suivez le train », histoire low poly ; transitions TER 3D remplacées en 2D)
const gl = (...s: SlideDef[]) => (FLAGS.lite ? [] : s);

// Ouverture, page de garde, problématique, les sept fonctionnalités classées en trois temps (une slide chacune,
// avec la ligne des stations en haut), la démo, le QR code. Les lignes commentées attendent d'être remises.
export const SLIDES: SlideDef[] = [
  staffRoom,
  stage,
  cover,
  problematic,
  featureMap,
  // Préparer
  withRail(mapSlide, 0),
  withRail(engine, 1),
  withRail(trust, 2),
  // Vivre le trajet (?lite : les monuments en 3D à la place de la scène WebGL)
  withRail(sim, 3),
  withRail(windowSlide, 4),
  withRail(FLAGS.lite ? discover : follow3d, 5),
  // Demander
  withRail(assistant, 6),
  demo,
  qr,
  // ...gl(intro3d, intro3dFull),
  // problem,
  // ...storyPhotos,
  // ...gl(...storyLowpoly),
  // solution, overview, search, videoRoute, route, videoSim, videoPlaces, school, videoSchool,
  // data, network, stack, reliable, next, thanks,
];

// Le stock des slides en attente (garde les imports vivants tant qu'elles sont retirées du diapo)
export const BENCH = {
  intro3d, intro3dFull, cover, problem, storyPhotos, storyLowpoly, solution, overview, search,
  videoRoute, route, sim, videoSim, windowSlide, follow3d, discover, videoPlaces, school,
  videoSchool, assistant, data, network, engine, stack, reliable, next, thanks, gl, blank,
};
