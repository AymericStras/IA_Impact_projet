#!/usr/bin/env python3
"""Render N random hostile requests to PDF and report failures and timings.

uv run python scripts/stress.py [N=200] [--start SEED] [--keep-failures DIR]
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from fuzzgen import make_request  # noqa: E402
from pypdf import PdfReader  # noqa: E402

from sncf_rapport.config import REPO_ROOT  # noqa: E402
from sncf_rapport.models import TripReportRequest  # noqa: E402
from sncf_rapport.pdf import render_pdf  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("count", type=int, nargs="?", default=200)
    parser.add_argument("--start", type=int, default=1000)
    parser.add_argument("--keep-failures", type=Path, default=REPO_ROOT / "var" / "stress")
    args = parser.parse_args()
    failures, slowest, pages_max, total = [], (0.0, -1), 0, 0.0
    for seed in range(args.start, args.start + args.count):
        data = make_request(seed)
        started = time.perf_counter()
        try:
            pdf = render_pdf(TripReportRequest.model_validate(data))
            pages = len(PdfReader(io.BytesIO(pdf)).pages)
            if not pdf.startswith(b"%PDF") or pages < 1:
                raise RuntimeError("output is not a PDF")
            pages_max = max(pages_max, pages)
        except Exception:  # noqa: BLE001 - the whole point is to see every failure
            failures.append(seed)
            args.keep_failures.mkdir(parents=True, exist_ok=True)
            (args.keep_failures / f"seed-{seed}.json").write_text(
                json.dumps(data, ensure_ascii=True, indent=1), encoding="utf-8"
            )
            (args.keep_failures / f"seed-{seed}.txt").write_text(
                traceback.format_exc(), encoding="utf-8"
            )
        elapsed = time.perf_counter() - started
        total += elapsed
        slowest = max(slowest, (elapsed, seed))
    print(
        f"{args.count} requests, {len(failures)} failure(s), "
        f"mean {total / max(args.count, 1):.2f} s, slowest {slowest[0]:.2f} s (seed {slowest[1]}), "
        f"longest report {pages_max} page(s)"
    )
    if failures:
        print(f"failing seeds: {failures} (inputs and tracebacks in {args.keep_failures})")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
