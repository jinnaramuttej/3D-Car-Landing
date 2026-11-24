/**
 * Builds public/models/gt3r.glb from the source car.
 *
 *   node scripts/optimize-car.mjs [source.glb] [out.glb]      (npm run car)
 *
 * Source: "Porsche 992 GT3 R" by MattDoesBlender, CC BY-NC-SA 4.0 (credit in the footer
 * and the README), kept as assets/gt3r-source.glb. Modified: interior removed, simplified,
 * compressed.
 *
 *   1. drop everything the tinted glass hides: the cockpit, seats, belts, roll-cage foam,
 *      dash, electronics, cables, displays, LEDs, the inner door panels and glass, the
 *      rear-view mirror (Car.tsx puts one dark shell behind the glass and a flat undertray
 *      under the car instead)
 *   2. keep the body panels, the wheels as separate nodes (WHEEL_xx, Car.tsx spins and
 *      steers them), the discs and calipers, the lights, the exhaust tips and the wipers
 *   3. weld, then simplify the big meshes (meshoptimizer) so the car lands at ~130k
 *      triangles; small parts (lights, badges) are left exact
 *   4. textures to WebP (KTX2 if the Khronos `toktx` tool is installed), max 1024 px
 *   5. meshopt geometry compression
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, prune, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const SRC = process.argv[2] ?? path.join(process.cwd(), 'assets', 'gt3r-source.glb');
const OUT = process.argv[3] ?? path.join(process.cwd(), 'public', 'models', 'gt3r.glb');
/** Target triangle count for the whole car. */
const TARGET = Number(process.env.TARGET ?? 130000);
/** Meshes smaller than this are left exact. */
const SMALL = 2500;

/** Materials of what the glass hides. */
const HIDDEN = /^(INT_|INT$|SEAT_|BELT_|SPARCO|STEER_|DISPLAY|LED_RACELOGIC|WorldGridMaterial)/;
/** Nodes of what the glass hides (by name). */
const HIDDEN_NODES = /^(MIRROR_C|CINTURE_ON|GEO_INT_|GEO_TRAV_|GEO_CARBON_DOOR|DOBRADICA_)/;

await MeshoptDecoder.ready;
await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(SRC);
const root = doc.getRoot();

const tris = (prim) => {
  const idx = prim.getIndices();
  return (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
};
const count = () => root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + tris(p), 0), 0);
const before = { tris: count(), nodes: root.listNodes().length, bytes: fs.statSync(SRC).size };

// 1. what the glass hides
for (const node of root.listNodes()) if (HIDDEN_NODES.test(node.getName())) node.dispose();
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives()) if (HIDDEN.test(prim.getMaterial()?.getName() ?? '')) prim.dispose();
for (const mesh of root.listMeshes()) if (!mesh.listPrimitives().length) mesh.dispose();
// (the livery is applied in code on TEXCOORD_0, which the GLB's own paint material doesn't
// reference: keep attributes through prune; only the spare uv sets 2-4 go)
for (const mesh of root.listMeshes())
  for (const prim of mesh.listPrimitives())
    for (const sem of ['TEXCOORD_2', 'TEXCOORD_3', 'TEXCOORD_4']) {
      const a = prim.getAttribute(sem);
      if (a) prim.setAttribute(sem, null);
    }
await doc.transform(prune({ keepLeaves: false, keepAttributes: true }));
const stripped = count();

// 3. weld, then simplify the big meshes toward the target
await doc.transform(weld());
const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
const small = prims.filter((p) => tris(p) < SMALL).reduce((s, p) => s + tris(p), 0);
const big = prims.filter((p) => tris(p) >= SMALL);
const bigTris = big.reduce((s, p) => s + tris(p), 0);
const ratio = Math.min(1, Math.max(0.15, (TARGET - small) / Math.max(1, bigTris)));
for (const p of big) simplifyPrimitive(p, { simplifier: MeshoptSimplifier, ratio, error: 0.004 });
const simplified = count();

// 4. textures
let ktx2 = false;
try {
  execSync('toktx --version', { stdio: 'ignore' });
  ktx2 = true;
} catch {
  /* no KTX-Software on this machine: WebP */
}
if (ktx2) {
  const { toktx, Mode } = await import('@gltf-transform/cli');
  await doc.transform(toktx({ mode: Mode.UASTC, slots: /^normalTexture$/, level: 2 }), toktx({ mode: Mode.ETC1S, slots: /^(?!normalTexture).*$/ }));
} else {
  await doc.transform(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 88 }));
}

// 5. geometry
await doc.transform(prune({ keepAttributes: true }), meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await io.write(OUT, doc);

const mb = (b) => `${(b / 1048576).toFixed(2)} MB`;
const k = (n) => `${Math.round(n / 1000)}k`;
console.log('optimize-car:');
console.log(`  triangles ${k(before.tris)} -> ${k(stripped)} without the interior -> ${k(simplified)} simplified (big meshes x${ratio.toFixed(2)})`);
console.log(`  nodes ${before.nodes} -> ${root.listNodes().length}, materials ${root.listMaterials().length}, textures ${root.listTextures().length} (${ktx2 ? 'KTX2' : 'WebP: install KTX-Software toktx for KTX2'})`);
console.log(`  file ${mb(before.bytes)} -> ${mb(fs.statSync(OUT).size)}  ${OUT}`);
