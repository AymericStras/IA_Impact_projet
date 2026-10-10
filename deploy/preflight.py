#!/usr/bin/env python3
"""Read-only host readiness. This is not a runtime reservation or Docker isolation proof."""
import json
import shutil
import subprocess
import sys


def guard_result(run=subprocess.run, which=shutil.which):
    if not which('host-guard'):
        return {'allowed': False, 'reasons': ['host_guard_missing']}
    try:
        result = run(['host-guard', 'preflight', '--memory-mb', '768'],
                     capture_output=True, text=True, timeout=30)
        value = json.loads(result.stdout)
        if (not isinstance(value, dict) or type(value.get('allowed')) is not bool
                or not isinstance(value.get('reasons'), list)
                or not all(isinstance(x, str) for x in value['reasons'])):
            raise ValueError('invalid_guard_response')
        if result.returncode != 0 or value['allowed'] is not True or value['reasons']:
            return {'allowed': False, 'reasons': value['reasons'] or ['host_guard_refused']}
        if value.get('request', {}).get('memory_bytes') != 768 * 1024**2:
            raise ValueError('unexpected_guard_budget')
        return value
    except (OSError, ValueError, TypeError, subprocess.TimeoutExpired) as error:
        return {'allowed': False, 'reasons': ['host_guard_unavailable:' + type(error).__name__]}


def main():
    value = guard_result()
    if value['allowed'] and len(sys.argv) == 3:
        try:
            conflicts = occupied_ports([int(x) for x in sys.argv[1:]])
            if conflicts:
                value.update(allowed=False, reasons=conflicts)
        except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as error:
            value.update(allowed=False, reasons=['port_ownership_unavailable:' + type(error).__name__])
    value['scope'] = 'readiness_only_not_runtime_reservation'
    print(json.dumps(value, indent=2))
    return 0 if value['allowed'] else 3


def occupied_ports(ports, run=subprocess.run):
    """A used port is reusable only when its Docker binding belongs to this stack."""
    listeners = run(['ss', '-H', '-ltn'], capture_output=True, text=True, check=True, timeout=10)
    used = {int(line.split()[3].rsplit(':', 1)[1]) for line in listeners.stdout.splitlines()}
    containers = run(['docker', 'ps', '-q'], capture_output=True, text=True, check=True, timeout=10)
    owned, foreign = set(), set()
    if containers.stdout.strip():
        fmt = '{{json .Config.Labels}}\t{{json .NetworkSettings.Ports}}'
        details = run(['docker', 'inspect', '--format', fmt, *containers.stdout.split()],
                      capture_output=True, text=True, check=True, timeout=10)
        for line in details.stdout.splitlines():
            labels, bindings = (json.loads(x) for x in line.split('\t'))
            ours = (labels.get('com.docker.compose.project') == 'sncf-chatbot'
                    and labels.get('com.docker.compose.service') in ('api', 'web'))
            for entries in bindings.values():
                for binding in entries or []:
                    target = owned if ours and binding['HostIp'] == '127.0.0.1' else foreign
                    target.add(int(binding['HostPort']))
    return ['port_in_use:' + str(p) for p in ports if p in foreign or (p in used and p not in owned)]


if __name__ == '__main__':
    sys.exit(main())
