// Chargement à la demande des scènes three.js : le code 3D (et three lui-même) n'est téléchargé que si une
// slide 3D est au programme, et une seule fois.
let intro: Promise<typeof import("../three/scene3d")> | null = null;
let story: Promise<typeof import("../three/lowpoly")> | null = null;

export const loadIntro3D = () => (intro ??= import("../three/scene3d"));
export const loadStory3D = () => (story ??= import("../three/lowpoly"));
