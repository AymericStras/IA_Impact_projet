#!/usr/bin/env python3
"""Validate packages/contracts: every schema compiles (Draft 2020-12) and every example
validates against the schema its filename names (examples/<schema>[_<variant>].json).

Run: uv run --with jsonschema python scripts/validate_contracts.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:  # pragma: no cover
    sys.exit("jsonschema missing: run with `uv run --with jsonschema python scripts/validate_contracts.py`")

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / "packages" / "contracts"
EXAMPLES = CONTRACTS / "examples"

# Example filename prefix -> schema file
SCHEMA_FOR_PREFIX = {
    "confirmed_requirements": "requirements.schema.json",
    "conversation_response": "conversation_response.schema.json",
    "requirement_patch": "requirement_patch.schema.json",
    "plan_result": "plan_result.schema.json",
    "handoff": "handoff.schema.json",
}


def load(path: Path) -> dict:
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def main() -> int:
    errors: list[str] = []
    validators: dict[str, Draft202012Validator] = {}

    for schema_path in sorted(CONTRACTS.glob("*.schema.json")):
        schema = load(schema_path)
        try:
            Draft202012Validator.check_schema(schema)
        except Exception as exc:  # noqa: BLE001 - report any schema problem
            errors.append(f"{schema_path.name}: invalid schema: {exc}")
            continue
        validators[schema_path.name] = Draft202012Validator(schema, format_checker=FormatChecker())
        print(f"ok  schema   {schema_path.name}")

    covered: set[str] = set()
    for example_path in sorted(EXAMPLES.glob("*.json")):
        prefix = next((p for p in SCHEMA_FOR_PREFIX if example_path.stem.startswith(p)), None)
        if prefix is None:
            errors.append(f"{example_path.name}: no schema mapping (add to SCHEMA_FOR_PREFIX)")
            continue
        validator = validators.get(SCHEMA_FOR_PREFIX[prefix])
        if validator is None:
            continue
        problems = sorted(validator.iter_errors(load(example_path)), key=lambda e: list(e.path))
        if problems:
            for problem in problems:
                loc = "/".join(str(p) for p in problem.path) or "<root>"
                errors.append(f"{example_path.name} @ {loc}: {problem.message}")
        else:
            covered.add(SCHEMA_FOR_PREFIX[prefix])
            print(f"ok  example  {example_path.name} → {SCHEMA_FOR_PREFIX[prefix]}")

    for name in validators:
        if name not in covered:
            errors.append(f"{name}: no valid example in examples/")

    if errors:
        print("\n".join(f"ERR {e}" for e in errors), file=sys.stderr)
        return 1
    print(f"contracts valid: {len(validators)} schemas, {len(list(EXAMPLES.glob('*.json')))} examples")
    return 0


if __name__ == "__main__":
    sys.exit(main())
