import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
export type Vector = [number, number, number];
export const paint = (color: string, metalness = 0.2, roughness = 0.3) =>
  new THREE.MeshPhysicalMaterial({
    color,
    metalness,
    roughness,
    clearcoat: 0.8,
    clearcoatRoughness: 0.24,
  });
export const white = () => paint('#e9edf5', 0.16, 0.27);
export const silver = () => paint('#a7b4c6', 0.9, 0.22);
export const black = () => paint('#101a26', 0.5, 0.27);
export const rounded = (x: number, y: number, z: number, r = 0.06) =>
  new RoundedBoxGeometry(x, y, z, 3, r);
export function addMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  position: Vector = [0, 0, 0],
  rotation: Vector = [0, 0, 0],
) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}
export const cylinder = (a: number, b: number, height: number, segments = 64) =>
  new THREE.CylinderGeometry(a, b, height, segments);
export function disc(
  group: THREE.Group,
  radius: number,
  depth: number,
  material: THREE.Material,
  z = 0,
) {
  return addMesh(group, cylinder(radius, radius, depth), material, [0, 0, z], [Math.PI / 2, 0, 0]);
}
export function ring(outer: number, inner: number, depth: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new THREE.Path();
  hole.absarc(0, 0, inner, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.012,
    bevelThickness: 0.012,
    bevelSegments: 2,
    curveSegments: 48,
  });
  geometry.translate(0, 0, -depth / 2);
  return geometry;
}
export function shellArc(outer: number, inner: number, length: number, start: number, end: number) {
  const shape = new THREE.Shape();
  shape.absarc(0, 0, outer, start, end, false);
  shape.absarc(0, 0, inner, end, start, true);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: length,
    bevelEnabled: true,
    bevelSize: 0.02,
    bevelThickness: 0.02,
    bevelSegments: 3,
    curveSegments: 48,
  });
  geometry.translate(0, 0, -length / 2);
  return geometry;
}
export function screw(
  group: THREE.Group,
  position: Vector,
  rotation: Vector = [0, 0, 0],
  scale = 1,
) {
  const part = new THREE.Group();
  part.position.set(...position);
  part.rotation.set(...rotation);
  part.scale.setScalar(scale);
  const steel = silver();
  disc(part, 0.054, 0.035, steel);
  disc(part, 0.022, 0.14, steel, -0.075);
  addMesh(part, rounded(0.063, 0.008, 0.006, 0.002), black(), [0, 0, 0.021]);
  addMesh(part, rounded(0.008, 0.063, 0.006, 0.002), black(), [0, 0, 0.021]);
  group.add(part);
  return part;
}
export function labelTexture(text: string, color = '#81e3ff', background = '#101624') {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, 256);
  ctx.strokeStyle = '#647188';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, 488, 232);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = color;
  ctx.shadowBlur = 24;
  ctx.fillStyle = color;
  ctx.font = '700 150px Arial';
  ctx.fillText(text, 256, 137);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
