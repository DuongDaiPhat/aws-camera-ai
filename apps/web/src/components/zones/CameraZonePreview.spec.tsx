// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraZonePreview } from './CameraZonePreview';
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  host = document.createElement('div');
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});
const zones = [
  {
    id: 'enabled',
    name: 'Kitchen',
    polygon: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    zoneType: 'RESTRICTED',
    isEnabled: true,
  },
  { id: 'disabled', name: 'Rest', polygon: [[0.5, 0.5]], zoneType: 'REST_AREA', isEnabled: false },
  { id: 'empty', name: 'Empty', polygon: [], zoneType: 'NORMAL', isEnabled: true },
];
function pointer(node: Element, type: string, x = 0, y = 0) {
  const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  act(() => node.dispatchEvent(event));
}
it('renders zone polygons, labels and enabled/selected styles', () => {
  const props = {
    preview: { url: '/image' },
    zones,
    selectedZoneId: 'enabled',
    draft: null,
    canDraw: false,
    onSelectZone: vi.fn(),
    onAddPoint: vi.fn(),
    onMovePoint: vi.fn(),
  };
  act(() =>
    root.render(
      <CameraZonePreview
        {...(props as unknown as React.ComponentProps<typeof CameraZonePreview>)}
      />,
    ),
  );
  expect(host.querySelector('img')!.getAttribute('src')).toBe('/image');
  expect(host.textContent).toContain('Rest · Đã tắt');
  expect(host.querySelectorAll('text')).toHaveLength(2);
  expect(host.querySelector('polygon')!.getAttribute('points')).toBe('0,0 1,0 1,1');
  expect(host.querySelectorAll('g')[1].getAttribute('opacity')).toBe('0.48');
  pointer(host.querySelectorAll('g')[1], 'pointerdown');
  expect(props.onSelectZone).toHaveBeenCalledWith('disabled');
  expect(props.onAddPoint).not.toHaveBeenCalled();
  pointer(host.querySelector('svg')!, 'pointerdown');
  expect(props.onAddPoint).not.toHaveBeenCalled();
});
it('normalizes and clamps drawing coordinates and does not add a point for zone clicks', () => {
  const add = vi.fn(),
    select = vi.fn();
  const props = {
    preview: { url: '/image', width: 640, height: 480 },
    zones,
    selectedZoneId: null,
    draft: [[0.2, 0.2]],
    canDraw: true,
    onSelectZone: select,
    onAddPoint: add,
    onMovePoint: vi.fn(),
  };
  act(() =>
    root.render(
      <CameraZonePreview
        {...(props as unknown as React.ComponentProps<typeof CameraZonePreview>)}
      />,
    ),
  );
  const svg = host.querySelector('svg')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 10,
    top: 20,
    width: 200,
    height: 100,
  } as DOMRect);
  pointer(svg, 'pointerdown', 110, 70);
  expect(add).toHaveBeenLastCalledWith([0.5, 0.5]);
  pointer(svg, 'pointerdown', 999, -100);
  expect(add).toHaveBeenLastCalledWith([1, 0]);
  pointer(host.querySelector('polygon')!, 'pointerdown', 110, 70);
  expect(add).toHaveBeenCalledTimes(2);
  expect(select).toHaveBeenCalledWith('enabled');
  expect(host.querySelector('polyline')).not.toBeNull();
});
it('moves captured vertices and releases the pointer without drawing extra points', () => {
  const move = vi.fn();
  const props = {
    preview: { url: '/image' },
    zones: [],
    selectedZoneId: null,
    draft: [
      [0, 0],
      [1, 0],
      [1, 1],
    ],
    canDraw: true,
    onSelectZone: vi.fn(),
    onAddPoint: vi.fn(),
    onMovePoint: move,
  };
  act(() =>
    root.render(
      <CameraZonePreview
        {...(props as unknown as React.ComponentProps<typeof CameraZonePreview>)}
      />,
    ),
  );
  expect(host.querySelector('polygon')).not.toBeNull();
  const svg = host.querySelector('svg')!,
    point = host.querySelector('circle')!;
  vi.spyOn(svg, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  } as DOMRect);
  const capture = vi.fn(),
    release = vi.fn(),
    hasCapture = vi.fn().mockReturnValue(false);
  Object.assign(point, {
    setPointerCapture: capture,
    releasePointerCapture: release,
    hasPointerCapture: hasCapture,
  });
  pointer(point, 'pointermove', 25, 75);
  expect(move).not.toHaveBeenCalled();
  pointer(point, 'pointerdown');
  expect(capture).toHaveBeenCalledWith(1);
  hasCapture.mockReturnValue(true);
  pointer(point, 'pointermove', 25, 75);
  expect(move).toHaveBeenCalledWith(0, [0.25, 0.75]);
  pointer(point, 'pointerup');
  expect(release).toHaveBeenCalledWith(1);
  expect(props.onAddPoint).not.toHaveBeenCalled();
});
