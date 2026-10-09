"""Machine à états de la conversation : fonction pure, exhaustivement testée.

Inspirée du remplissage de formulaire (« requested slot ») de Rasa Forms : le code choisit
l'unique prochaine action ; le modèle ne pilote jamais le flux.
"""

from __future__ import annotations

from dataclasses import dataclass
from dataclasses import field as dc_field
from enum import StrEnum

from app.domain.validators import Issue
from app.schemas.conversation import ConversationState as State
from app.schemas.patch import Ambiguity, FieldName, UserIntent


class ActionKind(StrEnum):
    WELCOME = "welcome"
    ASK_MISSING = "ask_missing"
    CLARIFY = "clarify"
    CONFLICT = "conflict"
    INVALID = "invalid"
    NOTHING_UNDERSTOOD = "nothing_understood"
    SUMMARIZE_AND_CONFIRM = "summarize_and_confirm"
    ASK_WHAT_TO_CHANGE = "ask_what_to_change"
    ACKNOWLEDGE_CONFIRMATION = "acknowledge_confirmation"
    REOPEN_EDIT = "reopen_edit"
    ALREADY_CONFIRMED = "already_confirmed"


@dataclass
class Action:
    kind: ActionKind
    field: FieldName | None = None
    detail: str | None = None  # kind d'ambiguïté ou d'incohérence
    params: dict[str, str] = dc_field(default_factory=dict)


@dataclass
class Decision:
    state: State
    action: Action


MISSING_ORDER: tuple[FieldName, ...] = ("participants_count", "departure", "return", "teaching_type")


def _first_missing(missing: list[FieldName]) -> FieldName:
    return next(name for name in MISSING_ORDER if name in missing)


def decide(
    previous: State,
    *,
    intent: UserIntent,
    changed_fields: list[FieldName],
    conflicts: list[FieldName],
    issues: list[Issue],
    ambiguities: list[Ambiguity],
    missing: list[FieldName],
) -> Decision:
    was_confirmed = previous == State.CONFIRMED
    changed = bool(changed_fields)

    if was_confirmed and not changed and not conflicts and not issues:
        return Decision(State.CONFIRMED, Action(ActionKind.ALREADY_CONFIRMED))

    if conflicts:
        return Decision(State.ASKING_USER, Action(ActionKind.CONFLICT, field=conflicts[0]))

    if issues:
        issue = issues[0]
        return Decision(
            State.ASKING_USER, Action(ActionKind.INVALID, field=issue.field, detail=issue.kind.value)
        )

    blocking = [a for a in ambiguities if a.field in missing]
    if blocking:
        amb = blocking[0]
        return Decision(State.ASKING_USER, Action(ActionKind.CLARIFY, field=amb.field, detail=amb.kind.value))

    if missing:
        target = _first_missing(missing)
        if not changed and intent in (
            UserIntent.OTHER,
            UserIntent.ASK_QUESTION,
            UserIntent.CONFIRM,
            UserIntent.REJECT,
        ):
            return Decision(State.COLLECTING, Action(ActionKind.NOTHING_UNDERSTOOD, field=target))
        return Decision(State.COLLECTING, Action(ActionKind.ASK_MISSING, field=target))

    # Tout est complet et valide.
    if was_confirmed and changed:
        return Decision(State.AWAITING_CONFIRMATION, Action(ActionKind.REOPEN_EDIT, field=changed_fields[0]))
    if previous == State.AWAITING_CONFIRMATION and not changed:
        if intent == UserIntent.CONFIRM:
            return Decision(State.CONFIRMED, Action(ActionKind.ACKNOWLEDGE_CONFIRMATION))
        if intent == UserIntent.REJECT:
            return Decision(State.AWAITING_CONFIRMATION, Action(ActionKind.ASK_WHAT_TO_CHANGE))
    return Decision(State.AWAITING_CONFIRMATION, Action(ActionKind.SUMMARIZE_AND_CONFIRM))


def decide_explicit_confirmation(previous: State, complete: bool) -> Decision | None:
    """Bouton « Confirmer » : accepté seulement si tout est complet et qu'une confirmation est attendue."""
    if not complete or previous not in (State.AWAITING_CONFIRMATION, State.EDITING):
        return None
    return Decision(State.CONFIRMED, Action(ActionKind.ACKNOWLEDGE_CONFIRMATION))
