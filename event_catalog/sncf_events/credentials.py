"""Small literal-only .env reader; never evaluate shell syntax or disclose values."""
import contextlib
import os
from pathlib import Path

NAMES = ('DATATOURISME_API_KEY','OPENAGENDA_PUBLIC_KEY')


def read_env_file(path):
    path = Path(path)
    if path.stat().st_size>8192:
        raise ValueError('credential_file_exceeds_8_KiB')
    result = {}
    for number,line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(),1):
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError('invalid_credential_line:'+str(number))
        name,value = (part.strip() for part in line.split('=',1))
        if name not in NAMES or name in result:
            raise ValueError('unknown_or_duplicate_credential_name_at_line:'+str(number))
        if value.startswith(('"',"'")):
            if len(value)<2 or value[-1]!=value[0]:
                raise ValueError('unclosed_credential_quote_at_line:'+str(number))
            value = value[1:-1]
        # API keys are opaque header values, never shell commands or interpolated strings.
        if len(value)>2048 or any(ord(c)<33 or ord(c)>126 for c in value) or any(c in value for c in '$`'):
            raise ValueError('invalid_credential_value_at_line:'+str(number))
        result[name] = value
    return result


@contextlib.contextmanager
def credential_environment(path, *, required=False):
    values = read_env_file(path) if Path(path).exists() or required else {}
    added = []
    try:
        for name,value in values.items():
            if name not in os.environ and value:
                os.environ[name] = value
                added.append(name)
        yield
    finally:
        for name in added:
            os.environ.pop(name,None)


def credential_status():
    result = {}
    for name in NAMES:
        value = os.environ.get(name,'')
        status = 'configured' if value else 'missing'
        if value and (len(value)>2048 or any(ord(c)<33 or ord(c)>126 for c in value)):
            status = 'invalid_header_value'
        if value and name=='OPENAGENDA_PUBLIC_KEY' and not value.startswith('oa_pk_'):
            status = 'requires_oa_pk_public_key'
        result[name] = status
    return result
