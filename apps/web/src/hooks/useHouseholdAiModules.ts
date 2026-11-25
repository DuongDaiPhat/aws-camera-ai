'use client';

import { useEffect, useState } from 'react';
import {
  AI_MODULES_UPDATED_EVENT,
  getHouseholdAiModules,
  type HouseholdAiModulesSettings,
} from '@/lib/household-client';

export function useHouseholdAiModules(enabled: boolean): HouseholdAiModulesSettings | null {
  const [modules, setModules] = useState<HouseholdAiModulesSettings | null>(null);

  useEffect(() => {
    if (!enabled) {
      setModules(null);
      return;
    }
    const controller = new AbortController();
    void getHouseholdAiModules(controller.signal)
      .then((res) => {
        if (!controller.signal.aborted) setModules(res);
      })
      .catch(() => undefined);

    const onUpdated = (event: Event) => {
      const detail = (event as CustomEvent<HouseholdAiModulesSettings>).detail;
      if (detail) setModules(detail);
    };
    window.addEventListener(AI_MODULES_UPDATED_EVENT, onUpdated);
    return () => {
      controller.abort();
      window.removeEventListener(AI_MODULES_UPDATED_EVENT, onUpdated);
    };
  }, [enabled]);

  return modules;
}
