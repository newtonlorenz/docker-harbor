#!/usr/bin/env python3
"""Attach Harbor to app networks, optionally renew a Tailscale certificate."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent


def run(*args, check=True):
    return subprocess.run(args, cwd=ROOT, capture_output=True, text=True, check=check)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--renew-tailscale-cert', action='store_true',
                        help='renew a Tailscale certificate when less than 7 days remain')
    args = parser.parse_args()
    config = json.loads(run('docker', 'compose', 'config', '--format', 'json').stdout)
    env = config['services']['harbor']['environment']
    cid = run('docker', 'compose', 'ps', '-q', 'harbor').stdout.strip()
    if not cid:
        raise SystemExit('Harbor is not running. Start it with docker compose up -d --build.')
    container = json.loads(run('docker', 'inspect', cid).stdout)[0]
    connected = set(container['NetworkSettings']['Networks'])
    allowed = {n.strip() for n in (env.get('HARBOR_ATTACH_NETWORKS') or '').split(',') if n.strip()}
    network_ids = run('docker', 'network', 'ls', '-q').stdout.split()
    networks = json.loads(run('docker', 'network', 'inspect', *network_ids).stdout) if network_ids else []
    for network in networks:
        name = network['Name']
        if name in connected or name in {'host', 'none', 'ingress', 'docker_gwbridge', 'bridge'}:
            continue
        if network.get('Internal') or network['Driver'] != 'bridge' or (allowed and name not in allowed):
            continue
        run('docker', 'network', 'connect', name, cid)
        print('Attached Harbor to', name)
    if args.renew_tailscale_cert:
        cert, key = ROOT / 'private/harbor.crt', ROOT / 'private/harbor.key'
        check = run('openssl', 'x509', '-checkend', '604800', '-noout', '-in', str(cert), check=False)
        if check.returncode:
            run('tailscale', 'cert', '--cert-file', str(cert), '--key-file', str(key), env['HARBOR_HOST'])
            os.chmod(key, 0o600)
            run('docker', 'compose', 'restart', 'harbor')
            print('Renewed certificate and restarted Harbor')


if __name__ == '__main__':
    main()
