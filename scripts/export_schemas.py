#!/usr/bin/env python3
"""Exports the JSON Schemas of `packages/contracts` from the Pydantic models (source of truth).

  cd services/api && uv run python ../../scripts/export_schemas.py          # writes the files
  cd services/api && uv run python ../../scripts/export_schemas.py --check  # fails on drift
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "api"))

from app.schemas import ConfirmedRequirements, ConversationResponse, RequirementPatch  # noqa: E402

CONTRACTS = ROOT / "packages" / "contracts"
BASE_ID = "https://sncf-lio-chatbot/contracts/"

EXPORTS: dict[str, tuple[type, str, str]] = {
    "requirements.schema.json": (
        ConfirmedRequirements,
        "serialization",
        "Payload handed to the planning module after explicit confirmation (schema_version 1.0).",
    ),
    "conversation_response.schema.json": (
        ConversationResponse,
        "serialization",
        "Response of all conversation endpoints; the client renders it without recomputing.",
    ),
    "requirement_patch.schema.json": (
        RequirementPatch,
        "validation",
        "Structured output of the extraction model for one message; validated and merged by the backend.",
    ),
}


def build(model: type, mode: str, description: str, filename: str) -> dict[str, Any]:
    schema: dict[str, Any] = model.model_json_schema(mode=mode)  # type: ignore[attr-defined]
    ordered: dict[str, Any] = {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": BASE_ID + filename,
        "description": description,
    }
    ordered.update(schema)
    return ordered


def openapi_document() -> dict[str, Any]:
    """HTTP contract snapshot: lets the web app generate types and CI detect API drift offline."""
    from app.core.config import Settings
    from app.main import create_app

    app = create_app(Settings(_env_file=None, database_url="sqlite:///:memory:"))
    return app.openapi()


def main() -> int:
    check = "--check" in sys.argv
    drift = False
    documents = {
        filename: build(model, mode, description, filename)
        for filename, (model, mode, description) in EXPORTS.items()
    }
    documents["openapi.json"] = openapi_document()
    for filename, document in documents.items():
        path = CONTRACTS / filename
        content = json.dumps(document, ensure_ascii=False, indent=2) + "\n"
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                print(f"DRIFT {filename}: regenerate with scripts/export_schemas.py", file=sys.stderr)
                drift = True
            else:
                print(f"ok  {filename}")
        else:
            path.write_text(content, encoding="utf-8")
            print(f"wrote {path.relative_to(ROOT)}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
