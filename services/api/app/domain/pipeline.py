"""Processing of one turn without I/O: merge → validation → decision → message.

Used by the conversation service (with a database) and by `evals_bridge` (without).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.domain import dialogue
from app.domain.patch_merger import MergeResult, apply_patch
from app.domain.state_machine import Action, ActionKind, Decision, decide
from app.domain.validators import IssueKind, ValidationResult, is_field_complete, validate
from app.schemas.conversation import ConversationState as State
from app.schemas.patch import FieldName, RequirementPatch
from app.schemas.requirements import PartialRequirements

_ANNOUNCE_REPLACEMENT_BEFORE = (ActionKind.ASK_MISSING, ActionKind.CLARIFY, ActionKind.SUMMARIZE_AND_CONFIRM)


@dataclass
class TurnResult:
    patch: RequirementPatch
    merge: MergeResult
    validation: ValidationResult
    decision: Decision
    assistant_message: str

    @property
    def requirements(self) -> PartialRequirements:
        return self.merge.requirements

    @property
    def changed(self) -> bool:
        return self.merge.requirements != self.merge.previous


def _revert_inconsistent_dates(merge: MergeResult, validation: ValidationResult) -> ValidationResult:
    """Return before departure: roll back the value introduced this turn rather than keep an inconsistent state."""
    if not any(i.kind == IssueKind.RETURN_BEFORE_DEPARTURE for i in validation.issues):
        return validation
    reqs, prev = merge.requirements, merge.previous
    changed: list[FieldName] = merge.changed_fields
    if "return" in changed or "departure" not in changed:
        reqs.return_ = prev.return_
        merge.changed_fields = [f for f in changed if f != "return"]
    else:
        reqs.departure = prev.departure
        merge.changed_fields = [f for f in changed if f != "departure"]
    return validation


def process_turn(
    previous_state: State,
    requirements: PartialRequirements,
    patch: RequirementPatch,
    today: date,
) -> TurnResult:
    merge = apply_patch(requirements, patch)
    validation = validate(merge.requirements, today)

    issues = list(validation.issues)
    invalid_params: dict[str, str] = {}
    if any(i.kind == IssueKind.RETURN_BEFORE_DEPARTURE for i in issues):
        invalid_params["return"] = dialogue.describe_datetime(merge.requirements.return_)
        _revert_inconsistent_dates(merge, validation)
        validation = validate(merge.requirements, today)
        validation.issues = [i for i in validation.issues if i.kind != IssueKind.RETURN_BEFORE_DEPARTURE]

    decision = decide(
        previous_state,
        intent=patch.user_intent,
        changed_fields=merge.changed_fields,
        conflicts=merge.conflicts,
        issues=issues,
        ambiguities=merge.ambiguities,
        missing=validation.missing_fields,
    )
    if decision.action.kind == ActionKind.INVALID:
        decision.action.params.update(invalid_params)
    if decision.action.kind == ActionKind.CONFLICT and decision.action.field is not None:
        decision.action.params["old"] = dialogue.describe_field(merge.previous, decision.action.field)

    message = dialogue.render(decision.action, merge.requirements)
    if decision.action.kind in _ANNOUNCE_REPLACEMENT_BEFORE:
        # A known value was overwritten this turn: say so, whether or not the model flagged a correction.
        replaced = [
            name
            for name in merge.changed_fields
            if is_field_complete(merge.previous, name) and is_field_complete(merge.requirements, name)
        ]
        if replaced:
            message = (
                dialogue.acknowledge_replacements(merge.previous, merge.requirements, replaced) + message
            )
    return TurnResult(
        patch=patch, merge=merge, validation=validation, decision=decision, assistant_message=message
    )


def welcome_action() -> Action:
    return Action(ActionKind.WELCOME)
