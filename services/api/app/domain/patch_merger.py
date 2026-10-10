"""Deterministic merge of a RequirementPatch into the current state.

The model proposes; this module decides. Main rules (AGENTS.md §3):
- `set` on an already known, different field → conflict (unless correction intent);
- `replace` or `correct_information` intent → explicit replacement;
- the participant total is computed by the code from the mentioned headcounts;
- a missing return date is derived from the departure date (one-day trip);
- no unmentioned field is modified.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from pydantic import ValidationError

from app.schemas.patch import (
    Ambiguity,
    AmbiguityKind,
    FieldName,
    Operation,
    PartialDateTimePatch,
    RequirementPatch,
    TeachingTypePatch,
    UserIntent,
)
from app.schemas.requirements import (
    PartialDateTime,
    PartialRequirements,
    ParticipantsBreakdown,
    TeachingType,
)


class InvalidPatchError(ValueError):
    """The patch would produce an invalid state (impossible calendar date, count below 1...)."""


@dataclass
class MergeResult:
    requirements: PartialRequirements
    previous: PartialRequirements
    changed_fields: list[FieldName] = field(default_factory=list)
    conflicts: list[FieldName] = field(default_factory=list)
    ambiguities: list[Ambiguity] = field(default_factory=list)


_TIME_EXPRESSION = re.compile(r"(?<!\d)(\d{1,2})\s*(?:h|heures?|:)\s*(\d{2})?(?!\d)", re.IGNORECASE)


def time_in_evidence(evidence: str) -> str | None:
    """« Avant 17 h » → 17:00, « 8h30 » → 08:30. None when there is no time or more than one."""
    found = {
        f"{int(hour):02d}:{minute or '00'}"
        for hour, minute in _TIME_EXPRESSION.findall(evidence)
        if int(hour) < 24 and (not minute or int(minute) < 60)
    }
    return found.pop() if len(found) == 1 else None


_APPROXIMATION = re.compile(
    r"\b(environ|à peu près|a peu pres|approximativement|presque|autour de|dans les|quelque|une \w+aine)\b"
)
_VAGUE_COUNT_KINDS = {AmbiguityKind.VAGUE_QUANTITY, AmbiguityKind.MULTIPLE_CANDIDATES}


def _vague_participants(patch: RequirementPatch) -> bool:
    """Deterministic backstop: « environ 35 », « une trentaine », « 28 ou 30 » are not exact totals,

    even if the model also proposed a value. Either the model says so, or the quote it gives does.
    """
    if any(a.field == "participants_count" and a.kind in _VAGUE_COUNT_KINDS for a in patch.ambiguities):
        return True
    return any(
        op.field == "participants_count" and _APPROXIMATION.search(op.evidence.casefold())
        for op in patch.operations
    )


def _is_correction(op: Operation, intent: UserIntent) -> bool:
    return op.operation == "replace" or intent == UserIntent.CORRECT_INFORMATION


def _get(reqs: PartialRequirements, name: FieldName) -> object:
    return getattr(reqs, "return_" if name == "return" else name)


def _set(reqs: PartialRequirements, name: FieldName, value: object) -> None:
    setattr(reqs, "return_" if name == "return" else name, value)


def _merge_datetime(
    current: PartialDateTime | None, incoming: PartialDateTimePatch, correction: bool
) -> tuple[PartialDateTime | None, bool]:
    """Returns (new value, conflict)."""
    new = PartialDateTime(
        date=incoming.date,  # ISO string validated by Pydantic
        time=incoming.time,
        constraint=incoming.constraint,
    )
    if current is None:
        return new, False
    if correction:
        # Correction: provided parts replace, the others are kept.
        return (
            PartialDateTime(
                date=new.date if new.date is not None else current.date,
                time=new.time if new.time is not None else current.time,
                constraint=new.constraint if new.constraint is not None else current.constraint,
            ),
            False,
        )
    # Completion: only still-unknown parts are filled; a different value is a conflict.
    for part in ("date", "time", "constraint"):
        cur, inc = getattr(current, part), getattr(new, part)
        if cur is not None and inc is not None and cur != inc:
            return current, True
    return (
        PartialDateTime(
            date=current.date or new.date,
            time=current.time or new.time,
            constraint=current.constraint or new.constraint,
        ),
        False,
    )


_STATION_PREFIX = re.compile(r"^(?:(?:la|le)\s+)?gare\s+(?:de|d['’]|du|des)\s*", re.IGNORECASE)


def _station(value: str) -> str | None:
    """« la gare de Toulouse Matabiau » → « Toulouse Matabiau ». The name itself is kept as said."""
    cleaned = _STATION_PREFIX.sub("", " ".join(value.split()), count=1).strip(" .,;")
    return cleaned[:80] or None


def _same_station(left: str, right: str) -> bool:
    return left.casefold() == right.casefold()


_LEADING_ARTICLE = re.compile(r"^(?:l['’]\s*|(?:le|la|les|un|une|des|du|de la|de l['’])\s+)", re.IGNORECASE)


def _label(value: str | None) -> str | None:
    """« la biodiversité » → « biodiversité »: a label, not a noun phrase."""
    if value is None:
        return None
    stripped = _LEADING_ARTICLE.sub("", value.strip(), count=1).strip()
    return stripped or None


def _merge_teaching(
    current: TeachingType | None, incoming: TeachingTypePatch, correction: bool
) -> TeachingType:
    new = TeachingType(subject=_label(incoming.subject), theme=_label(incoming.theme))
    if current is None or correction:
        if correction and current is not None:
            return TeachingType(subject=new.subject or current.subject, theme=new.theme or current.theme)
        return new
    # Adding a theme to a subject (or vice versa) is not a conflict: we complete.
    return TeachingType(subject=current.subject or new.subject, theme=current.theme or new.theme)


def _apply_participants(reqs: PartialRequirements, patch: RequirementPatch, result: MergeResult) -> None:
    """Computes the total from the mentioned headcounts (the model does no addition)."""
    mentioned = patch.participants_mentioned
    explicit = any(op.field == "participants_count" for op in patch.operations)
    correction = patch.user_intent == UserIntent.CORRECT_INFORMATION

    breakdown = reqs.participants_breakdown or ParticipantsBreakdown()
    if mentioned.students is not None:
        breakdown = breakdown.model_copy(update={"students": mentioned.students})
    if mentioned.accompanying is not None:
        breakdown = breakdown.model_copy(update={"accompanying": mentioned.accompanying})
    if mentioned.students is not None or mentioned.accompanying is not None:
        reqs.participants_breakdown = breakdown

    if explicit:
        return  # the explicit operation has already been applied

    total: int | None = None
    if mentioned.total_stated is not None:
        total = mentioned.total_stated
    elif breakdown.students is not None and breakdown.accompanying is not None:
        # Full headcount now known (in this message or completed by a previous message).
        if mentioned.students is not None or mentioned.accompanying is not None:
            total = breakdown.students + breakdown.accompanying
    elif mentioned.students is not None and breakdown.accompanying is None:
        if not any(a.kind == AmbiguityKind.STUDENTS_ONLY for a in result.ambiguities):
            result.ambiguities.append(
                Ambiguity(
                    field="participants_count",
                    kind=AmbiguityKind.STUDENTS_ONLY,
                    detail="students given without accompanying adults",
                )
            )
        return

    if total is None or total < 1:
        return
    if reqs.participants_count is None or correction or reqs.participants_count == total:
        if reqs.participants_count != total:
            result.changed_fields.append("participants_count")
        reqs.participants_count = total
    elif mentioned.total_stated is not None:
        result.conflicts.append("participants_count")
    else:
        # New breakdown that contradicts an already known total without an explicit correction.
        result.conflicts.append("participants_count")


def _drop_stale_breakdown(reqs: PartialRequirements) -> None:
    """The breakdown is detail for the planner: keep it only while it adds up to the total."""
    breakdown = reqs.participants_breakdown
    if breakdown is None or reqs.participants_count is None:
        return
    if breakdown.students is None or breakdown.accompanying is None:
        return  # partial detail (« dont 2 professeurs ») does not contradict a stated total
    if breakdown.students + breakdown.accompanying != reqs.participants_count:
        reqs.participants_breakdown = None


def _infer_return_date(reqs: PartialRequirements, result: MergeResult) -> None:
    """One-day trip: a return time without a date inherits the departure date (and vice versa)."""
    dep, ret = reqs.departure, reqs.return_
    if (
        ret is not None
        and ret.date is None
        and ret.time is not None
        and dep is not None
        and dep.date is not None
    ):
        reqs.return_ = ret.model_copy(update={"date": dep.date})
        if "return" not in result.changed_fields:
            result.changed_fields.append("return")
    if (
        dep is not None
        and dep.date is None
        and dep.time is not None
        and ret is not None
        and ret.date is not None
    ):
        reqs.departure = dep.model_copy(update={"date": ret.date})
        if "departure" not in result.changed_fields:
            result.changed_fields.append("departure")


def _apply_patch(current: PartialRequirements, patch: RequirementPatch) -> MergeResult:
    reqs = current.model_copy(deep=True)
    result = MergeResult(requirements=reqs, previous=current, ambiguities=list(patch.ambiguities))
    result.conflicts.extend(c.field for c in patch.conflicts)

    vague_count = _vague_participants(patch)
    if vague_count and not any(a.field == "participants_count" for a in result.ambiguities):
        result.ambiguities.append(
            Ambiguity(
                field="participants_count",
                kind=AmbiguityKind.VAGUE_QUANTITY,
                detail="approximate count in the quoted evidence",
            )
        )

    for op in patch.operations:
        if vague_count and op.field == "participants_count" and op.operation != "clear":
            continue  # an approximate count is never stored as an exact value
        correction = _is_correction(op, patch.user_intent)
        before = _get(reqs, op.field)

        if op.operation == "clear":
            _set(reqs, op.field, None)
            if op.field == "participants_count":
                reqs.participants_breakdown = None
        elif op.field == "participants_count":
            if not isinstance(op.value, int):
                continue
            if before is None or correction or before == op.value:
                _set(reqs, op.field, op.value)
            else:
                result.conflicts.append(op.field)
                continue
        elif op.field == "departure_station":
            station = _station(op.value) if isinstance(op.value, str) else None
            if station is None:
                continue
            if before is None or correction or _same_station(str(before), station):
                _set(reqs, op.field, station)
            else:
                result.conflicts.append(op.field)
                continue
        elif op.field in ("departure", "return"):
            if not isinstance(op.value, PartialDateTimePatch):
                continue
            if op.value.time is None:
                # The model sometimes drops the time of a bare answer (« Avant 17 h. »): read it back
                # from its own quote when that quote contains exactly one time expression.
                quoted = time_in_evidence(op.evidence)
                if quoted is not None:
                    op = op.model_copy(update={"value": op.value.model_copy(update={"time": quoted})})
            assert isinstance(op.value, PartialDateTimePatch)
            if op.value.date is None and op.value.time is None:
                continue  # a constraint alone carries no information: nothing to store
            assert before is None or isinstance(before, PartialDateTime)
            new_dt, conflict = _merge_datetime(before, op.value, correction)
            if conflict:
                result.conflicts.append(op.field)
                continue
            _set(reqs, op.field, new_dt)
        elif op.field == "teaching_type":
            if not isinstance(op.value, TeachingTypePatch):
                continue
            assert before is None or isinstance(before, TeachingType)
            _set(reqs, op.field, _merge_teaching(before, op.value, correction))

        if _get(reqs, op.field) != before and op.field not in result.changed_fields:
            result.changed_fields.append(op.field)

    if not vague_count:
        _apply_participants(reqs, patch, result)
    _drop_stale_breakdown(reqs)
    _infer_return_date(reqs, result)

    # De-duplicate while preserving order.
    result.conflicts = list(dict.fromkeys(result.conflicts))
    # A conflict cancels the corresponding change.
    result.changed_fields = [f for f in result.changed_fields if f not in result.conflicts]
    return result


def apply_patch(current: PartialRequirements, patch: RequirementPatch) -> MergeResult:
    """Merge, then re-validate the whole state: nothing invalid is ever stored."""
    try:
        result = _apply_patch(current, patch)
        result.requirements = PartialRequirements.model_validate(
            result.requirements.model_dump(mode="json", by_alias=True)
        )
    except ValidationError as exc:
        raise InvalidPatchError(str(exc.errors(include_input=False, include_url=False)[:1])) from exc
    return result
