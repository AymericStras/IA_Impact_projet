#!/usr/bin/env python3
"""Exporte les JSON Schema de `packages/contracts` depuis les modèles Pydantic (source de vérité).

  cd services/api && uv run python ../../scripts/export_schemas.py          # écrit les fichiers
  cd services/api && uv run python ../../scripts/export_schemas.py --check  # échoue en cas de dérive
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
        "Charge utile transmise au module de planification après confirmation explicite (schema_version 1.0).",
    ),
    "conversation_response.schema.json": (
        ConversationResponse,
        "serialization",
        "Réponse de tous les endpoints de conversation ; le client l'affiche sans recalculer.",
    ),
    "requirement_patch.schema.json": (
        RequirementPatch,
        "validation",
        "Sortie structurée du modèle d'extraction pour un message ; validée et fusionnée par le backend.",
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


def main() -> int:
    check = "--check" in sys.argv
    drift = False
    for filename, (model, mode, description) in EXPORTS.items():
        path = CONTRACTS / filename
        content = json.dumps(build(model, mode, description, filename), ensure_ascii=False, indent=2) + "\n"
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                print(f"DERIVE {filename}: régénérez avec scripts/export_schemas.py", file=sys.stderr)
                drift = True
            else:
                print(f"ok  {filename}")
        else:
            path.write_text(content, encoding="utf-8")
            print(f"écrit {path.relative_to(ROOT)}")
    return 1 if drift else 0


if __name__ == "__main__":
    sys.exit(main())
