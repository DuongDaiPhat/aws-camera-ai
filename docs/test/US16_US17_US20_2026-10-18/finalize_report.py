"""Validate the case schema and build a manifest from qualified run evidence."""
import hashlib
import json
import re
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from build_cases import CASES, HEADERS

HERE = Path(__file__).resolve().parent
QA = Path(r'C:\Users\ADMIN\.codex\visualizations\2026\10\18\01a14e4d-7ffe-7073-9f17-463257072541\qa-us16-us17-us20')
EVIDENCE = HERE / 'evidence'
results = json.loads((HERE / 'case_results.json').read_text(encoding='utf-8'))
assert len(HEADERS) == 16
assert len(CASES) == 48
assert len({row[0] for row in CASES}) == 48
assert set(results) == {row[0] for row in CASES}
assert all(len(row) == 16 and row[14] == 'Not Run' for row in CASES)
assert all(entry['result'] in {'Passed', 'Failed', 'Blocked', 'N/A', 'Not Run'} for entry in results.values())
for row in CASES:
    assert row[4] in {'Web', 'Orchestrator', 'AI Service', 'Edge/MQTT', 'Database', 'Storage', 'External Integration', 'End-to-end'}
    assert row[5] in {'Function', 'UI', 'Validation', 'Security', 'Integration', 'Reliability', 'Performance'}
    assert row[6] in {'P0', 'P1', 'P2'}
    assert row[12] in {'Đã triển khai', 'Một phần', 'Chưa tìm thấy', 'Chưa xác minh'}
    assert row[13] in {'Manual', 'Automation'}
    assert '§' not in row[1]
    assert 'Mục ' in row[1] or 'Code-only:' in row[1]
by_level = defaultdict(Counter)
for row in CASES:
    by_level[row[3]][results[row[0]]['result']] += 1

qualified = ['baseline-jest', 'baseline-python', 'baseline-bridge', 'fall-jest-existing-valid',
             'fall-jest-regression-valid', 'fall-python-final', 'fall-python-regression',
             'fall-model-smoke', 'fall-bridge', 'wellness-jest-existing', 'wellness-jest-regression',
             'db-migration-gate', 'runtime-db-migrate', 'candidate-existing-jest', 'candidate-db-complete',
             'candidate-http-qualified', 'candidate-ai-live-http', 'candidate-web', 'candidate-tools',
             'candidate-typecheck', 'candidate-lint', 'candidate-api', 'candidate-contracts-generate',
             'candidate-format-final', 'candidate-python-quality', 'candidate-python-format']
commands = [json.loads((EVIDENCE / (label + '.json')).read_text(encoding='utf-8')) for label in qualified]
jest_summary = {}
for name in ['baseline-jest-results', 'fall-jest-existing-valid-results', 'wellness-existing-results', 'candidate-existing-results',
             'fall-regression-valid-results', 'wellness-regression-results', 'candidate-db-complete-results', 'candidate-http-qualified-results']:
    data = json.loads((EVIDENCE / f'{name}.json').read_text(encoding='utf-8'))
    jest_summary[name] = {field: data[field] for field in ['numTotalTests', 'numPassedTests', 'numFailedTests', 'numPendingTests']}
additional = [jest_summary[name] for name in ['fall-regression-valid-results', 'wellness-regression-results', 'candidate-db-complete-results', 'candidate-http-qualified-results']]
additional_summary = {'total': 15 + sum(r['numTotalTests'] for r in additional),
                      'passed': 9 + sum(r['numPassedTests'] for r in additional),
                      'failed': 6 + sum(r['numFailedTests'] for r in additional)}
assert additional_summary == {'total': 61, 'passed': 22, 'failed': 39}
assert re.search(r'6 failed, 9 passed', (EVIDENCE / 'fall-python-regression.txt').read_text(encoding='utf-8'))

audits = []
for description, arguments in [
    ('Frame source and timestamp', ['rg', '-n', 'latest.jpg|build_pose_frame_header|urlopen', 'infra/frigate/frame-metadata/bridge.py']),
    ('M1/ingestion source feed wiring', ['rg', '-n', 'wellness|Wellness', 'apps/orchestrator/src/face-recognition', 'apps/orchestrator/src/ingestion']),
    ('Wellness UI source', ['rg', '-n', '-i', 'wellness', 'apps/web/src']),
    ('Fall pending worker/sweeper wiring', ['rg', '-n', 'sweep_all|fall_incidents|delivery_status', 'apps/orchestrator/src/fall-detection', 'services/ai-service/app']),
]:
    run = subprocess.run(arguments, cwd=QA, capture_output=True, text=True, encoding='utf-8')
    audits.append({'description': description, 'command': arguments, 'exit_code': run.returncode, 'output': run.stdout, 'stderr': run.stderr})
(EVIDENCE / 'source-audit.txt').write_text(json.dumps(audits, ensure_ascii=False, indent=2), encoding='utf-8')
references = {}
for ref in ['main', 'origin/main', 'origin/feat/US-16-US-17-pose-fall', 'origin/feat/US-20-wellness-check', 'HEAD']:
    references[ref] = subprocess.check_output(['git', 'rev-parse', ref], cwd=QA, text=True).strip()
assert references['main'] == references['origin/main'] == '0f5c948a27fc82e1e20cfd35bf56781a468750f2'
checks = {}
for label, arguments in [('generated_diff', ['git','diff','--exit-code','--','packages/contracts/src/generated']),
                          ('diff_check', ['git','diff','--check'])]:
    run = subprocess.run(arguments, cwd=QA, capture_output=True, text=True, encoding='utf-8')
    checks[label] = {'exit_code':run.returncode,'output':run.stdout+run.stderr}
    assert run.returncode == 0
manifest = {'created_at_utc': datetime.now(timezone.utc).isoformat(), 'references': references,
            'sheet_cases': dict(Counter(entry['result'] for entry in results.values())),
            'by_level': {key:dict(value) for key,value in by_level.items()}, 'additional_assertions':additional_summary,
            'jest_summary':jest_summary, 'qualified_commands':commands, 'diff_checks':checks,
            'excluded_from_product_totals': 'Earlier sandbox/cache/temp failures and QA fixture preparation (user login constraint, camera slug, HTTP prefix) are diagnostics only; qualified labels above supersede them. No product defect is inferred from those attempts.',
            'ci_observation': {'source':'mcp__code_review__pull_requests_checks', 'queried_date':'2026-10-18',
                               'pr28':{'head':references['origin/feat/US-16-US-17-pose-fall'],'CI xanh':'success','all_checks':9,
                                       'url':'https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/39022634533'},
                               'pr27':{'head':references['origin/feat/US-20-wellness-check'],'CI xanh':'success','all_checks':9,
                                       'url':'https://github.com/DuongDaiPhat/aws-camera-ai/actions/runs/38933224776'}}}
manifest['regression_sha256'] = {path.name:hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted((HERE / 'regression').iterdir()) if path.is_file()}
(EVIDENCE / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'cases':manifest['sheet_cases'],'by_level':manifest['by_level'],'additional':additional_summary}, ensure_ascii=False, indent=2))
