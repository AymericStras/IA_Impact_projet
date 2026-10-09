"""Fusion déterministe d'un RequirementPatch dans l'état courant.

Le modèle propose ; ce module décide. Règles principales (AGENTS.md §3) :
- `set` sur un champ déjà connu et différent → conflit (sauf intention de correction) ;
- `replace` ou intention `correct_information` → remplacement explicite ;
- le total de participants est calculé par le code à partir des effectifs mentionnés ;
- une date de retour absente est déduite de la date de départ (sortie à la journée) ;
- aucun champ non mentionné n'est modifié.
"""

from __future__ import annotations

from dataclasses import dataclass, field

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


@dataclass
class MergeResult:
    requirements: PartialRequirements
    previous: PartialRequirements
    changed_fields: list[FieldName] = field(default_factory=list)
    conflicts: list[FieldName] = field(default_factory=list)
    ambiguities: list[Ambiguity] = field(default_factory=list)


def _is_correction(op: Operation, intent: UserIntent) -> bool:
    return op.operation == "replace" or intent == UserIntent.CORRECT_INFORMATION


def _get(reqs: PartialRequirements, name: FieldName) -> object:
    return getattr(reqs, "return_" if name == "return" else name)


def _set(reqs: PartialRequirements, name: FieldName, value: object) -> None:
    setattr(reqs, "return_" if name == "return" else name, value)


def _merge_datetime(
    current: PartialDateTime | None, incoming: PartialDateTimePatch, correction: bool
) -> tuple[PartialDateTime | None, bool]:
    """Renvoie (nouvelle valeur, conflit)."""
    new = PartialDateTime(
        date=incoming.date,  # chaîne ISO validée par Pydantic
        time=incoming.time,
        constraint=incoming.constraint,
    )
    if current is None:
        return new, False
    if correction:
        # Correction : les parties fournies remplacent, les autres sont conservées.
        return (
            PartialDateTime(
                date=new.date if new.date is not None else current.date,
                time=new.time if new.time is not None else current.time,
                constraint=new.constraint if new.constraint is not None else current.constraint,
            ),
            False,
        )
    # Complétion : on ne remplit que les parties encore inconnues ; une valeur différente est un conflit.
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


def _merge_teaching(
    current: TeachingType | None, incoming: TeachingTypePatch, correction: bool
) -> TeachingType:
    new = TeachingType(subject=incoming.subject, theme=incoming.theme)
    if current is None or correction:
        if correction and current is not None:
            return TeachingType(subject=new.subject or current.subject, theme=new.theme or current.theme)
        return new
    # Ajouter un thème à une matière (ou l'inverse) n'est pas un conflit : on complète.
    return TeachingType(subject=current.subject or new.subject, theme=current.theme or new.theme)


def _apply_participants(reqs: PartialRequirements, patch: RequirementPatch, result: MergeResult) -> None:
    """Calcule le total à partir des effectifs mentionnés (le modèle ne fait pas d'addition)."""
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
        return  # l'opération explicite a déjà été appliquée

    total: int | None = None
    if mentioned.total_stated is not None:
        total = mentioned.total_stated
    elif breakdown.students is not None and breakdown.accompanying is not None:
        # Effectif complet désormais connu (dans ce message ou complété par un message précédent).
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
        # Nouvelle décomposition qui contredit un total déjà connu sans correction explicite.
        result.conflicts.append("participants_count")


def _infer_return_date(reqs: PartialRequirements, result: MergeResult) -> None:
    """Sortie à la journée : une heure de retour sans date hérite de la date de départ (et inversement)."""
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


def apply_patch(current: PartialRequirements, patch: RequirementPatch) -> MergeResult:
    reqs = current.model_copy(deep=True)
    result = MergeResult(requirements=reqs, previous=current, ambiguities=list(patch.ambiguities))
    result.conflicts.extend(c.field for c in patch.conflicts)

    for op in patch.operations:
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
        elif op.field in ("departure", "return"):
            if not isinstance(op.value, PartialDateTimePatch):
                continue
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

    _apply_participants(reqs, patch, result)
    _infer_return_date(reqs, result)

    # Dédoublonnage en conservant l'ordre.
    result.conflicts = list(dict.fromkeys(result.conflicts))
    # Un conflit annule le changement correspondant.
    result.changed_fields = [f for f in result.changed_fields if f not in result.conflicts]
    return result
