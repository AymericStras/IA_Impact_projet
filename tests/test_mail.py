"""The email: subject and bodies from the view, attachment, inline logo, dry-run and live paths."""

from __future__ import annotations

import copy
import html
import re
from dataclasses import replace
from email import message_from_bytes, policy

import pytest
from conftest import as_request, load_example
from mailato import api as mailato

from sncf_rapport.config import Config
from sncf_rapport.mail.compose import NoRecipient, compose, render_parts
from sncf_rapport.mail.deliver import deliver, write_eml
from sncf_rapport.view import attachment_filename, build_mail_view

PDF = b"%PDF-1.7\n% test document\n"


@pytest.fixture
def config(tmp_path) -> Config:
    return Config(data_dir=tmp_path, api_key="test-key", reply_to="contact@example.fr")


def complete():
    data = copy.deepcopy(load_example("01-carcassonne-complet.json"))
    data.get("education", {}).pop("insights", None)
    return data


def plain(text: str) -> str:
    return text.replace(" ", " ").replace(" ", " ")


def test_subject_is_one_line_from_the_cover(config):
    parts = render_parts(as_request(complete()), config)
    assert plain(parts["subject"]) == (
        "Rapport de voyage scolaire : Sortie pédagogique — Cité médiévale de Carcassonne"
    )
    assert "\n" not in parts["subject"]
    without_title = complete()
    del without_title["trip"]["title"]
    assert plain(render_parts(as_request(without_title), config)["subject"]) == (
        "Rapport de voyage scolaire : CM2 B, jeudi 12 novembre 2026"
    )
    assert render_parts(as_request({}), config)["subject"] == "Rapport de voyage scolaire"


def test_text_body_of_a_complete_report(config):
    text = plain(render_parts(as_request(complete()), config)["text"])
    for expected in [
        "Bonjour Mme Martin,",
        "(rapport-SIM-050033B9.pdf)",
        "École            : École élémentaire des Tilleuls (exemple), Toulouse",
        "Classe           : CM2 B",
        "Date             : jeudi 12 novembre 2026",
        "Matière et thème : Histoire — Moyen Âge",
        "En quelques chiffres :",
        "26 élèves participants",
        "3 sur 5 compétences acquises",
        "environ 51 kg de CO₂e de moins qu'en autocar (estimation",
        "Validé par Mme Claire Martin le lundi 16 novembre 2026.",
        "Les données de ce voyage sont simulées",
        "sont des estimations",
        "Répondez à ce message ou écrivez à contact@example.fr",
    ]:
        assert expected in text, expected
    assert "\n\n\n" not in text
    assert "None" not in text


def test_text_body_with_everything_missing_says_so(config):
    text = plain(render_parts(as_request({}), replace(config, reply_to=None))["text"])
    assert text.startswith("Bonjour,\n")
    assert "École            : non communiqué" in text
    assert "(rapport.pdf)" in text
    assert "Rapport non encore validé par l'enseignant·e." in text
    assert "non communiqué élèves" not in text  # a figure without a value is left out
    assert "5 compétences travaillées (appréciation non communiquée)" in text
    assert "Merci de ne pas répondre à ce message." in text
    for absent in ["simulées", "None", "IA"]:
        assert absent not in text, absent


def test_html_body_matches_the_text_body_and_loads_nothing_remote(config):
    parts = render_parts(as_request(complete()), config)
    html = plain(parts["html"])
    for expected in [
        "Bonjour Mme Martin,",
        "Sortie pédagogique — Cité médiévale de Carcassonne",
        "École élémentaire des Tilleuls (exemple), Toulouse",
        "CM2 B",
        "jeudi 12 novembre 2026",
        "Histoire — Moyen Âge",
        "élèves participants",
        "compétences acquises",
        "rapport-SIM-050033B9.pdf",
        "Validé par Mme Claire Martin le lundi 16 novembre 2026.",
        "simulées",
        "estimations",
    ]:
        assert expected in html, expected
    assert 'src="cid:logo"' in html
    assert re.findall(r'(?:src|href)="(?!cid:)[^"]*"', html) == []
    assert "http://" not in html and "https://" not in html
    assert "<script" not in html and "<style" not in html and "<link" not in html


def test_ai_notice_travels_with_the_generated_texts(config):
    data = load_example("04-carcassonne-enrichi-ia.json")
    parts = render_parts(as_request(data), config)
    assert "rédigés avec l'aide d'une IA" in plain(parts["text"])
    assert "rédigés avec l'aide d'une IA" in html.unescape(plain(parts["html"]))
    assert (
        "rédigés avec l'aide d'une IA" not in render_parts(as_request(complete()), config)["text"]
    )


def test_user_text_is_escaped_in_html_and_cannot_break_the_subject(config):
    data = complete()
    data["trip"]["title"] = '<img src=x onerror=alert(1)> & "co"\nsecond line'
    data["recipient"]["name"] = "<b>Bob</b>"
    parts = render_parts(as_request(data), config)
    assert "\n" not in parts["subject"]
    assert "<img src=x" not in parts["html"]
    assert "&lt;img src=x onerror=alert(1)&gt; &amp;" in parts["html"]
    assert "&lt;b&gt;Bob&lt;/b&gt;" in parts["html"]
    assert "<b>Bob</b>" in parts["text"]  # plain text carries it verbatim


def test_composed_message_has_pdf_attachment_and_inline_logo(config):
    message = compose(as_request(complete()), PDF, config)
    assert list(message.to) == ["destinataire@example.fr"]
    assert list(message.reply_to) == ["contact@example.fr"]
    pdf, logo = message.attachments
    assert (pdf.filename, pdf.content, pdf.content_type, pdf.content_id) == (
        "rapport-SIM-050033B9.pdf",
        PDF,
        "application/pdf",
        None,
    )
    assert (logo.content_type, logo.content_id) == ("image/png", "logo")
    assert logo.content.startswith(b"\x89PNG")


def test_no_recipient_cannot_be_composed(config):
    data = complete()
    del data["recipient"]
    with pytest.raises(NoRecipient):
        compose(as_request(data), PDF, config)
    data["recipient"] = {"name": "Quelqu'un"}
    with pytest.raises(NoRecipient):
        compose(as_request(data), PDF, config)
    assert build_mail_view(as_request(data)).recipient_email is None


def test_missing_logo_sends_a_message_without_picture(config, tmp_path):
    message = compose(as_request(complete()), PDF, replace(config, logo_png=tmp_path / "x.png"))
    assert [a.filename for a in message.attachments] == ["rapport-SIM-050033B9.pdf"]
    assert "cid:" not in message.html and "<img" not in message.html


def test_attachment_name_from_reference_date_or_nothing():
    assert attachment_filename(as_request(complete())) == "rapport-SIM-050033B9.pdf"
    assert attachment_filename(as_request({"trip": {"date": "2026-11-12"}})) == (
        "rapport-2026-11-12.pdf"
    )
    assert attachment_filename(as_request({"trip": {"reference": "a/b c"}})) == "rapport-abc.pdf"
    assert attachment_filename(as_request({})) == "rapport.pdf"


def test_dry_run_writes_a_complete_eml_and_sends_nothing(config, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("dry-run must not call the provider")

    monkeypatch.setattr(mailato, "send", forbidden)
    message = compose(as_request(complete()), PDF, config)

    delivery = deliver(message, config, report_id="abc")

    assert (delivery.provider, delivery.message_id, delivery.attempts) == ("dry-run", "abc.eml", 1)
    parsed = message_from_bytes(
        (config.data_dir / "outbox" / "abc.eml").read_bytes(), policy=policy.default
    )
    assert parsed["From"] == "Sorties scolaires liO – démo <sorties@zhaoyang.fr>"
    assert parsed["To"] == "destinataire@example.fr"
    assert parsed["Reply-To"] == "contact@example.fr"
    assert parsed["Subject"].startswith("Rapport de voyage scolaire")
    assert "Bonjour Mme Martin" in parsed.get_body(("plain",)).get_content()
    assert "cid:logo" in parsed.get_body(("html",)).get_content()
    attachments = list(parsed.iter_attachments())
    assert [part.get_filename() for part in attachments] == ["rapport-SIM-050033B9.pdf"]
    assert attachments[0].get_content() == PDF
    inline = [part for part in parsed.walk() if part.get("Content-ID") == "<logo>"]
    assert len(inline) == 1 and inline[0].get_content_type() == "image/png"


def test_live_mode_sends_through_mailato_with_a_key_tied_to_the_report(config, monkeypatch):
    calls = []

    def fake_send(message, settings, *, idempotency_key=None, audit_id=None):
        calls.append((message, settings, idempotency_key, audit_id))
        return mailato.SendResult("resend", "email_1", 2, idempotency_key)

    monkeypatch.setattr(mailato, "send", fake_send)
    live = replace(
        config, mail_mode="live", resend_api_key="re_test", allowed_domains=("example.fr",)
    )
    message = compose(as_request(complete()), PDF, live)

    delivery = deliver(message, live, report_id="abc")

    assert (delivery.provider, delivery.message_id, delivery.attempts) == ("resend", "email_1", 2)
    sent, settings, key, audit = calls[0]
    assert sent is message
    assert (key, audit) == ("sncf-rapport-abc", "abc")
    assert settings.mail_from == live.mail_from
    assert settings.resend_api_key == "re_test"
    assert settings.max_recipients == 1
    assert tuple(settings.allowed_domains) == ("example.fr",)
    assert not (config.data_dir / "outbox").exists()


def test_composed_message_passes_mailato_validation_and_builds_a_resend_payload(config):
    message = compose(as_request(complete()), PDF, config)
    settings = mailato.Settings(mail_from=config.mail_from, resend_api_key="re_test")
    payload = mailato.build_resend_payload(message, settings)
    assert payload["to"] == ["destinataire@example.fr"]
    assert {item.get("content_id") for item in payload["attachments"]} == {None, "logo"}
    write_eml(message, config, config.data_dir / "x.eml")


def test_copy_addresses_get_a_blind_copy_except_the_recipient(config):
    copied = replace(config, copy_to=("equipe@example.fr", "Destinataire@example.fr"))
    message = compose(as_request(complete()), PDF, copied)
    assert message.to == ["destinataire@example.fr"]
    assert message.bcc == ["equipe@example.fr"]
    assert compose(as_request(complete()), PDF, config).bcc == []


def test_copy_addresses_come_from_the_environment():
    from sncf_rapport.config import ConfigurationError

    env = {"RAPPORT_COPY_TO": " a@example.fr , b@example.fr,A@example.fr,, "}
    assert Config.from_env(env).copy_to == ("a@example.fr", "b@example.fr")
    assert Config.from_env({}).copy_to == ()
    with pytest.raises(ConfigurationError):
        Config.from_env({"RAPPORT_COPY_TO": "not-an-address"})


def test_copies_are_delivered_in_dry_run_and_fit_the_recipient_cap(config, tmp_path):
    copied = replace(config, copy_to=("a@example.fr", "b@example.fr"), data_dir=tmp_path)
    message = compose(as_request(complete()), PDF, copied)
    delivery = deliver(message, copied, report_id="copy-test")
    assert delivery.provider == "dry-run"
    raw = (tmp_path / "outbox" / "copy-test.eml").read_bytes().decode("utf-8", "replace")
    assert "To: destinataire@example.fr" in raw
    assert "a@example.fr" not in raw.split("\n\n", 1)[0]  # blind: not in the headers
    settings = mailato.Settings(
        mail_from=copied.mail_from, resend_api_key="re_test", max_recipients=1 + len(copied.copy_to)
    )
    assert mailato.build_resend_payload(message, settings)["bcc"] == [
        "a@example.fr",
        "b@example.fr",
    ]
