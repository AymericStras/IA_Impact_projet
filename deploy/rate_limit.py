#!/usr/bin/env python3
"""Bound the uncompressed image stream to 2 MiB/s; no archive is written to root."""
import sys
import time

RATE = 2 * 1024 * 1024
CHUNK = 64 * 1024
started = time.monotonic()
sent = 0
while data := sys.stdin.buffer.read(CHUNK):
    sys.stdout.buffer.write(data)
    sys.stdout.buffer.flush()
    sent += len(data)
    remaining = sent / RATE - (time.monotonic() - started)
    if remaining > 0:
        time.sleep(remaining)
