// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  claimFireAttention,
  fireAttentionStorageKey,
  readFireReceipts,
  saveFireReceipts,
} from './fire-attention-storage';
const receipt = {
  cameraId: 'cam',
  eventIds: ['e1'],
  firstDetectedAt: 1,
  lastDetectedAt: 2,
  shownAt: 3,
};
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
});
it.each([
  null,
  [],
  'bad',
  { ...receipt, cameraId: 1 },
  { ...receipt, eventIds: null },
  { ...receipt, eventIds: [1] },
  { ...receipt, firstDetectedAt: '1' },
  { ...receipt, lastDetectedAt: null },
  { ...receipt, shownAt: null },
])('rejects corrupted receipt records %o and returns a warning', (value) => {
  const user = 'invalid-' + JSON.stringify(value);
  localStorage.setItem(fireAttentionStorageKey(user), JSON.stringify([value]));
  const result = readFireReceipts(user);
  expect(result.receipts).toEqual([]);
  expect(result.warning).toContain('Không lưu được');
});
it('restores the latest memory snapshot when browser storage becomes unavailable', () => {
  expect(saveFireReceipts('cached', [receipt])).toBeNull();
  expect(readFireReceipts('cached').receipts).toEqual([receipt]);
  const set = vi.spyOn(Storage.prototype, 'setItem');
  expect(saveFireReceipts('cached', [receipt])).toBeNull();
  expect(set).not.toHaveBeenCalled();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw Error('denied');
  });
  expect(readFireReceipts('cached').receipts).toEqual([receipt]);
  expect(saveFireReceipts('cached', [receipt])).toContain('Không lưu được');
});
it('rejects malformed JSON or a non-array store and treats missing storage as empty', () => {
  expect(readFireReceipts('new')).toEqual({ receipts: [], warning: null });
  for (const raw of ['broken', '{}']) {
    localStorage.setItem(fireAttentionStorageKey('broken'), raw);
    expect(readFireReceipts('broken').warning).not.toBeNull();
  }
});
it('serializes cross-tab alert claims with Web Locks when available', async () => {
  const claim = vi.fn();
  const request = vi.fn(async (_key: string, callback: () => void) => callback());
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  await claimFireAttention('owner', claim);
  expect(request).toHaveBeenCalledWith(fireAttentionStorageKey('owner'), claim);
  expect(claim).toHaveBeenCalledOnce();
  Object.defineProperty(navigator, 'locks', { value: undefined, configurable: true });
  await claimFireAttention('owner', claim);
  expect(claim).toHaveBeenCalledTimes(2);
});
