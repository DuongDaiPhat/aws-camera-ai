// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CameraShowcase } from './CameraShowcase';
import { CameraControls } from './CameraControls';
import { CAMERA_FEATURES } from './camera-features';

const state = vi.hoisted(() => ({
  reduced: false,
  fail: false,
  scene: {} as Record<string, unknown>,
}));
vi.mock('motion/react', async () => {
  const { createElement } = await import('react');
  return {
    useReducedMotion: () => state.reduced,
    motion: Object.fromEntries(
      ['span', 'div'].map((tag) => [
        tag,
        ({ children, ...props }: Record<string, unknown>) =>
          createElement(
            tag,
            Object.fromEntries(
              Object.entries(props).filter(
                ([key]) => !['initial', 'animate', 'transition', 'layoutId'].includes(key),
              ),
            ),
            children as React.ReactNode,
          ),
      ]),
    ),
  };
});
vi.mock('next/dynamic', () => ({
  default: (_loader: unknown, options: { loading: () => React.ReactNode }) => {
    return function Scene(props: Record<string, unknown>) {
      state.scene = props;
      useEffect(() => {
        (props.onReady as () => void)();
      }, []);
      if (state.fail) throw new Error('WebGL context unavailable');
      return <div data-testid="scene">{options.loading()}</div>;
    };
  },
}));

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  state.reduced = false;
  state.fail = false;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    getExtension: () => ({ loseContext: vi.fn() }),
  } as unknown as WebGL2RenderingContext);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
function render(element: React.ReactElement) {
  act(() => root.render(element));
}
function button(text: string) {
  const node = [...host.querySelectorAll('button')].find(
    (item) => item.textContent?.trim() === text || item.getAttribute('aria-label') === text,
  );
  if (!node) throw new Error(`Button missing: ${text}`);
  return node;
}
function click(text: string) {
  act(() => button(text).click());
}

it('navigates from the overview, explodes the model and issues view commands', () => {
  const navigate = vi.fn();
  render(<CameraShowcase onNavigate={navigate} />);
  expect(button('Khám phá bên trong').disabled).toBe(false);
  click('Mở camera trực tiếp');
  expect(navigate).toHaveBeenLastCalledWith('cameras');
  click('Xem camera');
  expect(navigate).toHaveBeenLastCalledWith('cameras');
  click('Khám phá bên trong');
  expect(host.querySelector('section')?.getAttribute('data-camera-mode')).toBe('exploded');
  expect(host.textContent).toContain('Bên trong hệ thống');
  click('Lắp lại camera');
  expect(host.querySelector('section')?.getAttribute('data-camera-mode')).toBe('assembled');
  for (const [label, action] of [
    ['Xoay camera', 'left'],
    ['Phóng to', 'in'],
    ['Thu nhỏ', 'out'],
  ] as const) {
    click(label);
    expect(state.scene.command).toMatchObject({ action });
  }
  act(() => {
    (state.scene.onSelect as (part: string) => void)('lens');
    (state.scene.onToggle as () => void)();
  });
  expect(state.scene.selected).toBe('lens');
  click('Đặt lại góc nhìn');
  expect(state.scene).toMatchObject({
    exploded: false,
    feature: null,
    command: { action: 'reset' },
  });
});

it('selects each AI scenario, exposes its explanation and navigates to its feature', () => {
  state.reduced = true;
  const navigate = vi.fn();
  render(<CameraShowcase onNavigate={navigate} />);
  for (const feature of CAMERA_FEATURES) {
    click(feature.title);
    expect(state.scene).toMatchObject({
      feature: feature.id,
      selected: feature.part,
      exploded: false,
      reducedMotion: true,
    });
    expect(host.textContent).toContain(feature.description);
    expect(host.textContent).toContain(feature.result);
    expect(button(feature.title).getAttribute('aria-pressed')).toBe('true');
    click(feature.action);
    expect(navigate).toHaveBeenLastCalledWith(feature.page);
    click('Đóng mô phỏng');
    expect(host.querySelector('section')?.getAttribute('data-camera-mode')).toBe('assembled');
  }
  act(() => (state.scene.onUnavailable as () => void)());
  expect(host.textContent).toContain('Thiết bị chưa hỗ trợ 3D');
  expect(button('Khám phá bên trong').disabled).toBe(true);
});

it('keeps feature navigation usable without WebGL or navigation callback', () => {
  vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
  render(<CameraShowcase />);
  expect(host.textContent).toContain('Thiết bị chưa hỗ trợ 3D');
  expect(button('Phóng to').disabled).toBe(true);
  click('Xem camera');
  click('Mở camera trực tiếp');
  click('Phát hiện lửa');
  click('Xem sự kiện');
  expect(host.textContent).toContain(CAMERA_FEATURES[0].result);
});

it('falls back when the dynamic 3D scene throws', () => {
  state.fail = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  render(<CameraShowcase />);
  expect(host.textContent).toContain('Thiết bị chưa hỗ trợ 3D');
  expect(button('Khám phá bên trong').disabled).toBe(true);
});

it('maps accessible toolbar controls and disables unavailable or reduced-motion actions', () => {
  const toggle = vi.fn(),
    rotate = vi.fn(),
    reset = vi.fn(),
    send = vi.fn();
  const props = {
    exploded: false,
    autoRotate: false,
    available: true,
    reducedMotion: false,
    onToggleExploded: toggle,
    onToggleAutoRotate: rotate,
    onReset: reset,
    send,
  };
  render(<CameraControls {...props} />);
  click('Tách linh kiện');
  expect(toggle).toHaveBeenCalledOnce();
  click('Đặt lại góc nhìn');
  expect(reset).toHaveBeenCalledOnce();
  click('Tự xoay tắt');
  expect(rotate).toHaveBeenCalledOnce();
  for (const [label, command] of [
    ['Xoay trái', 'left'],
    ['Xoay phải', 'right'],
    ['Phóng to', 'in'],
    ['Thu nhỏ', 'out'],
  ] as const) {
    click(label);
    expect(send).toHaveBeenLastCalledWith(command);
  }
  render(<CameraControls {...props} exploded autoRotate reducedMotion />);
  expect(button('Lắp lại camera').getAttribute('aria-pressed')).toBe('true');
  expect(button('Tự xoay bật').disabled).toBe(true);
  render(<CameraControls {...props} available={false} />);
  expect([...host.querySelectorAll('button')].every((node) => node.disabled)).toBe(true);
});
