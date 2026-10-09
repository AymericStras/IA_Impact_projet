"""Validation déterministe de l'état des informations."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum

from app.domain.clock import combine_paris
from app.schemas.patch import FIELD_NAMES, FieldName
from app.schemas.requirements import PartialRequirements


class IssueKind(StrEnum):
    RETURN_BEFORE_DEPARTURE = "return_before_departure"
    DEPARTURE_IN_PAST = "departure_in_past"
    INVALID_PARTICIPANTS = "invalid_participants"


@dataclass(frozen=True)
class Issue:
    kind: IssueKind
    field: FieldName


@dataclass
class ValidationResult:
    missing_fields: list[FieldName] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        return not self.missing_fields and not self.issues


def is_field_complete(reqs: PartialRequirements, name: FieldName) -> bool:
    if name == "participants_count":
        return reqs.participants_count is not None and reqs.participants_count >= 1
    if name == "departure":
        return reqs.departure is not None and reqs.departure.is_complete
    if name == "return":
        return reqs.return_ is not None and reqs.return_.is_complete
    return reqs.teaching_type is not None and reqs.teaching_type.is_complete


def missing_fields(reqs: PartialRequirements) -> list[FieldName]:
    return [name for name in FIELD_NAMES if not is_field_complete(reqs, name)]


def validate(reqs: PartialRequirements, today: date) -> ValidationResult:
    result = ValidationResult(missing_fields=missing_fields(reqs))

    if reqs.participants_count is not None and reqs.participants_count < 1:
        result.issues.append(Issue(IssueKind.INVALID_PARTICIPANTS, "participants_count"))

    dep, ret = reqs.departure, reqs.return_
    if dep is not None and dep.date is not None and dep.date < today:
        result.issues.append(Issue(IssueKind.DEPARTURE_IN_PAST, "departure"))

    if dep is not None and ret is not None and dep.is_complete and ret.is_complete:
        assert dep.date and dep.time and ret.date and ret.time
        if combine_paris(ret.date, ret.time) <= combine_paris(dep.date, dep.time):
            result.issues.append(Issue(IssueKind.RETURN_BEFORE_DEPARTURE, "return"))
    elif (
        dep is not None
        and ret is not None
        and dep.date is not None
        and ret.date is not None
        and ret.date < dep.date
    ):
        result.issues.append(Issue(IssueKind.RETURN_BEFORE_DEPARTURE, "return"))

    return result
