import * as THREE from 'three';
import { addDetailing } from './camera-detailing';
import { batchPart } from './camera-batching';
import { buildHousing, buildHood, buildMount, buildFasteners } from './camera-shell';
import { buildLens, buildGlass, buildIR, buildSensor } from './camera-optics';
import { buildBoard, buildProcessor } from './camera-electronics';
import type { CameraPartId } from './camera-parts';
import type { Vector } from './camera-geometry';
export interface PartPose {
  position: Vector;
  spread: Vector;
  rotation: Vector;
  delay: number;
}
export const PART_POSES: Record<CameraPartId, PartPose> = {
  housing: { position: [0, 0, 0], spread: [0.6, -0.95, 0], rotation: [0, 0, -0.16], delay: 0.1 },
  hood: { position: [0, 0, 0], spread: [-0.25, 1.35, -0.1], rotation: [0, 0, 0.1], delay: 0 },
  lens: { position: [0, 0, 1.15], spread: [0, -0.05, 1.05], rotation: [0, 0, 0], delay: 0.09 },
  glass: { position: [0, 0, 1.57], spread: [0, -0.05, 2.1], rotation: [0, 0, 0], delay: 0.15 },
  ir: { position: [0, 0, 1.48], spread: [0, -0.05, 1.6], rotation: [0, 0, 0], delay: 0.12 },
  sensor: { position: [0, 0, 0.69], spread: [0, 0.02, 0.55], rotation: [0, 0, 0], delay: 0.06 },
  board: { position: [0, -0.18, -0.17], spread: [0, 0, 0], rotation: [0, 0, 0], delay: 0 },
  processor: {
    position: [0, -0.1, -0.17],
    spread: [-1.05, 0.6, 0.7],
    rotation: [0.45, 0, 0.4],
    delay: 0,
  },
  mount: {
    position: [0, 0, -1.4],
    spread: [-0.1, 0.15, -1.05],
    rotation: [0, 0, 0.08],
    delay: 0.05,
  },
  fasteners: {
    position: [0, 0, 0],
    spread: [0.45, 0.35, 0.14],
    rotation: [0, 0, 0.32],
    delay: 0.1,
  },
};
const builders: Record<CameraPartId, (group: THREE.Group) => void> = {
  housing: buildHousing,
  hood: buildHood,
  lens: buildLens,
  glass: buildGlass,
  ir: buildIR,
  sensor: buildSensor,
  board: buildBoard,
  processor: buildProcessor,
  mount: buildMount,
  fasteners: buildFasteners,
};
export function createCameraModel() {
  const root = new THREE.Group();
  root.rotation.z = 0.08;
  const head = new THREE.Group();
  head.position.z = -1.35;
  root.add(head);
  const parts = {} as Record<CameraPartId, THREE.Group>;
  for (const id of Object.keys(builders) as CameraPartId[]) {
    const group = new THREE.Group();
    group.position.set(...PART_POSES[id].position);
    group.userData.partId = id;
    builders[id](group);
    addDetailing(id, group);
    batchPart(group);
    parts[id] = group;
    if (id === 'mount') root.add(group);
    else {
      group.position.z += 1.35;
      head.add(group);
    }
  }
  return {
    root,
    head,
    parts,
    highlight(selected: CameraPartId) {
      for (const [id, part] of Object.entries(parts))
        part.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material]) {
            if (!(material instanceof THREE.MeshPhysicalMaterial) || material.map || id === 'glass')
              continue;
            material.emissive.set(id === selected ? '#3658aa' : '#000000');
            material.emissiveIntensity = id === selected ? 0.12 : 0;
          }
        });
    },
  };
}
