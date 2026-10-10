// L'histoire de Claire en 3D low poly : tout est modélisé ici, à facettes (flatShading), dans une palette chaude.
// Quatre scènes de 10 s — la classe, le quai, le trajet, Carcassonne — puis la caméra continue de dériver lentement.
// Chargé à la demande (import dynamique, seulement avec ?story) : DeckStory.play(slide, nom, retardMs) / stop(slide).
import * as THREE from "three";
import { buildTrain } from "./train3d";

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const easeIO = (p: number) => { p = Math.min(1, Math.max(0, p)); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
const flat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.9, metalness: 0, ...extra });
const C = {
  skin: 0xe8b894, skinDark: 0xa86f4c, hair: 0x2b1d16, hairKid: [0x5a3a22, 0xc89a5a, 0x1e1a18, 0x8a4a22],
  navy: 0x0f2149, red: 0xc90c0f, yellow: 0xffd500, white: 0xf4f1ea, jeans: 0x3d5a8a, grass: 0x8cbf5f, grassDark: 0x6fa24a,
  stone: 0xdcc59a, stoneDark: 0xb89c6e, terracotta: 0xc8643c, slate: 0x5d6b8a, wood: 0xb98552, floor: 0xd2a679,
  wall: 0xf1e3c8, water: 0x4fa3c7, leaf: 0x5f9e45, leaf2: 0x7fb24e, trunk: 0x7a5434, rail: 0x9aa0ad, sleeper: 0x5b4632,
};
const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
const shadowAll = (o: THREE.Object3D) => o.traverse((c) => { if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; } });

// ── Personnages : jambes, bras et tête articulés ; marche, assis, frappe au clavier ──
interface PersonOpts { kid?: boolean; top?: number; bottom?: number; hair?: number; skin?: number; glasses?: boolean; curly?: boolean; bag?: number | null }
function person({ kid = false, top = C.red, bottom = C.jeans, hair = C.hair, skin = C.skin, glasses = false, curly = false, bag = null }: PersonOpts = {}) {
  const g = new THREE.Group(), body = new THREE.Group();
  const S = kid ? 0.68 : 1;
  const mSkin = flat(skin), mTop = flat(top), mBottom = flat(bottom), mHair = flat(hair), mShoe = flat(0x2a2a30);
  const limb = (w: number, h: number, m: THREE.Material) => { const p = new THREE.Group(), b = box(w, h, w, m); b.position.y = -h / 2; p.add(b); return p; };
  const legL = limb(0.13, 0.48, mBottom), legR = limb(0.13, 0.48, mBottom);
  legL.position.set(-0.08, 0.5, 0); legR.position.set(0.08, 0.5, 0);
  for (const l of [legL, legR]) { const s = box(0.14, 0.06, 0.2, mShoe); s.position.set(0, -0.48, 0.04); l.add(s); }
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 6), mTop);
  torso.position.y = 0.75;
  const armL = limb(0.1, 0.44, mTop), armR = limb(0.1, 0.44, mTop);
  armL.position.set(-0.24, 0.98, 0); armR.position.set(0.24, 0.98, 0);
  for (const a of [armL, armR]) { const h = new THREE.Mesh(new THREE.IcosahedronGeometry(0.06, 0), mSkin); h.position.y = -0.46; a.add(h); }
  const head = new THREE.Group();
  head.position.y = 1.18;
  head.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), mSkin));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.185, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.55), mHair);
  cap.rotation.x = -0.25; cap.position.set(0, 0.02, -0.02);
  head.add(cap);
  if (curly) for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.075, 0), mHair);
    c.position.set(Math.cos(a) * 0.17, -0.06 - Math.abs(Math.sin(a * 1.5)) * 0.08, Math.sin(a) * 0.15 - 0.05);
    if (c.position.z < 0.08) head.add(c);
  }
  if (glasses) {
    const mg = flat(0x1a1a22);
    for (const x of [-0.065, 0.065]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.01, 4, 10), mg); r.position.set(x, 0.01, 0.16); head.add(r); }
  }
  for (const x of [-0.06, 0.06]) { const e = new THREE.Mesh(new THREE.IcosahedronGeometry(0.018, 0), flat(0x1a1a22)); e.position.set(x, 0.01, 0.158); head.add(e); }
  body.add(legL, legR, torso, armL, armR, head);
  if (bag) { const b = box(0.28, 0.32, 0.14, flat(bag)); b.position.set(0, 0.8, -0.21); body.add(b); }
  g.add(body);
  g.scale.setScalar(S);
  shadowAll(g);
  const phase = Math.random() * 6;
  return {
    g,
    walk(t: number, k = 1) {
      const s = Math.sin(t * 9 + phase) * 0.55 * k;
      legL.rotation.x = s; legR.rotation.x = -s; armL.rotation.x = -s * 0.8; armR.rotation.x = s * 0.8;
      body.position.y = Math.abs(Math.cos(t * 9 + phase)) * 0.04 * k;
      head.rotation.y = Math.sin(t * 1.3 + phase) * 0.15;
    },
    sit() { legL.rotation.x = legR.rotation.x = -1.45; body.position.y = -0.04; },
    type(t: number) {
      armL.rotation.x = -1.15 + Math.sin(t * 18) * 0.06; armR.rotation.x = -1.15 + Math.sin(t * 18 + 2) * 0.06;
      armL.rotation.z = 0.25; armR.rotation.z = -0.25;
      head.rotation.x = 0.18 + Math.sin(t * 0.8) * 0.04;
    },
    point(t: number) { armR.rotation.x = -2.6 + Math.sin(t * 3) * 0.1; },
  };
}

function tree(scale = 1, kind = 0) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.8, 5), flat(C.trunk));
  trunk.position.y = 0.4; g.add(trunk);
  const leaf = flat(kind % 2 ? C.leaf2 : C.leaf);
  if (kind === 2) { // cyprès
    const c = new THREE.Mesh(new THREE.ConeGeometry(0.25, 1.6, 6), leaf); c.position.y = 1.3; g.add(c);
  } else for (let i = 0; i < 3; i++) {
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42 - i * 0.06, 0), leaf);
    c.position.set((i - 1) * 0.25, 1.0 + (i % 2) * 0.25, (i % 2) * 0.15); g.add(c);
  }
  g.scale.setScalar(scale);
  shadowAll(g);
  return g;
}

function track(len: number, z = 0) {
  const g = new THREE.Group();
  for (const dz of [-0.24, 0.24]) { const r = box(len, 0.05, 0.05, flat(C.rail, { metalness: 0.4, roughness: 0.4 })); r.position.set(0, 0.06, z + dz); g.add(r); }
  const n = Math.floor(len / 0.45), sl = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.04, 0.75), flat(C.sleeper), n), m = new THREE.Matrix4();
  for (let i = 0; i < n; i++) sl.setMatrixAt(i, m.makeTranslation(-len / 2 + i * 0.45, 0.02, z));
  g.add(sl);
  const ballast = box(len, 0.03, 1.1, flat(0x9d8f7e)); ballast.position.set(0, 0.005, z); g.add(ballast);
  shadowAll(g);
  return g;
}

function hills(size: number, seg: number, amp: number, color: number, seed = 1) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), d = Math.min(1, Math.max(0, (Math.abs(z) - 3) / 8));
    p.setY(i, (Math.sin(x * 0.35 + seed) * Math.cos(z * 0.3 + seed * 2) * 0.5 + 0.5 + Math.sin(x * 0.9 + z * 0.7) * 0.15) * amp * d);
  }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, flat(color));
  m.receiveShadow = true;
  return m;
}

// ── Moteur ───────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft coûte bien plus pour une différence invisible en projection
renderer.domElement.className = "gl";
const camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.05, 300);

function baseScene(sky: number, sunPos: THREE.Vector3, sunColor = 0xfff1d6) {
  const s = new THREE.Scene();
  s.background = new THREE.Color(sky);
  s.fog = new THREE.Fog(sky, 30, 90);
  s.add(new THREE.HemisphereLight(0xffffff, 0x8a7a66, 1.3));
  const sun = new THREE.DirectionalLight(sunColor, 2.6);
  sun.position.copy(sunPos);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 80 });
  sun.shadow.bias = -0.0005;
  s.add(sun);
  return s;
}

const ui = new THREE.TextureLoader().load("assets/story/ui-scolaire.jpg");
ui.colorSpace = THREE.SRGBColorSpace;

interface StoryScene { scene: THREE.Scene; update: (t: number) => void }
const SCENES: Record<string, StoryScene> = {};

// 1 · La classe : Claire tape sur son portable, l'écran montre le vrai site
{
  const s = baseScene(0xf6e6cc, V(-6, 7, 5));
  const floor = box(14, 0.1, 10, flat(C.floor)); floor.position.y = -0.05; floor.receiveShadow = true; s.add(floor);
  const back = box(14, 5, 0.2, flat(C.wall)); back.position.set(0, 2.5, -3); back.receiveShadow = true; s.add(back);
  const left = box(0.2, 5, 10, flat(C.wall)); left.position.set(-5, 2.5, 2); s.add(left);
  // Fenêtres lumineuses sur le mur de gauche, tableau vert et dessins d'enfants au fond
  for (const z of [-1, 1.8]) { const w = box(0.25, 1.9, 1.5, new THREE.MeshBasicMaterial({ color: 0xcfe8ff })); w.position.set(-4.95, 2.4, z); s.add(w); const f = box(0.3, 2.05, 0.08, flat(C.white)); f.position.set(-4.9, 2.4, z); s.add(f); }
  const board = box(3.4, 1.4, 0.08, flat(0x2f5a46)); board.position.set(1.6, 2.4, -2.88); s.add(board);
  const frame = box(3.6, 1.6, 0.06, flat(C.wood)); frame.position.set(1.6, 2.4, -2.9); s.add(frame);
  [0xff8a5b, 0x5bb0ff, 0xffd34d, 0x8fd16a, 0xff6fa8, 0x9b7bff].forEach((c, i) => {
    const p = box(0.5, 0.42, 0.03, flat(c)); p.position.set(-3.6 + i * 0.62, 3.6 + (i % 2) * 0.15, -2.88); p.rotation.z = (i % 3 - 1) * 0.08; s.add(p);
  });
  // Bureau, chaise, portable
  const desk = new THREE.Group();
  const top = box(1.8, 0.08, 0.9, flat(C.wood)); top.position.y = 0.78; desk.add(top);
  for (const [x, z] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]]) { const l = box(0.07, 0.78, 0.07, flat(0x8a6038)); l.position.set(x, 0.39, z); desk.add(l); }
  const lapBase = box(0.5, 0.025, 0.34, flat(0xc9cdd8, { metalness: 0.5, roughness: 0.4 })); lapBase.position.set(0.1, 0.835, 0.1); desk.add(lapBase);
  const lid = new THREE.Group(); lid.position.set(0.1, 0.85, -0.07); lid.rotation.x = -0.28;
  const back2 = box(0.5, 0.34, 0.02, flat(0xc9cdd8, { metalness: 0.5, roughness: 0.4 })); back2.position.y = 0.17; lid.add(back2);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.3), new THREE.MeshBasicMaterial({ map: ui })); screen.position.set(0, 0.17, 0.012); lid.add(screen);
  desk.add(lid);
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 8), flat(C.yellow)); mug.position.set(-0.55, 0.88, 0.15); desk.add(mug);
  shadowAll(desk); desk.position.set(0, 0, 0.4); s.add(desk);
  const chair = new THREE.Group();
  const seat = box(0.5, 0.06, 0.5, flat(C.navy)); seat.position.y = 0.48; chair.add(seat);
  const backrest = box(0.5, 0.55, 0.06, flat(C.navy)); backrest.position.set(0, 0.78, 0.25); chair.add(backrest);
  shadowAll(chair); chair.position.set(0.1, 0, 1.25); s.add(chair);
  const claire = person({ top: C.navy, bottom: 0x2d3a55, glasses: true, curly: true });
  claire.g.position.set(0.1, 0.0, 1.15); claire.g.rotation.y = Math.PI; claire.sit(); s.add(claire.g);
  // Rangées de pupitres vides
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const d = box(0.9, 0.06, 0.5, flat(C.wood)); d.position.set(-2.4 + c * 1.6, 0.62, 3 + r * 1.3); d.castShadow = true; s.add(d); }
  const T = V(0.1, 1.05, 0.4);
  SCENES.classe = {
    scene: s,
    update(t: number) {
      claire.type(t);
      const k = easeIO(t / 10);
      // Large de face, puis par-dessus l'épaule jusqu'à l'écran du portable
      const a = V(-3.2, 2.6, 5.2), b = V(0.75, 1.55, 2.0), c = V(0.18, 1.2, 0.95);
      const p = k < 0.6 ? a.clone().lerp(b, easeIO(k / 0.6)) : b.clone().lerp(c, easeIO((k - 0.6) / 0.4));
      const tg = k < 0.6 ? T.clone().lerp(V(0.1, 0.95, 0.15), easeIO(k / 0.6)) : V(0.1, 0.95, 0.15).lerp(V(0.1, 1.01, -0.04), easeIO((k - 0.6) / 0.4));
      if (t > 10) { p.x += Math.sin((t - 10) * 0.3) * 0.04; p.y += Math.sin((t - 10) * 0.4) * 0.02; }
      camera.position.copy(p); camera.lookAt(tg);
    },
  };
}

// 2 · Le quai : Claire et sa classe marchent jusqu'au TER
{
  const s = baseScene(0xbfe0f5, V(8, 12, 6));
  const ground = box(60, 0.1, 40, flat(C.grass)); ground.position.y = -0.05; ground.receiveShadow = true; s.add(ground);
  const platform = box(26, 0.4, 3, flat(0xcfc7b8)); platform.position.set(0, 0.2, 1.6); platform.receiveShadow = true; s.add(platform);
  const edge = box(26, 0.02, 0.18, flat(C.yellow)); edge.position.set(0, 0.41, 0.25); s.add(edge);
  s.add(track(60, -0.6));
  // Gare en pierre, toit de tuiles, horloge
  const st = new THREE.Group();
  const walls = box(5, 2.4, 2, flat(C.stone)); walls.position.y = 1.2; st.add(walls);
  const roofShape = new THREE.Shape([new THREE.Vector2(-2.8, 0), new THREE.Vector2(2.8, 0), new THREE.Vector2(0, 1.1)]);
  const roof = new THREE.Mesh(new THREE.ExtrudeGeometry(roofShape, { depth: 2.4, bevelEnabled: false }), flat(C.terracotta));
  roof.rotation.y = Math.PI / 2; roof.position.set(0, 2.4, 0); roof.rotation.set(0, 0, 0); roof.position.set(0, 2.4, -1.2); st.add(roof);
  for (const x of [-1.6, 0, 1.6]) { const d = box(0.7, 1.3, 0.05, flat(0x3b5b7a)); d.position.set(x, 0.85, 1.02); st.add(d); }
  const clock = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 16), flat(C.white)); clock.rotation.x = Math.PI / 2; clock.position.set(0, 2.05, 1.04); st.add(clock);
  const sign = box(1.8, 0.35, 0.05, flat(C.navy)); sign.position.set(0, 2.5, 1.25); st.add(sign);
  shadowAll(st); st.position.set(-2, 0.4, 4.4); s.add(st);
  [[-8, 5, 0], [-4.5, 6, 1], [3.5, 5.5, 0], [7, 6, 1], [11, 5, 0], [-11, 6, 2]].forEach(([x, z, k]) => { const tr = tree(1.6, k); tr.position.set(x, 0, z); s.add(tr); });
  for (let i = 0; i < 10; i++) { const tr = tree(1.2 + Math.random(), i % 3); tr.position.set(-25 + i * 5.5, 0, -9 - Math.random() * 6); s.add(tr); }
  const ter = buildTrain({ cars: 3 });
  ter.train.position.set(8, 0.07, -0.6); s.add(ter.train);
  ter.train.traverse((o) => { if (o instanceof THREE.Mesh) o.receiveShadow = true; });
  const group = [person({ top: C.navy, bottom: 0x2d3a55, glasses: true, curly: true })];
  const tops = [C.red, C.yellow, 0x3fa7d6, 0x8fd16a, 0xff8a5b, 0x9b7bff];
  for (let i = 0; i < 6; i++) group.push(person({ kid: true, top: tops[i], hair: C.hairKid[i % 4], skin: i === 2 ? C.skinDark : C.skin, bag: tops[(i + 3) % 6] }));
  const spots = [[0, 1.2], [-0.8, 0.8], [-0.9, 1.7], [-1.7, 1.2], [-2.4, 0.7], [-2.6, 1.9], [-3.3, 1.3]];
  group.forEach((p) => { p.g.rotation.y = Math.PI / 2; s.add(p.g); });
  SCENES.quai = {
    scene: s,
    update(t: number) {
      const walkT = Math.min(t, 9), x0 = -7 + walkT * 0.85;
      group.forEach((p, i) => {
        p.g.position.set(x0 + spots[i][0], 0.4, spots[i][1] + 0.4);
        p.walk(t, t < 9 ? 1 : Math.max(0, 1 - (t - 9) * 2));
      });
      // Devant le groupe, sur le quai : la caméra recule pendant qu'ils avancent, puis pivote vers le TER
      const k = easeIO(t / 10), lead = group[0].g.position;
      const p = V(lead.x + 4.2 - k * 1.2, 1.35 + k * 0.5, 2.9);
      if (t > 10) p.y += Math.sin((t - 10) * 0.4) * 0.05;
      camera.position.copy(p);
      camera.lookAt(lead.x - 1 + k * 7, 0.95, 0.9 - k * 1.2);
    },
  };
}

// 3 · Le trajet : le TER file entre collines, vignes et étang
{
  const s = baseScene(0xa9d8f2, V(10, 14, 4));
  s.add(hills(120, 60, 5, C.grass, 1));
  const lagoon = new THREE.Mesh(new THREE.PlaneGeometry(200, 30), flat(C.water, { roughness: 0.3, metalness: 0.1 }));
  lagoon.rotation.x = -Math.PI / 2; lagoon.position.set(0, 0.02, 20); s.add(lagoon);
  s.add(track(200, 0));
  // Vignes en rangs, arbres et cyprès épars, quelques nuages
  const vine = new THREE.InstancedMesh(new THREE.BoxGeometry(0.35, 0.35, 0.35), flat(0x5f8f3a), 2400), m = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < 12; r++) for (let i = 0; i < 200 && n < 2400; i++) { m.makeTranslation(-60 + i * 0.6, 0.18, -3 - r * 0.9); vine.setMatrixAt(n++, m); }
  vine.castShadow = true; s.add(vine);
  for (let i = 0; i < 40; i++) { const tr = tree(1 + Math.random() * 0.8, i % 3); tr.position.set(-60 + Math.random() * 120, 0, -16 - Math.random() * 18); s.add(tr); }
  for (let i = 0; i < 8; i++) {
    const cl = new THREE.Group();
    for (let j = 0; j < 4; j++) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + Math.random(), 0), flat(0xffffff)); b.position.set(j * 1.3, Math.random() * 0.6, Math.random()); cl.add(b); }
    cl.position.set(-50 + i * 14, 12 + Math.random() * 4, -25 - Math.random() * 10); s.add(cl);
  }
  const ter = buildTrain({ cars: 3 });
  s.add(ter.train);
  SCENES.trajet = {
    scene: s,
    update(t: number) {
      const x = -30 + t * 6;
      ter.train.position.set(x, 0.07, 0);
      ter.wheels.forEach((w) => (w.rotation.z -= 0.5));
      ter.caisses.forEach((c, i) => (c.rotation.x = 0.012 * Math.sin(t * 10 + i)));
      // Travelling latéral, puis la caméra passe devant la rame, puis grue au-dessus de l'étang
      const k = Math.min(t, 10);
      const shots: [number, (tt: number) => THREE.Vector3, (tt: number) => THREE.Vector3][] = [
        [0, () => V(x - 1, 1.2, 4.2), () => V(x - 1, 0.6, 0)],
        [3.4, () => V(x + 4.5, 0.8, 1.6), () => V(x - 1, 0.6, 0)],
        [6.6, (tt: number) => V(x - 6 + (tt - 6.6) * 1.5, 7 + (tt - 6.6) * 0.6, 12), () => V(x - 2, 0, 2)],
      ];
      let i = 0; while (i + 1 < shots.length && k >= shots[i + 1][0]) i++;
      let p = shots[i][1](k), g = shots[i][2](k);
      if (i > 0 && k - shots[i][0] < 0.7) { const e = easeIO((k - shots[i][0]) / 0.7); p = shots[i - 1][1](k).lerp(p, e); g = shots[i - 1][2](k).lerp(g, e); }
      camera.position.copy(p); camera.lookAt(g);
    },
  };
}

// 4 · Carcassonne : remparts, tours à toits pointus, la classe arrive au pied des murs
{
  const s = baseScene(0xf7c99a, V(-12, 9, 8), 0xffd9a8);
  s.fog = new THREE.Fog(0xf7c99a, 35, 100);
  const ground = box(120, 0.1, 120, flat(0xa9b86a)); ground.position.y = -0.05; ground.receiveShadow = true; s.add(ground);
  const hill = new THREE.Mesh(new THREE.CylinderGeometry(9, 12, 1.6, 10), flat(0x9aa85e)); hill.position.set(0, 0.8, -6); hill.receiveShadow = true; s.add(hill);
  const mStone = flat(C.stone), mDark = flat(C.stoneDark), mRoof = flat(C.slate);
  function towerAt(x: number, z: number, r: number, h: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.05, h, 8), mStone); body.position.y = h / 2; g.add(body);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(r * 1.25, h * 0.7, 8), mRoof); roof.position.y = h + h * 0.35; g.add(roof);
    for (let i = 0; i < 3; i++) { const w = box(0.12, 0.3, 0.05, flat(0x3a3328)); const a = i * 2.1; w.position.set(Math.cos(a) * r, h * 0.65, Math.sin(a) * r); w.lookAt(0, h * 0.65, 0); g.add(w); }
    g.position.set(x, 1.6, z); shadowAll(g); return g;
  }
  function wallRing(R: number, h: number, nT: number, z0: number) {
    const g = new THREE.Group();
    for (let i = 0; i < nT; i++) {
      const a = (i / nT) * Math.PI * 2, b = ((i + 1) / nT) * Math.PI * 2;
      const A = V(Math.cos(a) * R, 0, Math.sin(a) * R * 0.75), B = V(Math.cos(b) * R, 0, Math.sin(b) * R * 0.75);
      const len = A.distanceTo(B), wall = box(len, h, 0.5, mDark);
      wall.position.set((A.x + B.x) / 2, 1.6 + h / 2, (A.z + B.z) / 2 + z0); wall.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x); g.add(wall);
      for (let c = 0; c < Math.floor(len / 0.5); c++) {
        const m = box(0.25, 0.25, 0.52, mDark), f = -len / 2 + 0.25 + c * 0.5;
        m.position.set(wall.position.x + Math.cos(-wall.rotation.y) * f, 1.6 + h + 0.12, wall.position.z + Math.sin(-wall.rotation.y) * f);
        m.rotation.y = wall.rotation.y; g.add(m);
      }
      g.add(towerAt(A.x, A.z + z0, 0.7, h + 1.4));
    }
    shadowAll(g); return g;
  }
  s.add(wallRing(7.5, 1.6, 12, -6), wallRing(5, 2.4, 9, -6));
  s.add(towerAt(0, -7, 1.3, 5.5), towerAt(-1.8, -6, 0.8, 4.2), towerAt(1.9, -5.6, 0.9, 4.6));
  const keep = box(3, 3, 2, mStone); keep.position.set(0, 3.1, -5.2); keep.castShadow = true; s.add(keep);
  const gate = box(1.4, 1.6, 0.6, flat(0x3a3328)); gate.position.set(0, 2.3, -0.4); s.add(gate);
  const path = box(1.6, 0.04, 14, flat(0xd8c49c)); path.position.set(0, 0.03, 6); path.receiveShadow = true; s.add(path);
  for (let i = 0; i < 18; i++) { const tr = tree(1.1 + Math.random() * 0.6, 2); tr.position.set((Math.random() < 0.5 ? -1 : 1) * (12 + Math.random() * 20), 0, -20 + Math.random() * 35); s.add(tr); }
  const group = [person({ top: C.navy, bottom: 0x2d3a55, glasses: true, curly: true })];
  const tops = [C.red, C.yellow, 0x3fa7d6, 0x8fd16a, 0xff8a5b, 0x9b7bff];
  for (let i = 0; i < 6; i++) group.push(person({ kid: true, top: tops[i], hair: C.hairKid[i % 4], skin: i === 2 ? C.skinDark : C.skin, bag: tops[(i + 3) % 6] }));
  const spots = [[0, 0], [-0.8, 0.6], [0.8, 0.7], [-0.4, 1.4], [0.5, 1.6], [-1.2, 1.6], [1.3, 1.5]];
  group.forEach((p) => { p.g.rotation.y = Math.PI; s.add(p.g); });
  SCENES.ville = {
    scene: s,
    update(t: number) {
      const walk = Math.min(t, 7), z = 11 - walk * 0.9;
      group.forEach((p, i) => {
        p.g.position.set(spots[i][0], 0.04, z + spots[i][1]);
        p.walk(t, t < 7 ? 1 : 0);
        if (i === 2 && t > 7) p.point(t);
      });
      // De dos, au ras du chemin, puis grande grue qui découvre toute la Cité
      const k = easeIO(Math.min(t, 10) / 10);
      const p = V(Math.sin(k * 1.2) * 6, 1.2 + k * 9, z + 4.5 + k * 9);
      if (t > 10) { const a = (t - 10) * 0.04; p.x = Math.sin(1.2 + a) * 6; }
      camera.position.copy(p);
      camera.lookAt(0, 2.2 + k * 0.6, -4 + (1 - k) * 8);
    },
  };
}

let current: string | null = null, start = 0, raf = 0;
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  if (!current) return;
  const t = Math.max(0, (now - start) / 1000);
  SCENES[current].update(t);
  renderer.render(SCENES[current].scene, camera);
}
export const DeckStory = {
  play(slide: HTMLElement, name: string, delayMs = 0) {
    this.stop();
    slide.querySelector(".stage3d")?.append(renderer.domElement);
    current = name; start = performance.now() + delayMs;
    raf = requestAnimationFrame(frame);
  },
  stop(slide?: HTMLElement) {
    if (slide && !slide.contains(renderer.domElement)) return;
    cancelAnimationFrame(raf); current = null;
  },
};
// Préchauffage hors écran : une scène par tâche, quand le navigateur souffle
const idle = (f: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 300));
Object.keys(SCENES).forEach((name) => idle(() => {
  if (current) return;
  SCENES[name].update(0);
  renderer.render(SCENES[name].scene, camera);
}));
