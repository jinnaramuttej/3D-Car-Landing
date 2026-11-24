/**
 * The city as the scene has it, for the build's checks (contact, corridor, pacing): every
 * primitive of public/models/city.glb as a world-placed three.js mesh, tagged road (the
 * road and ground materials the wheels may stand on) or not.
 */
import { type Document, NodeIO, type Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { BufferAttribute, BufferGeometry, Matrix4, Mesh, MeshBasicMaterial } from 'three';
import { CITY_ORIGIN } from '../../src/lib/cityRoute';

export const CITY_FILE = 'public/models/city.glb';

export type CityMesh = { mesh: Mesh; road: boolean; material: string; node: string; prim: number; primitive: Primitive };

export async function cityIO() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  return new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

/** The model's primitives as three.js meshes (world space, CITY_ORIGIN added). */
export function cityMeshes(doc: Document): CityMesh[] {
  const out: CityMesh[] = [];
  const mat = new MeshBasicMaterial();
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = new Matrix4().fromArray(node.getWorldMatrix());
    mesh.listPrimitives().forEach((p, prim) => {
      const name = p.getMaterial()?.getName() ?? '';
      const kind = name.split(':')[0];
      const pos = p.getAttribute('POSITION')!;
      const arr = new Float32Array(pos.getCount() * 3);
      const e: number[] = [];
      for (let i = 0; i < pos.getCount(); i++) arr.set(pos.getElement(i, e), i * 3);
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(arr, 3));
      const idx = p.getIndices();
      g.setIndex(idx ? Array.from(idx.getArray()!) : Array.from({ length: pos.getCount() }, (_, i) => i));
      const me = new Mesh(g, mat);
      me.applyMatrix4(m);
      me.position.add(CITY_ORIGIN);
      me.updateMatrixWorld(true);
      out.push({ mesh: me, road: kind === 'road' || kind === 'ground', material: name, node: node.getName(), prim, primitive: p });
    });
  }
  return out;
}

export async function loadCityMeshes(file = CITY_FILE): Promise<CityMesh[]> {
  const doc = await (await cityIO()).read(file);
  return cityMeshes(doc);
}
