/** Measure clock offset without changing Windows or Docker time settings. */
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const durationSeconds = Number(process.argv[2] ?? 60);
const report = resolve(process.argv[3] ?? 'artifacts/m3/evaluation/clock-offset.json');
const nodeImage = process.argv[4] ?? 'camerai-us18-orchestrator:local';
const container = `camerai-us18-clock-${process.pid}`;
if (!Number.isInteger(durationSeconds) || durationSeconds < 5 || durationSeconds > 3600)
  throw new Error('Duration must be 5..3600 seconds');
const python = [
  'import json,sys,time,threading',
  'from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer',
  'class Handler(BaseHTTPRequestHandler):',
  ' def do_GET(self):',
  '  received=time.time_ns()/1e6',
  '  self.send_response(200);self.send_header("Content-Type","application/json");self.end_headers()',
  '  self.wfile.write(json.dumps({"receivedMs":received,"sentMs":time.time_ns()/1e6}).encode())',
  ' def log_message(self,*args):pass',
  'threading.Thread(target=ThreadingHTTPServer(("0.0.0.0",8765),Handler).serve_forever,daemon=True).start()',
  'print(json.dumps({"ready":True}),flush=True)',
  'for line in sys.stdin:',
  ' received=time.time_ns()/1e6',
  ' request=json.loads(line)',
  ' print(json.dumps({"id":request["id"],"receivedMs":received,"sentMs":time.time_ns()/1e6,"monotonicMs":time.monotonic_ns()/1e6}),flush=True)',
].join('\n');
const child = spawn(
  'docker',
  [
    'run',
    '--rm',
    '--name',
    container,
    '-i',
    '--entrypoint',
    'python',
    'camerai-us18-ai:local',
    '-u',
    '-c',
    python,
  ],
  { stdio: ['pipe', 'pipe', 'inherit'] },
);
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
child.once('error', (error) => {
  throw error;
});
const samples = [];
let dockerComparison;
const handshake = await lines.next();
if (handshake.done || !JSON.parse(handshake.value).ready)
  throw new Error('Clock probe failed to start');
const initialWallMs = Date.now();
const initialMonotonicMs = performance.now();
console.log(`Measuring Windows-to-Docker clock for ${durationSeconds} seconds`);
try {
  for (let id = 0; id < durationSeconds; id++) {
    const startedWallMs = Date.now();
    const startedMonotonicMs = performance.now();
    child.stdin.write(`${JSON.stringify({ id })}\n`);
    const line = await lines.next();
    const finishedWallMs = Date.now();
    const finishedMonotonicMs = performance.now();
    if (line.done) throw new Error('Clock probe ended before measurement completed');
    const remote = JSON.parse(line.value);
    if (remote.id !== id) throw new Error('Clock probe response identity mismatch');
    const roundTripMs = finishedMonotonicMs - startedMonotonicMs;
    samples.push({
      id,
      at: new Date(finishedWallMs).toISOString(),
      offsetMs: (remote.receivedMs - startedWallMs + (remote.sentMs - finishedWallMs)) / 2,
      uncertaintyMs: roundTripMs / 2,
      hostWallStepMs: finishedWallMs - startedWallMs - roundTripMs,
      hostWallDriftMs: finishedWallMs - initialWallMs - (finishedMonotonicMs - initialMonotonicMs),
      remoteWallMs: remote.sentMs,
      remoteMonotonicMs: remote.monotonicMs,
    });
    if ((id + 1) % 15 === 0) console.log(`Clock samples: ${id + 1}/${durationSeconds}`);
    await delay(1000);
  }
  const nodeProbe = `
    (async () => {
      const samples = [];
      for (let index=0;index<30;index++) {
        const before=Date.now(), started=performance.now();
        const response=await fetch('http://127.0.0.1:8765');
        const remote=await response.json(), after=Date.now();
        samples.push({offsetMs:((remote.receivedMs-before)+(remote.sentMs-after))/2,uncertaintyMs:(performance.now()-started)/2});
        await new Promise(resolve=>setTimeout(resolve,250));
      }
      console.log(JSON.stringify({nodeVersion:process.version,samples}));
    })().catch(error=>{console.error(error.message);process.exitCode=1});
  `;
  dockerComparison = JSON.parse(
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        `container:${container}`,
        '--entrypoint',
        'node',
        nodeImage,
        '-e',
        nodeProbe,
      ],
      { encoding: 'utf8' },
    ),
  );
} finally {
  child.stdin.end();
  await new Promise((resolveExit) => child.once('exit', resolveExit));
}
const values = samples.map((item) => item.offsetMs).sort((left, right) => left - right);
const summary = {
  samples: samples.length,
  offsetMinMs: values[0],
  offsetMedianMs: values[Math.floor(values.length / 2)],
  offsetMaxMs: values.at(-1),
  maxUncertaintyMs: Math.max(...samples.map((item) => item.uncertaintyMs)),
  hostWallDriftRangeMs:
    Math.max(...samples.map((item) => item.hostWallDriftMs)) -
    Math.min(...samples.map((item) => item.hostWallDriftMs)),
  nodeVersion: process.version,
  clocksModified: false,
  dockerNodeImage: nodeImage,
};
summary.dockerNodeVersion = dockerComparison.nodeVersion;
summary.sameKernelOffsetMaxAbsMs = Math.max(
  ...dockerComparison.samples.map((item) => Math.abs(item.offsetMs)),
);
await mkdir(dirname(report), { recursive: true });
await writeFile(report, JSON.stringify({ summary, samples, dockerComparison }, null, 2));
console.log(JSON.stringify(summary));
console.log(`Clock evidence: ${report}`);
