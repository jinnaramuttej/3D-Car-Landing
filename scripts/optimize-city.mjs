/**
 * Builds assets/city-full.glb from the source model (trim-city.mjs then cuts it down to
 * public/models/city.glb, what the journey can see).
 *
 *   node scripts/optimize-city.mjs [source.glb] [out.glb]
 *
 * Source: "city" by golukumar (mortalityrexotable), CC BY 4.0,
 * https://sketchfab.com/3d-models/city-2e358ed084524a8f963c146a19637815
 * (default path: ~/Downloads/city/source/Untitled.glb). Modified: scaled, merged,
 * compressed, and some textures replaced with generated ones (city-textures.mjs).
 *
 * Steps:
 *   1. replace the two oversized pasted textures (palm atlas, tree card) with generated
 *      LED ones, and the three ad posters (faces, logos) with generated shop signs
 *   2. tag every material with what the scene should do with it (road, window, sign...)
 *   3. bake every node's transform plus the global scale (a lane, 0.06 units in the
 *      source, becomes 3.5 m) and centre the city on x/z
 *   4. sort the meshes into a grid of tiles and join everything that shares a material
 *      inside a tile (frustum culling still works per tile, draw calls stay low)
 *   5. weld, dedup, prune, WebP textures (max 512 px), meshopt compression
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, getBounds, join, meshopt, prune, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import { ledPalm, ledSign, ledTree } from './city-textures.mjs';

const SRC = process.argv[2] ?? path.join(os.homedir(), 'Downloads', 'city', 'source', 'Untitled.glb');
const OUT = process.argv[3] ?? path.join(process.cwd(), 'assets', 'city-full.glb');

/** Source lane width (model units) -> 3.5 m. */
const LANE_SOURCE = 0.06;
export const SCALE = 3.5 / LANE_SOURCE;
const TILES_X = Number(process.env.TILES_X ?? 2);
const TILES_Z = Number(process.env.TILES_Z ?? 2);

/** Texture name prefix -> what the scene does with the material (see src/scene/city/cityMaterials.ts). */
const KIND = {
  road: [49, 65, 72, 76, 79, 87, 'Untitled1'],
  ground: [19, 27, 47, 97],
  window: [0, 17, 33, 50, 51, 52, 53, 57, 66, 73, 80, 83, 84, 85, 90, 93, 95, 96, 98],
  sign: [9, 26, 29, 31, 32, 58, 61, 62, 63, 67, 68, 71, 74, 86, 88, 89, 94],
  metal: [54, 75],
  foliage: [24, 91, 92],
};

function kindOf(texName) {
  if (!texName) return 'plain';
  if (texName.startsWith('ChatGPT')) return 'ledpalm';
  if (texName.startsWith('socialsight')) return 'ledtree';
  const m = texName.match(/^Image_(\d+)/);
  const id = m ? Number(m[1]) : texName;
  for (const [k, list] of Object.entries(KIND)) if (list.includes(id)) return k;
  return 'plain';
}

const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;

function stats(doc) {
  const root = doc.getRoot();
  let draws = 0;
  let tris = 0;
  for (const node of root.listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    for (const p of mesh.listPrimitives()) {
      draws++;
      const idx = p.getIndices();
      tris += (idx ? idx.getCount() : p.getAttribute('POSITION').getCount()) / 3;
    }
  }
  let tex = 0;
  for (const t of root.listTextures()) tex += t.getImage()?.byteLength ?? 0;
  return { nodes: root.listNodes().length, materials: root.listMaterials().length, textures: root.listTextures().length, draws, tris: Math.round(tris), tex };
}

await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const srcBytes = fs.statSync(SRC).size;
const doc = await io.read(SRC);
const root = doc.getRoot();
const before = stats(doc);
console.log(`source  ${mb(srcBytes)}  ${before.draws} draw calls, ${before.tris} tris, ${before.materials} materials, ${before.textures} textures (${mb(before.tex)})`);

/* 1. generated textures ------------------------------------------------------ */
const replaced = [];
for (const t of root.listTextures()) {
  const name = t.getName() ?? '';
  let png = null;
  if (name.startsWith('ChatGPT')) png = await ledPalm();
  else if (name.startsWith('socialsight')) png = await ledTree();
  else if (/^Image_29$/.test(name)) png = await ledSign(256, 256, 29, { cols: 2, rows: 3 });
  else if (/^Image_94$/.test(name)) png = await ledSign(256, 256, 94, { cols: 2, rows: 2 });
  else if (/^Image_74$/.test(name)) png = await ledSign(128, 256, 74, { vertical: true, cols: 1, rows: 1 });
  if (!png) continue;
  replaced.push(`${name} (${kb(t.getImage().byteLength)} -> generated)`);
  t.setImage(png).setMimeType('image/png').setURI('');
}
console.log('replaced textures:\n  ' + replaced.join('\n  '));

/* 2. material kinds ------------------------------------------------------------ */
const kinds = {};
for (const m of root.listMaterials()) {
  const tex = m.getBaseColorTexture()?.getName();
  const kind = kindOf(tex);
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  m.setName(`${kind}:${tex ?? m.getName()}`);
  if (kind === 'ledpalm' || kind === 'ledtree') {
    // cut-outs instead of sorted transparency: they merge into a few big meshes
    m.setAlphaMode('MASK').setAlphaCutoff(0.4).setDoubleSided(true);
  }
}
console.log('material kinds', kinds);

/* 3. bake transforms + global scale, centred on x/z --------------------------- */
const scene = root.listScenes()[0];
const b = getBounds(scene);
const cx = (b.min[0] + b.max[0]) / 2;
const cz = (b.min[2] + b.max[2]) / 2;
// column-major: scale, then translate the centre to the origin (y stays: the source's 0 is road level in the north)
const G = [SCALE, 0, 0, 0, 0, SCALE, 0, 0, 0, 0, SCALE, 0, -cx * SCALE, 0, -cz * SCALE, 1];
const mul = (a, c) => {
  const o = new Array(16).fill(0);
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * c[j * 4 + k];
  return o;
};

const meshNodes = root.listNodes().filter((n) => n.getMesh());
const seen = new Set();
const tiles = new Map();
const tileOf = (x, z) => {
  const sx = (b.max[0] - b.min[0]) * SCALE;
  const sz = (b.max[2] - b.min[2]) * SCALE;
  const ix = Math.min(TILES_X - 1, Math.max(0, Math.floor(((x + sx / 2) / sx) * TILES_X)));
  const iz = Math.min(TILES_Z - 1, Math.max(0, Math.floor(((z + sz / 2) / sz) * TILES_Z)));
  const key = `tile_${ix}_${iz}`;
  if (!tiles.has(key)) {
    const node = doc.createNode(key);
    scene.addChild(node);
    tiles.set(key, node);
  }
  return tiles.get(key);
};

for (const node of meshNodes) {
  let mesh = node.getMesh();
  if (seen.has(mesh)) {
    mesh = mesh.clone();
    node.setMesh(mesh);
  }
  seen.add(mesh);
  const world = mul(G, node.getWorldMatrix());
  transformMesh(mesh, world);
  // centre of the baked mesh decides its tile
  let x = 0;
  let z = 0;
  let n = 0;
  for (const p of mesh.listPrimitives()) {
    const pos = p.getAttribute('POSITION');
    const lo = pos.getMin([]);
    const hi = pos.getMax([]);
    x += (lo[0] + hi[0]) / 2;
    z += (lo[2] + hi[2]) / 2;
    n++;
  }
  const tile = tileOf(x / n, z / n);
  // detach from the old hierarchy with an identity transform
  for (const parent of node.listParents()) if (parent !== root && parent.removeChild) parent.removeChild(node);
  node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]);
  tile.addChild(node);
}
// everything else (the old hierarchy) goes
for (const child of scene.listChildren()) if (!child.getName().startsWith('tile_')) scene.removeChild(child);

/* 4-5. merge and compress --------------------------------------------------- */
await doc.transform(
  prune(),
  dedup(),
  join({ keepNamed: false }),
  weld(),
  prune(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [512, 512], quality: 82 }),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);

const after = stats(doc);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const outBytes = fs.statSync(OUT).size;
const sb = getBounds(doc.getRoot().listScenes()[0]);
console.log(`output  ${mb(outBytes)}  ${after.draws} draw calls, ${after.tris} tris, ${after.materials} materials, ${after.textures} textures (${mb(after.tex)})`);
console.log('bounds (m)', sb.min.map((v) => v.toFixed(1)).join(', '), '->', sb.max.map((v) => v.toFixed(1)).join(', '));
console.log(`scale ${SCALE.toFixed(3)} m per source unit, centre offset x ${(-cx * SCALE).toFixed(2)} z ${(-cz * SCALE).toFixed(2)}`);
console.log(`wrote ${OUT}`);
