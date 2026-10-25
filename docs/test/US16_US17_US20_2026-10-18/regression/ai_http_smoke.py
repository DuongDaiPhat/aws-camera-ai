"""Live HTTP smoke with the actual AI process and pinned local pose model."""
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

from PIL import Image

destination = Path(__file__).resolve().parents[1] / 'evidence'
image = io.BytesIO()
Image.new('RGB', (320, 240)).save(image, format='JPEG')
boundary = 'qa-form-boundary'
fields = {'trackId': 'qa-track', 'cameraSlug': 'qa-camera', 'sourceSessionId': 'qa-system',
          'frameId': 'qa-blank', 'frameTimestamp': datetime.now(UTC).isoformat(),
          'personBoundingBox': json.dumps({'x': 0.1, 'y': 0.1, 'width': 0.8, 'height': 0.8})}
parts = [f'--{boundary}\r\nContent-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode() for key, value in fields.items()]
parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="blank.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'.encode() + image.getvalue() + f'\r\n--{boundary}--\r\n'.encode())
payload = b''.join(parts)
environment = os.environ.copy()
environment['AI_INTERNAL_TOKEN'] = 'qa-only-live-ai-token-not-a-real-secret'
with (destination / 'ai-http-server.txt').open('w', encoding='utf-8') as server_log:
    process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '58001'], env=environment, stdout=server_log, stderr=subprocess.STDOUT)
    try:
        for attempt in range(100):
            try:
                with urllib.request.urlopen('http://127.0.0.1:58001/health', timeout=1) as response:
                    assert response.status == 200
                break
            except (OSError, urllib.error.URLError):
                if process.poll() is not None:
                    raise RuntimeError('AI server terminated before readiness')
                time.sleep(0.2)
        else:
            raise RuntimeError('AI server readiness timeout')
        headers = {'Content-Type': f'multipart/form-data; boundary={boundary}'}
        try:
            urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:58001/pose/fall', data=payload, headers=headers), timeout=10)
            raise AssertionError('Missing token must fail')
        except urllib.error.HTTPError as error:
            assert error.code == 401
        headers['X-Internal-Token'] = environment['AI_INTERNAL_TOKEN']
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:58001/pose/fall', data=payload, headers=headers), timeout=20) as response:
            result = json.load(response)
            assert response.status == 200
            assert result['state'] == 'MONITORING'
            assert result['poseAvailable'] is False
            assert result['error'] is None
            assert result['trackId'] == 'qa-track'
        print(json.dumps({'health_http': 'Passed', 'token_http': 'Passed', 'model_inference_http': 'Passed',
                          'state': result['state'], 'reason': result['reason'], 'accuracy_claim': False}))
    finally:
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
