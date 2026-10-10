from __future__ import annotations

import json
from pathlib import Path

import pytest

from sncf_bilan.config import Config
from sncf_bilan.models import RecapRequest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLES = ROOT / "contracts" / "examples"


def example_data(name: str) -> dict:
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def example(name: str, **trip_overrides) -> RecapRequest:
    data = example_data(name)
    data["trip"].update(trip_overrides)
    return RecapRequest.model_validate(data)


@pytest.fixture
def config(tmp_path: Path) -> Config:
    return Config(data_dir=tmp_path, api_key="test-key", reply_to="contact@example.fr")
