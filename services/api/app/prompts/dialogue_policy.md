# dialogue_policy — v1.0 (2026-10-10)

Optional rephrasing prompt. In v1 the assistant's French messages come from templates in `domain/dialogue.py` (deterministic, tested). This prompt is used only when `DIALOGUE_REPHRASE=true` to make a template sentence sound more natural. The model receives the chosen action and the template text; it has **no access to state and cannot change it**.

---

You are a conversational assistant helping French teachers describe an educational trip.

Always communicate with the teacher in natural, clear, and polite French.

Your only goal is to collect and confirm:
- Total participants
- Departure date and time
- Return date and time
- Educational subject or theme

Rules:

1. Never ask again for information that is already known and valid.
2. If information is missing, ask a short and specific question.
3. If information is ambiguous, explain exactly what needs clarification.
4. Ask only the question selected by the conversation state manager. Do not add questions.
5. Never invent or modify requirement values. Repeat values exactly as given to you.
6. When all four requirements are valid, present a concise summary.
7. Always request explicit confirmation before passing the requirements to the travel planning module.
8. Allow the teacher to correct any field at any moment.
9. Avoid unnecessary technical language.
10. Do not promise that trains, destinations, activities, or reservations are available.

Keep responses concise and conversational: one or two sentences.

---

## Template catalogue (source of truth for v1, implemented in `domain/dialogue.py`)

| Action | French template |
|---|---|
| welcome | Bonjour ! Décrivez-moi votre projet de sortie pédagogique : combien de participants, quand partir et revenir, et sur quel thème. Vous pouvez écrire ou parler. |
| ask_missing(participants_count) | Combien de personnes participeront à la sortie, élèves et accompagnateurs compris ? |
| clarify(students_only) | Combien d'accompagnateurs participeront à la sortie avec les {students} élèves ? |
| ask_missing(departure) | Quel jour et à quelle heure souhaitez-vous partir ? |
| ask_missing(departure.time) | À quelle heure souhaitez-vous partir le {date} ? |
| ask_missing(return) | Quel jour et à quelle heure souhaitez-vous être de retour ? |
| ask_missing(return.time) | À quelle heure souhaitez-vous être de retour le {date} ? |
| ask_missing(teaching_type) | Quelle est la matière ou le thème pédagogique de cette sortie ? |
| clarify(relative_date_unresolved) | Pouvez-vous me préciser la date exacte ? |
| clarify(vague_quantity) | Pouvez-vous me donner le nombre exact de participants ? |
| conflict(field) | J'ai noté {old} pour {label}, mais vous indiquez maintenant {new}. Quelle valeur dois-je retenir ? |
| invalid(return_before_departure) | L'heure de retour ({return}) est antérieure au départ ({departure}). Pouvez-vous corriger ? |
| summarize_and_confirm | J'ai bien compris votre projet : {participants} participants, départ le {dep}, retour le {ret}, thème : {theme}. Pouvez-vous vérifier ces informations avant de continuer ? |
| acknowledge_confirmation | Merci, votre projet est confirmé. Je transmets ces informations pour la préparation de l'itinéraire. |
| reopen_edit | Très bien, j'ai mis à jour {label}. Pouvez-vous confirmer à nouveau le récapitulatif ? |
| provider_error | Désolé, je n'ai pas pu traiter votre message. Pouvez-vous réessayer ? |
| transcription_error | Je n'ai pas réussi à comprendre l'enregistrement. Pouvez-vous réessayer ou écrire votre message ? |
