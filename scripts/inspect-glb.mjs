import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { getBounds } from '@gltf-transform/functions';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(process.argv[2]);
const root = doc.getRoot();
const scene = root.listScenes()[0];
const b = getBounds(scene);
console.log('bounds', b.min.map(v=>v.toFixed(2)), b.max.map(v=>v.toFixed(2)));
console.log('nodes', root.listNodes().length, 'meshes', root.listMeshes().length, 'materials', root.listMaterials().length, 'textures', root.listTextures().length);
let prims = 0, tris = 0, verts = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) { prims++; const idx = p.getIndices(); const pos = p.getAttribute('POSITION'); verts += pos.getCount(); tris += (idx ? idx.getCount() : pos.getCount())/3; }
// draw calls = node-mesh instances * primitives
let draws = 0;
for (const n of root.listNodes()) { const m = n.getMesh(); if (m) draws += m.listPrimitives().length; }
console.log('primitives', prims, 'draws', draws, 'tris', Math.round(tris), 'verts', verts);
console.log('--- textures');
for (const t of root.listTextures()) { const s = t.getSize(); console.log(t.getName(), t.getURI(), t.getMimeType(), s && s.join('x'), (t.getImage()?.byteLength/1024|0)+'KB'); }
console.log('--- materials');
for (const m of root.listMaterials()) {
  const bc = m.getBaseColorTexture(); const em = m.getEmissiveTexture();
  console.log(JSON.stringify(m.getName()), 'col', m.getBaseColorFactor().map(v=>v.toFixed(2)).join(','), 'rough', m.getRoughnessFactor().toFixed(2), 'metal', m.getMetallicFactor().toFixed(2), 'emis', m.getEmissiveFactor().map(v=>v.toFixed(2)).join(','), 'alpha', m.getAlphaMode(), 'bc', bc?.getName()||bc?.getURI()||'', 'em', em?.getName()||'', 'users', m.listParents().length);
}
