import * as THREE from 'three';
import type { CameraFeatureId } from './camera-features';
import { makeFire, makeFall, makeFace, makeZone } from './camera-scenario-objects';
export const DEMO_AIM: Record<
  CameraFeatureId,
  { yaw: number; pitch: number; target: THREE.Vector3; color: string }
> = {
  fire: { yaw: 0.94, pitch: 0.08, target: new THREE.Vector3(1.7, -0.35, 1.6), color: '#ffa652' },
  fall: { yaw: 1.02, pitch: 0.3, target: new THREE.Vector3(1.7, -1.0, 1.45), color: '#ffbd7f' },
  face: { yaw: 0.96, pitch: 0.03, target: new THREE.Vector3(1.95, -0.1, 1.55), color: '#63e2d0' },
  zone: { yaw: 1.06, pitch: 0.28, target: new THREE.Vector3(1.9, -0.7, 1.35), color: '#b295ff' },
};
function makeBeam(scene: THREE.Scene) {
  const material = new THREE.MeshBasicMaterial({
    color: '#ffa652',
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(1.04, 0.03, 1, 40, 1, true), material);
  scene.add(cone);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1.04, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    material.clone(),
  );
  scene.add(dome);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.04, 0.009, 6, 64),
    new THREE.MeshBasicMaterial({
      color: '#ffa652',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  scene.add(ring);
  const geometry = new THREE.BufferGeometry();
  const points = new Float32Array(8 * 2 * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
  const rays = new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({
      color: '#ffa652',
      transparent: true,
      opacity: 0,
      depthWrite: false,
    }),
  );
  scene.add(rays);
  return { cone, dome, ring, rays, geometry, points, material };
}
function updateBeam(
  beam: ReturnType<typeof makeBeam>,
  origin: THREE.Vector3,
  id: CameraFeatureId | null,
  amount: number,
) {
  const { cone, dome, ring, rays, geometry, points, material } = beam;
  const objects = [cone, dome, ring, rays];
  objects.forEach((object) => {
    object.visible = Boolean(id) && amount > 0.001;
  });
  if (!id) return;
  const spec = DEMO_AIM[id],
    direction = spec.target.clone().sub(origin),
    length = direction.length();
  direction.normalize();
  const turn = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  cone.position.copy(origin).lerp(spec.target, 0.5);
  cone.quaternion.copy(turn);
  cone.scale.set(1, length, 1);
  material.color.set(spec.color);
  material.opacity = 0.075 * amount;
  dome.position.copy(spec.target);
  dome.quaternion.copy(turn);
  dome.material.color.set(spec.color);
  dome.material.opacity = 0.045 * amount;
  ring.position.copy(spec.target);
  ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
  ring.material.color.set(spec.color);
  ring.material.opacity = 0.5 * amount;
  for (let i = 0; i < 8; i++) {
    const tip = new THREE.Vector3(
      Math.cos((i * Math.PI) / 4) * 1.04,
      0,
      Math.sin((i * Math.PI) / 4) * 1.04,
    )
      .applyQuaternion(turn)
      .add(spec.target);
    origin.toArray(points, i * 6);
    tip.toArray(points, i * 6 + 3);
  }
  geometry.attributes.position!.needsUpdate = true;
  geometry.computeBoundingSphere();
  rays.material.color.set(spec.color);
  rays.material.opacity = 0.16 * amount;
}

export function createSimulation(scene: THREE.Scene) {
  const scenarios = { fire: makeFire(), fall: makeFall(), face: makeFace(), zone: makeZone() };
  const beam = makeBeam(scene);
  let current: CameraFeatureId | null = null,
    elapsed = 0,
    amount = 0;
  for (const scenario of Object.values(scenarios)) {
    scenario.group.visible = false;
    scene.add(scenario.group);
  }
  return {
    update(id: CameraFeatureId | null, delta: number, reduce: boolean, origin: THREE.Vector3) {
      if (id !== current) {
        current = id;
        elapsed = 0;
      }
      elapsed += delta;
      const target = id ? 1 : 0;
      amount = reduce ? target : THREE.MathUtils.damp(amount, target, 7, delta);
      if (Math.abs(amount - target) < 0.001) amount = target;
      for (const [key, scenario] of Object.entries(scenarios)) {
        scenario.group.visible = key === id;
        if (key === id) {
          scenario.group.scale.setScalar(Math.max(0.001, amount));
          scenario.tick(elapsed, reduce);
        }
      }
      updateBeam(beam, origin, id, amount);
      return amount !== target || Boolean(id && !reduce && !document.hidden);
    },
  };
}
