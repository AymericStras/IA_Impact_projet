# Instructions du projet

@AGENTS.md

Suivre l'architecture, les invariants et les règles de développement définis dans AGENTS.md.

Avant de modifier :
1. Lire `docs/HANDOFF.md`, puis la documentation utile à la tâche.
2. Inspecter les implémentations existantes et les réutiliser.
3. Identifier les modules touchés et l'impact éventuel sur le contrat.
4. Écrire ou mettre à jour les tests correspondants.

Après modification :
1. Exécuter les tests pertinents (`./scripts/test.sh` ou un sous-ensemble).
2. Exécuter lint et vérification de types (`./scripts/check.sh`).
3. Mettre à jour `docs/HANDOFF.md`, et `docs/DECISIONS.md` / `docs/API.md` si nécessaire.
4. Résumer tous les fichiers modifiés.

Les skills du projet sont dans `.claude/skills/` (liens vers `.agents/skills/`), les agents de rôle dans `.claude/agents/`, les hooks dans `.claude/settings.json`.
