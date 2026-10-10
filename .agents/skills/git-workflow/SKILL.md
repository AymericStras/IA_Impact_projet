---
name: git-workflow
description: Préparer, vérifier, committer et transmettre le travail dans ce dépôt — nommage des branches, Conventional Commits en français, contrôles avant commit, mise à jour de HANDOFF.md et création de PR avec gh.
---

# Flux Git

## Branches
`main` est toujours démontrable. Travailler sur `feature/<sujet>` (`feature/chat-ui`, `feature/speech-to-text`, `feature/requirements-extraction`, `feature/conversation-manager`), `fix/<sujet>`, `docs/<sujet>`.

## Avant de committer
1. `git status` — ni `.env`, ni `.local/`, ni `artifacts/`, ni audio, ni fichiers de base. `git diff --cached | grep -iE "sk-[A-Za-z0-9]|api[_-]?key *="` doit être vide.
2. `./scripts/check.sh` vert (ou le sous-ensemble pertinent, indiqué dans le corps du commit).
3. `docs/HANDOFF.md` à jour ; `docs/DECISIONS.md` / `docs/API.md` si applicable.
4. Stager par chemins explicites quand plusieurs agents travaillent en parallèle (pas `git add -A`).

## Commit
Conventional Commits, impératif, **description en français** : `feat: ajouter l'enregistrement audio`, `fix: conserver l'effectif corrigé`, `test: ajouter les cas de champ manquant`, `docs: mettre à jour le contrat d'intégration`, `chore(ci): …`. Portée optionnelle : `feat(api): …`, `feat(web): …`, `feat(prompt): …`. Le corps explique le pourquoi ; terminer par la ligne d'attribution exigée par la session, s'il y en a une.

## PR
`gh pr create --fill --base main` ; description : quoi, pourquoi, comment vérifié (commandes exécutées), captures pour l'UI, impact sur le contrat (aucun / incrément de version). CI verte. Fusion par squash.

## Transmission
Le message final d'une session liste les fichiers modifiés, les vérifications effectuées et la prochaine étape telle qu'écrite dans `docs/HANDOFF.md`.
