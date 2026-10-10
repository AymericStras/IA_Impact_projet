"""Generation of the assistant's messages from French templates (ADR-004).

The reference catalogue is in `app/prompts/dialogue_policy.md`; any modification here must be
mirrored there.
"""

from __future__ import annotations

from app.domain.clock import format_constraint_fr, format_date_fr
from app.domain.state_machine import Action, ActionKind
from app.domain.validators import IssueKind
from app.schemas.patch import AmbiguityKind, FieldName
from app.schemas.requirements import PartialDateTime, PartialRequirements

WELCOME = (
    "Bonjour ! Décrivez-moi votre projet de sortie pédagogique : combien de participants, "
    "quand partir et revenir, et sur quel thème. Vous pouvez écrire ou parler."
)
PROVIDER_ERROR = "Désolé, je n'ai pas pu traiter votre message. Pouvez-vous réessayer ?"
TRANSCRIPTION_ERROR = (
    "Je n'ai pas réussi à comprendre l'enregistrement. Pouvez-vous réessayer ou écrire votre message ?"
)

FIELD_LABELS: dict[FieldName, str] = {
    "participants_count": "le nombre de participants",
    "departure": "le départ",
    "return": "le retour",
    "teaching_type": "le thème pédagogique",
}


def describe_datetime(value: PartialDateTime | None, with_year: bool = False) -> str:
    if value is None:
        return "à préciser"
    parts: list[str] = []
    if value.date is not None:
        parts.append(format_date_fr(value.date, with_year=with_year))
    if value.time is not None:
        parts.append(format_constraint_fr(value.constraint, value.time))
    return " ".join(parts) if parts else "à préciser"


def describe_field(reqs: PartialRequirements, name: FieldName) -> str:
    if name == "participants_count":
        return f"{reqs.participants_count} participants" if reqs.participants_count else "à préciser"
    if name == "departure":
        return describe_datetime(reqs.departure)
    if name == "return":
        return describe_datetime(reqs.return_)
    tt = reqs.teaching_type
    if tt is None or not tt.is_complete:
        return "à préciser"
    if tt.subject and tt.theme:
        return f"{tt.subject} ({tt.theme})"
    return tt.subject or tt.theme or "à préciser"


def _ask_missing(reqs: PartialRequirements, name: FieldName) -> str:
    if name == "participants_count":
        breakdown = reqs.participants_breakdown
        if breakdown is not None and breakdown.students is not None and breakdown.accompanying is None:
            return (
                f"Combien d'accompagnateurs participeront à la sortie avec les {breakdown.students} élèves ?"
            )
        return "Combien de personnes participeront à la sortie, élèves et accompagnateurs compris ?"
    if name == "departure":
        dep = reqs.departure
        if dep is not None and dep.date is not None and dep.time is None:
            return f"À quelle heure souhaitez-vous partir le {format_date_fr(dep.date, with_year=False)} ?"
        if dep is not None and dep.time is not None and dep.date is None:
            return "Quel jour souhaitez-vous partir ?"
        return "Quel jour et à quelle heure souhaitez-vous partir ?"
    if name == "return":
        ret = reqs.return_
        if ret is not None and ret.date is not None and ret.time is None:
            return f"À quelle heure souhaitez-vous être de retour le {format_date_fr(ret.date, with_year=False)} ?"
        if (
            reqs.departure is not None
            and reqs.departure.date is not None
            and (ret is None or ret.time is None)
        ):
            return (
                "À quelle heure souhaitez-vous être de retour le "
                f"{format_date_fr(reqs.departure.date, with_year=False)} ?"
            )
        return "Quel jour et à quelle heure souhaitez-vous être de retour ?"
    return "Quelle est la matière ou le thème pédagogique de cette sortie ?"


def _clarify(reqs: PartialRequirements, action: Action) -> str:
    kind = action.detail
    if kind == AmbiguityKind.STUDENTS_ONLY:
        students = reqs.participants_breakdown.students if reqs.participants_breakdown else None
        if students is not None:
            return f"Combien d'accompagnateurs participeront à la sortie avec les {students} élèves ?"
        return "Combien d'accompagnateurs participeront à la sortie ?"
    if kind == AmbiguityKind.RELATIVE_DATE_UNRESOLVED:
        return "Pouvez-vous me préciser la date exacte ?"
    if kind == AmbiguityKind.VAGUE_QUANTITY:
        return "Pouvez-vous me donner le nombre exact de participants ?"
    if kind == AmbiguityKind.VAGUE_TIME:
        label = "de départ" if action.field == "departure" else "de retour"
        return f"Pouvez-vous me préciser l'heure {label} ?"
    if kind == AmbiguityKind.UNCLEAR_SUBJECT:
        return "Pouvez-vous me préciser la matière ou le thème pédagogique de la sortie ?"
    return f"Pouvez-vous me préciser {FIELD_LABELS[action.field or 'participants_count']} ?"


def _invalid(reqs: PartialRequirements, action: Action) -> str:
    if action.detail == IssueKind.RETURN_BEFORE_DEPARTURE:
        return (
            f"L'heure de retour ({action.params.get('return', 'indiquée')}) est antérieure au départ "
            f"({describe_datetime(reqs.departure)}). Pouvez-vous corriger l'heure de retour ?"
        )
    if action.detail == IssueKind.DEPARTURE_IN_PAST:
        return (
            f"La date de départ ({describe_datetime(reqs.departure)}) est déjà passée. "
            "Pouvez-vous me donner la bonne date ?"
        )
    return "Le nombre de participants doit être d'au moins une personne. Pouvez-vous le préciser ?"


def acknowledge_replacements(
    previous: PartialRequirements, current: PartialRequirements, fields: list[FieldName]
) -> str:
    changes = [
        f"{FIELD_LABELS[name]} : {describe_field(current, name)} (au lieu de {describe_field(previous, name)})"
        for name in fields
    ]
    return "C'est noté, j'ai mis à jour " + " ; ".join(changes) + ". "


def summary(reqs: PartialRequirements) -> str:
    return (
        f"J'ai bien compris votre projet : {describe_field(reqs, 'participants_count')}, "
        f"départ le {describe_datetime(reqs.departure, with_year=True)}, retour le {describe_datetime(reqs.return_, with_year=True)}, "
        f"thème : {describe_field(reqs, 'teaching_type')}. "
        "Pouvez-vous vérifier ces informations avant de continuer ?"
    )


def render(action: Action, reqs: PartialRequirements) -> str:
    match action.kind:
        case ActionKind.WELCOME:
            return WELCOME
        case ActionKind.ASK_MISSING:
            return _ask_missing(reqs, action.field or "participants_count")
        case ActionKind.CLARIFY:
            return _clarify(reqs, action)
        case ActionKind.CONFLICT:
            name = action.field or "participants_count"
            return (
                f"J'ai noté {action.params.get('old', describe_field(reqs, name))} pour {FIELD_LABELS[name]}, "
                f"mais vous indiquez maintenant autre chose. Quelle valeur dois-je retenir ?"
            )
        case ActionKind.INVALID:
            return _invalid(reqs, action)
        case ActionKind.NOTHING_UNDERSTOOD:
            return "Je n'ai pas trouvé d'information sur votre projet dans ce message. " + _ask_missing(
                reqs, action.field or "participants_count"
            )
        case ActionKind.SUMMARIZE_AND_CONFIRM:
            return summary(reqs)
        case ActionKind.ASK_WHAT_TO_CHANGE:
            return "Très bien. Que souhaitez-vous modifier : les participants, le départ, le retour ou le thème ?"
        case ActionKind.ACKNOWLEDGE_CONFIRMATION:
            return "Merci, votre projet est confirmé. Je transmets ces informations pour la préparation de l'itinéraire."
        case ActionKind.REOPEN_EDIT:
            name = action.field or "participants_count"
            return (
                f"Très bien, j'ai mis à jour {FIELD_LABELS[name]} : {describe_field(reqs, name)}. "
                + summary(reqs)
            )
        case ActionKind.ALREADY_CONFIRMED:
            return "Votre projet est déjà confirmé. Souhaitez-vous modifier une information ?"
    return PROVIDER_ERROR
