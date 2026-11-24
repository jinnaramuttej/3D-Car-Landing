'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { ContactShadows, useGLTF, useTexture } from '@react-three/drei';
import {
  Box3,
  Color,
  Group,
  MathUtils,
  type Mesh,
  type MeshPhysicalMaterial,
  type MeshStandardMaterial,
  Object3D,
  type PointLight,
  type SpotLight,
  type Texture,
  Vector3,
} from 'three';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { chapterState } from '@/lib/chapterRuntime';
import { interaction } from '@/lib/interaction';
import { carState } from '@/lib/motion';
import { useStore } from '@/lib/store';
import {
  createGlassMaterial,
  createPaintMaterial,
  createTyreMaterial,
  fixMaterial,
  LIVERY_URL,
  LIVERY_URL_MOBILE,
  type MaterialRoles,
  prepareLivery,
} from './carMaterials';
import { createLiveryUniforms, LIVERIES, patchPaint } from './livery';

export const MODEL_URL = '/models/gt3r.glb';

const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;
type CornerId = (typeof CORNERS)[number];

type Corner = {
  id: CornerId;
  front: boolean;
  /** Sits at the hub centre. Rotates about Y to steer. Holds caliper + spin pivot. */
  steer: Group;
  /** Child of steer. Rotates about X to roll. Holds tyre, rim and brake disc. */
  spin: Group;
  /** Motion-blur discs that ship with the model; faded in with wheel speed. */
  blur: Mesh[];
};

type GlowMat = { mat: MeshStandardMaterial; factor: number };

type Rig = {
  body: Object3D;
  wheels: Group;
  corners: Corner[];
  groundOffset: number;
  frontRadius: number;
  rearRadius: number;
  /** Car-local tyre contact patches of the rear wheels [left, right]. */
  rearContactsLocal: [Vector3, Vector3];
  head: GlowMat[];
  tail: GlowMat[];
  paint: MeshPhysicalMaterial | null;
  glass: MeshPhysicalMaterial[];
  tyre: MeshPhysicalMaterial | null;
  rims: MeshStandardMaterial[];
  calipers: MeshStandardMaterial[];
};

const logged = new WeakSet<Object3D>();

function logNodes(root: Object3D) {
  const lines: string[] = [];
  const walk = (o: Object3D, depth: number) => {
    lines.push(`${'  '.repeat(depth)}${o.name || '(unnamed)'}  <${o.type}>`);
    for (const c of o.children) walk(c, depth + 1);
  };
  walk(root, 0);
  console.groupCollapsed(`[gt3r] ${lines.length} nodes in ${MODEL_URL}`);
  console.log(lines.join('\n'));
  console.groupEnd();
}

function materialsOf(mesh: Mesh) {
  return (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as MeshStandardMaterial[];
}

/**
 * Turns the glTF into a drivable rig. Works on a clone (geometry and materials are
 * shared), so the cached useGLTF scene is never mutated: StrictMode double renders
 * and fast refresh can rebuild it safely.
 *
 * The model ships every wheel as its own node (WHEEL_LF/RF/LR/RR), but their
 * pivots sit at the car origin with the geometry baked in place. We measure each
 * tyre, drop a pivot at the hub and re-parent the wheel under it with `attach`
 * (keeps world position), so rotation.x spins and rotation.y steers.
 */
function buildRig(source: Object3D, livery: Texture, mobile: boolean): Rig {
  const verbose = process.env.NODE_ENV !== 'production' && !logged.has(source);
  logged.add(source);
  if (verbose) logNodes(source);
  const scene = source.clone(true);

  // Sketchfab_model -> *.fbx -> RootNode. The two wrappers only convert units
  // (net transform = uniform 0.01 scale). RootNode's own space is metres,
  // +Y up, +Z forward, +X = the car's left. We use RootNode directly.
  const root = scene.getObjectByName('RootNode');
  if (!root) throw new Error('[gt3r] RootNode not found. Did the model change?');
  root.removeFromParent();
  root.position.set(0, 0, 0);
  root.updateMatrixWorld(true);

  const wheels = new Group();
  wheels.name = 'WHEEL_PIVOTS';
  const corners: Corner[] = [];
  const rearContacts: Vector3[] = [];
  let groundOffset = Infinity;
  let frontRadius = 0.34;
  let rearRadius = 0.35;

  for (const id of CORNERS) {
    const wheel = root.getObjectByName(`WHEEL_${id}`);
    if (!wheel) {
      console.error(`[gt3r] WHEEL_${id} not found; this wheel will not animate.`);
      continue;
    }
    const tyre = root.getObjectByName(`GEO_TIRE_${id}`) ?? wheel;
    const box = new Box3().setFromObject(tyre);
    const hub = box.getCenter(new Vector3());
    const radius = (box.max.y - box.min.y) / 2;
    const front = id.endsWith('F');
    groundOffset = Math.min(groundOffset, box.min.y);
    if (front) frontRadius = radius;
    else rearRadius = radius;

    const steer = new Group();
    steer.name = `STEER_${id}`;
    steer.position.copy(hub);
    const spin = new Group();
    spin.name = `SPIN_${id}`;
    steer.add(spin);
    wheels.add(steer);
    wheels.updateMatrixWorld(true);

    spin.attach(wheel);
    const disc = root.getObjectByName(`DISC_${id}`);
    if (disc) spin.attach(disc); // brake disc spins with the wheel
    const caliper = root.getObjectByName(`SUSP_${id}`);
    if (caliper) steer.attach(caliper); // caliper steers but doesn't spin

    const blur: Mesh[] = [];
    wheel.traverse((o) => {
      // RIM_BLUR_xx holds a low-poly copy of the rim that overlaps RIM_xx. Hide it.
      if (o.name.startsWith('GEO_RIM_STATIC_')) o.visible = false;
      const m = o as Mesh;
      if (m.isMesh && o.name.includes('RIM_BLUR')) {
        const mat = materialsOf(m)[0].clone();
        mat.transparent = true;
        mat.depthWrite = false;
        mat.opacity = 0;
        m.material = mat;
        m.visible = false;
        blur.push(m);
      }
    });

    if (!front) rearContacts.push(new Vector3(hub.x, box.min.y, hub.z));
    corners.push({ id, front, steer, spin, blur });
  }

  if (!Number.isFinite(groundOffset)) groundOffset = 0;
  while (rearContacts.length < 2) rearContacts.push(new Vector3(0, groundOffset, -1.2));

  // Lights and paint. Materials are shared between meshes, so dedupe.
  const head = new Map<MeshStandardMaterial, number>();
  const tail = new Map<MeshStandardMaterial, number>();
  const roles: MaterialRoles = { rims: [], calipers: [] };
  let paint: MeshPhysicalMaterial | null = null;
  // (typed initialisers: these are assigned inside the traverse callback)
  let glassOuter = null as MeshPhysicalMaterial | null;
  let glassInner = null as MeshPhysicalMaterial | null;
  let tyre = null as MeshPhysicalMaterial | null;
  // Wheels, discs and calipers were re-parented under `wheels` above, so walk both.
  const visit = (o: Object3D) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const first = materialsOf(m)[0];
    const name = first?.name ?? '';
    // The bodywork gets the livery on a clear-coated material (one shared instance).
    if (materialsOf(m).some((mat) => mat.name?.includes('Carpaint'))) {
      paint ??= createPaintMaterial(livery, first);
      m.material = paint;
      return;
    }
    // Outer windows: real transmissive glass (cheap tinted glass on mobile)
    if (/^EXT_Windows/.test(name)) {
      glassOuter ??= createGlassMaterial(first, !mobile);
      m.material = glassOuter;
      return;
    }
    // Inner glass layers: tinted only, so there's one transmission render, not two
    if (/^INT_(Windows|Windshield|Glass)/.test(name)) {
      glassInner ??= createGlassMaterial(first, false);
      m.material = glassInner;
      return;
    }
    if (/^MI_Tyre/.test(name)) {
      tyre ??= createTyreMaterial(first);
      m.material = tyre;
      return;
    }
    for (const mat of materialsOf(m)) {
      fixMaterial(mat, roles);
      const name = mat.name ?? '';
      const glass = name.includes('Glass') ? 0.12 : 1;
      if (/Emissive.*Front/.test(name)) {
        mat.emissive?.set('#fff3e2');
        head.set(mat, glass);
      } else if (/Emissive.*Rear/.test(name)) {
        mat.emissive?.set('#ff1424');
        tail.set(mat, glass);
      }
    }
  };
  root.traverse(visit);
  wheels.traverse(visit);
  if (!paint) console.error('[gt3r] EXT_Carpaint_Inst not found; the livery is not applied.');

  const rig: Rig = {
    body: root,
    wheels,
    corners,
    groundOffset,
    frontRadius,
    rearRadius,
    rearContactsLocal: [rearContacts[0], rearContacts[1]],
    head: [...head].map(([mat, factor]) => ({ mat, factor })),
    tail: [...tail].map(([mat, factor]) => ({ mat, factor })),
    paint,
    glass: [glassOuter, glassInner].filter(Boolean) as MeshPhysicalMaterial[],
    tyre,
    rims: roles.rims,
    calipers: roles.calipers,
  };

  if (verbose) {
    // Scale check: a 992 GT3 R is ~4.62 m long, 2.05 m wide, 2.51 m wheelbase.
    const size = new Box3().setFromObject(root).getSize(new Vector3());
    const hubZ = (id: CornerId) => corners.find((k) => k.id === id)?.steer.position.z ?? 0;
    console.info('[gt3r] size (m)', {
      length: +size.z.toFixed(3),
      width: +size.x.toFixed(3),
      height: +size.y.toFixed(3),
      wheelbase: +(hubZ('LF') - hubZ('LR')).toFixed(3),
    });
    console.info('[gt3r] rig', {
      body: 'RootNode (MAIN_BODY, doors, cockpit, lights...)',
      wheels: corners.map((c) => `WHEEL_${c.id} -> ${c.steer.name}/${c.spin.name}`),
      groundOffset: +groundOffset.toFixed(3),
      frontRadius: +frontRadius.toFixed(3),
      rearRadius: +rearRadius.toFixed(3),
      headlightMaterials: rig.head.map((h) => h.mat.name),
      tailLightMaterials: rig.tail.map((h) => h.mat.name),
    });
  }

  return rig;
}

const liveryUrl = () => (isMobile() ? LIVERY_URL_MOBILE : LIVERY_URL);

export function Car() {
  const { scene } = useGLTF(MODEL_URL);
  const gl = useThree((s) => s.gl);
  const liveryTex = useTexture(liveryUrl());
  const livery = useMemo(
    () => prepareLivery(liveryTex, Math.min(8, gl.capabilities.getMaxAnisotropy())),
    [liveryTex, gl],
  );
  const mobile = useMemo(() => isMobile(), []);
  const rig = useMemo(() => buildRig(scene, livery, mobile), [scene, livery, mobile]);
  const liveryU = useMemo(() => createLiveryUniforms(), []);
  const lights = useMemo(() => ({ level: 0, tail: 0 }), []);

  const car = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const beamL = useRef<SpotLight>(null!);
  const beamR = useRef<SpotLight>(null!);
  const tailGlow = useRef<PointLight>(null!);
  const beamTargets = useMemo(() => [new Object3D(), new Object3D()] as const, []);

  useLayoutEffect(() => {
    carState.frontRadius = rig.frontRadius;
    carState.rearRadius = rig.rearRadius;
    if (rig.paint) patchPaint(rig.paint, liveryU);
    interaction.carObject = car.current;
    return () => {
      carState.carReady = false;
      interaction.carObject = null;
    };
  }, [rig, liveryU]);

  useFrame((state, rawDt) => {
    const s = carState;
    const c = CONFIG.car;
    const g = car.current;
    const t = state.clock.elapsedTime;
    const dt = Math.min(rawDt, 1 / 20);
    const ui = useStore.getState();

    // road height and slope come from the route in the city (0 and flat on the waterfront)
    g.position.set(s.position.x, s.position.y - rig.groundOffset, s.position.z);
    g.rotation.set(-s.pitch, s.heading, 0, 'YXZ');

    // Body only: roll + a little buzz while the rears are lit up, the engine idles or revs.
    const idle = chapterState.engineOn ? 0.0015 : 0;
    const buzz = CONFIG.drift.vibration * s.slip + idle + CONFIG.interaction.revVibration * interaction.rev;
    body.current.rotation.z = s.roll + Math.sin(t * 47) * buzz * 0.5;
    body.current.position.y = (Math.sin(t * 61) * 0.6 + Math.sin(t * 23.7) * 0.4) * buzz;

    for (const k of rig.corners) {
      if (k.front) k.steer.rotation.y = s.steer;
      k.spin.rotation.x = k.front ? s.frontSpin : s.rearSpin;
      const rate = Math.abs(k.front ? s.frontSpinRate : s.rearSpinRate);
      const blur = MathUtils.smoothstep(rate, c.rimBlurFrom, c.rimBlurTo) * 0.85;
      for (const m of k.blur) {
        (m.material as MeshStandardMaterial).opacity = blur;
        m.visible = blur > 0.01;
      }
    }

    // Headlights: the beat's level times the ignition, unless the
    // visitor forced them on or off. A cold start flickers before it settles.
    const ign = chapterState.ignition;
    const flicker = ign > 0 && ign < 1 ? 0.55 + 0.45 * Math.sign(Math.sin(t * 61) + Math.sin(t * 23.3) + 0.6) : 1;
    const target =
      ui.headlights === 'off' ? 0 : ui.headlights === 'on' ? Math.max(1, chapterState.look.headlights) : chapterState.look.headlights * ign * flicker;
    lights.level = ign > 0 && ign < 1 && ui.headlights === 'auto' ? target : MathUtils.damp(lights.level, target, 18, dt);
    lights.tail = MathUtils.damp(lights.tail, Math.max(ign, ui.headlights === 'on' ? 1 : 0), 18, dt);
    const hl = lights.level;
    const brake = (1 + c.brakeBoost * s.brake) * lights.tail;
    for (const h of rig.head) h.mat.emissiveIntensity = c.headlightEmissive * h.factor * hl;
    for (const h of rig.tail) h.mat.emissiveIntensity = c.tailLightEmissive * h.factor * brake;

    // Livery: ease the recolour toward the chosen preset
    const lv = LIVERIES[ui.livery % LIVERIES.length];
    const k = 1 - Math.exp((-4 * dt) / Math.max(0.05, CONFIG.interaction.liveryTime));
    liveryU.hue.value += (lv.hue - liveryU.hue.value) * k;
    liveryU.sat.value += (lv.sat - liveryU.sat.value) * k;
    liveryU.value.value += (lv.value - liveryU.value.value) * k;
    liveryU.tintMix.value += (lv.tintMix - liveryU.tintMix.value) * k;
    liveryU.tint.value.lerp(_tint.set(lv.tint), k);
    // Explicit envMap so envMapIntensity counts (three ignores it with scene.environment).
    const env = state.scene.environment;
    const withEnv = (m: MeshStandardMaterial, intensity: number) => {
      if (env && m.envMap !== env) {
        m.envMap = env;
        m.needsUpdate = true;
      }
      m.envMapIntensity = intensity;
    };
    const paint = rig.paint;
    if (paint) {
      withEnv(paint, c.paintEnv);
      paint.roughness = c.paintRoughness;
      paint.metalness = c.paintMetalness;
      paint.clearcoat = c.clearcoat;
      paint.clearcoatRoughness = c.clearcoatRoughness;
    }
    for (const glass of rig.glass) {
      withEnv(glass, c.glassEnv);
      glass.color.set(c.glassTint);
      glass.roughness = c.glassRoughness;
    }
    if (rig.tyre) {
      withEnv(rig.tyre, c.tyreEnv);
      rig.tyre.color.set(c.tyreColor);
      rig.tyre.roughness = c.tyreRoughness;
      rig.tyre.specularIntensity = c.tyreSpecular;
    }
    for (const m of rig.rims) m.color.set(c.rimColor);
    for (const m of rig.calipers) m.color.set(c.caliperColor);
    beamL.current.intensity = beamR.current.intensity = c.headBeam * hl;
    beamL.current.angle = beamR.current.angle = c.headBeamAngle;
    tailGlow.current.intensity = c.tailGlow * brake;

    // Publish world-space contact patches for smoke + skid marks
    g.updateMatrixWorld();
    s.rearContacts[0].copy(rig.rearContactsLocal[0]).applyMatrix4(g.matrixWorld);
    s.rearContacts[1].copy(rig.rearContactsLocal[1]).applyMatrix4(g.matrixWorld);
    s.tailLight.set(0, 0.6, -2.4).applyMatrix4(g.matrixWorld);
    // Headlight positions and beam direction, for rain and spray lit by the beams
    s.headPos[0].set(0.62, 0.66, 1.9).applyMatrix4(g.matrixWorld);
    s.headPos[1].set(-0.62, 0.66, 1.9).applyMatrix4(g.matrixWorld);
    s.headDir.set(0, -0.035, 1).transformDirection(g.matrixWorld);
    s.headLevel = hl;
    s.carReady = true;
  }, -2);

  return (
    <group ref={car} name="GT3R">
      <group ref={body}>
        <primitive object={rig.body} />
        <spotLight
          ref={beamL}
          position={[0.62, 0.66, 1.9]}
          target={beamTargets[0]}
          penumbra={0.9}
          distance={80}
          decay={1.3}
          color="#fff1dc"
        />
        <spotLight
          ref={beamR}
          position={[-0.62, 0.66, 1.9]}
          target={beamTargets[1]}
          penumbra={0.9}
          distance={80}
          decay={1.3}
          color="#fff1dc"
        />
        <primitive object={beamTargets[0]} position={[1.4, 0, 24]} />
        <primitive object={beamTargets[1]} position={[-1.4, 0, 24]} />
        <pointLight ref={tailGlow} position={[0, 0.4, -3.1]} color="#ff1a1a" distance={7} decay={2} />
      </group>
      <primitive object={rig.wheels} />
      {/* Contact shadows ride with the car (re-rendered every frame) */}
      <ContactShadows
        position={[0, rig.groundOffset + 0.01, 0]}
        scale={[3.4, 6.2]}
        resolution={mobile ? 256 : 512}
        blur={CONFIG.car.contactBlur}
        far={1.6}
        opacity={CONFIG.car.contactOpacity}
        color="#000000"
      />
    </group>
  );
}

const _tint = new Color();

useGLTF.preload(MODEL_URL);
if (typeof window !== 'undefined') useTexture.preload(liveryUrl());
