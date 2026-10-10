import json
from pathlib import Path

import httpx
import pytest

from sncf_rapport.config import Config
from sncf_rapport.enrich import build_payload, check_text, enrich_request, guard
from sncf_rapport.models import TripReportRequest

EXAMPLES = Path(__file__).resolve().parents[1] / "contracts" / "examples"
GOOD = {
    "why": "En parcourant la Cité, les élèves observent comment une ville se protégeait.",
    "competencies": {
        "savoir": "Observer les remparts pour comprendre leur rôle.",
        "savoir_faire": "Prendre des notes pendant la visite.",
        "savoir_se_deplacer": "Prendre le train en groupe.",
        "savoir_s_orienter": "Suivre un plan de la gare à la Cité.",
        "savoir_etre": "Écouter la guide et respecter les lieux.",
    },
    "questions": ["Qu'est-ce qui t'a le plus surpris ?", "À quoi servaient les remparts ?"],
}


@pytest.fixture
def request_full() -> TripReportRequest:
    data = json.loads((EXAMPLES / "01-carcassonne-complet.json").read_text(encoding="utf-8"))
    data["education"].pop("insights", None)
    return TripReportRequest.model_validate(data)


def _config(tmp_path, **kwargs) -> Config:
    return Config(openai_api_key="sk-test", cache_dir=tmp_path, **kwargs)


def _client(answer, calls: list, status: int = 200) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        assert request.headers["authorization"] == "Bearer sk-test"
        body = {
            "output": [
                {"type": "reasoning"},
                {
                    "type": "message",
                    "content": [{"type": "output_text", "text": json.dumps(answer)}],
                },
            ],
            "usage": {"input_tokens": 900, "output_tokens": 300},
        }
        return httpx.Response(status, json=body)

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_payload_carries_no_personal_data(request_full):
    text = json.dumps(build_payload(request_full), ensure_ascii=False)
    assert "Carcassonne" in text and "Histoire" in text and "CM2" in text
    for private in ("Tilleuls", "Martin", "pique-nique", "attentive", "26", "SIM-"):
        assert private not in text


def test_payload_none_when_nothing_to_say_or_cancelled(request_full):
    assert build_payload(TripReportRequest()) is None
    data = request_full.model_dump(mode="json", by_alias=True)
    data["teacher_feedback"]["trip_completed"] = "cancelled"
    assert build_payload(TripReportRequest.model_validate(data)) is None


def test_generated_then_cached(request_full, tmp_path):
    calls: list = []
    config = _config(tmp_path)
    enriched, outcome = enrich_request(request_full, config, client=_client(GOOD, calls))
    assert outcome.status == "generated" and outcome.input_tokens == 900
    insights = enriched.education.insights
    assert insights.why.startswith("En parcourant") and insights.origin == "ai"
    assert insights.reviewed_by_teacher is False and insights.model == "gpt-5.4-mini"
    assert insights.competencies.savoir_etre and len(insights.questions) == 2
    sent = calls[0]
    assert sent["store"] is False and sent["text"]["format"]["type"] == "json_schema"
    assert "Tilleuls" not in json.dumps(sent, ensure_ascii=False)

    again, outcome2 = enrich_request(request_full, config, client=_client(GOOD, calls))
    assert outcome2.status == "cached" and len(calls) == 1
    assert again.education.insights.why == insights.why
    # The original request object is untouched.
    assert request_full.education.insights is None


def test_cache_works_without_key(request_full, tmp_path):
    calls: list = []
    enrich_request(request_full, _config(tmp_path), client=_client(GOOD, calls))
    _, outcome = enrich_request(request_full, Config(openai_api_key=None, cache_dir=tmp_path))
    assert outcome.status == "cached"


def test_no_key_off_and_existing(request_full, tmp_path):
    same, outcome = enrich_request(request_full, Config(openai_api_key=None, cache_dir=tmp_path))
    assert outcome.status == "no_key" and same is request_full
    _, outcome = enrich_request(request_full, _config(tmp_path, enrich_mode="off"))
    assert outcome.status == "off"
    data = request_full.model_dump(mode="json", by_alias=True)
    data["education"]["insights"] = {"why": "Texte de l'enseignante.", "origin": "teacher"}
    kept, outcome = enrich_request(TripReportRequest.model_validate(data), _config(tmp_path))
    assert outcome.status == "existing" and kept.education.insights.origin == "teacher"


@pytest.mark.parametrize("status", [401, 429, 500])
def test_http_error_never_raises(request_full, tmp_path, status):
    same, outcome = enrich_request(
        request_full, _config(tmp_path), client=_client(GOOD, [], status=status)
    )
    assert outcome.status == "failed" and same is request_full


def test_network_error_and_garbage_answer_never_raise(request_full, tmp_path):
    def boom(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectTimeout("slow")

    client = httpx.Client(transport=httpx.MockTransport(boom))
    assert enrich_request(request_full, _config(tmp_path), client=client)[1].status == "failed"
    for answer in ("just text", [1, 2]):
        outcome = enrich_request(
            request_full, _config(tmp_path), client=_client(answer, []), force=True
        )[1]
        assert outcome.status == "failed"
    empty = {"why": "", "competencies": {"savoir": ""}, "questions": []}
    same, outcome = enrich_request(
        request_full, _config(tmp_path), client=_client(empty, []), force=True
    )
    assert outcome.status == "no_material" and same is request_full
    rejected = {"why": "Bâtie en 1130.", "competencies": {}, "questions": []}
    outcome = enrich_request(
        request_full, _config(tmp_path), client=_client(rejected, []), force=True
    )[1]
    assert outcome.status == "failed" and outcome.dropped


def test_guard_drops_invented_facts_and_result_claims():
    payload = {"theme": "Moyen Âge", "destination": "Carcassonne", "activites": [{"titre": "A 2"}]}
    assert check_text("Les élèves découvrent la Cité.", payload) is None
    assert check_text("Atelier 2 en groupe.", payload) is None
    assert check_text("Construite en 1247 par le roi.", payload) == "number not in the input"
    assert check_text("Une cité du XIIIe siècle.", payload) == "century not in the input"
    assert check_text("Les élèves ont acquis la notion.", payload) == "states a result"
    assert check_text("Ils maîtrisent le plan.", payload) == "states a result"
    assert check_text("Voir https://exemple.fr", payload) == "link"
    assert check_text("Quelle journée !", payload) == "exclamation mark"
    raw = {
        "why": "Fondée en 1247.",
        "competencies": {"savoir": "Observer les remparts.", "savoir_etre": "Ils ont validé."},
        "questions": ["Qu'as-tu vu ?", "", "x" * 400],
    }
    kept, dropped = guard(raw, payload)
    assert "why" not in kept and kept["competencies"] == {"savoir": "Observer les remparts."}
    assert kept["questions"] == ["Qu'as-tu vu ?"] and len(dropped) == 3


def test_partial_answer_is_kept(request_full, tmp_path):
    answer = {**GOOD, "why": "Bâtie en 1130.", "questions": []}
    enriched, outcome = enrich_request(request_full, _config(tmp_path), client=_client(answer, []))
    assert outcome.status == "generated" and outcome.dropped
    assert enriched.education.insights.why is None
    assert enriched.education.insights.competencies.savoir
