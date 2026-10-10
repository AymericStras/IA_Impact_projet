"""Build the report email: subject, plain text, HTML, PDF attachment, inline logo.

Every value comes from `view.build_mail_view`, itself derived from the `ReportView`
the PDF is rendered from: the email cannot say something the PDF does not.
"""

from __future__ import annotations

import logging
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from mailato.api import Attachment, Message

from ..config import Config
from ..models import TripReportRequest
from ..view import MailView, ReportView, build_mail_view

TEMPLATE_DIR = Path(__file__).resolve().parent
LOGO_CID = "logo"
log = logging.getLogger(__name__)


class NoRecipient(ValueError):
    """The request carries no `recipient.email`: there is nobody to send to."""


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


def render_parts(
    request: TripReportRequest,
    config: Config,
    *,
    report: ReportView | None = None,
    logo: bool = True,
) -> dict[str, str]:
    """Subject, text, html and the attachment name for a request.

    `logo=False` leaves the inline picture out (the file is missing): the HTML then
    has no image at all rather than a broken one.
    """
    mail = build_mail_view(request, config=config, report=report)
    context = {
        "mail": mail,
        "sender_name": config.sender_name,
        "reply_to": config.reply_to,
        "logo_cid": LOGO_CID if logo else None,
        "subject": mail.subject,
    }
    return {
        "subject": mail.subject,
        "text": _text_env.get_template("body.txt.j2").render(context),
        "html": _html_env.get_template("body.html.j2").render(context),
        "attachment_name": mail.attachment_name,
    }


def mail_view(request: TripReportRequest, config: Config) -> MailView:
    return build_mail_view(request, config=config)


def compose(
    request: TripReportRequest,
    pdf: bytes,
    config: Config,
    *,
    report: ReportView | None = None,
) -> Message:
    """The message for one request. Raises `NoRecipient` when there is no address."""
    recipient = request.recipient.email if request.recipient else None
    if not recipient:
        raise NoRecipient("recipient.email is missing")
    logo_png = config.logo_png if config.logo_png.is_file() else None
    if logo_png is None:
        log.warning("logo file is missing, email sent without it: %s", config.logo_png)
    parts = render_parts(request, config, report=report, logo=logo_png is not None)
    attachments = [Attachment(parts["attachment_name"], pdf, "application/pdf")]
    if logo_png is not None:
        attachments.append(
            Attachment("logo.png", logo_png.read_bytes(), "image/png", content_id=LOGO_CID)
        )
    return Message(
        to=[recipient],
        subject=parts["subject"],
        text=parts["text"],
        html=parts["html"],
        bcc=[address for address in config.copy_to if address.lower() != recipient.lower()],
        reply_to=[config.reply_to] if config.reply_to else [],
        attachments=attachments,
    )
