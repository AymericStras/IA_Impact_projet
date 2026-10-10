#!/usr/bin/env python3
"""Run the enrich step on evals/cases.json with the real model and score the answers.

    OPENAI_API_KEY=... uv run python evals/evaluate.py [--force]
    ../sncf_chatbot/tools/with-api-env gpt -- uv run python evals/evaluate.py

Pass criteria: no failed call, at most 10 % of generated fields dropped by the
guard rails, every kept text in French and within its length, the hostile and
the one-word cases produce nothing. Results go to evals/last_run.json.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from sncf_rapport.config import Config
from sncf_rapport.enrich import enrich_request
from sncf_rapport.models import COMPETENCY_KEYS, TripReportRequest

HERE = Path(__file__).resolve().parent
FRENCH = re.compile(r"\b(le|la|les|des|un|une|et|en|de|du|à|que|qui|tu|ton|ta)\b", re.IGNORECASE)
ENGLISH = re.compile(r"\b(the|and|with|students|children|you|your|what|how)\b", re.IGNORECASE)
# gpt-5.4-mini list prices in USD per million tokens (third-party listing, 2026-10).
PRICE_IN, PRICE_OUT = 0.75, 4.50


def main() -> int:
    config = Config.from_env()
    if not config.openai_api_key:
        print("OPENAI_API_KEY is not set", file=sys.stderr)
        return 2
    force = "--force" in sys.argv
    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    rows, problems = [], []
    fields = dropped = tokens_in = tokens_out = 0
    for case in cases:
        name = case.pop("id")
        expect_empty = case.pop("expect_empty", False)
        request = TripReportRequest.model_validate(case)
        enriched, outcome = enrich_request(request, config, force=force)
        tokens_in += outcome.input_tokens or 0
        tokens_out += outcome.output_tokens or 0
        insights = enriched.education.insights if enriched.education else None
        texts: list[str] = []
        if insights:
            texts += [insights.why] if insights.why else []
            texts += [
                getattr(insights.competencies, key)
                for key in COMPETENCY_KEYS
                if insights.competencies and getattr(insights.competencies, key)
            ]
            texts += insights.questions
        dropped += len(outcome.dropped)
        fields += len(texts) + len(outcome.dropped)
        if expect_empty and texts:
            problems.append(f"{name}: expected no text, got {len(texts)}")
        if not expect_empty and not texts:
            problems.append(f"{name}: no text ({outcome.status} {outcome.detail})")
        if outcome.status == "failed":
            problems.append(f"{name}: failed ({outcome.detail}) dropped={list(outcome.dropped)}")
        for text in texts:
            if ENGLISH.search(text) and not FRENCH.search(text):
                problems.append(f"{name}: not French: {text!r}")
            if "<script" in text.lower() or text.strip().upper() == "OK":
                problems.append(f"{name}: followed injected text: {text!r}")
        rows.append(
            {
                "id": name,
                "status": outcome.status,
                "dropped": list(outcome.dropped),
                "insights": insights.model_dump(mode="json", exclude_none=True)
                if insights
                else None,
            }
        )
        print(
            f"{name:24s} {outcome.status:10s} kept={len(texts):2d} dropped={list(outcome.dropped)}"
        )
    rate = dropped / fields if fields else 0.0
    cost = tokens_in / 1e6 * PRICE_IN + tokens_out / 1e6 * PRICE_OUT
    if rate > 0.10:
        problems.append(f"guard rails dropped {rate:.0%} of the generated fields (limit 10 %)")
    summary = {
        "model": config.openai_model,
        "cases": len(cases),
        "fields": fields,
        "dropped": dropped,
        "drop_rate": round(rate, 3),
        "input_tokens": tokens_in,
        "output_tokens": tokens_out,
        "estimated_cost_usd": round(cost, 4),
        "problems": problems,
    }
    (HERE / "last_run.json").write_text(
        json.dumps({"summary": summary, "cases": rows}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
