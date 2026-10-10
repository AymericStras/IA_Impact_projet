"""Private viewer access using a generated 256-bit password, never an API key."""
import base64
import binascii
import hashlib
import hmac
import os
from pathlib import Path
import re
import secrets
import stat

from .db import dumps, loads


def generate_access(username='zhaoyang'):
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', username):
        raise ValueError('invalid_viewer_username')
    password = secrets.token_urlsafe(32)
    # A fast hash is appropriate only for this randomly generated 256-bit secret.
    # This is deliberately not a human-password registration/reset API.
    record = {'schema': 1, 'username': username,
              'token_sha256': hashlib.sha256(password.encode('ascii')).hexdigest()}
    return record, password


def load_access(path):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_size > 1024:
            raise ValueError('viewer_access_file_must_be_private_regular_file')
        record = loads(stream.read(1025))
    if (not isinstance(record, dict) or set(record) != {'schema','username','token_sha256'}
            or record['schema'] != 1
            or not isinstance(record['username'], str)
            or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', record['username'])
            or not isinstance(record['token_sha256'], str)
            or not re.fullmatch(r'[0-9a-f]{64}', record['token_sha256'])):
        raise ValueError('invalid_viewer_access_file')
    return record


def authorized(record, header):
    if not isinstance(header, str) or len(header) > 256 or not header.startswith('Basic '):
        return False
    try:
        raw = base64.b64decode(header[6:], validate=True).decode('ascii')
        username, password = raw.split(':', 1)
    except (ValueError, UnicodeError, binascii.Error):
        return False
    if not re.fullmatch(r'[A-Za-z0-9_-]{43}', password):
        return False
    name_ok = hmac.compare_digest(record['username'], username)
    token_ok = hmac.compare_digest(record['token_sha256'], hashlib.sha256(password.encode('ascii')).hexdigest())
    return name_ok and token_ok


def create_access(directory, username='zhaoyang'):
    """Exclusive private directory; no secret on stdout, argv or environment."""
    directory = Path(directory)
    record, password = generate_access(username)
    directory.mkdir(mode=0o700)  # Refuse an existing credential directory.
    for name, value in (('access.json', dumps(record)),
                        ('login.txt', 'URL: https://zhaoyang.fr/sncf-events/\nUsername: '
                         + username + '\nPassword: ' + password + '\n')):
        fd = os.open(directory/name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(value+'\n')
    return {'created': True, 'directory': str(directory), 'secrets_printed': False}
