import * as THREE from 'three';
import { addMesh, rounded } from './camera-geometry';
const basic = (color: string, opacity = 1) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity === 1,
  });
export function makePerson() {
  const root = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: '#9eabe5', roughness: 0.5, metalness: 0.1 });
  const skin = new THREE.MeshStandardMaterial({ color: '#e5e9fa', roughness: 0.5 });
  addMesh(root, new THREE.CapsuleGeometry(0.22, 0.46, 5, 16), body, [0, 0.94, 0]);
  addMesh(root, new THREE.SphereGeometry(0.18, 24, 16), skin, [0, 1.57, 0]);
  for (const side of [-1, 1]) {
    addMesh(
      root,
      new THREE.CapsuleGeometry(0.075, 0.5, 4, 12),
      body,
      [side * 0.32, 0.94, 0],
      [0, 0, side * 0.2],
    );
    addMesh(root, new THREE.CapsuleGeometry(0.085, 0.49, 4, 12), body, [side * 0.135, 0.33, 0]);
    addMesh(root, rounded(0.17, 0.12, 0.26, 0.04), basic('#3c476b'), [side * 0.135, 0.03, 0.05]);
    addMesh(root, new THREE.SphereGeometry(0.022, 10, 8), basic('#38445e'), [
      side * 0.063,
      1.59,
      0.158,
    ]);
  }
  return root;
}
function flameShape() {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-0.85, 0.06, -0.95, 0.73, -0.47, 1.2);
  shape.bezierCurveTo(-0.53, 0.8, -0.16, 0.78, -0.2, 1.25);
  shape.bezierCurveTo(-0.25, 1.7, 0.24, 1.88, 0.13, 2.2);
  shape.bezierCurveTo(0.92, 1.69, 0.43, 1.18, 0.64, 1.02);
  shape.bezierCurveTo(0.76, 1.28, 1.02, 0.7, 0.77, 0.33);
  shape.bezierCurveTo(0.61, 0.03, 0.27, 0, 0, 0);
  return shape;
}
export function makeFire() {
  const group = new THREE.Group();
  group.position.set(1.7, -1.3, 1.6);
  const flame = new THREE.Group();
  flame.rotation.y = -0.5;
  group.add(flame);
  const geometry = new THREE.ExtrudeGeometry(flameShape(), {
    depth: 0.1,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: 0.05,
    bevelThickness: 0.05,
    curveSegments: 24,
  });
  addMesh(flame, geometry, basic('#f66e2d'));
  const middle = addMesh(flame, geometry.clone(), basic('#ffb743'), [0.035, 0.025, 0.16]);
  middle.scale.set(0.66, 0.72, 0.7);
  const core = addMesh(flame, geometry.clone(), basic('#fff0a7'), [0.04, 0.025, 0.25]);
  core.scale.set(0.32, 0.44, 0.5);
  const smoke = new THREE.Group();
  group.add(smoke);
  for (let i = 0; i < 3; i++) {
    const puff = addMesh(
      smoke,
      new THREE.SphereGeometry(0.23 + i * 0.05, 16, 12),
      basic('#aab6cb', 0.12 - i * 0.02),
      [0.12 + i * 0.12, 1.85 + i * 0.24, -0.1],
    );
    puff.scale.set(1.25, 0.65, 1);
  }
  const glow = addMesh(
    group,
    new THREE.RingGeometry(0.6, 0.85, 64),
    basic('#fa9f4a', 0.45),
    [0, 0.02, 0],
    [-Math.PI / 2, 0, 0],
  );
  glow.position.y = -0.03;
  return {
    group,
    tick(time: number, reduce: boolean) {
      flame.scale.set(1, reduce ? 1 : 1 + Math.sin(time * 7) * 0.026, 1);
      smoke.position.x = reduce ? 0 : Math.sin(time) * 0.05;
    },
  };
}
export function makeFall() {
  const group = new THREE.Group();
  group.position.set(0.9, -1.2, 1.45);
  const person = makePerson();
  group.add(person);
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(2.15, 0.6, 0.72)),
    new THREE.LineBasicMaterial({ color: '#ffb16e', transparent: true, opacity: 0.8 }),
  );
  edges.position.set(0.8, 0.18, 0);
  group.add(edges);
  const floor = addMesh(
    group,
    new THREE.RingGeometry(0.85, 1.0, 64),
    basic('#f7a765', 0.4),
    [0.8, -0.16, 0],
    [-Math.PI / 2, 0, 0],
  );
  floor.scale.set(1.35, 1, 1);
  return {
    group,
    tick(time: number, reduce: boolean) {
      const phase = reduce ? 1 : THREE.MathUtils.smoothstep(Math.min(time / 1.1, 1), 0, 1);
      person.rotation.z = (-Math.PI / 2) * phase;
    },
  };
}
export function makeFace() {
  const group = new THREE.Group();
  group.position.set(1.95, -1.35, 1.55);
  group.add(makePerson());
  const frame = new THREE.Group();
  frame.position.set(0, 1.56, 0.23);
  group.add(frame);
  const cyan = basic('#66efd0');
  for (const side of [-1, 1])
    for (const vertical of [-1, 1]) {
      addMesh(frame, rounded(0.2, 0.018, 0.018, 0.006), cyan, [side * 0.24, vertical * 0.34, 0]);
      addMesh(frame, rounded(0.018, 0.2, 0.018, 0.006), cyan, [side * 0.34, vertical * 0.24, 0]);
    }
  const scan = addMesh(
    frame,
    rounded(0.57, 0.018, 0.01, 0.004),
    basic('#6cecd6', 0.8),
    [0, 0, 0.015],
  );
  const approved = addMesh(frame, new THREE.SphereGeometry(0.055, 16, 12), cyan, [0.4, 0.36, 0]);
  approved.scale.z = 0.25;
  return {
    group,
    tick(time: number, reduce: boolean) {
      scan.position.y = reduce ? 0 : Math.sin(time * 2) * 0.27;
    },
  };
}
export function makeZone() {
  const group = new THREE.Group();
  group.position.set(1.9, -1.4, 1.35);
  const shape = new THREE.Shape();
  shape.moveTo(-0.9, -0.65);
  shape.lineTo(0.9, -0.65);
  shape.lineTo(1.05, 0.65);
  shape.lineTo(-0.75, 0.65);
  shape.closePath();
  addMesh(
    group,
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({
      color: '#a47cff',
      transparent: true,
      opacity: 0.18,
      side: THREE.DoubleSide,
      depthWrite: false,
    }),
    [0, 0, 0],
    [-Math.PI / 2, 0, 0],
  );
  const points = [
    new THREE.Vector3(-0.9, 0.01, 0.65),
    new THREE.Vector3(0.9, 0.01, 0.65),
    new THREE.Vector3(1.05, 0.01, -0.65),
    new THREE.Vector3(-0.75, 0.01, -0.65),
    new THREE.Vector3(-0.9, 0.01, 0.65),
  ];
  for (let i = 0; i < 4; i++) {
    const curve = new THREE.LineCurve3(points[i]!, points[i + 1]!);
    addMesh(group, new THREE.TubeGeometry(curve, 1, 0.018, 8, false), basic('#ba93ff'));
    addMesh(group, new THREE.CylinderGeometry(0.014, 0.014, 0.35, 8), basic('#be9bff', 0.8), [
      points[i]!.x,
      0.18,
      points[i]!.z,
    ]);
  }
  const person = makePerson();
  person.scale.setScalar(0.78);
  group.add(person);
  return {
    group,
    tick(time: number, reduce: boolean) {
      const phase = reduce ? 1 : THREE.MathUtils.smoothstep(Math.min(time / 1.6, 1), 0, 1);
      person.position.set(1.7 * (1 - phase), 0.04, 0);
    },
  };
}
