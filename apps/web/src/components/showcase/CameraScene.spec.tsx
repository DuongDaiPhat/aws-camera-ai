// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import CameraScene from './CameraScene';

const gpu = vi.hoisted(() => ({
  render: vi.fn(),
  dispose: vi.fn(),
  loss: vi.fn(),
  environmentDispose: vi.fn(),
  controlsDispose: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('three', async (original) => {
  const actual = await original<typeof import('three')>();
  return {
    ...actual,
    WebGLRenderer: class {
      domElement = document.createElement('canvas');
      shadowMap = {};
      setPixelRatio = vi.fn();
      setSize = vi.fn();
      render = gpu.render;
      dispose = gpu.dispose;
      forceContextLoss = gpu.loss;
    },
    PMREMGenerator: class {
      fromScene = () => ({ texture: new actual.Texture(), dispose: gpu.environmentDispose });
      dispose = vi.fn();
    },
  };
});
vi.mock('three/addons/controls/OrbitControls.js', async () => {
  const { Vector3 } = await import('three');
  return {
    OrbitControls: class {
      target = new Vector3();
      update = () => false;
      saveState = vi.fn();
      reset = gpu.reset;
      dispose = gpu.controlsDispose;
      addEventListener = vi.fn();
      removeEventListener = vi.fn();
    },
  };
});
vi.mock('three/addons/environments/RoomEnvironment.js', async () => {
  const { Scene } = await import('three');
  return {
    RoomEnvironment: class extends Scene {
      dispose = vi.fn();
    },
  };
});

let host: HTMLDivElement;
let root: Root;
let frames: Map<number, FrameRequestCallback>;
let resize: ResizeObserverCallback;
let observer: ResizeObserver;
let frameId: number;
const disconnect = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  frameId = 0;
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = callback;
        observer = this as unknown as ResizeObserver;
      }
      observe = vi.fn();
      disconnect = disconnect;
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 500,
    width: 800,
    height: 500,
    toJSON: () => ({}),
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function flush(count = 1) {
  for (let i = 0; i < count; i++) {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(performance.now() + i * 50 + 50)));
  }
}
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number) {
  canvas.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y }));
}

it('renders, resizes, handles commands/context loss and disposes GPU resources on unmount', () => {
  const ready = vi.fn(),
    unavailable = vi.fn(),
    select = vi.fn(),
    toggle = vi.fn();
  const props = {
    feature: null,
    exploded: false,
    selected: 'processor' as const,
    onSelect: select,
    onToggle: toggle,
    reducedMotion: true,
    autoRotate: false,
    command: { id: 0, action: 'reset' as const },
    onUnavailable: unavailable,
    onReady: ready,
  };
  act(() => root.render(<CameraScene {...props} />));
  const canvas = host.querySelector('canvas')!;
  expect(canvas.getAttribute('role')).toBe('img');
  expect(canvas.getAttribute('aria-label')).toContain('Camera giám sát 3D');
  flush();
  expect(ready).toHaveBeenCalledOnce();
  const [scene, camera] = gpu.render.mock.lastCall as [THREE.Scene, THREE.PerspectiveCamera];
  resize([], observer);
  flush();
  expect(camera.aspect).toBe(1.6);
  expect(camera.position.length()).toBeGreaterThan(5);
  const geometryDispose = vi.fn(),
    materialDispose = vi.fn(),
    textureDispose = vi.fn();
  const geometry = new THREE.BoxGeometry();
  geometry.addEventListener('dispose', geometryDispose);
  const texture = new THREE.Texture();
  texture.addEventListener('dispose', textureDispose);
  const material = new THREE.MeshBasicMaterial({ map: texture });
  material.addEventListener('dispose', materialDispose);
  scene.add(new THREE.Mesh(geometry, [material, material]));
  scene.add(new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial()));
  scene.add(new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial()));
  for (const [id, action] of ['left', 'right', 'in', 'out', 'reset'].entries()) {
    const before = camera.position.clone();
    act(() =>
      root.render(<CameraScene {...props} command={{ id: id + 1, action: action as 'left' }} />),
    );
    flush();
    if (action !== 'reset') expect(camera.position.distanceTo(before)).toBeGreaterThan(0);
  }
  expect(gpu.reset).toHaveBeenCalled();
  act(() =>
    root.render(
      <CameraScene {...props} feature="fire" exploded autoRotate reducedMotion={false} />,
    ),
  );
  flush(4);
  act(() => root.render(<CameraScene {...props} feature="face" exploded />));
  flush();
  expect(camera.zoom).toBeLessThanOrEqual(0.92);
  act(() => root.render(<CameraScene {...props} exploded />));
  flush();
  expect(camera.zoom).toBe(0.72);
  const part = new THREE.Group();
  part.userData.partId = 'lens';
  const child = new THREE.Mesh(new THREE.BoxGeometry(), material);
  part.add(child);
  const hit = vi
    .spyOn(THREE.Raycaster.prototype, 'intersectObject')
    .mockReturnValue([{ object: child, distance: 1, point: new THREE.Vector3() }]);
  pointer(canvas, 'pointerdown', 10, 10);
  pointer(canvas, 'pointerup', 12, 12);
  expect(select).toHaveBeenCalledWith('lens');
  expect(toggle).toHaveBeenCalledOnce();
  pointer(canvas, 'pointerdown', 0, 0);
  pointer(canvas, 'pointerup', 100, 100);
  expect(hit).toHaveBeenCalledTimes(1);
  hit.mockReturnValue([]);
  pointer(canvas, 'pointerdown', 10, 10);
  pointer(canvas, 'pointerup', 10, 10);
  expect(toggle).toHaveBeenCalledOnce();
  const lost = new Event('webglcontextlost', { cancelable: true });
  canvas.dispatchEvent(lost);
  expect(lost.defaultPrevented).toBe(true);
  expect(unavailable).toHaveBeenCalledOnce();
  document.dispatchEvent(new Event('visibilitychange'));
  flush();
  act(() => root.render(<div />));
  expect(host.querySelector('canvas')).toBeNull();
  expect(disconnect).toHaveBeenCalledOnce();
  expect(gpu.dispose).toHaveBeenCalledOnce();
  expect(gpu.loss).toHaveBeenCalledOnce();
  expect(gpu.environmentDispose).toHaveBeenCalledOnce();
  expect(gpu.controlsDispose).toHaveBeenCalledOnce();
  expect(geometryDispose).toHaveBeenCalledOnce();
  expect(materialDispose).toHaveBeenCalledOnce();
  expect(textureDispose).toHaveBeenCalledOnce();
  expect(frames.size).toBe(0);
});

it('ignores zero-size resize notifications and suppresses auto rotation for hidden documents', () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 0,
    height: 0,
  } as DOMRect);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() =>
    root.render(
      <CameraScene
        feature={null}
        exploded={false}
        selected="mount"
        onSelect={vi.fn()}
        onToggle={vi.fn()}
        reducedMotion={false}
        autoRotate
        command={{ id: 0, action: 'reset' }}
        onUnavailable={vi.fn()}
        onReady={vi.fn()}
      />,
    ),
  );
  resize([], observer);
  flush();
  const camera = gpu.render.mock.lastCall![1] as THREE.PerspectiveCamera;
  expect(camera.aspect).toBe(1);
  expect(frames.size).toBe(0);
});
