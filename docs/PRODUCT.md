# Définition produit

## Utilisateurs et objectif

Enseignants (primaire/secondaire) en France préparant une sortie pédagogique à la journée avec les trains régionaux liO en Occitanie. Ils décrivent la sortie en français naturel, à la voix ou au clavier. L'assistant extrait, clarifie et confirme **quatre informations**, puis les transmet au module de planification.

## Les quatre informations

| # | Champ | Complète lorsque | Formulations typiques |
|---|---|---|---|
| 1 | `participants_count` | Un total est connu : total énoncé, ou élèves + accompagnateurs connus | « Nous sommes 30 », « 27 élèves et 3 accompagnateurs », « deux classes de 25 et 4 adultes » |
| 2 | `departure` | date + heure + contrainte | « le 12 novembre vers 8 h », « jeudi prochain à 7 h 45 » (si résoluble) |
| 3 | `return` | date + heure + contrainte | « retour avant 17 h », « rentrés vers seize heures » |
| 4 | `teaching_type` | matière **ou** thème | « professeur d'histoire », « le Moyen Âge », « un cours de SVT », « autour de l'architecture » |

Ambiguïté → on demande, on ne devine jamais :

- « J'ai 25 élèves » → demander le nombre d'accompagnateurs (élèves ≠ participants).
- « Le mois prochain », « bientôt », « une trentaine » → demander la valeur exacte.
- Retour avant le départ → demander une correction (la valeur incohérente n'est pas conservée).
- Heure de retour sans date → hérite de la date de départ (sortie à la journée, ADR-011) ; l'enseignant peut corriger.
- Nouvelle valeur contradictoire sans formule de correction (« finalement », « en fait ») → demander laquelle retenir.

Les contraintes horaires sont conservées : `exact` (à), `approximate` (vers), `earliest` (après / pas avant), `latest` (avant / au plus tard).

## Non collecté

Budget, gare de départ, âge des élèves, niveau, établissement, coordonnées, noms. Si l'enseignant les mentionne, elles sont ignorées (jamais stockées dans les informations) et jamais demandées.

## Déroulé de la conversation

1. Message d'accueil avec un exemple de ce qu'on peut dire.
2. L'enseignant parle ou écrit. Audio → transcription affichée pour correction → envoyée comme texte.
3. Extraction → fusion du patch → validation → la machine à états choisit : question ciblée (manque), clarification (ambiguïté/conflit/incohérence) ou récapitulatif + demande de confirmation (complet).
4. L'enseignant peut modifier n'importe quel champ à tout moment, par le chat ou dans le panneau.
5. Confirmation explicite (« Confirmer et continuer ») → `CONFIRMED` → JSON versionné exporté.
6. Après confirmation, une correction rouvre l'édition (nouvelle confirmation requise, export invalidé entre-temps).

Principes : ne jamais redemander un champ connu ; une question à la fois ; français concis et poli ; aucune promesse sur les trains, destinations ou disponibilités.

## Critères de réussite (hackathon)

- Démonstration minimale : texte → extraction → relance → correction → confirmation → JSON.
- La voix utilise le même pipeline (pas de seconde logique de dialogue).
- Cible ≥ 95 % d'exactitude d'extraction sur les cas non ambigus ; zéro remplissage non fondé / fausse confirmation (bloquant). Résultat actuel : voir `docs/HANDOFF.md`.
- Fonctionne hors ligne en mode démo pour la présentation.
