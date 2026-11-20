const MAX_PARALLEL_CLIPS = 2;
let running = 0;
interface Pending {
  run: () => void;
  signal: AbortSignal;
  reject: (reason: unknown) => void;
}
const pending: Pending[] = [];
function drain(): void {
  while (running < MAX_PARALLEL_CLIPS && pending.length) {
    const next = pending.shift();
    if (!next) break;
    if (next.signal.aborted) {
      next.reject(new DOMException('Aborted', 'AbortError'));
      continue;
    }
    next.run();
  }
}
export function queuePlayback<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const job: Pending = {
      signal,
      reject,
      run: () => {
        signal.removeEventListener('abort', cancel);
        running++;
        Promise.resolve()
          .then(work)
          .then(resolve, reject)
          .finally(() => {
            running--;
            drain();
          });
      },
    };
    const cancel = () => {
      const index = pending.indexOf(job);
      if (index >= 0) {
        pending.splice(index, 1);
        reject(new DOMException('Aborted', 'AbortError'));
      }
    };
    signal.addEventListener('abort', cancel, { once: true });
    pending.push(job);
    drain();
  });
}
