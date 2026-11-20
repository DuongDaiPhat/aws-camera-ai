import * as THREE from 'three';
import { addMesh, black, labelTexture, paint, rounded, silver } from './camera-geometry';
export function buildBoard(group: THREE.Group) {
  addMesh(group, rounded(1.2, 0.045, 2.05, 0.045), paint('#164c42', 0.25, 0.48));
  const trace = paint('#c6ae6a', 0.75, 0.35);
  for (let i = 0; i < 12; i++)
    for (const side of [-1, 1]) {
      addMesh(group, rounded(0.013, 0.004, 0.5, 0.002), trace, [
        (i - 5.5) * 0.075,
        0.026,
        side * 0.67,
      ]);
      addMesh(group, rounded(0.32, 0.004, 0.012, 0.002), trace, [
        side * 0.38,
        0.027,
        (i - 5.5) * 0.062,
      ]);
    }
  for (const x of [-0.43, 0.43])
    for (const z of [-0.8, -0.36, 0.3, 0.76]) {
      addMesh(group, rounded(0.15, 0.07, 0.22, 0.015), black(), [x, 0.06, z]);
      for (const side of [-1, 1])
        for (let i = 0; i < 5; i++)
          addMesh(group, rounded(0.025, 0.025, 0.016, 0.002), silver(), [
            x + side * 0.08,
            0.04,
            z + (i - 2) * 0.035,
          ]);
    }
  for (const x of [-0.32, -0.2, -0.08, 0.08, 0.2, 0.32])
    addMesh(group, rounded(0.04, 0.02, 0.14, 0.002), trace, [x, 0.035, -0.98]);
  for (const z of [-0.9, 0.9])
    for (const x of [-0.5, 0.5]) {
      const mount = addMesh(
        group,
        new THREE.TorusGeometry(0.04, 0.01, 8, 20),
        silver(),
        [x, 0.029, z],
        [Math.PI / 2, 0, 0],
      );
      mount.castShadow = false;
    }
  for (let i = 0; i < 8; i++)
    addMesh(group, rounded(0.06, 0.035, 0.035, 0.004), paint('#adbbbd', 0.7), [
      (i - 3.5) * 0.1,
      0.04,
      0.77,
    ]);
}
export function buildProcessor(group: THREE.Group) {
  addMesh(group, rounded(0.91, 0.08, 0.91, 0.035), paint('#c2a66b', 0.8, 0.25));
  addMesh(group, rounded(0.77, 0.07, 0.77, 0.035), black(), [0, 0.06, 0]);
  const texture = labelTexture('AI');
  const top = new THREE.MeshPhysicalMaterial({
    map: texture,
    metalness: 0.55,
    roughness: 0.22,
    emissive: '#5ba5ed',
    emissiveMap: texture,
    emissiveIntensity: 0.8,
    clearcoat: 1,
  });
  addMesh(group, new THREE.PlaneGeometry(0.65, 0.65), top, [0, 0.104, 0], [-Math.PI / 2, 0, 0]);
  const gold = paint('#dec78b', 0.85, 0.2);
  for (const side of [-1, 1])
    for (let i = 0; i < 14; i++) {
      addMesh(group, rounded(0.022, 0.035, 0.12, 0.004), gold, [
        (i - 6.5) * 0.052,
        -0.015,
        side * 0.48,
      ]);
      addMesh(group, rounded(0.12, 0.035, 0.022, 0.004), gold, [
        side * 0.48,
        -0.015,
        (i - 6.5) * 0.052,
      ]);
    }
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = 128;
  glowCanvas.height = 128;
  const ctx = glowCanvas.getContext('2d')!;
  const glow = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  glow.addColorStop(0, 'rgba(90,198,255,.2)');
  glow.addColorStop(0.5, 'rgba(79,112,255,.08)');
  glow.addColorStop(1, 'rgba(79,112,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 128, 128);
  const aura = new THREE.CanvasTexture(glowCanvas);
  const halo = addMesh(
    group,
    new THREE.PlaneGeometry(2.4, 2.4),
    new THREE.MeshBasicMaterial({
      map: aura,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
    [0, 0.12, 0],
    [-Math.PI / 2, 0, 0],
  );
  halo.castShadow = false;
}
