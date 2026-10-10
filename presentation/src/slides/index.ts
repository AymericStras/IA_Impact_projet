// L'ordre du diapo. Une slide retirée ici disparaît du diapo (son code reste dans son fichier).
import type { SlideDef } from "../engine/deck";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { FLAGS } from "../engine/util";
import { cover, intro3d, intro3dFull, problem, storyLowpoly, storyPhotos } from "./opening";
import {
  assistant, discover, follow3d, overview, route, school, search, sim, solution,
  videoPlaces, videoRoute, videoSchool, videoSim, windowSlide,
} from "./features";
import { data, engine, network, next, reliable, stack, thanks } from "./technical";

// ?lite : sans les scènes WebGL (intros, « Suivez le train », histoire low poly ; transitions TER 3D remplacées en 2D)
const gl = (...s: SlideDef[]) => (FLAGS.lite ? [] : s);

// Toutes retirées temporairement : décommenter une ligne pour remettre la slide.
export const SLIDES: SlideDef[] = [
  // ...gl(intro3d, intro3dFull),
  // cover,
  // problem,
  // ...storyPhotos,
  // ...gl(...storyLowpoly),
  // solution,
  // overview,
  // search,
  // videoRoute,
  // route,
  // sim,
  // videoSim,
  // windowSlide,
  // ...gl(follow3d),
  // discover,
  // videoPlaces,
  // school,
  // videoSchool,
  // assistant,
  // data,
  // network,
  // engine,
  // stack,
  // reliable,
  // next,
  // thanks,
];
