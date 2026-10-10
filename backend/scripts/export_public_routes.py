"""Build a reproducible static demo from the team's unchanged Python routing engine.

Run from any directory: python backend/scripts/export_public_routes.py
Generated files are ignored in Git; regenerate before a public snapshot build.
"""
import gzip
import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
from app.routing import Network, SamePlace  # noqa: E402


def export(output=None):
    dataset = BACKEND / "data" / "train_lio"
    out = Path(output) if output else BACKEND.parent / "frontend" / "public" / "demo-routes"
    out.mkdir(parents=True, exist_ok=True)
    net = Network(dataset)
    # Equivalent town/station queries share a row, preserving city access costs.
    signatures, queries, aliases = {}, [], {}
    for key in sorted(net.by_key):
        signature = tuple(sorted(net.resolve(key).items()))
        if signature not in signatures:
            signatures[signature] = len(queries)
            queries.append(key)
        aliases[key] = signatures[signature]
    info = json.loads((dataset / "build_info.json").read_text(encoding="utf-8"))
    metadata = {"schema": 1, "aliases": aliases, "places": net.places(), "edges": net.edges(),
                "info": info, "modes": net.modes(), "transfer_margins": [5, 15]}
    (out / "index.json").write_text(json.dumps(metadata, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    for margin in (5, 15):
        folder = out / str(margin)
        folder.mkdir(exist_ok=True)
        for index, origin in enumerate(queries):
            row = []
            for destination in queries:
                try:
                    row.append(net.route(origin, destination, transfer_min=margin))
                except SamePlace:
                    row.append({"error": "same_place"})
            payload = json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()
            # .bin avoids automatic Content-Encoding on static hosts; client explicitly decompresses.
            (folder / f"{index}.bin").write_bytes(gzip.compress(payload, mtime=0))
            if index % 50 == 0:
                print(f"Transfer {margin}: {index}/{len(queries)}", flush=True)
    print(f"Export complete: {len(queries)} distinct queries, {len(net.place)} stations; {out}", flush=True)


if __name__ == "__main__":
    export(sys.argv[1] if len(sys.argv) > 1 else None)
