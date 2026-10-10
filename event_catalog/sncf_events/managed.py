"""Read-only service entry. Host-guard admission is a separate deployment prerequisite.

Kernel checks here fail closed; they do not grant permission to install/start a unit.
No scheduler, API credentials, subprocesses, migration or database writer is used.
"""
import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import sys

from .access import load_access
from .db import connect
from .server import App, make_server, peak_rss

CGROUP = '/sncfeventsv2.slice/sncf-events-v2.service'


def verify_limits(io_device, *, root=Path('/'), platform=None):
    if (platform or sys.platform)!='linux' or not re.fullmatch(r'\d+:\d+',io_device):
        raise ValueError('managed_viewer_requires_linux_and_reviewed_device')
    def read(name):
        return (root/name.lstrip('/')).read_text().strip()
    if read('/proc/self/cgroup')!='0::'+CGROUP:
        raise ValueError('managed_viewer_wrong_cgroup')
    group = '/sys/fs/cgroup'+CGROUP+'/'
    for key,limit in [('memory.max',128*1024**2),('memory.high',96*1024**2),('pids.max',32)]:
        value = read(group+key)
        if not value.isdigit() or not 0<int(value)<=limit:
            raise ValueError('managed_viewer_unbounded_'+key)
    if read(group+'memory.swap.max')!='0' or read(group+'memory.oom.group')!='1':
        raise ValueError('managed_viewer_swap_or_oom_group')
    quota,period = read(group+'cpu.max').split()
    if not quota.isdigit() or not period.isdigit() or not 0<int(quota)<=int(period)//4:
        raise ValueError('managed_viewer_cpu_limit')
    lines = [line.split() for line in read(group+'io.max').splitlines()]
    device = next((dict(x.split('=') for x in line[1:]) for line in lines if line[0]==io_device),{})
    if any(not device.get(k,'').isdigit() or not 0<int(device[k])<=1000000 for k in ('rbps','wbps')):
        raise ValueError('managed_viewer_io_limit')
    status = dict(line.split(':',1) for line in read('/proc/self/status').splitlines() if ':' in line)
    uids = status['Uid'].split()
    if (len(uids)!=4 or any(int(x)<=0 for x in uids) or int(status['CapEff'].strip(),16)!=0
            or status['NoNewPrivs'].strip()!='1'):
        raise ValueError('managed_viewer_privileged')
    return {'cgroup':CGROUP,'kernel_limits_verified':True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--db',required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--auth-file')
    mode.add_argument('--public',action='store_true',help='explicit account-free read-only viewer')
    parser.add_argument('--io-device',required=True,help='reviewed backing device major:minor')
    args = parser.parse_args(argv)
    os.umask(0o077)
    verify_limits(args.io_device)
    access = load_access(args.auth_file) if args.auth_file else None
    if any(os.environ.get(k) for k in ('DATATOURISME_API_KEY','OPENAGENDA_PUBLIC_KEY')):
        raise ValueError('managed_viewer_must_not_receive_crawler_keys')
    for p in (Path(args.db).resolve(),Path(__file__).resolve().parent):
        if not os.statvfs(p).f_flag & os.ST_RDONLY:
            raise ValueError('managed_viewer_requires_readonly_mounts')
    with contextlib.closing(connect(args.db,readonly=True)) as conn:
        if not conn.execute("SELECT 1 FROM schema_migrations WHERE version='006_rail_walk'").fetchone():
            raise ValueError('managed_viewer_schema_mismatch')
    app = App(args.db,readonly=True,base_path='/sncf-events/',access=access,managed=True,public=args.public)
    server = make_server(app,8767)
    previous = {s:signal.signal(s,lambda *_:app.stop.set()) for s in (signal.SIGINT,signal.SIGTERM)}
    print(json.dumps({'ready':True,'mode':'public_readonly' if args.public else 'authenticated_readonly','port':8767}),flush=True)
    try:
        while not app.stop.is_set():
            if peak_rss()>112*1024**2:
                raise RuntimeError('managed_viewer_memory_budget_reached')
            server.handle_request()
    finally:
        app.close()
        server.server_close()
        for s,handler in previous.items():
            signal.signal(s,handler)
    return 0


if __name__=='__main__':
    try:
        raise SystemExit(main())
    except (ValueError,RuntimeError,OSError,KeyError,sqlite3.Error) as error:
        print(json.dumps({'ready':False,'error':type(error).__name__}),file=sys.stderr)
        raise SystemExit(2)
