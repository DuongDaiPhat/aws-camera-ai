import * as THREE from 'three';
import type { CameraPartId } from './camera-parts';
import { addMesh, black, paint, rounded, screw, silver } from './camera-geometry';
function bodyMark(group: THREE.Group) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#667489';
  ctx.font = '600 43px Arial';
  ctx.fillText('CameraAI', 85, 65);
  ctx.font = '20px Arial';
  ctx.fillText('VISION / OPTICAL SYSTEM', 86, 98);
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++)
      if ((x * 13 + y * 7) % 5 < 3) ctx.fillRect(5 + x * 8, 15 + y * 8, 6, 6);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  addMesh(
    group,
    new THREE.PlaneGeometry(1.32, 0.33),
    material,
    [-0.797, 0.13, -0.25],
    [0, -Math.PI / 2, 0],
  );
}
function rearPorts(group: THREE.Group) {
  addMesh(group, rounded(0.35, 0.25, 0.08, 0.035), black(), [0.32, -0.2, -0.12]);
  addMesh(group, rounded(0.24, 0.14, 0.035, 0.012), paint('#c1c8d0', 0.8), [0.32, -0.2, -0.165]);
  for (let i = 0; i < 8; i++)
    addMesh(group, rounded(0.016, 0.07, 0.018, 0.002), paint('#c5ac68', 0.8), [
      0.23 + i * 0.025,
      -0.2,
      -0.19,
    ]);
  for (let i = 0; i < 6; i++)
    addMesh(group, new THREE.TorusGeometry(0.12, 0.01, 6, 24), black(), [
      -0.22,
      -0.15,
      -0.2 - i * 0.025,
    ]);
}
function detailHood(group: THREE.Group) {
  bodyMark(group);
  for (let i = 0; i < 16; i++)
    for (const side of [-1, 1])
      addMesh(group, rounded(0.012, 0.016, 0.07, 0.004), paint('#c9d0dc', 0.7), [
        side * 0.81,
        0.13,
        -1 + i * 0.12,
      ]);
}

function detailHousing(group: THREE.Group) {
  for (let i = 0; i < 15; i++)
    for (const side of [-1, 1])
      addMesh(group, rounded(0.18, 0.018, 0.033, 0.008), black(), [
        side * 0.25,
        -0.765,
        -0.8 + i * 0.11,
      ]);
  for (const side of [-1, 1])
    for (const z of [-0.9, 0.8]) screw(group, [side * 0.56, -0.47, z], [Math.PI / 2, 0, 0], 0.55);
}

function detailBoard(group: THREE.Group) {
  for (const side of [-1, 1])
    for (const z of [-0.82, 0.82])
      addMesh(group, new THREE.CylinderGeometry(0.035, 0.035, 0.18, 12), silver(), [
        side * 0.48,
        -0.08,
        z,
      ]);
  for (let i = 0; i < 18; i++)
    addMesh(group, rounded(0.035, 0.02, 0.045, 0.003), paint('#d9c48a', 0.7), [
      ((i % 6) - 2.5) * 0.1,
      0.04,
      0.44 + Math.floor(i / 6) * 0.085,
    ]);
}

function detailProcessor(group: THREE.Group) {
  const neon = new THREE.MeshBasicMaterial({ color: '#28cfff' }),
    halo = new THREE.MeshBasicMaterial({
      color: '#37bfff',
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
  for (const side of [-1, 1]) {
    addMesh(group, rounded(0.82, 0.012, 0.014, 0.005), neon, [0, 0.117, side * 0.4]);
    addMesh(group, rounded(0.014, 0.012, 0.82, 0.005), neon, [side * 0.4, 0.117, 0]);
    addMesh(group, rounded(0.86, 0.009, 0.05, 0.012), halo, [0, 0.113, side * 0.4]);
    addMesh(group, rounded(0.05, 0.009, 0.86, 0.012), halo, [side * 0.4, 0.113, 0]);
  }
}

function detailIR(group: THREE.Group) {
  for (let i = 0; i < 48; i++) {
    const a = (i * Math.PI) / 24;
    addMesh(
      group,
      rounded(0.014, 0.047, 0.008, 0.003),
      paint('#8692a6', 0.65),
      [Math.cos(a) * 0.746, Math.sin(a) * 0.746, 0.11],
      [0, 0, a - Math.PI / 2],
    );
  }
}

const detailBuilders: Partial<Record<CameraPartId, (group: THREE.Group) => void>> = {
  hood: detailHood,
  housing: detailHousing,
  mount: rearPorts,
  board: detailBoard,
  ir: detailIR,
  processor: detailProcessor,
};
export function addDetailing(id: CameraPartId, group: THREE.Group) {
  detailBuilders[id]?.(group);
}
