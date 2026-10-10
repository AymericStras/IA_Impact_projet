// Intro 3D (three.js) : l'Occitanie en relief, seule — sans voies, gares ni trains — descend du ciel pendant que
// son liseré jaune se dessine (deux traits partent du sud et se rejoignent au nord), puis tourne lentement.
// Chargé à la demande (import dynamique) : three.js n'alourdit pas le reste du diapo.
import * as THREE from "three";
import { NETWORK } from "../data";

const YELLOW = 0xffd500;
const SCALE = 45, TOP = 0.35;
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const w = ([x, y]: number[], h = TOP) => V((x - 500) / SCALE, h, (y - 410) / SCALE);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(1920, 1080, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoft coûte bien plus pour une différence invisible en projection
renderer.domElement.className = "gl";
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x060f26);
scene.fog = new THREE.Fog(0x060f26, 24, 62);
const camera = new THREE.PerspectiveCamera(35, 16 / 9, 0.02, 200);
scene.add(new THREE.HemisphereLight(0xffffff, 0x223366, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 2.6);
sun.position.set(6, 12, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); // 4096 : ombre de 16 M de pixels recalculée à chaque image
Object.assign(sun.shadow.camera, { left: -13, right: 13, top: 11, bottom: -11, near: 1, far: 40 });
sun.shadow.bias = -0.0004;
scene.add(sun);
const rimLight = new THREE.DirectionalLight(0x8fb3ff, 0.9);
rimLight.position.set(-8, 5, -8);
scene.add(rimLight);

// La région en relief
const pts = NETWORK.outline.replace(/[MZ]/g, "").split("L").map((p) => p.split(",").map(Number));
const shape = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2((x - 500) / SCALE, -(y - 410) / SCALE)));
const land = new THREE.ExtrudeGeometry(shape, { depth: TOP, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 });
land.rotateX(-Math.PI / 2);
const landMesh = new THREE.Mesh(land, new THREE.MeshStandardMaterial({ color: 0x24397a, roughness: 0.85, metalness: 0.05 }));
landMesh.receiveShadow = true;
scene.add(landMesh);

// Liseré jaune en tube (une ligne WebGL ne fait qu'un pixel) : deux traits partent du sud, face à la caméra,
// font le tour de la région chacun de leur côté et se rejoignent au nord, une étincelle en tête de chaque trait
const outline = (() => {
  const P = pts.map((p) => w(p, TOP + 0.05));
  const s = P.reduce((b, p, i) => (p.z > P[b].z ? i : b), 0), n = P.reduce((b, p, i) => (p.z < P[b].z ? i : b), 0);
  const ring = P.slice(s).concat(P.slice(0, s)), k = (n - s + P.length) % P.length;
  const halves = [ring.slice(0, k + 1), ring.slice(k).concat([ring[0]]).reverse()];
  const core = new THREE.MeshBasicMaterial({ color: YELLOW });
  const glowMat = new THREE.MeshBasicMaterial({ color: YELLOW, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const spark = new THREE.SphereGeometry(0.075, 14, 10), halo = new THREE.SphereGeometry(0.26, 14, 10);
  const haloMat = new THREE.MeshBasicMaterial({ color: 0xfff1a0, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false });
  const parts = halves.map((h) => {
    const curve = new THREE.CatmullRomCurve3(h, false, "centripetal"), seg = h.length * 3;
    const geo = new THREE.TubeGeometry(curve, seg, 0.03, 6, false), glow = new THREE.TubeGeometry(curve, seg, 0.1, 8, false);
    const head = new THREE.Group();
    head.add(new THREE.Mesh(spark, new THREE.MeshBasicMaterial({ color: 0xfffbe6 })), new THREE.Mesh(halo, haloMat));
    scene.add(new THREE.Mesh(geo, core), new THREE.Mesh(glow, glowMat), head);
    return { curve, geo, glow, head };
  });
  const count = (g: THREE.BufferGeometry) => g.index?.count ?? 0;
  // p : avancement 0 → 1 ; flash : éclat du halo quand les deux traits se rejoignent
  return (p: number, flash = 0) => {
    for (const o of parts) {
      o.geo.setDrawRange(0, Math.floor((count(o.geo) * p) / 3) * 3);
      o.glow.setDrawRange(0, Math.floor((count(o.glow) * p) / 3) * 3);
      o.head.visible = p > 0 && p < 1;
      if (o.head.visible) o.head.position.copy(o.curve.getPointAt(p));
    }
    glowMat.opacity = 0.22 + 0.5 * flash;
  };
})();

// Sol pointillé à perte de vue
{
  const g: number[] = [];
  for (let x = -40; x <= 40; x += 0.8) for (let z = -40; z <= 40; z += 0.8) g.push(x, -0.02, z);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(g, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x2a3f78, size: 0.06 })));
}

const easeInOutCubic = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const orbit = (c: THREE.Vector3, r: number, h: number, a: number) => V(c.x + Math.cos(a) * r, c.y + h, c.z + Math.sin(a) * r);

// 3,2 s, un seul plan continu : l'orbite tourne dès la première image et la descente s'y fond à vitesse nulle,
// sans raccord (un raccord faisait sauter le champ de vision pendant une image)
function intro(t: number) {
  const p = Math.min(1, Math.max(0, (t - 0.25) / 2.6)), d = easeInOutCubic(p);
  outline(d, p >= 1 ? Math.exp(-(t - 2.85) * 2.2) : 0);
  const C = V(0.5, 0, 1.2), e = easeInOutCubic(Math.min(1, t / 3.2));
  const a = 1.25 + t * 0.025 - 0.35 * (1 - e);
  camera.position.copy(V(0, 46, 34).lerp(orbit(V(0.5, 0, 1), 17, 14, a), e));
  camera.lookAt(V(0, 0, 0).lerp(C, e));
}

let playing = false, start = 0, raf = 0;
function frame(now: number) {
  raf = requestAnimationFrame(frame);
  intro(Math.max(0, (now - start) / 1000));
  renderer.render(scene, camera);
}

export const Deck3D = {
  play(slide: HTMLElement, delayMs = 0) {
    this.stop();
    slide.querySelector(".stage3d")?.append(renderer.domElement);
    playing = true;
    // Première image dessinée tout de suite, horloge arrêtée : compilation des shaders et envoi au GPU se font
    // ici, pas pendant le mouvement (sinon la caméra « saute » de la durée de la compilation)
    intro(0);
    renderer.render(scene, camera);
    start = performance.now() + delayMs;
    raf = requestAnimationFrame(frame);
  },
  stop(slide?: HTMLElement) {
    if (slide && !slide.contains(renderer.domElement)) return; // une autre scène a déjà pris le canvas
    cancelAnimationFrame(raf);
    playing = false;
  },
};

// Préchauffage hors écran dès que le navigateur souffle : la première image compile les shaders
const idle = (f: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 2000 }) : setTimeout(f, 300));
idle(() => { if (!playing) { intro(0); renderer.render(scene, camera); } });
