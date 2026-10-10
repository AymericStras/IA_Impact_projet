"""Seeded generator of hostile but schema-valid report requests.

Used by tests/test_robustness.py and scripts/stress.py. The point is not to be
realistic: it is to hit every "what if the upstream sends this" case at once.
"""

from __future__ import annotations

import base64
import random
import struct
import zlib
from typing import Any

STATIONS = [
    "Toulouse Matabiau", "Carcassonne", "Montpellier Saint-Roch", "Nîmes", "Perpignan",
    "Narbonne", "Albi Ville", "Tarbes", "Rodez", "Mende", "Cahors", "Foix", "Sète", "Béziers",
    "toulouse", "MONTPELLIER", "Gare de Narbonne", "Paris Gare de Lyon", "Bordeaux Saint-Jean",
    "Villefranche", "Saint", "Zzyzx", "", " ", "A", "Latour-de-Carol - Enveitg",
]  # fmt: skip
WORDS = [
    "visite", "atelier", "château", "musée", "élèves", "remparts", "découverte", "œuvre",
    "l'Occitanie", "aujourd'hui", "«", "»", "—", "CO₂", "n°", "1er", "&", "<b>", "</div>",
    "<script>alert(1)</script>", "{{ 7*7 }}", "{% raw %}", "%s", "\\", '"', "'", "日本語",
    "العربية", "🚆", "👩‍🏫", "é", " ", "​", "ſ", "İ", "ß",
]  # fmt: skip
NASTY = [
    "", " ", "\n\n\n", "\t", "\x00", "\x1b[31mred", "a‮b", "\ud83d", "￿",
    "x" * 5000, "Supercalifragilisticexpialidocious" * 30, ("mot " * 2000),
    "https://example.org/" + "a" * 900, "-" * 400, "ﷺ" * 200, "<" * 300, "&amp;" * 100,
]  # fmt: skip
MEDIA_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif", "text/html", "", None]


def png(width: int = 8, height: int = 6, rgb: tuple[int, int, int] = (15, 33, 73)) -> bytes:
    """A valid PNG without any imaging library."""

    def chunk(kind: bytes, data: bytes) -> bytes:
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    row = b"\x00" + bytes(rgb) * width
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


class Fuzzer:
    def __init__(self, seed: int) -> None:
        self.r = random.Random(seed)  # noqa: S311 - test data, not security

    # -- primitives ---------------------------------------------------------
    def maybe(self, value: Any, p_missing: float = 0.25) -> Any:
        return None if self.r.random() < p_missing else value

    def text(self, words: int = 6) -> Any:
        roll = self.r.random()
        if roll < 0.12:
            return self.r.choice(NASTY)
        if roll < 0.16:
            return None
        count = self.r.choice([1, 2, words, words * 4, words * 30])
        return " ".join(self.r.choice(WORDS) for _ in range(count))

    def moment(self) -> Any:
        roll = self.r.random()
        if roll < 0.1:
            return None
        year = self.r.choice([2026, 2026, 2026, 1970, 1, 9999, 2027])
        month, day = self.r.randint(1, 12), self.r.randint(1, 28)
        hour, minute = self.r.randint(0, 23), self.r.randint(0, 59)
        zone = self.r.choice(["+01:00", "+02:00", "Z", "", "-11:00", "+14:00"])
        return f"{year:04d}-{month:02d}-{day:02d}T{hour:02d}:{minute:02d}:00{zone}"

    def day(self) -> Any:
        if self.r.random() < 0.15:
            return None
        year = self.r.choice([2026, 2026, 1, 9999, 2000])
        return f"{year:04d}-{self.r.randint(1, 12):02d}-{self.r.randint(1, 28):02d}"

    def count(self, top: int) -> Any:
        return self.r.choice([None, 0, 1, 2, 26, 30, 31, top])

    def station(self) -> Any:
        return self.r.choice(STATIONS) if self.r.random() < 0.9 else self.text(2)

    # -- blocks -------------------------------------------------------------
    def participants(self) -> Any:
        return self.maybe(
            {
                "total": self.count(2000),
                "students": self.count(2000),
                "accompanying": self.count(500),
            }
        )

    def leg(self) -> Any:
        return self.maybe(
            {
                "line": self.text(5),
                "train_number": self.maybe(str(self.r.randint(1, 999999))),
                "from_station": self.station(),
                "to_station": self.station(),
                "departure": self.moment(),
                "arrival": self.moment(),
            }
        )

    def place(self) -> dict[str, Any]:
        return {
            "title": self.text(3),
            "note": self.text(10),
            "entity_id": self.maybe("id-" + str(self.r.randint(0, 99))),
            "official_url": self.maybe(self.r.choice(["https://exemple.fr/lieu", self.text(1)])),
            "latitude": self.maybe(self.r.choice([43.21, -90, 90, 0, 44.0, 48.85])),
            "longitude": self.maybe(self.r.choice([2.35, -180, 180, 0, 3.2])),
            "license": self.text(3),
            "attribution": self.text(4),
            "walk_minutes": self.maybe(self.r.choice([0, 5, 22, 600])),
        }

    def activity(self, index: int) -> dict[str, Any]:
        return {
            "id": self.r.choice([f"act-{index}", f"act-{index}", None, "dup", ""]),
            "title": self.text(4),
            "description": self.text(15),
            "start": self.moment(),
            "end": self.moment(),
        }

    def competency(self) -> dict[str, Any]:
        return {
            "status": self.r.choice(["acquis", "partiel", "non_evalue"]),
            "comment": self.text(12),
        }

    def photo(self) -> dict[str, Any]:
        roll = self.r.random()
        if roll < 0.5:
            size = self.r.choice([(8, 6), (1, 1), (400, 3), (3, 400), (64, 64)])
            data: Any = base64.b64encode(png(*size)).decode()
        elif roll < 0.65:
            data = "not base64 !!"
        elif roll < 0.8:
            data = base64.b64encode(b"GIF89a not an image at all").decode()
        else:
            data = None
        return {
            "data_base64": data,
            "path": self.maybe(self.r.choice(["/nonexistent/p.png", "/etc/hosts", ""]), 0.7),
            "media_type": self.r.choice(MEDIA_TYPES),
            "caption": self.text(8),
            "taken_at": self.moment(),
            "consent": self.r.random() < 0.7,
            "kind": self.r.choice(["trip", "trip", "documentary"]),
        }

    def request(self) -> dict[str, Any]:
        r = self.r
        n_activities = r.choice([0, 0, 1, 2, 3, 8, 30, 80])
        activities = [self.activity(i + 1) for i in range(n_activities)]
        ids = [a["id"] for a in activities if a["id"]]
        data: dict[str, Any] = {
            "schema_version": "1.0",
            "school": self.maybe(
                {
                    "name": self.text(4),
                    "class_name": self.text(2),
                    "teacher_name": self.text(2),
                    "city": self.text(1),
                }
            ),
            "trip": self.maybe(
                {
                    "reference": self.text(1),
                    "title": self.text(6),
                    "date": self.day(),
                    "return_date": self.day(),
                    "origin_station": self.station(),
                    "destination_station": self.station(),
                    "destination_city": self.text(1),
                    "outbound": self.leg(),
                    "return": self.leg(),
                    "planned_participants": self.participants(),
                    "simulated": r.random() < 0.5,
                }
            ),
            "education": self.maybe(
                {
                    "subject": self.text(2),
                    "theme": self.text(3),
                    "objectives": [self.text(8) for _ in range(r.choice([0, 1, 3, 12, 40]))],
                    "places": [self.place() for _ in range(r.choice([0, 1, 2, 6, 20, 50]))],
                    "activities": activities,
                    "insights": self.maybe(
                        {
                            "why": self.text(30),
                            "competencies": self.maybe(
                                {
                                    key: self.text(15)
                                    for key in ("savoir", "savoir_faire", "savoir_etre")
                                }
                            ),
                            "questions": [self.text(8) for _ in range(r.choice([0, 3, 9]))],
                            "origin": r.choice(["ai", "teacher"]),
                            "model": self.text(1),
                            "generated_at": self.moment(),
                            "reviewed_by_teacher": r.random() < 0.5,
                        },
                        0.5,
                    ),
                }
            ),
            "teacher_feedback": self.maybe(
                {
                    "trip_completed": r.choice(["completed", "partial", "cancelled", None]),
                    "actual_participants": self.participants(),
                    "activities_completed": r.choice(["all", "partial", "none", None]),
                    "completed_activity_ids": r.sample(ids, k=r.randint(0, len(ids)))
                    + r.choice([[], ["ghost"], ["dup", "dup"]]),
                    "changes": self.text(20),
                    "competencies": self.maybe(
                        {
                            key: self.competency()
                            for key in (
                                "savoir",
                                "savoir_faire",
                                "savoir_se_deplacer",
                                "savoir_s_orienter",
                                "savoir_etre",
                            )
                            if r.random() < 0.8
                        }
                    ),
                    "observations": self.text(40),
                    "validated_at": self.moment(),
                }
            ),
            "environment": self.maybe(
                {
                    "baselines": r.choice(
                        [["autocar", "voiture"], ["autocar"], ["voiture"], [], ["voiture"] * 9]
                    ),
                    "distance_km_override": r.choice([None, None, 0, 0.01, 91, 257.5, 5000]),
                    "car_occupancy": r.choice([None, None, 0.01, 1, 2.2, 9]),
                }
            ),
            "media": self.maybe(
                {"photos": [self.photo() for _ in range(r.choice([0, 0, 1, 3, 7, 30]))]}
            ),
            "sources": [
                {"label": self.text(4), "url": self.text(1), "retrieved_at": self.moment()}
                for _ in range(r.choice([0, 0, 2, 10, 80]))
            ],
            "unknown_upstream_key": {"anything": [1, 2, 3]},
        }
        if r.random() < 0.15:  # origin equals destination
            trip = data.get("trip")
            if trip:
                trip["destination_station"] = trip["origin_station"]
        return data


def make_request(seed: int) -> dict[str, Any]:
    return Fuzzer(seed).request()
