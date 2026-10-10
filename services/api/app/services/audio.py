"""Checks an uploaded recording before it is sent to the transcription provider.

The declared MIME type is only a hint: `ffprobe` must find a real audio stream, and the duration
is capped. Bytes live in a temporary file for the probe and are deleted immediately; nothing is
persisted or logged.
"""

from __future__ import annotations

import contextlib
import json
import logging
import os
import subprocess
import tempfile

from app.core.errors import AppError

log = logging.getLogger(__name__)

ALLOWED_TYPES = {
    "audio/webm": ".webm",
    "video/webm": ".webm",  # some browsers label MediaRecorder audio this way
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "video/mp4": ".m4a",
    "audio/x-m4a": ".m4a",
    "audio/m4a": ".m4a",
    "audio/flac": ".flac",
}
PROBE_TIMEOUT_SECONDS = 8
DECODE_TIMEOUT_SECONDS = 20


def suffix_for(content_type: str) -> str:
    try:
        return ALLOWED_TYPES[content_type]
    except KeyError:
        raise AppError(400, "AUDIO_FORMAT", "Format audio non pris en charge.") from None


def _invalid() -> AppError:
    return AppError(400, "AUDIO_INVALID", "Le fichier ne contient pas un enregistrement audio exploitable.")


def _decoded_duration(path: str, limit_seconds: int) -> float:
    """MediaRecorder WebM often has no duration header: decode at most limit+1 s of 8 kHz mono PCM."""
    try:
        done = subprocess.run(
            ["ffmpeg", "-v", "error", "-i", path, "-t", str(limit_seconds + 1)]
            + ["-f", "s16le", "-ac", "1", "-ar", "8000", "pipe:1"],
            capture_output=True,
            timeout=DECODE_TIMEOUT_SECONDS,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise _invalid() from None
    if done.returncode != 0:
        raise _invalid()
    return len(done.stdout) / 16000


def inspect_audio(data: bytes, content_type: str, max_seconds: int) -> float | None:
    """Returns the duration in seconds, or None when ffprobe is not installed (check skipped)."""
    suffix = suffix_for(content_type)
    path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
            handle.write(data)
            path = handle.name
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type"]
                + ["-of", "json", path],
                capture_output=True,
                timeout=PROBE_TIMEOUT_SECONDS,
                check=False,
            )
        except FileNotFoundError:
            log.warning("ffprobe not installed: audio content and duration checks skipped")
            return None
        except subprocess.TimeoutExpired:
            raise _invalid() from None
        if probe.returncode != 0:
            raise _invalid()
        info = json.loads(probe.stdout or b"{}")
        if not any(stream.get("codec_type") == "audio" for stream in info.get("streams", [])):
            raise _invalid()
        raw_duration = info.get("format", {}).get("duration")
        try:
            duration = (
                float(raw_duration) if raw_duration is not None else _decoded_duration(path, max_seconds)
            )
        except (TypeError, ValueError):
            duration = _decoded_duration(path, max_seconds)
        if duration <= 0:
            raise _invalid()
        if duration > max_seconds:
            raise AppError(
                413, "AUDIO_TOO_LONG", f"Enregistrement trop long ({max_seconds} secondes maximum)."
            )
        return duration
    finally:
        if path is not None:
            with contextlib.suppress(FileNotFoundError):
                os.unlink(path)
