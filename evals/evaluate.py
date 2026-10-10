#!/usr/bin/env python3
"""Evaluate the French extraction pipeline on evals/french_cases.jsonl.

Usage:
  python evals/evaluate.py --list                       # no API, no services/api needed
  ./tools/with-api-env gpt -- python evals/evaluate.py [--model M] [--tag T] [--id ID]

Scoring uses the real extraction adapter and the deterministic merge/validate from
services/api (P1). Until that exists, only --list works and the script exits with code 2.
Results are written to evals/results/<timestamp>.json (git-ignored).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
CASES = ROOT / "evals" / "french_cases.jsonl"
RESULTS = ROOT / "evals" / "results"
API_SRC = ROOT / "services" / "api"

BLOCKING_METRICS = ("unsupported_fills", "false_confirmations", "dropped_fields")


def load_cases(tag: str | None, case_id: str | None) -> list[dict[str, Any]]:
    cases = [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]
    if tag:
        cases = [c for c in cases if tag in c.get("tags", [])]
    if case_id:
        cases = [c for c in cases if c["id"] == case_id]
    return cases


def subset(expected: Any, actual: Any) -> bool:
    """True when every key/value in `expected` is present in `actual` (recursive for dicts)."""
    if isinstance(expected, dict):
        return isinstance(actual, dict) and all(k in actual and subset(v, actual[k]) for k, v in expected.items())
    if isinstance(expected, list):
        return isinstance(actual, list) and sorted(map(json.dumps, expected)) == sorted(map(json.dumps, actual))
    return expected == actual


def check_patch(expect: dict[str, Any], patch: dict[str, Any]) -> list[str]:
    failures: list[str] = []
    ops = patch.get("operations", [])
    for want in expect.get("operations", []):
        hit = any(
            o["field"] == want["field"]
            and o["operation"] == want["operation"]
            and ("value" not in want or subset(want["value"], o["value"]))
            for o in ops
        )
        if not hit:
            failures.append(f"missing operation {want}")
    for field in expect.get("no_operations_on", []):
        if any(o["field"] == field for o in ops):
            failures.append(f"unexpected operation on {field}")
    if "participants_mentioned" in expect and not subset(expect["participants_mentioned"], patch.get("participants_mentioned", {})):
        failures.append(f"participants_mentioned {patch.get('participants_mentioned')} != {expect['participants_mentioned']}")
    kinds = [a["kind"] for a in patch.get("ambiguities", [])]
    for kind in expect.get("ambiguity_kinds", []):
        if kind not in kinds:
            failures.append(f"missing ambiguity {kind}")
    if "ambiguity_kinds" in expect and expect["ambiguity_kinds"] == [] and kinds:
        failures.append(f"unexpected ambiguities {kinds}")
    conflict_fields = [c["field"] for c in patch.get("conflicts", [])]
    for field in expect.get("conflicts_on", []):
        if field not in conflict_fields:
            failures.append(f"missing conflict on {field}")
    if "user_intent" in expect and patch.get("user_intent") != expect["user_intent"]:
        failures.append(f"user_intent {patch.get('user_intent')} != {expect['user_intent']}")
    for op in ops:
        if not op.get("evidence"):
            failures.append(f"UNSUPPORTED_FILL: operation on {op['field']} without evidence")
    return failures


def check_merged(expect: dict[str, Any], merged: dict[str, Any], missing: list[str]) -> list[str]:
    failures: list[str] = []
    if "merged" in expect and not subset(expect["merged"], merged):
        failures.append(f"merged state mismatch: want ⊆ {expect['merged']}, got {merged}")
    if "missing_fields" in expect and sorted(missing) != sorted(expect["missing_fields"]):
        failures.append(f"missing_fields {missing} != {expect['missing_fields']}")
    return failures


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--list", action="store_true", help="print cases and exit")
    parser.add_argument("--model", default=None, help="override EXTRACTION_MODEL")
    parser.add_argument("--tag", default=None)
    parser.add_argument("--id", dest="case_id", default=None)
    args = parser.parse_args()

    cases = load_cases(args.tag, args.case_id)
    if args.list:
        for c in cases:
            kind = f"{len(c['turns'])} turns" if "turns" in c else "single"
            print(f"{c['id']:<36} {kind:<9} {','.join(c.get('tags', []))}")
        print(f"{len(cases)} cases")
        return 0

    sys.path.insert(0, str(API_SRC))
    try:
        from app.evals_bridge import run_turn  # type: ignore[import-not-found]  # provided by P1
    except ImportError:
        print(
            "services/api is not implemented yet (P1). evaluate.py needs app/evals_bridge.py exposing\n"
            "  run_turn(state: dict, message: str, today: str, model: str | None, history: list[dict]) -> dict\n"
            "returning {'patch': RequirementPatch, 'merged': PartialRequirements, 'missing_fields': [...]}.",
            file=sys.stderr,
        )
        return 2

    results: list[dict[str, Any]] = []
    totals = {"cases": 0, "passed": 0, **{m: 0 for m in BLOCKING_METRICS}}
    started = time.time()
    for case in cases:
        turns = case.get("turns") or [{"message": case["message"], "expect": case.get("expect", {})}]
        state = dict(case.get("state", {}))
        history: list[dict[str, str]] = list(case.get("history", []))
        failures: list[str] = []
        for i, turn in enumerate(turns):
            out = run_turn(state, turn["message"], case.get("today", "2026-10-10"), args.model, history)
            patch, merged, missing = out["patch"], out["merged"], out["missing_fields"]
            turn_failures = check_patch(turn.get("expect", {}), patch) + check_merged(turn.get("expect", {}), merged, missing)
            failures += [f"turn {i + 1}: {f}" for f in turn_failures]
            if any(f.startswith("UNSUPPORTED_FILL") for f in turn_failures):
                totals["unsupported_fills"] += 1
            if patch.get("user_intent") == "confirm" and turn.get("expect", {}).get("user_intent") not in (None, "confirm"):
                totals["false_confirmations"] += 1
            for field, old in state.items():
                if old not in (None, {}) and field in merged and merged[field] is None and not any(
                    o["field"] == field and o["operation"] == "clear" for o in patch.get("operations", [])
                ):
                    totals["dropped_fields"] += 1
                    failures.append(f"turn {i + 1}: DROPPED_FIELD {field}")
            if "state" in turn.get("expect", {}) and out.get("state") != turn["expect"]["state"]:
                failures.append(f"turn {i + 1}: state {out.get('state')} != {turn['expect']['state']}")
            history += [{"role": "user", "content": turn["message"]}]
            if out.get("assistant_message"):
                history += [{"role": "assistant", "content": out["assistant_message"]}]
            state = merged
        totals["cases"] += 1
        totals["passed"] += not failures
        results.append({"id": case["id"], "ok": not failures, "failures": failures})
        print(("PASS " if not failures else "FAIL ") + case["id"] + ("" if not failures else "\n   " + "\n   ".join(failures)))

    RESULTS.mkdir(exist_ok=True)
    out_path = RESULTS / f"{datetime.now().strftime('%Y%m%d-%H%M%S')}.json"
    out_path.write_text(json.dumps({"model": args.model, "totals": totals, "results": results}, ensure_ascii=False, indent=2))
    accuracy = totals["passed"] / totals["cases"] if totals["cases"] else 0.0
    print(f"\n{totals['passed']}/{totals['cases']} cases passed ({accuracy:.0%}) in {time.time() - started:.1f}s → {out_path.relative_to(ROOT)}")
    blocking = {m: totals[m] for m in BLOCKING_METRICS if totals[m]}
    if blocking:
        print(f"BLOCKING: {blocking}", file=sys.stderr)
        return 1
    return 0 if accuracy >= 0.95 else 1


if __name__ == "__main__":
    sys.exit(main())
