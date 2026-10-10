"""Patch merging: totals computed by the code, corrections, conflicts, return-date inference."""

from __future__ import annotations

from datetime import date

from app.domain.patch_merger import apply_patch
from app.schemas.patch import AmbiguityKind, UserIntent
from app.schemas.requirements import PartialDateTime, PartialRequirements, TeachingType, TimeConstraint
from tests.conftest import COMPLETE_PATCH, dt, mk_patch, op, tt


def test_complete_message_computes_total_from_breakdown() -> None:
    result = apply_patch(PartialRequirements(), COMPLETE_PATCH)
    reqs = result.requirements
    assert reqs.participants_count == 30
    assert reqs.participants_breakdown is not None
    assert (reqs.participants_breakdown.students, reqs.participants_breakdown.accompanying) == (27, 3)
    assert reqs.departure == PartialDateTime(
        date=date(2026, 11, 12), time="08:00", constraint=TimeConstraint.APPROXIMATE
    )
    assert reqs.return_ is not None and reqs.return_.constraint == TimeConstraint.LATEST
    assert reqs.teaching_type == TeachingType(subject="Histoire", theme="Moyen Âge")
    assert set(result.changed_fields) == {"participants_count", "departure", "return", "teaching_type"}
    assert result.conflicts == []


def test_students_only_is_ambiguous_not_a_total() -> None:
    result = apply_patch(PartialRequirements(), mk_patch(students=25))
    assert result.requirements.participants_count is None
    assert result.requirements.participants_breakdown is not None
    assert result.requirements.participants_breakdown.students == 25
    assert [a.kind for a in result.ambiguities] == [AmbiguityKind.STUDENTS_ONLY]


def test_accompanying_given_later_completes_total() -> None:
    first = apply_patch(PartialRequirements(), mk_patch(students=25))
    second = apply_patch(first.requirements, mk_patch(accompanying=3))
    assert second.requirements.participants_count == 28
    assert second.changed_fields == ["participants_count"]


def test_total_stated_wins_over_breakdown() -> None:
    result = apply_patch(PartialRequirements(), mk_patch(total=30))
    assert result.requirements.participants_count == 30


def test_explicit_correction_replaces_without_adding() -> None:
    state = PartialRequirements(participants_count=30, teaching_type=TeachingType(subject="Histoire"))
    patch = mk_patch(op("participants_count", 32, "replace"), intent=UserIntent.CORRECT_INFORMATION, total=32)
    result = apply_patch(state, patch)
    assert result.requirements.participants_count == 32
    assert result.requirements.teaching_type == TeachingType(
        subject="Histoire"
    )  # unmentioned field preserved
    assert result.conflicts == []


def test_set_on_known_different_value_is_a_conflict() -> None:
    state = PartialRequirements(participants_count=30)
    result = apply_patch(state, mk_patch(op("participants_count", 28), total=28))
    assert result.requirements.participants_count == 30
    assert result.conflicts == ["participants_count"]
    assert result.changed_fields == []


def test_model_reported_conflict_is_kept() -> None:
    state = PartialRequirements(participants_count=30)
    result = apply_patch(
        state, mk_patch(op("teaching_type", tt("Géographie")), conflicts=["participants_count"])
    )
    assert result.conflicts == ["participants_count"]
    assert result.requirements.teaching_type == TeachingType(subject="Géographie")


def test_partial_datetime_completion_keeps_known_parts() -> None:
    state = PartialRequirements(departure=PartialDateTime(date=date(2026, 11, 12)))
    result = apply_patch(state, mk_patch(op("departure", dt(None, "08:00", "exact"))))
    assert result.requirements.departure == PartialDateTime(
        date=date(2026, 11, 12), time="08:00", constraint=TimeConstraint.EXACT
    )


def test_return_time_without_date_inherits_departure_date() -> None:
    state = PartialRequirements(
        departure=PartialDateTime(date=date(2026, 11, 15), time="09:00", constraint=TimeConstraint.EXACT)
    )
    result = apply_patch(state, mk_patch(op("return", dt(None, "18:00", "latest"))))
    assert result.requirements.return_ == PartialDateTime(
        date=date(2026, 11, 15), time="18:00", constraint=TimeConstraint.LATEST
    )


def test_correction_of_date_keeps_time_and_constraint() -> None:
    state = PartialRequirements(
        departure=PartialDateTime(
            date=date(2026, 11, 12), time="08:00", constraint=TimeConstraint.APPROXIMATE
        )
    )
    patch = mk_patch(op("departure", dt("2026-11-19"), "replace"), intent=UserIntent.CORRECT_INFORMATION)
    result = apply_patch(state, patch)
    assert result.requirements.departure == PartialDateTime(
        date=date(2026, 11, 19), time="08:00", constraint=TimeConstraint.APPROXIMATE
    )


def test_theme_added_to_subject_is_not_a_conflict() -> None:
    state = PartialRequirements(teaching_type=TeachingType(subject="Histoire"))
    result = apply_patch(state, mk_patch(op("teaching_type", tt(theme="Moyen Âge"))))
    assert result.requirements.teaching_type == TeachingType(subject="Histoire", theme="Moyen Âge")
    assert result.conflicts == []


def test_clear_removes_value() -> None:
    state = PartialRequirements(participants_count=30)
    result = apply_patch(state, mk_patch(op("participants_count", None, "clear")))
    assert result.requirements.participants_count is None
    assert result.changed_fields == ["participants_count"]


def test_empty_patch_changes_nothing() -> None:
    state = PartialRequirements(participants_count=30)
    result = apply_patch(state, mk_patch())
    assert result.requirements == state
    assert result.changed_fields == []


def test_invalid_merged_state_is_rejected() -> None:
    import pytest

    from app.domain.patch_merger import InvalidPatchError

    with pytest.raises(InvalidPatchError):
        apply_patch(PartialRequirements(), mk_patch(op("departure", dt("2026-02-30", "08:00", "exact"))))
    with pytest.raises(InvalidPatchError):
        apply_patch(PartialRequirements(), mk_patch(op("participants_count", 0)))
    # A stated total of zero is simply not applied (no operation, nothing stored).
    assert apply_patch(PartialRequirements(), mk_patch(total=0)).requirements.participants_count is None


def test_approximate_count_is_never_stored_as_exact() -> None:
    known = PartialRequirements(participants_count=30)
    # The model flags the vagueness but still proposes a value.
    flagged = mk_patch(
        op("participants_count", 35, "replace"),
        intent=UserIntent.CORRECT_INFORMATION,
        total=35,
        ambiguities=[("participants_count", AmbiguityKind.VAGUE_QUANTITY)],
    )
    assert apply_patch(known, flagged).requirements.participants_count == 30
    # The model does not flag it, but its own quote is approximate.
    unflagged = mk_patch(op("participants_count", 35, "replace", evidence="environ 35"), total=35)
    result = apply_patch(known, unflagged)
    assert result.requirements.participants_count == 30
    assert [a.kind for a in result.ambiguities] == [AmbiguityKind.VAGUE_QUANTITY]
    assert (
        apply_patch(
            PartialRequirements(), mk_patch(op("participants_count", 30, evidence="une trentaine"))
        ).requirements.participants_count
        is None
    )
    # An exact statement is unaffected.
    assert (
        apply_patch(
            known, mk_patch(op("participants_count", 35, "replace", evidence="nous serons 35"))
        ).requirements.participants_count
        == 35
    )
