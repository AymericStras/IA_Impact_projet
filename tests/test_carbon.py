"""Carbon package: factor file loading and the round-trip estimate."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from sncf_rapport.carbon import CarbonEstimate, Factor, estimate, load_factors
from sncf_rapport.carbon.estimate import METHOD_NOTE_FR

REAL_FILE = Path(__file__).resolve().parents[1] / "data" / "emission_factors.json"


def _factor(mode: str, grams: float, occupancy: float | None = None) -> Factor:
    return Factor(
        mode=mode,
        label=mode.capitalize(),
        g_co2e_per_pkm=grams,
        source_name="Synthetic",
        source_url="https://example.org/factors",
        version="test",
        retrieved_at="2026-01-01",
        default_occupancy=occupancy,
    )


# Round numbers, unrelated to the real factors.
SYNTHETIC = {
    "ter": _factor("ter", 10.0),
    "autocar": _factor("autocar", 30.0),
    "voiture": _factor("voiture", 200.0, occupancy=1.0),
}


def _entry(**overrides: object) -> dict[str, object]:
    entry: dict[str, object] = {
        "mode": "ter",
        "label": "TER",
        "g_co2e_per_pkm": 10.0,
        "source_name": "Synthetic",
        "source_url": "https://example.org/factors",
        "version": "test",
        "retrieved_at": "2026-01-01",
        "note": None,
    }
    entry.update(overrides)
    return entry


def _write(path: Path, document: object) -> Path:
    path.write_text(json.dumps(document), encoding="utf-8")
    return path


# --- load_factors -----------------------------------------------------------------------


def test_real_file_has_the_three_modes_with_sources() -> None:
    factors = load_factors(REAL_FILE)
    assert {"ter", "autocar", "voiture"} <= set(factors)
    for mode, factor in factors.items():
        assert factor.mode == mode
        assert factor.g_co2e_per_pkm > 0
        assert factor.source_url.startswith("https://")
        assert factor.source_name and factor.label and factor.retrieved_at


def test_real_file_documents_the_car_occupancy() -> None:
    factors = load_factors(REAL_FILE)
    assert factors["voiture"].default_occupancy is not None
    assert factors["voiture"].default_occupancy > 0
    assert factors["ter"].default_occupancy is None
    assert factors["autocar"].default_occupancy is None


def test_real_file_top_level_metadata() -> None:
    document = json.loads(REAL_FILE.read_text(encoding="utf-8"))
    assert document["schema_version"] == "1.0"
    assert document["source"]["url"].startswith("https://")
    assert document["source"]["retrieval"] in {"api", "manual"}
    assert len(document["retrieved_at"]) == 10


def test_missing_file_gives_empty(tmp_path: Path) -> None:
    assert load_factors(tmp_path / "absent.json") == {}


def test_directory_instead_of_file_gives_empty(tmp_path: Path) -> None:
    assert load_factors(tmp_path) == {}


@pytest.mark.parametrize("text", ["", "{not json", "[1, 2]", '"text"', "{}", '{"factors": 3}'])
def test_invalid_documents_give_empty(tmp_path: Path, text: str) -> None:
    path = tmp_path / "factors.json"
    path.write_text(text, encoding="utf-8")
    assert load_factors(path) == {}


def test_malformed_entries_are_skipped(tmp_path: Path) -> None:
    document = {
        "factors": [
            "nonsense",
            _entry(mode="autocar", g_co2e_per_pkm="30"),  # not a number
            _entry(mode="voiture", g_co2e_per_pkm=-1),  # not positive
            _entry(mode="avion", source_url=None),  # no source
            {"mode": "metro"},  # nearly everything missing
            _entry(g_co2e_per_pkm=True),  # a boolean is not a factor
            _entry(mode="ter", g_co2e_per_pkm=12.5, version=None),
        ]
    }
    factors = load_factors(_write(tmp_path / "factors.json", document))
    assert list(factors) == ["ter"]
    assert factors["ter"].g_co2e_per_pkm == 12.5
    assert factors["ter"].version is None
    assert factors["ter"].default_occupancy is None


def test_default_occupancy_is_read_and_validated(tmp_path: Path) -> None:
    document = {
        "factors": [
            _entry(mode="voiture", g_co2e_per_pkm=200, default_occupancy=2),
            _entry(mode="autocar", default_occupancy=0),
        ]
    }
    factors = load_factors(_write(tmp_path / "factors.json", document))
    assert factors["voiture"].default_occupancy == 2.0
    assert factors["autocar"].default_occupancy is None


# --- estimate ---------------------------------------------------------------------------


def test_arithmetic_round_trip() -> None:
    result = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC)
    assert isinstance(result, CarbonEstimate)
    assert result.distance_km_one_way == 50.0
    assert result.passengers == 20
    # 20 people x 50 km x 2 x 10 g / 1000
    assert result.train.kg_total == pytest.approx(20.0)
    assert result.train.kg_per_person == pytest.approx(1.0)
    assert result.train.g_co2e_per_pkm == 10.0
    autocar, voiture = result.baselines
    assert autocar.kg_total == pytest.approx(60.0)
    assert autocar.kg_per_person == pytest.approx(3.0)
    assert voiture.kg_total == pytest.approx(400.0)
    assert voiture.kg_per_person == pytest.approx(20.0)
    assert result.car_occupancy == 1.0


def test_no_rounding_inside_the_computation() -> None:
    factors = {"ter": _factor("ter", 27.69)}
    result = estimate(distance_km=91.3, passengers=7, factors=factors, baselines=())
    assert result is not None
    assert result.train.kg_total == 7 * 91.3 * 2 * 27.69 / 1000
    assert result.train.kg_per_person == result.train.kg_total / 7


@pytest.mark.parametrize(
    ("distance", "passengers"),
    [(None, 20), (0, 20), (-5.0, 20), (50.0, None), (50.0, 0), (50.0, -3), (float("nan"), 20)],
)
def test_none_when_distance_or_passengers_unusable(
    distance: float | None, passengers: int | None
) -> None:
    assert estimate(distance_km=distance, passengers=passengers, factors=SYNTHETIC) is None


def test_none_without_the_train_factor() -> None:
    without_train = {k: v for k, v in SYNTHETIC.items() if k != "ter"}
    assert estimate(distance_km=50.0, passengers=20, factors=without_train) is None
    assert estimate(distance_km=50.0, passengers=20, factors={}) is None


def test_car_occupancy_override_divides_the_car_figure() -> None:
    alone = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC)
    shared = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC, car_occupancy=4)
    assert alone is not None and shared is not None
    assert shared.car_occupancy == 4.0
    car = shared.baselines[1]
    assert car.kg_total == pytest.approx(100.0)
    assert car.kg_per_person == pytest.approx(5.0)
    assert car.g_co2e_per_pkm == pytest.approx(50.0)
    assert car.factor.g_co2e_per_pkm == 200.0  # the published figure is kept as is
    assert car.kg_total == pytest.approx(alone.baselines[1].kg_total / 4)
    # the other modes do not move
    assert shared.train == alone.train
    assert shared.baselines[0] == alone.baselines[0]


def test_default_occupancy_comes_from_the_factor() -> None:
    factors = {**SYNTHETIC, "voiture": _factor("voiture", 200.0, occupancy=2.0)}
    result = estimate(distance_km=50.0, passengers=20, factors=factors)
    assert result is not None
    assert result.car_occupancy == 2.0
    assert result.baselines[1].kg_total == pytest.approx(200.0)


@pytest.mark.parametrize("bad", [0, -2, float("nan")])
def test_unusable_occupancy_falls_back_to_the_default(bad: float) -> None:
    result = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC, car_occupancy=bad)
    assert result is not None
    assert result.car_occupancy == 1.0
    assert result.baselines[1].kg_total == pytest.approx(400.0)


def test_car_factor_already_per_passenger_is_not_divided() -> None:
    factors = {**SYNTHETIC, "voiture": _factor("voiture", 200.0)}
    result = estimate(distance_km=50.0, passengers=20, factors=factors, car_occupancy=4)
    assert result is not None
    assert result.car_occupancy is None
    assert result.baselines[1].kg_total == pytest.approx(400.0)


def test_car_occupancy_is_none_without_a_car_baseline() -> None:
    result = estimate(
        distance_km=50.0, passengers=20, factors=SYNTHETIC, baselines=("autocar",), car_occupancy=3
    )
    assert result is not None
    assert result.car_occupancy is None
    assert [b.factor.mode for b in result.baselines] == ["autocar"]


def test_saving_sign_is_not_clamped() -> None:
    result = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC)
    assert result is not None
    assert result.saving_kg("autocar") == pytest.approx(40.0)
    assert result.saving_kg("voiture") == pytest.approx(380.0)

    dirty_train = {**SYNTHETIC, "ter": _factor("ter", 50.0)}
    worse = estimate(distance_km=50.0, passengers=20, factors=dirty_train)
    assert worse is not None
    assert worse.saving_kg("autocar") == pytest.approx(-40.0)


def test_saving_is_none_for_an_absent_baseline() -> None:
    result = estimate(distance_km=50.0, passengers=20, factors=SYNTHETIC, baselines=("autocar",))
    assert result is not None
    assert result.saving_kg("voiture") is None
    assert result.saving_kg("avion") is None
    assert result.saving_kg("ter") is None


def test_baselines_keep_the_requested_order_and_skip_unknown_modes() -> None:
    result = estimate(
        distance_km=50.0,
        passengers=20,
        factors=SYNTHETIC,
        baselines=("voiture", "avion", "ter", "autocar", "voiture"),
    )
    assert result is not None
    assert [b.factor.mode for b in result.baselines] == ["voiture", "autocar"]


def test_baseline_without_a_factor_is_skipped() -> None:
    factors = {k: v for k, v in SYNTHETIC.items() if k != "autocar"}
    result = estimate(distance_km=50.0, passengers=20, factors=factors)
    assert result is not None
    assert [b.factor.mode for b in result.baselines] == ["voiture"]
    assert result.saving_kg("autocar") is None


def test_real_factors_end_to_end() -> None:
    factors = load_factors(REAL_FILE)
    result = estimate(distance_km=91.0, passengers=30, factors=factors, car_occupancy=4)
    assert result is not None
    assert [b.factor.mode for b in result.baselines] == ["autocar", "voiture"]
    assert result.car_occupancy == 4.0
    expected = 30 * 91.0 * 2 * factors["ter"].g_co2e_per_pkm / 1000
    assert result.train.kg_total == pytest.approx(expected)


def test_method_note_has_no_figures_and_formats() -> None:
    assert not any(character.isdigit() for character in METHOD_NOTE_FR)
    text = METHOD_NOTE_FR.format(
        source_name="ADEME, Impact CO2", retrieved_at="10/10/2026", car_people="une personne"
    )
    assert "estimations" in text and "aller-retour" in text and "ADEME" in text
    assert "{" not in text
