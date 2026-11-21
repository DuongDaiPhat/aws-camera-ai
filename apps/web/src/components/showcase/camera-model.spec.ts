// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { createCameraModel, PART_POSES } from './camera-model';
import { batchPart } from './camera-batching';
import { addMesh, disc, labelTexture, screw } from './camera-geometry';
import { createSimulation, DEMO_AIM } from './camera-simulation';
import { makeFace, makeFall, makeFire, makeZone } from './camera-scenario-objects';

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    createRadialGradient: () => ({ addColorStop: vi.fn() }),
  } as unknown as CanvasRenderingContext2D);
});
afterEach(() => vi.restoreAllMocks());

describe('camera model assemblies', () => {
  it('builds finite selectable geometry and keeps the mount independent of the head', () => {
    const model = createCameraModel();
    expect(Object.keys(model.parts).sort()).toEqual(Object.keys(PART_POSES).sort());
    expect(model.parts.mount.parent).toBe(model.root);
    for (const [id, part] of Object.entries(model.parts)) {
      expect(part.userData.partId).toBe(id);
      if (id !== 'mount') expect(part.parent).toBe(model.head);
      let meshes = 0;
      part.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        meshes++;
        const position = object.geometry.getAttribute('position');
        expect(position.count).toBeGreaterThan(0);
        expect(Array.from(position.array).every(Number.isFinite)).toBe(true);
      });
      expect(meshes).toBeGreaterThan(0);
    }
    model.highlight('processor');
    const physical: THREE.MeshPhysicalMaterial[] = [];
    model.parts.processor.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object.material instanceof THREE.MeshPhysicalMaterial &&
        !object.material.map
      )
        physical.push(object.material);
    });
    expect(physical.length).toBeGreaterThan(0);
    expect(physical.every((material) => material.emissiveIntensity === 0.12)).toBe(true);
    model.highlight('lens');
    expect(physical.every((material) => material.emissiveIntensity === 0)).toBe(true);
    expect(new THREE.Box3().setFromObject(model.root).isEmpty()).toBe(false);
  });

  it('batches compatible opaque materials while preserving geometry and transparent details', () => {
    const group = new THREE.Group();
    group.position.set(3, 2, 1);
    const material = new THREE.MeshPhysicalMaterial({ color: '#123456' });
    const one = addMesh(group, new THREE.BoxGeometry(1, 1, 1), material, [-2, 0, 0]);
    const otherMaterial = material.clone();
    const two = addMesh(
      group,
      new THREE.BoxGeometry(1, 1, 1).toNonIndexed(),
      otherMaterial,
      [2, 0, 0],
    );
    const transparent = addMesh(
      group,
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial({ transparent: true }),
    );
    const transmission = addMesh(
      group,
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial({ transmission: 1 }),
    );
    const mapped = addMesh(
      group,
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial({ map: new THREE.Texture() }),
    );
    const plain = addMesh(group, new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    const unique = addMesh(
      group,
      new THREE.BoxGeometry(),
      new THREE.MeshPhysicalMaterial({ color: '#ffffff' }),
    );
    const before = new THREE.Box3().setFromObject(group);
    const disposeGeometry = vi.spyOn(one.geometry, 'dispose');
    const disposeMaterial = vi.spyOn(otherMaterial, 'dispose');
    batchPart(group);
    expect(one.parent).toBeNull();
    expect(two.parent).toBeNull();
    expect(disposeGeometry).toHaveBeenCalledOnce();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    for (const kept of [transparent, transmission, mapped, plain, unique])
      expect(kept.parent).toBe(group);
    const after = new THREE.Box3().setFromObject(group);
    expect(after.min.distanceTo(before.min)).toBeLessThan(0.00001);
    expect(after.max.distanceTo(before.max)).toBeLessThan(0.00001);
  });

  it('builds geometry helpers with defaults and explicit transforms and label colors', () => {
    const group = new THREE.Group();
    const material = new THREE.MeshBasicMaterial();
    const mesh = addMesh(group, new THREE.BoxGeometry(), material);
    expect(mesh.position.toArray()).toEqual([0, 0, 0]);
    expect(mesh.castShadow && mesh.receiveShadow).toBe(true);
    expect(disc(group, 1, 0.1, material).rotation.x).toBe(Math.PI / 2);
    const bolt = screw(group, [1, 2, 3]);
    expect(bolt.position.toArray()).toEqual([1, 2, 3]);
    expect(bolt.children).toHaveLength(4);
    expect(labelTexture('AI').colorSpace).toBe(THREE.SRGBColorSpace);
    expect(labelTexture('VISION', '#fff', '#000').image.width).toBe(512);
  });
});

describe('AI showcase scenarios', () => {
  it('moves fire, face, fall and zone examples and freezes them with reduced motion', () => {
    const fire = makeFire();
    fire.tick(0.2, false);
    expect(fire.group.children[0]!.scale.y).not.toBe(1);
    fire.tick(0.2, true);
    expect(fire.group.children[0]!.scale.y).toBe(1);
    const fall = makeFall();
    fall.tick(0, false);
    expect(fall.group.children[0]!.rotation.z).toBeCloseTo(0);
    fall.tick(0, true);
    expect(fall.group.children[0]!.rotation.z).toBe(-Math.PI / 2);
    const face = makeFace();
    const scan = face.group.children[1]!.children[8]!;
    face.tick(0.3, false);
    expect(scan.position.y).not.toBe(0);
    face.tick(0.3, true);
    expect(scan.position.y).toBe(0);
    const zone = makeZone();
    const person = zone.group.children.at(-1)!;
    zone.tick(0, false);
    expect(person.position.x).toBe(1.7);
    zone.tick(0, true);
    expect(person.position.x).toBe(0);
  });

  it('shows exactly one scenario and aims the beam at the selected event', () => {
    const scene = new THREE.Scene();
    const simulation = createSimulation(scene);
    const origin = new THREE.Vector3(0, 0, 1);
    expect(simulation.update(null, 0.1, true, origin)).toBe(false);
    expect(scene.children.every((child) => !child.visible)).toBe(true);
    for (const id of ['fire', 'fall', 'face', 'zone'] as const) {
      expect(simulation.update(id, 0.1, true, origin)).toBe(false);
      expect(
        scene.children.filter((child) => child instanceof THREE.Group && child.visible),
      ).toHaveLength(1);
      const cone = scene.children[0] as THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
      expect(cone.visible).toBe(true);
      expect(cone.position.distanceTo(origin.clone().lerp(DEMO_AIM[id].target, 0.5))).toBeLessThan(
        0.00001,
      );
      expect(cone.material.color.getHexString()).toBe(DEMO_AIM[id].color.slice(1));
      expect(simulation.update(id, 0.1, false, origin)).toBe(true);
    }
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    expect(simulation.update('zone', 0.1, false, origin)).toBe(false);
    expect(simulation.update(null, 0.1, false, origin)).toBe(true);
    for (let i = 0; i < 100; i++) simulation.update(null, 0.1, false, origin);
    expect(simulation.update(null, 0.1, false, origin)).toBe(false);
    expect(scene.children.every((child) => !child.visible)).toBe(true);
  });
});
