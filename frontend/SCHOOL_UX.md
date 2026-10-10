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

1. Conserver l’exemple du lycée Bellevue (établissement réel, classe fictive), seconde, 30 élèves + 3 adultes.
2. Rechercher, sélectionner deux sorties à comparer et ouvrir un détail.
3. Vérifier les durées aller / retour et les données restant à contrôler.
4. Imprimer le récapitulatif, enregistrer la demande, puis retrouver sa référence côté agent après actualisation.
5. Saisir un retour enseignant fictif, puis tester 48 élèves + 3 adultes, absence de résultats, panne API et affichage mobile.

Référence UX consultée : https://workflow-lio-hackathon-18h.wholeanole3.chatgpt.site/ (rôle E, étapes E1–E5). DA : https://arnaudfuret-design.fr/project/lio/.
