# Frontend — carte et itinéraires

React + Vite + Leaflet. Carte des gares d'Occitanie, liste des lieux par département,
et calcul d'itinéraire via le backend (`/route`) : trajets directs, correspondances avec
attente estimée, nombre d'arrêts et de trains par jour ; filtre par type de transport
(liste fournie par `/modes`) : un mode désactivé est exclu
du calcul et masqué sur la carte. Direction artistique inspirée de la
charte liO (marine `#0f2149`, rouge `#c90c0f`, jaune `#ffd500`, capsules et points).
Interface en anglais et en français, langue détectée depuis le navigateur.

## Lancer

Le backend doit tourner sur le port 8000 (voir `../backend/README.md`) :

```bash
cd backend && source .venv/bin/activate && uvicorn app.main:app --port 8000
```

Puis :

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

En dev, Vite relaie `/api/*` vers `http://127.0.0.1:8000`. Pour un build pointant
vers une API déployée : `VITE_API_URL=https://… npm run build`.

## Structure

```
src/
├── api.ts                 # client du backend
├── i18n.tsx               # textes EN / FR + détection de langue
├── App.tsx                # état : départ, arrivée, itinéraire, lieu sélectionné
└── components/
    ├── Header.tsx
    ├── RoutePanel.tsx     # formulaire + frise des tronçons
    ├── PlacesPanel.tsx    # gares groupées par département
    ├── MapView.tsx        # carte Leaflet (réseau, gares, trajet)
    └── Trame.tsx          # motif de capsules et de points
```
