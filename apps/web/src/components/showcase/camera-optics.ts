import * as THREE from 'three';
import { addMesh, black, disc, paint, ring, rounded, silver, white } from './camera-geometry';
export function buildLens(group: THREE.Group) {
  disc(group, 0.515, 0.58, black());
  for (const z of [-0.24, -0.15, -0.06, 0.03, 0.12, 0.21])
    addMesh(group, ring(0.528, 0.49, 0.03), paint('#334150', 0.85, 0.23), [0, 0, z]);
  disc(group, 0.39, 0.085, black(), 0.34);
  addMesh(group, ring(0.416, 0.342, 0.04), silver(), [0, 0, 0.39]);
  for (let index = 0; index < 26; index++) {
    const a = (index / 26) * Math.PI * 2;
    addMesh(
      group,
      rounded(0.018, 0.085, 0.24, 0.005),
      black(),
      [Math.cos(a) * 0.518, Math.sin(a) * 0.518, 0.1],
      [0, 0, a - Math.PI / 2],
    );
  }
}
export function buildGlass(group: THREE.Group) {
  const glass = new THREE.MeshPhysicalMaterial({
    color: '#486d99',
    metalness: 0.25,
    roughness: 0.05,
    transmission: 0.62,
    thickness: 0.04,
    transparent: true,
    opacity: 0.8,
    ior: 1.5,
    clearcoat: 1,
    side: THREE.DoubleSide,
  });
  for (const [index, radius] of [0.35, 0.31, 0.27].entries()) {
    const lens = addMesh(group, new THREE.SphereGeometry(radius, 64, 32), glass, [
      0,
      0,
      -index * 0.11,
    ]);
    lens.scale.z = 0.12;
    addMesh(group, ring(radius + 0.012, radius - 0.005, 0.02), black(), [0, 0, -index * 0.11]);
  }
  disc(group, 0.19, 0.025, paint('#040c18', 0.6, 0.08), -0.28);
  const reflection = new THREE.MeshBasicMaterial({
    color: '#a1e0ff',
    transparent: true,
    opacity: 0.35,
  });
  const glint = addMesh(
    group,
    new THREE.SphereGeometry(0.09, 24, 16),
    reflection,
    [-0.09, 0.1, 0.052],
  );
  glint.scale.set(0.75, 0.4, 0.1);
}
export function buildIR(group: THREE.Group) {
  addMesh(group, ring(0.785, 0.51, 0.2), white());
  addMesh(group, ring(0.69, 0.525, 0.028), paint('#13203b', 0.5, 0.3), [0, 0, 0.115]);
  const emitter = paint('#6784d4', 0.65, 0.13);
  for (let i = 0; i < 30; i++) {
    const a = (i * Math.PI * 2) / 30;
    const x = Math.cos(a) * 0.61,
      y = Math.sin(a) * 0.61;
    const led = addMesh(group, new THREE.SphereGeometry(0.039, 16, 10), emitter, [x, y, 0.15]);
    led.scale.z = 0.4;
    addMesh(group, new THREE.TorusGeometry(0.043, 0.006, 6, 16), silver(), [x, y, 0.14]);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2 + Math.PI / 4;
    addMesh(group, ring(0.04, 0.018, 0.01), black(), [
      Math.cos(a) * 0.73,
      Math.sin(a) * 0.73,
      0.115,
    ]);
  }
}
export function buildSensor(group: THREE.Group) {
  addMesh(group, rounded(0.57, 0.52, 0.07, 0.025), silver());
  addMesh(group, rounded(0.4, 0.34, 0.025, 0.008), paint('#4774ae', 0.8, 0.1), [0, 0, 0.048]);
  addMesh(group, rounded(0.29, 0.24, 0.01, 0.004), paint('#293858', 0.7, 0.06), [0, 0, 0.068]);
  for (const side of [-1, 1])
    for (let i = 0; i < 8; i++)
      addMesh(group, rounded(0.025, 0.06, 0.025, 0.002), paint('#d6b65d', 0.85), [
        side * 0.22,
        (i - 3.5) * 0.05,
        0,
      ]);
}
