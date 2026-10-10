"""Evidence check: an operation must quote the teacher's message (typography-insensitive)."""

from __future__ import annotations

import pytest

from app.services.extraction import evidence_supported

MESSAGE = "Bonjour, j’ai 27 élèves et 3 accompagnateurs. On partirait vers 8 h le 12 novembre."


@pytest.mark.parametrize(
    "evidence",
    [
        "27 élèves et 3 accompagnateurs",
        "j'ai 27 élèves",  # straight apostrophe vs the transcript's curly one
        "« vers 8 h »",  # quotation marks added by the model, non-breaking space in the message
        "27 ÉLÈVES",  # case
        "27 élèves … vers 8 h",  # two real fragments joined by an ellipsis
        "le 12 novembre.",
    ],
)
def test_real_quotes_are_accepted(evidence: str) -> None:
    assert evidence_supported(evidence, MESSAGE)


@pytest.mark.parametrize(
    "evidence",
    [
        "",
        "…",
        "30 participants",
        "27 élèves et 4 accompagnateurs",
        "27 élèves … 500 personnes",
        "départ à 8 h",
    ],
)
def test_invented_or_paraphrased_evidence_is_rejected(evidence: str) -> None:
    assert not evidence_supported(evidence, MESSAGE)
