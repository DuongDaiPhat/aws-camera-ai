"""Capture repeatable commands without reading or logging environment secrets."""
import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

parser = argparse.ArgumentParser()
parser.add_argument('--label', required=True)
parser.add_argument('--cwd', required=True)
parser.add_argument('--timeout', type=int, default=1200)
parser.add_argument('command', nargs=argparse.REMAINDER)
args = parser.parse_args()
command = args.command[1:] if args.command[:1] == ['--'] else args.command
destination = Path(__file__).resolve().parent / 'evidence'
destination.mkdir(exist_ok=True)
environment = os.environ.copy()
environment.update({'CI': 'true', 'PYTHONIOENCODING': 'utf-8', 'NO_COLOR': '1', 'npm_config_manage_package_manager_versions': 'false'})
started = datetime.now(timezone.utc).isoformat()
tick = time.monotonic()
try:
    result = subprocess.run(command, cwd=args.cwd, env=environment, capture_output=True, timeout=args.timeout)
    output = result.stdout.decode('utf-8', errors='replace') + '\n' + result.stderr.decode('utf-8', errors='replace')
    code = result.returncode
except subprocess.TimeoutExpired as error:
    output = str(error) + '\n' + (error.stdout or b'').decode('utf-8', errors='replace') + (error.stderr or b'').decode('utf-8', errors='replace')
    code = 124
except OSError as error:
    output, code = str(error), 127
try:
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=args.cwd, text=True).strip()
except subprocess.CalledProcessError:
    revision = None
record = {'label': args.label, 'cwd': args.cwd, 'command': command, 'revision': revision, 'started_utc': started, 'duration_seconds': round(time.monotonic() - tick, 3), 'exit_code': code}
(destination / f'{args.label}.txt').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n\n' + output, encoding='utf-8')
(destination / f'{args.label}.json').write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(record, ensure_ascii=False))
print(output[-2400:])
