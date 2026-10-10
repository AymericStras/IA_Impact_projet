#!/usr/bin/env python3
"""Send one request file to a real mailbox through Mailato, without the HTTP service.

    uv run python scripts/send_example.py contracts/examples/01-aller-retour-complet.json \\
        --to you@example.com            # shows what would be sent
    ... --to you@example.com --yes      # sends

Needs RESEND_API_KEY (or RESEND_API_KEY_FILE) in the environment. Without
--yes nothing leaves the machine.
"""

from __future__ import annotations

import argparse
import sys
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path

from mailato import api as mailato

from sncf_bilan.config import Config, ConfigurationError
from sncf_bilan.mail.compose import compose
from sncf_bilan.mail.deliver import deliver
from sncf_bilan.models import RecapRequest
from sncf_bilan.pdf.render import render_pdf


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("request", type=Path, help="JSON request file")
    parser.add_argument("--to", required=True, help="recipient; replaces the one in the file")
    parser.add_argument("--yes", action="store_true", help="actually send")
    args = parser.parse_args()

    data = RecapRequest.model_validate_json(args.request.read_text(encoding="utf-8"))
    request = RecapRequest.model_validate(
        {
            **data.model_dump(mode="json"),
            "recipient": {"email": args.to, "name": data.recipient.name},
        }
    )
    config = replace(Config.from_env(), mail_mode="live")
    pdf = render_pdf(
        request.trip,
        fingerprint=request.fingerprint(),
        logo=config.logo_svg,
        issued_at=datetime.now(UTC),
    )
    message = compose(request, pdf, config)

    print(f"From:       {config.mail_from}")
    print(f"To:         {', '.join(message.to)}")
    print(f"Reply-To:   {', '.join(message.reply_to) or '(none)'}")
    print(f"Subject:    {message.subject}")
    for attachment in message.attachments:
        kind = "inline" if attachment.content_id else "attached"
        print(f"Attachment: {attachment.filename} ({len(attachment.content)} bytes, {kind})")
    if not args.yes:
        print("\nNothing sent. Add --yes to send.")
        return 0

    try:
        config.check_for_live_sending()
        delivery = deliver(message, config, recap_id=f"example-{uuid.uuid4()}")
    except (ConfigurationError, mailato.ConfigError) as exc:
        print(f"Not sent: {exc}", file=sys.stderr)
        return 2
    except mailato.SendError as exc:
        print(f"Send failed: {exc}", file=sys.stderr)
        return 1
    print(f"\nSent via {delivery.provider}, message id {delivery.message_id}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
