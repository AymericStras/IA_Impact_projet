#!/usr/bin/env python3
"""Edit only the SNCF gateway block, preserving the bind-mounted inode."""
import base64
import datetime
import fcntl
import os
from pathlib import Path
import re
import subprocess
import sys

BEGIN = '# BEGIN managed sncf-chatbot'
END = '# END managed sncf-chatbot'
PATTERN = re.compile(r'^# BEGIN managed sncf-chatbot\n.*?^# END managed sncf-chatbot\n?', re.S | re.M)


def render(text, block, remove=False):
    if text.count(BEGIN) != text.count(END) or text.count(BEGIN) > 1:
        raise ValueError('ambiguous_managed_block')
    if not remove and (not block.startswith(BEGIN + '\n') or not block.rstrip().endswith(END)
                       or block.count(BEGIN) != 1 or block.count(END) != 1):
        raise ValueError('empty_or_invalid_route_block')
    replacement = '' if remove else block.rstrip() + '\n'
    if PATTERN.search(text):
        return PATTERN.sub(lambda _: replacement, text, count=1)
    if BEGIN in text or END in text:
        raise ValueError('malformed_managed_block')
    if remove:
        return text
    anchor = 'server_name zhaoyang.fr;\n'
    if text.count(anchor) != 1:
        raise ValueError('expected_exactly_one_target_server')
    return text.replace(anchor, anchor + replacement, 1)


def update(conf, container, block, remove=False, run=subprocess.run):
    conf = Path(conf)
    with conf.open('r+', encoding='utf-8') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        before = handle.read()
        after = render(before, block, remove)
        if before == after:
            return 'unchanged'
        backup = conf.with_name(conf.name + '.before-sncf-chatbot-' +
                                datetime.datetime.now().strftime('%Y%m%dT%H%M%S%f'))
        with backup.open('x', encoding='utf-8') as saved:
            saved.write(before)
        backup.chmod(0o600)
        def write(value):
            handle.seek(0)
            handle.write(value)
            handle.truncate()
            handle.flush()
            os.fsync(handle.fileno())
        write(after)
        try:
            run(['docker', 'exec', container, 'nginx', '-t'], check=True,
                capture_output=True, text=True, timeout=10)
            run(['docker', 'exec', container, 'nginx', '-s', 'reload'], check=True,
                capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError):
            handle.seek(0)
            if handle.read() != after:
                raise RuntimeError('gateway_changed_concurrently_manual_review_required')
            write(before)
            # A reload may have succeeded before the client timed out. Restore
            # both disk and running configuration, and surface a recovery error.
            run(['docker', 'exec', container, 'nginx', '-t'], check=True,
                capture_output=True, text=True, timeout=10)
            run(['docker', 'exec', container, 'nginx', '-s', 'reload'], check=True,
                capture_output=True, text=True, timeout=10)
            raise RuntimeError('gateway_update_failed_original_restored')
        return str(backup)


if __name__ == '__main__':
    conf, container, action, encoded = sys.argv[1:]
    if conf != '/data/services/zenbook-gateway/nginx.conf' or container != 'zenbook-projects-gateway':
        raise SystemExit('unexpected_gateway_target')
    if action not in ('up', 'down'):
        raise SystemExit('invalid_gateway_action')
    block = base64.b64decode(encoded, validate=True).decode('utf-8')
    print(update(conf, container, block, remove=action == 'down'))
