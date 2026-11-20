import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
interface Batch {
  material: THREE.MeshPhysicalMaterial;
  meshes: THREE.Mesh[];
}
/** Combine fixed opaque details inside each independently moving assembly. */
export function batchPart(part: THREE.Group) {
  part.updateMatrixWorld(true);
  const inverse = part.matrixWorld.clone().invert();
  const batches = new Map<string, Batch>();
  part.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !(object.material instanceof THREE.MeshPhysicalMaterial))
      return;
    const material = object.material;
    if (material.map || material.transparent || material.transmission > 0) return;
    const key = [
      material.color.getHexString(),
      material.metalness,
      material.roughness,
      material.clearcoat,
      material.clearcoatRoughness,
      material.side,
    ].join(':');
    const batch = batches.get(key) ?? { material, meshes: [] };
    batch.meshes.push(object);
    batches.set(key, batch);
  });
  for (const batch of batches.values()) {
    if (batch.meshes.length < 2) continue;
    const sources = batch.meshes.map((mesh) => {
      const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
      geometry.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld));
      return geometry;
    });
    const geometry = mergeGeometries(sources, false);
    for (const source of sources) source.dispose();
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, batch.material);
    merged.castShadow = true;
    merged.receiveShadow = true;
    const oldGeometry = new Set<THREE.BufferGeometry>(),
      oldMaterial = new Set<THREE.Material>();
    for (const mesh of batch.meshes) {
      oldGeometry.add(mesh.geometry);
      if (mesh.material !== batch.material) oldMaterial.add(mesh.material as THREE.Material);
      mesh.parent?.remove(mesh);
    }
    for (const item of oldGeometry) item.dispose();
    for (const item of oldMaterial) item.dispose();
    part.add(merged);
  }
}
