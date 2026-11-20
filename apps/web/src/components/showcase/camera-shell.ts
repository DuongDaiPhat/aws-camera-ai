import * as THREE from 'three';
import {
  addMesh,
  black,
  cylinder,
  disc,
  paint,
  ring,
  rounded,
  screw,
  shellArc,
  silver,
  white,
} from './camera-geometry';

export function buildHousing(group: THREE.Group) {
  addMesh(group, shellArc(0.79, 0.7, 2.65, Math.PI, Math.PI * 2), white());
  for (const side of [-1, 1]) {
    addMesh(group, rounded(0.055, 0.07, 2.6, 0.015), paint('#a7afbb', 0.7), [
      side * 0.745,
      -0.03,
      0,
    ]);
    for (const z of [-1.1, 0.95])
      screw(group, [side * 0.73, -0.1, z], [0, (side * Math.PI) / 2, 0], 0.7);
  }
  for (const z of [-0.8, -0.45, -0.1, 0.25, 0.6])
    addMesh(group, rounded(0.54, 0.035, 0.045, 0.012), white(), [0, -0.765, z]);
}
export function buildHood(group: THREE.Group) {
  addMesh(group, shellArc(0.79, 0.7, 2.65, 0, Math.PI), white());
  addMesh(group, shellArc(0.86, 0.8, 3.15, -0.08, Math.PI + 0.08), white(), [0, 0.05, 0.19]);
  addMesh(group, shellArc(0.864, 0.805, 0.1, -0.08, Math.PI + 0.08), black(), [0, 0.05, 1.8]);
  for (const side of [-1, 1])
    addMesh(group, rounded(0.018, 0.025, 1.6, 0.008), paint('#657a9a', 0.5), [
      side * 0.842,
      0.16,
      -0.22,
    ]);
}
export function buildMount(group: THREE.Group) {
  disc(group, 0.74, 0.16, white(), 0);
  disc(group, 0.55, 0.22, white(), -0.14);
  addMesh(group, cylinder(0.23, 0.21, 0.75), white(), [0, 0, -0.55], [Math.PI / 2, 0, 0]);
  addMesh(group, new THREE.SphereGeometry(0.25, 32, 24), silver(), [0, 0, -0.98]);
  addMesh(group, cylinder(0.2, 0.2, 0.75), white(), [0, 0.11, -1.32], [Math.PI / 2 - 0.26, 0, 0]);
  disc(group, 0.87, 0.16, white(), -1.72);
  disc(group, 0.69, 0.035, silver(), -1.81);
  for (let index = 0; index < 4; index++) {
    const angle = (index * Math.PI) / 2 + Math.PI / 4;
    screw(group, [Math.cos(angle) * 0.66, Math.sin(angle) * 0.66, -1.62], [0, 0, 0], 1.3);
  }
  for (const side of [-1, 1]) {
    addMesh(
      group,
      cylinder(0.09, 0.09, 0.08),
      silver(),
      [side * 0.235, 0, -0.97],
      [0, 0, Math.PI / 2],
    );
    addMesh(group, rounded(0.12, 0.16, 0.26, 0.025), white(), [side * 0.15, 0.15, -0.36]);
  }
  const cable = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.25, -0.32, -0.05),
    new THREE.Vector3(0.38, -0.5, -0.55),
    new THREE.Vector3(0.3, -0.42, -1.2),
    new THREE.Vector3(0.23, -0.3, -1.68),
  ]);
  addMesh(group, new THREE.TubeGeometry(cable, 30, 0.035, 10, false), black());
}
export function buildFasteners(group: THREE.Group) {
  for (const side of [-1, 1])
    for (const z of [-1.15, 1.1]) screw(group, [side * 0.57, side * 0.5, z], [0, 0, 0], 0.9);
  for (const side of [-1, 1]) screw(group, [side * 0.54, -0.45, 0.3], [Math.PI / 2, 0, 0], 0.7);
  addMesh(group, ring(0.735, 0.69, 0.025), black(), [0, 0, -1.3]);
}
