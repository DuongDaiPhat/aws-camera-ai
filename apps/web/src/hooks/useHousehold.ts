'use client';
import { useCallback, useEffect, useState } from 'react';
import { getHousehold, type Household } from '@/lib/household-client';
export function useHousehold() {
  const [data, setData] = useState<Household | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState('');
  const reload = useCallback(async (signal?: AbortSignal) => {
    const next = await getHousehold(signal);
    if (!signal?.aborted) setData(next);
  }, []);
  useEffect(() => {
    const abort = new AbortController();
    void reload(abort.signal)
      .catch((e: unknown) => {
        if (!abort.signal.aborted)
          setError(e instanceof Error ? e.message : 'Không tải được hộ gia đình.');
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoading(false);
      });
    return () => abort.abort();
  }, [reload]);
  async function run(work: () => Promise<unknown>, message: string) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      await reload();
      setNotice(message);
      return true;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Không lưu được. Hãy thử lại.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { data, error, loading, busy, notice, run, reload };
}
