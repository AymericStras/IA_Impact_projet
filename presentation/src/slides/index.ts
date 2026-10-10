// L'ordre du diapo. Une slide retirée ici disparaît du diapo (son code reste dans son fichier).
import type { SlideDef } from "../engine/deck";
import { FLAGS } from "../engine/util";
import { cover, intro3d, problem, storyLowpoly, storyPhotos } from "./opening";
import { assistant, route, school, search, sim, solution, windowSlide } from "./features";
import { data, engine, network, next, stack, thanks } from "./technical";

export const SLIDES: SlideDef[] = [
  ...(FLAGS.lite ? [] : [intro3d]), // ?lite : sans les scènes WebGL
  cover,
  problem,
  ...(FLAGS.story ? [...storyPhotos, ...(FLAGS.lite ? [] : storyLowpoly)] : []), // ?story : l'histoire de Claire
  solution,
  search,
  route,
  sim,
  windowSlide,
  school,
  assistant,
  data,
  network,
  engine,
  stack,
  next,
  thanks,
];
