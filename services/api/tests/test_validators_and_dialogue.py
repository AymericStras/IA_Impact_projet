"""Validation déterministe et gabarits français."""

from __future__ import annotations

from datetime import date

from app.domain import dialogue
from app.domain.clock import format_constraint_fr, format_date_fr
from app.domain.state_machine import Action, ActionKind
from app.domain.validators import IssueKind, missing_fields, validate
from app.schemas.requirements import PartialDateTime, PartialRequirements, TeachingType, TimeConstraint
from tests.conftest import TODAY


def _complete() -> PartialRequirements:
    return PartialRequirements(
        participants_count=30,
        departure=PartialDateTime(
            date=date(2026, 11, 12), time="08:00", constraint=TimeConstraint.APPROXIMATE
        ),
        return_=PartialDateTime(date=date(2026, 11, 12), time="17:00", constraint=TimeConstraint.LATEST),
        teaching_type=TeachingType(subject="Histoire", theme="Moyen Âge"),
    )


def test_missing_fields_order_and_partial_datetime() -> None:
    reqs = PartialRequirements(departure=PartialDateTime(date=date(2026, 11, 12)))
    assert missing_fields(reqs) == ["participants_count", "departure", "return", "teaching_type"]
    assert missing_fields(_complete()) == []


def test_theme_alone_is_enough() -> None:
    reqs = _complete()
    reqs.teaching_type = TeachingType(theme="Moyen Âge")
    assert "teaching_type" not in missing_fields(reqs)


def test_return_before_departure_is_an_issue() -> None:
    reqs = _complete()
    reqs.return_ = PartialDateTime(date=date(2026, 11, 12), time="07:00", constraint=TimeConstraint.EXACT)
    issues = validate(reqs, TODAY).issues
    assert [i.kind for i in issues] == [IssueKind.RETURN_BEFORE_DEPARTURE]


def test_departure_in_past_is_an_issue() -> None:
    reqs = _complete()
    reqs.departure = PartialDateTime(date=date(2026, 1, 5), time="08:00", constraint=TimeConstraint.EXACT)
    reqs.return_ = PartialDateTime(date=date(2026, 1, 5), time="17:00", constraint=TimeConstraint.EXACT)
    assert IssueKind.DEPARTURE_IN_PAST in {i.kind for i in validate(reqs, TODAY).issues}


def test_french_formatting() -> None:
    assert format_date_fr(date(2026, 11, 12)) == "jeudi 12 novembre 2026"
    assert format_constraint_fr(TimeConstraint.LATEST, "17:00") == "au plus tard à 17 h 00"
    assert format_constraint_fr(TimeConstraint.APPROXIMATE, "08:05") == "vers 8 h 05"


def test_summary_mentions_all_four_fields() -> None:
    text = dialogue.summary(_complete())
    assert "30 participants" in text
    assert "jeudi 12 novembre vers 8 h 00" in text
    assert "au plus tard à 17 h 00" in text
    assert "Histoire (Moyen Âge)" in text
    assert text.endswith("Pouvez-vous vérifier ces informations avant de continuer ?")


def test_ask_return_time_uses_departure_date() -> None:
    reqs = PartialRequirements(
        departure=PartialDateTime(date=date(2026, 11, 15), time="09:00", constraint=TimeConstraint.EXACT)
    )
    text = dialogue.render(Action(ActionKind.ASK_MISSING, field="return"), reqs)
    assert text == "À quelle heure souhaitez-vous être de retour le dimanche 15 novembre ?"


def test_students_only_clarification_mentions_count() -> None:
    reqs = PartialRequirements.model_validate(
        {"participants_breakdown": {"students": 25, "accompanying": None}}
    )
    text = dialogue.render(
        Action(ActionKind.CLARIFY, field="participants_count", detail="students_only"), reqs
    )
    assert text == "Combien d'accompagnateurs participeront à la sortie avec les 25 élèves ?"
