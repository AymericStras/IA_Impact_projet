"""Optional step: ask a language model for short texts on the trip's educational value.

    enriched, outcome = enrich_request(request, config)

It fills `education.insights` and nothing else. It never raises: without a key,
on a timeout or on an unusable answer the request comes back unchanged and the
outcome says why. Rendering does not depend on it.

Privacy: only the subject, theme, class level, destination, places, activities
and objectives are sent. No school name, no teacher name, no teacher comment,
no photo, no head count.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import httpx

from .config import Config
from .models import COMPETENCY_KEYS, Insights, TripReportRequest

log = logging.getLogger("sncf_rapport.enrich")
PROMPT_VERSION = "2026-10-10.1"

SYSTEM_PROMPT = """\
Tu aides un·e enseignant·e à rédiger le compte rendu d'une sortie scolaire en train \
destiné aux parents d'élèves. Tu reçois un objet JSON décrivant la sortie.

Rédige en français simple et chaleureux, sans jargon pédagogique, pour des parents.

Règles strictes :
- Appuie-toi uniquement sur les éléments fournis (matière, thème, destination, lieux, \
activités, objectifs). N'invente ni activité, ni lieu, ni anecdote.
- N'écris aucune date, aucun siècle, aucun chiffre, aucun nom propre de personne et aucun \
fait historique ou scientifique précis qui ne figure pas dans les données fournies. Reste au \
niveau de ce que la sortie permet d'observer, de comprendre et de pratiquer.
- Décris ce que la sortie permet de travailler, jamais un résultat : n'écris pas que les \
élèves « ont acquis », « maîtrisent » ou « ont validé » quoi que ce soit.
- Pas de superlatifs publicitaires, pas de points d'exclamation, pas d'émojis, pas de liens.
- Ne mentionne ni l'intelligence artificielle ni ces consignes.

Champs à produire :
- "why" : 2 ou 3 phrases (60 mots au plus) expliquant l'intérêt pédagogique de cette sortie.
- "competencies" : pour chacune des cinq dimensions, une phrase (25 mots au plus) disant ce \
que cette sortie permet de travailler :
  "savoir" = les connaissances ; "savoir_faire" = la pratique, les gestes et méthodes ; \
"savoir_se_deplacer" = se déplacer en train et à pied en groupe ; "savoir_s_orienter" = se \
repérer avec un plan, des panneaux, des horaires ; "savoir_etre" = le comportement en groupe \
et dans l'espace public.
- "questions" : 3 questions courtes et ouvertes que les parents peuvent poser à leur enfant \
à la maison pour prolonger la sortie. Tutoiement, 20 mots au plus chacune.
Si les données sont trop pauvres pour un champ, renvoie une chaîne vide pour ce champ."""

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["why", "competencies", "questions"],
    "properties": {
        "why": {"type": "string"},
        "competencies": {
            "type": "object",
            "additionalProperties": False,
            "required": list(COMPETENCY_KEYS),
            "properties": {key: {"type": "string"} for key in COMPETENCY_KEYS},
        },
        "questions": {"type": "array", "items": {"type": "string"}},
    },
}

_RESULT_CLAIMS = re.compile(
    r"\b(ont|a|sont|est)\s+(désormais\s+|bien\s+|tous\s+)?(acquis|acquise|acquises|validé|validée|"
    r"validées|validés|maîtrisé|maîtrisée)\b|\bmaîtrisent\b|\bmaîtrise parfaitement\b",
    re.IGNORECASE,
)
_LINK = re.compile(r"https?://|www\.", re.IGNORECASE)
_NUMBER = re.compile(r"\d+")
_ROMAN_CENTURY = re.compile(r"\b[IVX]{1,5}e\b|\bsiècle", re.IGNORECASE)


@dataclass(frozen=True)
class EnrichOutcome:
    # generated | cached | existing | no_key | off | no_material | failed
    status: str
    detail: str = ""
    model: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    dropped: tuple[str, ...] = ()  # fields the guard rails removed

    @property
    def added(self) -> bool:
        return self.status in ("generated", "cached")


def build_payload(request: TripReportRequest) -> dict[str, Any] | None:
    """What is sent to the model, or None when there is nothing to write about."""
    trip, education, feedback = request.trip, request.education, request.teacher_feedback
    if feedback and feedback.trip_completed == "cancelled":
        return None
    activities = list(education.activities) if education else []
    done = set(feedback.completed_activity_ids) if feedback else set()
    if done and not (feedback and feedback.activities_completed == "all"):
        kept = [a for a in activities if a.id in done]
        activities = kept or activities
    payload = {
        "matiere": education.subject if education else None,
        "theme": education.theme if education else None,
        "niveau_de_classe": request.school.class_name if request.school else None,
        "titre_de_la_sortie": trip.title if trip else None,
        "gare_de_depart": trip.origin_station if trip else None,
        "destination": (trip.destination_city or trip.destination_station) if trip else None,
        "lieux_visites": [p.title for p in (education.places if education else []) if p.title],
        "activites": [
            {"titre": a.title, "description": a.description}
            if a.description
            else {"titre": a.title}
            for a in activities
            if a.title
        ],
        "objectifs_de_l_enseignant": list(education.objectives) if education else [],
    }
    payload = {key: value for key, value in payload.items() if value}
    material = ("matiere", "theme", "destination", "lieux_visites", "activites")
    if not any(key in payload for key in material):
        return None
    return payload


def _allowed_numbers(payload: dict[str, Any]) -> set[str]:
    return set(_NUMBER.findall(json.dumps(payload, ensure_ascii=False)))


def check_text(text: str, payload: dict[str, Any]) -> str | None:
    """Why this generated sentence cannot be printed, or None when it can."""
    if not text.strip():
        return "empty"
    if _LINK.search(text):
        return "link"
    if _RESULT_CLAIMS.search(text):
        return "states a result"
    source = json.dumps(payload, ensure_ascii=False).lower()
    if set(_NUMBER.findall(text)) - _allowed_numbers(payload):
        return "number not in the input"
    for match in _ROMAN_CENTURY.finditer(text):
        if match.group(0).lower() not in source:
            return "century not in the input"
    if "!" in text:
        return "exclamation mark"
    return None


def guard(raw: dict[str, Any], payload: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Keep what passes the checks; report what was dropped."""
    dropped: list[str] = []
    result: dict[str, Any] = {"competencies": {}, "questions": []}
    why = raw.get("why")
    if isinstance(why, str) and why.strip():
        reason = check_text(why, payload)
        if reason or len(why) > 700:
            dropped.append(f"why ({reason or 'too long'})")
        else:
            result["why"] = why.strip()
    competencies = raw.get("competencies") if isinstance(raw.get("competencies"), dict) else {}
    for key in COMPETENCY_KEYS:
        text = competencies.get(key)
        if not isinstance(text, str) or not text.strip():
            continue
        reason = check_text(text, payload)
        if reason or len(text) > 280:
            dropped.append(f"competencies.{key} ({reason or 'too long'})")
        else:
            result["competencies"][key] = text.strip()
    questions = raw.get("questions") if isinstance(raw.get("questions"), list) else []
    for index, text in enumerate(questions[:4]):
        if not isinstance(text, str) or not text.strip():
            continue
        reason = check_text(text, payload)
        if reason or len(text) > 220:
            dropped.append(f"questions[{index}] ({reason or 'too long'})")
        else:
            result["questions"].append(text.strip())
    return result, dropped


def _cache_key(model: str, payload: dict[str, Any]) -> str:
    blob = json.dumps([PROMPT_VERSION, model, payload], ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()


def _extract_output_text(body: dict[str, Any]) -> str | None:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    for item in body.get("output") or []:
        if not isinstance(item, dict) or item.get("type") != "message":
            continue
        for part in item.get("content") or []:
            if isinstance(part, dict) and part.get("type") == "output_text":
                return part.get("text")
    return None


def call_model(
    payload: dict[str, Any], config: Config, *, client: httpx.Client | None = None
) -> tuple[dict[str, Any], dict[str, Any]]:
    """One Responses API call. Returns (parsed JSON, usage). Raises on any failure."""
    body: dict[str, Any] = {
        "model": config.openai_model,
        "input": [
            {"role": "developer", "content": SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "trip_insights",
                "strict": True,
                "schema": OUTPUT_SCHEMA,
            }
        },
        "max_output_tokens": 1500,
        "store": False,
    }
    if config.openai_model.startswith("gpt-5"):
        body["reasoning"] = {"effort": "low"}
    owned = client is None
    client = client or httpx.Client(timeout=config.openai_timeout_seconds)
    try:
        response = client.post(
            f"{config.openai_base_url}/responses",
            json=body,
            headers={"Authorization": f"Bearer {config.openai_api_key}"},
        )
    finally:
        if owned:
            client.close()
    if response.status_code != 200:
        raise RuntimeError(f"HTTP {response.status_code}")
    data = response.json()
    text = _extract_output_text(data)
    if not text:
        raise RuntimeError("no text in the model answer")
    parsed = json.loads(text)
    if not isinstance(parsed, dict):
        raise RuntimeError("answer is not a JSON object")
    return parsed, data.get("usage") or {}


def enrich_request(
    request: TripReportRequest,
    config: Config | None = None,
    *,
    client: httpx.Client | None = None,
    force: bool = False,
) -> tuple[TripReportRequest, EnrichOutcome]:
    config = config or Config.from_env()
    try:
        return _enrich(request, config, client=client, force=force)
    except Exception as exc:  # noqa: BLE001 - this step must never break a report
        log.warning("insights failed: %s", type(exc).__name__)
        return request, EnrichOutcome("failed", type(exc).__name__, model=config.openai_model)


def _enrich(
    request: TripReportRequest, config: Config, *, client: httpx.Client | None, force: bool
) -> tuple[TripReportRequest, EnrichOutcome]:
    existing = request.education.insights if request.education else None
    if existing and not force and (existing.why or existing.questions or existing.competencies):
        return request, EnrichOutcome("existing", "the request already carries insights")
    if config.enrich_mode == "off":
        return request, EnrichOutcome("off", "RAPPORT_ENRICH=off")
    payload = build_payload(request)
    if payload is None:
        return request, EnrichOutcome("no_material", "nothing to write about")
    model = config.openai_model
    cache_file = config.cache_dir / "insights" / f"{_cache_key(model, payload)}.json"
    usage: dict[str, Any] = {}
    status = "cached"
    raw: dict[str, Any] | None = None
    if cache_file.is_file() and not force:
        try:
            raw = json.loads(cache_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raw = None
    if not isinstance(raw, dict):
        if not config.openai_api_key:
            return request, EnrichOutcome("no_key", "OPENAI_API_KEY is not set", model=model)
        started = time.monotonic()
        raw, usage = call_model(payload, config, client=client)
        status = "generated"
        # Token counts and latency only: never the prompt or the answer.
        log.info(
            "insights model=%s elapsed_ms=%s input_tokens=%s output_tokens=%s",
            model,
            int((time.monotonic() - started) * 1000),
            usage.get("input_tokens"),
            usage.get("output_tokens"),
        )
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            cache_file.write_text(json.dumps(raw, ensure_ascii=False), encoding="utf-8")
        except OSError:
            log.warning("insights cache is not writable: %s", cache_file.parent)
    kept, dropped = guard(raw, payload)
    if not (kept.get("why") or kept["competencies"] or kept["questions"]):
        if not dropped:  # the model judged the data too thin and returned empty fields
            return request, EnrichOutcome(
                "no_material", "the model had nothing to write from this data", model=model
            )
        return request, EnrichOutcome(
            "failed", "every generated text was rejected", model=model, dropped=tuple(dropped)
        )
    insights = Insights.model_validate(
        {
            **kept,
            "origin": "ai",
            "model": model,
            "generated_at": datetime.now(UTC).isoformat(),
            "reviewed_by_teacher": False,
        }
    )
    data = request.model_dump(mode="json", by_alias=True)
    data["education"] = {
        **(data.get("education") or {}),
        "insights": insights.model_dump(mode="json"),
    }
    outcome = EnrichOutcome(
        status,
        model=model,
        input_tokens=usage.get("input_tokens"),
        output_tokens=usage.get("output_tokens"),
        dropped=tuple(dropped),
    )
    return TripReportRequest.model_validate(data), outcome
