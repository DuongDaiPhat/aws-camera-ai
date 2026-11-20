'use client';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createCameraModel, PART_POSES } from './camera-model';
import { createSimulation, DEMO_AIM } from './camera-simulation';
import type { CameraFeatureId } from './camera-features';
import type { CameraCommand, CameraPartId } from './camera-parts';
interface Props {
  feature: CameraFeatureId | null;
  exploded: boolean;
  selected: CameraPartId;
  onSelect: (part: CameraPartId) => void;
  onToggle: () => void;
  reducedMotion: boolean;
  autoRotate: boolean;
  command: CameraCommand;
  onUnavailable: () => void;
  onReady: () => void;
}

function setup(container: HTMLDivElement) {
  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute(
    'aria-label',
    'Camera giám sát 3D — nhấn để tách hoặc lắp, kéo để xoay',
  );
  container.appendChild(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, 0.04);
  scene.environment = environment.texture;
  scene.environmentIntensity = 0.9;
  room.dispose();
  pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
  camera.position.set(-7, 4.5, 9.5);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, -0.3);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.09;
  controls.minDistance = 5;
  controls.maxDistance = 23;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = Math.PI * 0.75;
  controls.autoRotateSpeed = 0.45;
  controls.update();
  controls.saveState();
  scene.add(new THREE.AmbientLight('#d7e3ff', 0.6));
  const key = new THREE.DirectionalLight('#f5f4ff', 3.3);
  key.position.set(-3, 6, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -7, right: 7, top: 6, bottom: -6 });
  key.shadow.normalBias = 0.04;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#9bafff', 1.5);
  fill.position.set(5, 1, -3);
  scene.add(fill);
  const rim = new THREE.DirectionalLight('#80e4f0', 1.3);
  rim.position.set(-5, 0, -5);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.ShadowMaterial({ opacity: 0.07 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.2;
  floor.receiveShadow = true;
  scene.add(floor);
  const model = createCameraModel();
  scene.add(model.root);
  return { scene, renderer, camera, controls, environment, model };
}
function pose(model: ReturnType<typeof createCameraModel>, progress: number) {
  for (const [id, group] of Object.entries(model.parts) as [CameraPartId, THREE.Group][]) {
    const target = PART_POSES[id];
    const phase = THREE.MathUtils.smoothstep(
      THREE.MathUtils.clamp((progress - target.delay) / (1 - target.delay), 0, 1),
      0,
      1,
    );
    group.position
      .set(...target.position)
      .addScaledVector(new THREE.Vector3(...target.spread), phase);
    if (id !== 'mount') group.position.z += 1.35;
    group.scale.setScalar(id === 'processor' ? 0.82 : 1);
    group.rotation.set(
      target.rotation[0] * phase,
      target.rotation[1] * phase,
      target.rotation[2] * phase,
    );
  }
}
function disposeScene(scene: THREE.Scene) {
  const textures = new Set<THREE.Texture>(),
    materials = new Set<THREE.Material>(),
    geometries = new Set<THREE.BufferGeometry>();
  scene.traverse((object) => {
    if (
      object instanceof THREE.Mesh ||
      object instanceof THREE.LineSegments ||
      object instanceof THREE.Line ||
      object instanceof THREE.Points
    ) {
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material])
        materials.add(material);
    }
    if (object instanceof THREE.DirectionalLight) object.shadow.dispose();
  });
  for (const material of materials) {
    for (const value of Object.values(material))
      if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const texture of textures) texture.dispose();
  for (const geometry of geometries) geometry.dispose();
}
function bindPointer(
  canvas: HTMLCanvasElement,
  camera: THREE.Camera,
  root: THREE.Group,
  getProps: () => Props,
) {
  let down = { x: 0, y: 0 };
  const ray = new THREE.Raycaster();
  const start = (event: PointerEvent) => {
    down = { x: event.clientX, y: event.clientY };
  };
  const end = (event: PointerEvent) => {
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    const rect = canvas.getBoundingClientRect();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        (-(event.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      camera,
    );
    let object: THREE.Object3D | null = ray.intersectObject(root, true)[0]?.object ?? null;
    while (object && !object.userData.partId) object = object.parent;
    if (object) {
      getProps().onSelect(object.userData.partId as CameraPartId);
      getProps().onToggle();
    }
  };
  canvas.addEventListener('pointerdown', start);
  canvas.addEventListener('pointerup', end);
  return () => {
    canvas.removeEventListener('pointerdown', start);
    canvas.removeEventListener('pointerup', end);
  };
}
function aimModel(
  model: ReturnType<typeof createCameraModel>,
  feature: CameraFeatureId | null,
  delta: number,
  reduce: boolean,
) {
  let moving = false;
  const mode = feature ? DEMO_AIM[feature] : null;
  const settle = (value: number, target: number) => {
    const next = reduce ? target : THREE.MathUtils.damp(value, target, 6, delta);
    if (Math.abs(next - target) > 0.001) moving = true;
    return Math.abs(next - target) < 0.001 ? target : next;
  };
  model.root.position.set(
    settle(model.root.position.x, feature ? -2.15 : 0),
    settle(model.root.position.y, feature ? -0.05 : 0),
    settle(model.root.position.z, feature ? -0.45 : 0),
  );
  model.root.scale.setScalar(settle(model.root.scale.x, feature ? 0.62 : 1));
  model.head.rotation.y = settle(model.head.rotation.y, mode?.yaw ?? 0);
  model.head.rotation.x = settle(model.head.rotation.x, mode?.pitch ?? 0);
  return moving;
}

function createRuntime(container: HTMLDivElement, getProps: () => Props) {
  const { scene, renderer, camera, controls, environment, model } = setup(container);
  const simulation = createSimulation(scene);
  let frame = 0,
    previous = performance.now(),
    progress = getProps().exploded ? 1 : 0,
    disposed = false,
    ready = false;
  const invalidate = () => {
    if (!disposed && !frame) frame = requestAnimationFrame(draw);
  };
  function draw(time: number) {
    frame = 0;
    const props = getProps();
    const delta = Math.min((time - previous) / 1000, 0.05);
    previous = time;
    const target = props.exploded ? 1 : 0;
    progress = props.reducedMotion ? target : THREE.MathUtils.damp(progress, target, 5.8, delta);
    if (Math.abs(progress - target) < 0.0005) progress = target;
    pose(model, progress);
    const modelMoving = aimModel(model, props.feature, delta, props.reducedMotion);
    model.root.updateMatrixWorld(true);
    const origin = model.parts.ir.localToWorld(new THREE.Vector3(0, 0, 0.16));
    const effectsMoving = simulation.update(props.feature, delta, props.reducedMotion, origin);
    const zoom = props.feature ? Math.min(0.92, camera.aspect * 0.72) : props.exploded ? 0.72 : 1;
    camera.zoom = props.reducedMotion ? zoom : THREE.MathUtils.damp(camera.zoom, zoom, 5.8, delta);
    camera.updateProjectionMatrix();
    controls.autoRotate = props.autoRotate && !props.reducedMotion && !document.hidden;
    controls.enableDamping = !props.reducedMotion;
    const changed = controls.update(delta);
    renderer.render(scene, camera);
    if (!ready) {
      ready = true;
      props.onReady();
    }
    if (
      modelMoving ||
      effectsMoving ||
      progress !== target ||
      Math.abs(camera.zoom - zoom) > 0.0005 ||
      controls.autoRotate ||
      changed
    )
      invalidate();
  }
  controls.addEventListener('change', invalidate);
  document.addEventListener('visibilitychange', invalidate);
  const resize = new ResizeObserver(() => {
    const { width, height } = container.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const distance = 8.9 * Math.max(1, 1.25 / camera.aspect);
    camera.position.sub(controls.target).normalize().multiplyScalar(distance).add(controls.target);
    controls.update();
    controls.saveState();
    invalidate();
  });
  resize.observe(container);
  const unbind = bindPointer(renderer.domElement, camera, model.root, getProps);
  const lost = (event: Event) => {
    event.preventDefault();
    getProps().onUnavailable();
  };
  renderer.domElement.addEventListener('webglcontextlost', lost);
  const command = (action: CameraCommand['action']) => {
    if (action === 'reset') controls.reset();
    else {
      const offset = camera.position.clone().sub(controls.target);
      if (action === 'left' || action === 'right')
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), action === 'left' ? -0.32 : 0.32);
      else
        offset.setLength(
          THREE.MathUtils.clamp(offset.length() * (action === 'in' ? 0.85 : 1.18), 5, 23),
        );
      camera.position.copy(controls.target).add(offset);
      controls.update();
    }
    invalidate();
  };
  const update = () => {
    model.highlight(getProps().selected);
    invalidate();
  };
  update();
  return {
    update,
    command,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      unbind();
      controls.removeEventListener('change', invalidate);
      document.removeEventListener('visibilitychange', invalidate);
      renderer.domElement.removeEventListener('webglcontextlost', lost);
      controls.dispose();
      disposeScene(scene);
      environment.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
export default function CameraScene(props: Props) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;
  const runtime = useRef<ReturnType<typeof createRuntime> | null>(null);
  useEffect(() => {
    if (!root.current) return;
    const scene = createRuntime(root.current, () => latest.current);
    runtime.current = scene;
    return () => {
      scene.dispose();
      runtime.current = null;
    };
  }, []);
  useEffect(() => {
    runtime.current?.update();
  }, [props.feature, props.exploded, props.selected, props.autoRotate, props.reducedMotion]);
  useEffect(() => {
    runtime.current?.command(props.command.action);
  }, [props.command]);
  return <div ref={root} style={{ width: '100%', height: '100%' }} />;
}
