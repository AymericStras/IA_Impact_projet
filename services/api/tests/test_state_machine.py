"""Transitions de la machine à états (fonction pure)."""

from __future__ import annotations

from app.domain.state_machine import ActionKind, decide, decide_explicit_confirmation
from app.domain.validators import Issue, IssueKind
from app.schemas.conversation import ConversationState as S
from app.schemas.patch import Ambiguity, AmbiguityKind, UserIntent

NO_AMB: list[Ambiguity] = []


def _decide(prev: S = S.COLLECTING, **kwargs: object) -> tuple[S, ActionKind, str | None]:
    params: dict[str, object] = {
        "intent": UserIntent.PROVIDE_INFORMATION,
        "changed_fields": [],
        "conflicts": [],
        "issues": [],
        "ambiguities": NO_AMB,
        "missing": [],
    }
    params.update(kwargs)
    decision = decide(prev, **params)  # type: ignore[arg-type]
    return decision.state, decision.action.kind, decision.action.field


def test_missing_field_asks_in_canonical_order() -> None:
    assert _decide(changed_fields=["teaching_type"], missing=["return", "participants_count"]) == (
        S.COLLECTING,
        ActionKind.ASK_MISSING,
        "participants_count",
    )


def test_blocking_ambiguity_takes_precedence_over_missing() -> None:
    amb = [Ambiguity(field="participants_count", kind=AmbiguityKind.STUDENTS_ONLY, detail="")]
    state, kind, field = _decide(ambiguities=amb, missing=["participants_count", "return"])
    assert (state, kind, field) == (S.ASKING_USER, ActionKind.CLARIFY, "participants_count")


def test_ambiguity_on_known_field_is_ignored() -> None:
    amb = [Ambiguity(field="participants_count", kind=AmbiguityKind.VAGUE_QUANTITY, detail="")]
    state, kind, _ = _decide(changed_fields=["return"], ambiguities=amb, missing=["return"])
    assert (state, kind) == (S.COLLECTING, ActionKind.ASK_MISSING)


def test_conflict_has_highest_priority() -> None:
    issues = [Issue(IssueKind.RETURN_BEFORE_DEPARTURE, "return")]
    state, kind, field = _decide(conflicts=["participants_count"], issues=issues, missing=["return"])
    assert (state, kind, field) == (S.ASKING_USER, ActionKind.CONFLICT, "participants_count")


def test_issue_asks_for_correction() -> None:
    state, kind, field = _decide(
        issues=[Issue(IssueKind.RETURN_BEFORE_DEPARTURE, "return")], missing=["return"]
    )
    assert (state, kind, field) == (S.ASKING_USER, ActionKind.INVALID, "return")


def test_complete_requests_confirmation() -> None:
    assert _decide(changed_fields=["return"]) == (
        S.AWAITING_CONFIRMATION,
        ActionKind.SUMMARIZE_AND_CONFIRM,
        None,
    )


def test_chat_confirmation_only_when_awaiting_and_unchanged() -> None:
    assert _decide(S.AWAITING_CONFIRMATION, intent=UserIntent.CONFIRM)[:2] == (
        S.CONFIRMED,
        ActionKind.ACKNOWLEDGE_CONFIRMATION,
    )
    # « oui » alors qu'il manque une information : jamais une confirmation.
    assert _decide(S.COLLECTING, intent=UserIntent.CONFIRM, missing=["return"])[:2] == (
        S.COLLECTING,
        ActionKind.NOTHING_UNDERSTOOD,
    )
    # « oui » accompagné d'une modification : on re-présente le récapitulatif.
    assert _decide(S.AWAITING_CONFIRMATION, intent=UserIntent.CONFIRM, changed_fields=["return"])[:2] == (
        S.AWAITING_CONFIRMATION,
        ActionKind.SUMMARIZE_AND_CONFIRM,
    )


def test_reject_asks_what_to_change() -> None:
    assert _decide(S.AWAITING_CONFIRMATION, intent=UserIntent.REJECT)[1] == ActionKind.ASK_WHAT_TO_CHANGE


def test_edit_after_confirmation_reopens() -> None:
    assert _decide(S.CONFIRMED, changed_fields=["participants_count"]) == (
        S.AWAITING_CONFIRMATION,
        ActionKind.REOPEN_EDIT,
        "participants_count",
    )
    assert _decide(S.CONFIRMED, intent=UserIntent.OTHER)[:2] == (S.CONFIRMED, ActionKind.ALREADY_CONFIRMED)


def test_nothing_understood_repeats_pending_question() -> None:
    assert _decide(intent=UserIntent.OTHER, missing=["departure"]) == (
        S.COLLECTING,
        ActionKind.NOTHING_UNDERSTOOD,
        "departure",
    )


def test_explicit_button_confirmation_rules() -> None:
    assert decide_explicit_confirmation(S.AWAITING_CONFIRMATION, complete=True) is not None
    assert decide_explicit_confirmation(S.COLLECTING, complete=True) is None
    assert decide_explicit_confirmation(S.AWAITING_CONFIRMATION, complete=False) is None
