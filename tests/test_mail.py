from __future__ import annotations

import re
from dataclasses import replace
from email import message_from_bytes, policy

import pytest
from mailato import api as mailato

from sncf_bilan.mail.compose import compose, render_parts
from sncf_bilan.mail.deliver import deliver, write_eml

from .conftest import example

PDF = b"%PDF-1.7\n% test document\n"


def plain(text: str) -> str:
    return text.replace(" ", " ").replace(" ", " ")


def test_subject_is_one_line_with_route_and_date(config):
    parts = render_parts(example("01-aller-retour-complet"), config)
    assert parts["subject"] == (
        "Votre récapitulatif de voyage — Toulouse Matabiau → Carcassonne, jeudi 12 novembre 2026"
    )
    assert "\n" not in parts["subject"]


def test_text_body_of_a_complete_round_trip(config):
    text = plain(render_parts(example("01-aller-retour-complet"), config)["text"])
    for expected in [
        "Bonjour Mme Martin,",
        "(recapitulatif-SIM-050033B9.pdf)",
        "Trajet       : Toulouse Matabiau → Carcassonne (aller-retour)",
        "Date         : jeudi 12 novembre 2026",
        "Départ       : 8 h 05 de Toulouse Matabiau, arrivée 9 h 00",
        "Retour       : 16 h 25 de Carcassonne, arrivée 17 h 20",
        "Voyageurs    : 30",
        "Classe       : 2de classe",
        "Prix total   : 30,00 €",
        "Par personne : 1,00 €",
        "Référence    : SIM-050033B9",
        "Ils ne constituent pas un titre de transport",
        "Les données de ce voyage sont simulées",
        "Répondez à ce message ou écrivez à contact@example.fr",
    ]:
        assert expected in text, expected
    # Each fact on its own line, no blank line inside the block, none run together.
    block = text[text.index("  Trajet") : text.index("Ce message")]
    assert [line for line in block.splitlines() if line.strip()] == block.rstrip().splitlines()
    assert "\n\n\n" not in text


def test_text_body_with_every_optional_value_missing(config):
    text = plain(
        render_parts(example("02-aller-simple-minimal"), replace(config, reply_to=None))["text"]
    )
    assert text.startswith("Bonjour,\n")
    assert "Classe       : non communiquée" in text
    assert "Prix total   : 1,00 €" in text
    assert "Par personne : 1,00 €" in text
    assert "Départ       : 14 h 32 de Toulouse Matabiau\n" in text
    for absent in ["Retour", "Référence", "simulées", "None", "arrivée"]:
        assert absent not in text, absent
    assert "Merci de ne pas répondre à ce message." in text
    assert "\n\n\n" not in text


def test_html_body_matches_the_text_body_and_loads_nothing_remote(config):
    parts = render_parts(example("01-aller-retour-complet"), config)
    html = plain(parts["html"])
    for expected in [
        "Bonjour Mme Martin,",
        "Toulouse Matabiau",
        "Carcassonne",
        "Aller-retour",
        "jeudi 12 novembre 2026",
        "8 h 05 de Toulouse Matabiau, arrivée 9 h 00",
        "16 h 25 de Carcassonne, arrivée 17 h 20",
        "2de classe",
        "30,00 €",
        "1,00 €",
        "SIM-050033B9",
        "recapitulatif-SIM-050033B9.pdf",
        "Ils ne constituent pas un titre de transport",
        "simulées",
    ]:
        assert expected in html, expected
    assert 'src="cid:logo"' in html
    assert re.findall(r'(?:src|href)="(?!cid:)[^"]*"', html) == []
    assert "http://" not in html and "https://" not in html
    assert "<script" not in html and "<style" not in html and "<link" not in html


def test_html_body_states_missing_values(config):
    html = render_parts(example("02-aller-simple-minimal"), config)["html"]
    assert "non communiquée" in html
    assert "1,00 €" in plain(html)
    for absent in ["Retour", "Référence", "None", "non communiqué<"]:
        assert absent not in html, absent


def test_user_text_is_escaped_in_html_and_cannot_break_the_subject(config):
    request = example("01-aller-retour-complet", title='<img src=x onerror=alert(1)> & "co"')
    request.recipient.name = "<b>Bob</b>"
    parts = render_parts(request, config)
    assert "<img src=x" not in parts["html"]
    assert "&lt;img src=x onerror=alert(1)&gt; &amp;" in parts["html"]
    assert "&lt;b&gt;Bob&lt;/b&gt;" in parts["html"]
    assert "<b>Bob</b>" in parts["text"]  # plain text carries it verbatim


def test_composed_message_has_pdf_attachment_and_inline_logo(config):
    message = compose(example("01-aller-retour-complet"), PDF, config)
    assert list(message.to) == ["destinataire@example.fr"]
    assert list(message.reply_to) == ["contact@example.fr"]
    pdf, logo = message.attachments
    assert (pdf.filename, pdf.content, pdf.content_type, pdf.content_id) == (
        "recapitulatif-SIM-050033B9.pdf",
        PDF,
        "application/pdf",
        None,
    )
    assert (logo.content_type, logo.content_id) == ("image/png", "logo")
    assert logo.content.startswith(b"\x89PNG")


def test_missing_logo_is_an_error(config, tmp_path):
    with pytest.raises(FileNotFoundError):
        compose(
            example("01-aller-retour-complet"), PDF, replace(config, logo_png=tmp_path / "x.png")
        )


def test_dry_run_writes_a_complete_eml_and_sends_nothing(config, monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("dry-run must not call the provider")

    monkeypatch.setattr(mailato, "send", forbidden)
    message = compose(example("01-aller-retour-complet"), PDF, config)

    delivery = deliver(message, config, recap_id="abc")

    assert (delivery.provider, delivery.message_id, delivery.attempts) == ("dry-run", "abc.eml", 1)
    parsed = message_from_bytes(
        (config.data_dir / "outbox" / "abc.eml").read_bytes(), policy=policy.default
    )
    assert parsed["From"] == "Sorties scolaires liO – démo <sorties@zhaoyang.fr>"
    assert parsed["To"] == "destinataire@example.fr"
    assert parsed["Reply-To"] == "contact@example.fr"
    assert parsed["Subject"].startswith("Votre récapitulatif de voyage — Toulouse Matabiau")
    assert "Bonjour Mme Martin" in parsed.get_body(("plain",)).get_content()
    assert "cid:logo" in parsed.get_body(("html",)).get_content()
    attachments = list(parsed.iter_attachments())
    assert [part.get_filename() for part in attachments] == ["recapitulatif-SIM-050033B9.pdf"]
    assert attachments[0].get_content() == PDF
    inline = [part for part in parsed.walk() if part.get("Content-ID") == "<logo>"]
    assert len(inline) == 1 and inline[0].get_content_type() == "image/png"


def test_live_mode_sends_through_mailato_with_a_key_tied_to_the_recap(config, monkeypatch):
    calls = []

    def fake_send(message, settings, *, idempotency_key=None, audit_id=None):
        calls.append((message, settings, idempotency_key, audit_id))
        return mailato.SendResult("resend", "email_1", 2, idempotency_key)

    monkeypatch.setattr(mailato, "send", fake_send)
    live = replace(
        config, mail_mode="live", resend_api_key="re_test", allowed_domains=("example.fr",)
    )
    message = compose(example("01-aller-retour-complet"), PDF, live)

    delivery = deliver(message, live, recap_id="abc")

    assert (delivery.provider, delivery.message_id, delivery.attempts) == ("resend", "email_1", 2)
    sent, settings, key, audit = calls[0]
    assert sent is message
    assert (key, audit) == ("sncf-bilan-abc", "abc")
    assert settings.mail_from == live.mail_from
    assert settings.resend_api_key == "re_test"
    assert settings.max_recipients == 1
    assert tuple(settings.allowed_domains) == ("example.fr",)
    assert not (config.data_dir / "outbox").exists()


def test_composed_message_passes_mailato_validation_and_builds_a_resend_payload(config):
    message = compose(example("03-correspondance-premiere-classe"), PDF, config)
    settings = mailato.Settings(mail_from=config.mail_from, resend_api_key="re_test")
    payload = mailato.build_resend_payload(message, settings)
    assert payload["to"] == ["destinataire@example.fr"]
    assert {item.get("content_id") for item in payload["attachments"]} == {None, "logo"}
    write_eml(message, config, config.data_dir / "x.eml")
