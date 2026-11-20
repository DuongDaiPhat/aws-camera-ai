export function cameraLayoutPresets(cameraCount: number): number[] {
  const count = Math.max(1, Math.ceil(cameraCount));
  const presets = [1];
  for (let size = 2; size <= Math.ceil(count / 2) * 2 && count > 1; size += 2) presets.push(size);
  return presets;
}

export function isCameraLayout(value: unknown): value is 'custom' | `${number}` {
  if (value === 'custom') return true;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  const count = Number(value);
  return Number.isSafeInteger(count) && (count === 1 || count % 2 === 0);
}

// Keep the stored preference: a temporarily unavailable camera may return later.
export function availableCameraLayout(layout: string, cameraCount: number): string {
  if (layout === 'custom') return layout;
  const presets = cameraLayoutPresets(cameraCount);
  return String(Math.min(Number(layout), presets[presets.length - 1]));
}

export function cameraLayoutOptions(cameraCount: number) {
  return [
    ...cameraLayoutPresets(cameraCount).map((count) => ({
      value: String(count),
      label: `${count} camera`,
    })),
    { value: 'custom', label: 'Tùy chỉnh' },
  ];
}
