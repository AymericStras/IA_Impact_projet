# Parcours scolaire — prototype local

La page d’entrée est désormais le parcours enseignant : besoin → idées de sorties → détail / comparaison → récapitulatif → demande locale → espace agent. L’explorateur précédent reste accessible par « Explorer le réseau ».

## Lancer

Depuis `backend`, lancer l’API avec les dépendances du projet :

```sh
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Depuis `frontend` :

```sh
npm ci
npm run dev -- --host 127.0.0.1
```

La configuration Vite existante relaie `/api` vers le port 8000. `npm run build` vérifie TypeScript et construit le site.

## Intégration effective

- `GET /places`, `/network`, `/info`, `/modes` et `/route` sont appelés sur le serveur de l’équipe.
- `/route` est appelé séparément à l’aller et au retour ; seuls `Train TER` et les liaisons `Marche` sont acceptés. Les autres modes présents dans `/modes` sont explicitement exclus, y compris avec la base complète.
- Marge de correspondance demandée : 15 minutes, en plus de l’attente moyenne du moteur. Cela ne garantit pas une correspondance datée.
- Aucun changement de l’algorithme Python. Le moteur n’accepte ni date, ni effectif, ni budget, ni besoins d’accessibilité. Ces critères sont conservés dans le projet et exposés comme vérifications restantes.
- La durée ferroviaire cumulée doit être inférieure au créneau demandé pour apparaître. Ce contrôle nécessaire ne valide pas la journée : accès, visite, horaires et marges restent inconnus.
- Catalogue, photographies et crédits existants réutilisés. Les contenus pédagogiques restent ceux du catalogue de démonstration.
- La date de l’exemple (5 novembre 2026) correspond au jour de référence du jeu de données du dépôt. Elle n’est pas validée par une recherche d’horaires datés. Le scénario historique février–juin 2026 du workflow reste à connecter à ses données propres.

## Simulations et raccordements restants

- `school.ts` contient l’adaptateur des demandes locales. `saveRequest`, `loadRequests` et `saveFeedback` devront être remplacés par les appels à la sauvegarde du responsable A. La référence `DEMO-…` et le statut « À examiner » sont conservés après rechargement dans le même navigateur. Les soumissions identiques retrouvent le dossier existant.
- Aucun espace agent sécurisé ni stockage serveur n’est présenté comme terminé. L’onglet agent est une vue locale de démonstration et ne contient aucun contact enseignant réel.
- L’assistant utilise des règles locales simples et montre les champs avant application. Remplacer son analyse par le chatbot du responsable A ; conserver la confirmation et le formulaire autonome.
- Aucune capacité disponible, note de confiance, réduction carbone ou marche calculée à vol d’oiseau n’est inventée. Ces données restent « à vérifier » ou « indisponibles » jusqu’aux livraisons B/C/D.
- Les niveaux et classes sont sélectionnables. La pertinence pédagogique par classe n’est pas calculée ; elle doit venir du catalogue C.
- Le questionnaire après-voyage est explicitement simulé, sa sauvegarde est locale.

## Fond de carte

Le fichier PMTiles d’environ 370 Mo n’est pas livré dans Git. Le frontend utilise donc par défaut les tuiles raster OpenStreetMap pour une prévisualisation fonctionnelle sur un nouveau poste. Attribution conservée ; aucun préchargement massif. Pour une diffusion à grande échelle, utiliser un fournisseur adapté ou les tuiles locales.

Pour retrouver le fond vectoriel autonome précédent après avoir installé ses fichiers : `VITE_LOCAL_BASEMAP=true`. Le changement ne modifie ni les liaisons ni le calcul d’itinéraire. Les lignes entre gares restent signalées comme schématiques.

## Scénario de revue

### Variante mobile de conception : `/mobile`

La route `/` conserve la disposition ordinateur. `/mobile` ouvre un parcours dédié en trois étapes (classe et thème, gare de départ, journée et effectif), puis un résumé modifiable avant la simulation. Les idées apparaissent avant la carte ; la navigation inférieure conserve le projet pendant les déplacements entre écrans. La variante reste volontairement limitée à une largeur de 480 px sur ordinateur pour permettre la revue sans changer le navigateur.

`MobilePlanner.tsx` réutilise `school.ts`, les tarifs, les illustrations et le récapitulatif du parcours existant. Les demandes utilisent la même clé de stockage local sur les deux routes. Aucune détection automatique du téléphone ni modification de l’algorithme Python. Le rafraîchissement remet le formulaire à l’exemple initial ; les demandes enregistrées restent conservées.

Revue mobile : étapes 1–3 → résumé → simulation → idées → comparaison → carte → détail → demande → carnet. Vérifier aussi les champs obligatoires, le plafond de 50 (adultes inclus), le retour invalide, l’erreur API, et le retour aux étapes précédentes sans perte de saisie. Pour ouvrir réellement depuis un téléphone, prévoir une URL accessible au téléphone ; `127.0.0.1` désigne l’appareil qui ouvre le lien et ne partage pas le serveur de l’ordinateur.

### Ajustements visuels et tarifs — 10 octobre 2026

- Carte occupant environ 70 % de la largeur disponible sur ordinateur, hauteur de 560 à 760 px selon la fenêtre. Les trois propositions restent dessous. Sur mobile, les onglets carte/liste sont conservés.
- Bandeau illustré bleu marine en haut du formulaire ; corps blanc, bouton rouge « Simuler ma sortie », motifs et sourires vectoriels accessibles (décorations masquées aux lecteurs d’écran).
- Source tarifaire principale : [offre scolaire SNCF](https://www.ter.sncf.com/occitanie/tarifs-cartes/voyage-groupes/scolaires), consultée le 10 octobre 2026. Le forfait s’applique **par train emprunté**, et non à un trajet complet comportant plusieurs trains. `school-fares.ts` compte les segments ferroviaires de chaque sens ; la marche n’ajoute aucun forfait. L’estimation reste conditionnée au devis, sans vérification d’éligibilité ni de disponibilité par le moteur.
- Pour 30 élèves + 3 adultes, un aller-retour direct est estimé à 80 € ; avec deux trains à l’aller et un au retour, à 120 €. Les visites et autres frais restent exclus.
- La page régionale du [7 octobre 2026](https://www.lio-occitanie.fr/actualites/1e-sorties-scolaires-en-train-lio-zoom-sur-ce-dispositif/) concorde sur le plafond de 6 à 50, accompagnateurs compris. L’ancien flyer PDF 2025 mentionne 10 à 60 et un autre téléphone : les pages actuelles SNCF et Région ont été privilégiées. Le détail des exclusions est accessible depuis l’interface via le lien officiel.
- `npm test` vérifie les seuils tarifaires, les effectifs invalides, les correspondances, la marche et l’absence de tarif pour un mode non couvert. `npm run build` vérifie TypeScript et la compilation.

### Parcours complet

1. Conserver l’exemple du lycée Bellevue (établissement réel, classe fictive), seconde, 30 élèves + 3 adultes.
2. Rechercher, sélectionner deux sorties à comparer et ouvrir un détail.
3. Vérifier les durées aller / retour et les données restant à contrôler.
4. Imprimer le récapitulatif, enregistrer la demande, puis retrouver sa référence côté agent après actualisation.
5. Saisir un retour enseignant fictif, puis tester 48 élèves + 3 adultes, absence de résultats, panne API et affichage mobile.

Référence UX consultée : https://workflow-lio-hackathon-18h.wholeanole3.chatgpt.site/ (rôle E, étapes E1–E5). DA : https://arnaudfuret-design.fr/project/lio/.

## Publication Sites — prototype public

Le site public propose `/` (ordinateur) et `/mobile` (parcours mobile).
Il utilise des résultats précalculés par **le moteur Python existant, sans modification de Dijkstra**.
Les dossiers restent dans le navigateur ; aucune réservation, disponibilité ou horaire daté n'est garanti.

### Reproduire la version publique

1. À la racine du dépôt : `python backend/scripts/export_public_routes.py` (bibliothèque standard uniquement, quelques minutes).
2. Dans `frontend` : `npm ci`, `npm test`, puis `npm run build:public`.
3. Publier `frontend/dist`, avec le manifeste `frontend/.openai/hosting.json` et le même identifiant Sites.

L'export utilise `backend/data/train_lio`, conserve les coûts d'accès des communes et les marges de correspondance de 5 minutes (explorateur) et 15 minutes (scolaire). Les noms complets des gares et communes sont reconnus, sans recherche par préfixe libre. Les alias équivalents partagent les résultats. Les lignes compressées sont chargées à la demande ; seuls douze départs restent en cache mémoire. Les fichiers `public/demo-routes/` sont générés et ignorés dans Git : les régénérer après toute modification de données ou d'algorithme. Ne pas utiliser `IA_DATASET=full` pour cet export.

La publication Sites utilise une copie de `frontend` dans son dépôt source propre, incluant les données publiques générées. Ne jamais y copier les fichiers `.env.local`, données de navigateur, secrets ou dépendances. Le helper Sites construit, pousse cette source puis archive `dist`. Le manifeste conserve l'identifiant du Site existant. La route `/mobile/index.html` est également générée pour les hébergeurs statiques.

### Raccorder l'API de l'équipe

Le développement local reste connecté à FastAPI sur le port 8000. Pour une API publique, compiler avec `VITE_API_URL=https://votre-api` et `VITE_PUBLIC_SNAPSHOT=false`, via `npm run build` ; configurer CORS sur l'API. Le mode précalculé est uniquement activé dans `.env.public` ou par `VITE_PUBLIC_SNAPSHOT=true` lors de la compilation. Ne pas utiliser `build:public` lors du basculement vers l'API.

Publication validée le 10 octobre 2026 : https://lio-sorties-scolaires-hackathon-2026.wholeanole3.chatgpt.site (ordinateur), route /mobile/ pour téléphone. Version Sites 1. Vérifications : 6 tests frontend, compilation TypeScript/Vite, 40 comparaisons des exports avec Python et simulation mobile sur le paquet statique.
