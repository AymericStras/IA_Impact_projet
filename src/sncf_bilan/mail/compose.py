"""Build the recap email: subject, plain text, HTML, PDF attachment, inline logo."""

from __future__ import annotations

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from mailato.api import Attachment, Message

from ..config import Config
from ..models import RecapRequest
from ..view import attachment_filename, build_trip_view

TEMPLATE_DIR = Path(__file__).resolve().parent
LOGO_CID = "logo"

_loader = FileSystemLoader(TEMPLATE_DIR)
# Plain-text templates: there is no markup to escape.
_text_env = Environment(
    loader=_loader,
    autoescape=False,  # noqa: S701
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
    keep_trailing_newline=True,
)
_html_env = Environment(
    loader=_loader,
    autoescape=True,
    undefined=StrictUndefined,
    trim_blocks=True,
    lstrip_blocks=True,
)


def render_parts(request: RecapRequest, config: Config) -> dict[str, str]:
    """Return subject, text, html and the attachment name for a request."""
    context = {
        "trip": build_trip_view(request.trip),
        "recipient_name": request.recipient.name,
        "sender_name": config.sender_name,
        "reply_to": config.reply_to,
        "attachment_name": attachment_filename(request.trip),
        "logo_cid": LOGO_CID,
    }
    subject = " ".join(_text_env.get_template("subject.txt.j2").render(context).split())
    context["subject"] = subject
    return {
        "subject": subject,
        "text": _text_env.get_template("body.txt.j2").render(context),
        "html": _html_env.get_template("body.html.j2").render(context),
        "attachment_name": context["attachment_name"],
    }


def compose(request: RecapRequest, pdf: bytes, config: Config) -> Message:
    if not config.logo_png.is_file():
        raise FileNotFoundError(f"Logo file is missing: {config.logo_png}")
    parts = render_parts(request, config)
    recipient = request.recipient.email
    return Message(
        to=[recipient],
        subject=parts["subject"],
        text=parts["text"],
        html=parts["html"],
        bcc=[address for address in config.copy_to if address.lower() != recipient.lower()],
        reply_to=[config.reply_to] if config.reply_to else [],
        attachments=[
            Attachment(parts["attachment_name"], pdf, "application/pdf"),
            Attachment("logo.png", config.logo_png.read_bytes(), "image/png", content_id=LOGO_CID),
        ],
    )
