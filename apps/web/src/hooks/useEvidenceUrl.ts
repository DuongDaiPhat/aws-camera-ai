'use client';

import { useEffect, useState } from 'react';

/** Keep playback stable while background detail requests renew signed URLs. */
export function useEvidenceUrl(incoming: string | null, failed: boolean): string | null {
  const [current, setCurrent] = useState(incoming);
  const identity = (url: string | null): string => url?.split('?')[0] ?? '';
  useEffect(() => {
    setCurrent((previous) =>
      !previous || failed || identity(previous) !== identity(incoming) ? incoming : previous,
    );
  }, [incoming, failed]);
  return identity(current) === identity(incoming) ? current : incoming;
}
