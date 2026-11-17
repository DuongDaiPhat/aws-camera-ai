/** Keep saved priorities while adding new cameras and removing stale/duplicate IDs. */
export function reconcileCameraOrder(
  available: readonly string[],
  preferred: readonly string[],
): string[] {
  const remaining = new Set(available);
  const ordered: string[] = [];
  for (const id of preferred) {
    if (remaining.delete(id)) ordered.push(id);
  }
  return [...ordered, ...remaining];
}

export function moveCamera(ids: readonly string[], source: string, target: string): string[] {
  const from = ids.indexOf(source);
  const to = ids.indexOf(target);
  const result = [...ids];
  if (from < 0 || to < 0 || from === to) return result;
  result.splice(from, 1);
  result.splice(to, 0, source);
  return result;
}
