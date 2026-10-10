#!/usr/bin/env python3
"""Add education.insights to a request with the language model; result on stdout.

    OPENAI_API_KEY=... uv run python scripts/enrich.py REQUEST.json [--force] > enriched.json

On the owner's Mac the key comes from the Keychain:
    ../sncf_chatbot/tools/with-api-env gpt -- uv run python scripts/enrich.py REQUEST.json
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from sncf_rapport.config import Config
from sncf_rapport.enrich import enrich_request
from sncf_rapport.models import TripReportRequest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("request", type=Path)
    parser.add_argument("--force", action="store_true", help="ignore existing insights and cache")
    args = parser.parse_args()
    request = TripReportRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
    enriched, outcome = enrich_request(request, Config.from_env(), force=args.force)
    print(
        f"insights: {outcome.status} {outcome.detail} model={outcome.model} "
        f"tokens={outcome.input_tokens}/{outcome.output_tokens} dropped={list(outcome.dropped)}",
        file=sys.stderr,
    )
    print(
        json.dumps(
            enriched.model_dump(mode="json", by_alias=True, exclude_none=True),
            ensure_ascii=False,
            indent=2,
        )
    )
    return 0 if outcome.status != "failed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
