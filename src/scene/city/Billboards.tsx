'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import {
  CanvasTexture,
  Color,
  type Group,
  type Intersection,
  LinearFilter,
  type Mesh,
  type Object3D,
  type PointLight,
  Raycaster,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from 'three';
import { CHAPTERS, type StopId } from '@/lib/chapters';
import { chapterState, stopWeight } from '@/lib/chapterRuntime';
import { EXTRAS, getRoute, sampleRoute, STOPS } from '@/lib/cityRoute';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { carState, leftOf } from '@/lib/motion';
import { type BoardId, boardS, expoIndexAt, heartbeatPulse, isExtra, mountOf, stopAnchor, stopFx, useStops } from '@/lib/stops';
import { ART_H, ART_W, type ArtState, drawStop, resolveFont } from './billboardArt';
import { CITY_URL, useCityLayer } from './City';

const STOP_IDS = CHAPTERS.filter((c) => c.stop).map((c) => c.stop!) as StopId[];
/** The stops' boards and the ones the car drives past. */
const BOARD_IDS: BoardId[] = [...STOP_IDS, ...(Object.keys(EXTRAS) as BoardId[])];
const specOf = (id: BoardId) => (isExtra(id) ? EXTRAS[id] : STOPS[id]);

const ledVert = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const ledFrag = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform sampler2D uMap;
uniform vec2 uGrid;
uniform float uBright;
uniform float uTime;
uniform float uAnim;
uniform float uWake;
varying vec2 vUv;
void main() {
  // one LED per grid cell: sample the canvas at the cell centre, draw a round dot
  vec2 g = vUv * uGrid;
  vec2 cell = floor(g) + 0.5;
  vec3 c = texture2D(uMap, cell / uGrid).rgb;
  float d = length(fract(g) - 0.5);
  float led = smoothstep(0.5, 0.3, d);
  // far away the dots blend into their average instead of shimmering
  float fw = fwidth(g.x);
  led = mix(led, 0.42, smoothstep(0.25, 0.8, fw));
  // a slow refresh band and per-LED sparkle (desktop only)
  float scan = 1.0 + uAnim * (0.06 * sin(vUv.y * 22.0 - uTime * 2.2) + 0.04 * (fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453 + uTime * 0.6) - 0.5));
  vec3 col = c * (led * 1.15 + 0.05) * uBright * scan;
  // waking up as the car comes: the rows come on top-down with a stutter, then settle
  float row = 1.0 - vUv.y;
  float lit = smoothstep(row, row + 0.05, uWake * 1.2 - 0.1);
  float stutter = mix(0.3 + 0.7 * step(0.45, fract(sin(floor(uTime * 20.0) * 12.9898 + floor(g.y * 0.25)) * 43758.5453)), 1.0, smoothstep(0.7, 1.0, uWake));
  col *= mix(0.03, 1.0, lit * stutter);
  gl_FragColor = vec4(col, 1.0);
  #include <fog_fragment>
}
`;

type Board = {
  id: BoardId;
  /** On a facade (or its own legs), on a gantry over the deck, or on a pylon's cross-beam. */
  mount: 'wall' | 'gantry' | 'pylon';
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  mat: ShaderMaterial;
  /** What is drawn (content) and how far its animation is (redraws without a new tint). */
  key: string;
  anim: string;
  /** Average colour of the art (for the light it spills on the street). */
  tint: Color;
  centre: Vector3;
  normal: Vector3;
  width: number;
  height: number;
  /** Mounted on a facade, or standing on its own legs. */
  onWall: boolean;
  /** 0 asleep .. 1 fully on (it wakes as the car comes, sleeps once it is well past). */
  wake: number;
};

const _ray = new Raycaster();
// (the city is on its own render layer, CITY_LAYER: the wall search has to see it)
_ray.layers.enableAll();
const _o = new Vector3();
const _d = new Vector3();
const _l = new Vector3();
const _n = new Vector3();

/** Finds a facade beside the road at the stop and hangs the billboard on it (world space). */
function place(id: BoardId, city: Object3D) {
  const a = stopAnchor(id);
  if (mountOf(id) !== 'wall') return { centre: a.centre.clone(), normal: a.normal.clone(), onWall: true };
  const spec = specOf(id);
  const r = getRoute();
  const h = sampleRoute(spec.s, _o);
  leftOf(h, _l);
  const room = r.room(spec.s)[spec.side === 1 ? 0 : 1];
  const y = _o.y + spec.lift + spec.height / 2;
  _d.copy(_l).multiplyScalar(spec.side);
  let best: Intersection | null = null;
  // a few heights and a little forward/back, take the nearest proper wall
  for (const dy of [0, -2, 3]) {
    for (const dz of [0, -6, 6]) {
      const o = _o.clone().setY(y + dy).addScaledVector(new Vector3(Math.sin(h), 0, Math.cos(h)), dz);
      _ray.set(o, _d);
      _ray.near = room + 1;
      _ray.far = 45;
      for (const hit of _ray.intersectObject(city, true)) {
        if (!hit.face) continue;
        _n.copy(hit.face.normal).transformDirection(hit.object.matrixWorld);
        if (Math.abs(_n.y) > 0.3 || _n.dot(_d) > -0.5) continue;
        if (!best || hit.distance < best.distance) best = hit;
        break;
      }
    }
  }
  if (best && best.face) {
    const normal = best.face.normal.clone().transformDirection(best.object.matrixWorld).setY(0).normalize();
    // along the wall, centred where the ray hit, at the planned height
    const centre = best.point.clone().addScaledVector(normal, 0.45).setY(y);
    return { centre, normal, onWall: true };
  }
  return { centre: a.centre.clone(), normal: a.normal.clone(), onWall: false };
}

/**
 * The stops' LED billboards: one per stop, hung on the nearest facade on its side of the
 * road (or standing on legs where there is none), each a canvas of that stop's content
 * turned into LEDs by a small shader (bright enough to bloom), plus one light that spills
 * the active billboard's colour onto the street and the car. Phones: text only, no LED
 * shimmer, and the canvases only redraw when their content changes.
 */
export function Billboards() {
  const gltf = useGLTF(CITY_URL);
  const mobile = useMemo(() => isMobile(), []);
  const group = useRef<Group>(null!);
  useCityLayer(group);
  const spill = useRef<PointLight>(null!);
  // the boards render once more after they're hung, so the ones on a wall lose their legs
  const [, setPlaced] = useState(false);

  const boards = useMemo<Board[]>(() => {
    resolveFont();
    return BOARD_IDS.map((id) => {
      const canvas = document.createElement('canvas');
      canvas.width = ART_W;
      canvas.height = ART_H;
      const ctx = canvas.getContext('2d')!;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.minFilter = LinearFilter;
      tex.generateMipmaps = false;
      const spec = specOf(id);
      const mat = new ShaderMaterial({
        uniforms: {
          uMap: { value: tex },
          uGrid: { value: new Vector2(spec.width * 10, spec.height * 10) },
          uBright: { value: 2.2 },
          uTime: { value: 0 },
          uAnim: { value: mobile ? 0 : 1 },
          uWake: { value: 0 },
          fogColor: { value: new Color() },
          fogDensity: { value: 0 },
        },
        vertexShader: ledVert,
        fragmentShader: ledFrag,
        fog: true,
      });
      return { id, mount: mountOf(id), canvas, ctx, tex, mat, key: '', anim: '', tint: new Color(), centre: new Vector3(), normal: new Vector3(0, 0, 1), width: spec.width, height: spec.height, onWall: false, wake: 0 };
    });
  }, [mobile]);

  useEffect(() => () => boards.forEach((b) => (b.tex.dispose(), b.mat.dispose())), [boards]);

  // hang each billboard (once the city is in the scene graph)
  useLayoutEffect(() => {
    // (the city group sits far out at CITY_ORIGIN: bring its world matrix up to date first)
    gltf.scene.updateWorldMatrix(true, true);
    for (const b of boards) {
      const p = place(b.id, gltf.scene);
      b.centre.copy(p.centre);
      b.normal.copy(p.normal);
      b.onWall = p.onWall;
      const a = stopAnchor(b.id);
      a.centre.copy(b.centre);
      a.normal.copy(b.normal);
      a.placed = true;
    }
    setPlaced(true);
    if (process.env.NODE_ENV !== 'production') {
      (window as unknown as { __boards?: unknown }).__boards = boards.map((b) => ({ id: b.id, onWall: b.onWall, centre: b.centre.toArray().map((v) => +v.toFixed(1)) }));
    }
    // redraw once the display font is in
    const fam = resolveFont();
    void document.fonts?.load(`900 64px ${fam}`).then(() => boards.forEach((b) => (b.key = '')));
  }, [boards, gltf.scene]);

  const art = useMemo<ArtState>(
    () => ({ robowarsClass: 0, competitionFilter: 'All', competitionAnim: 1, previousFilter: 'All', speakerCategory: useStops.getState().speakerCategory, expoIndex: 0, pulse: 0 }),
    [],
  );

  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const ui = useStops.getState();
    if (ui.competitionFilter !== art.competitionFilter) {
      art.previousFilter = art.competitionFilter;
      art.competitionFilter = ui.competitionFilter;
      art.competitionAnim = mobile ? 1 : 0;
    }
    art.competitionAnim = Math.min(1, art.competitionAnim + dt * 1.4);
    art.robowarsClass = ui.robowarsClass;
    art.speakerCategory = ui.speakerCategory;
    art.expoIndex = expoIndexAt(chapterState.progress, 4);
    stopFx.expoIndex = art.expoIndex;
    stopFx.heartbeat = heartbeatPulse(t, CONFIG.city.heartbeatBpm);
    art.pulse = mobile ? 0.6 : stopFx.heartbeat;

    let best: Board | null = null;
    let bestW = 0;
    for (const b of boards) {
      const w = isExtra(b.id) ? 0 : stopWeight(b.id);
      // only the billboards near the car redraw
      const near = isExtra(b.id) ? Math.abs(boardS(b.id) - carState.s) < 240 : Math.abs(CHAPTERS.findIndex((c) => c.stop === b.id) - chapterState.chapter) <= 1;
      if (near) {
        const key =
          b.id === 'robowars'
            ? `${art.robowarsClass}`
            : b.id === 'competitions'
              ? art.competitionFilter
              : b.id === 'speakers'
                ? art.speakerCategory
                : b.id === 'expo'
                  ? `${art.expoIndex}`
                  : 'static';
        // (animated art redraws the canvas: only while its own stop is the one on screen)
        const own = CHAPTERS.findIndex((c) => c.stop === b.id) === chapterState.chapter;
        const anim = !own ? b.anim : b.id === 'competitions' ? art.competitionAnim.toFixed(2) : b.id === 'dkms' ? (Math.round(art.pulse * 8) / 8).toFixed(3) : '';
        if (key !== b.key || anim !== b.anim) {
          const fresh = key !== b.key;
          b.key = key;
          b.anim = anim;
          drawStop(b.id, b.ctx, art);
          b.tex.needsUpdate = true;
          if (fresh) averageColour(b);
        }
      }
      const u = b.mat.uniforms;
      u.uTime.value = t;
      const ahead = boardS(b.id) - carState.s;
      const want = ahead < 120 && ahead > -70 ? 1 : 0;
      b.wake += (want - b.wake) * (1 - Math.exp(-dt / (want > b.wake ? 0.9 : 2)));
      u.uWake.value = mobile ? want : b.wake;
      const dk = b.id === 'dkms' ? 0.8 + 0.25 * stopFx.heartbeat : 1;
      // (LEDs stay readable by day: they don't dim with the city's lights)
      u.uBright.value = CONFIG.city.billboardGlow * Math.max(0.8, chapterState.env.city) * dk;
      if (w > bestW) {
        bestW = w;
        best = b;
      }
    }
    // the active billboard lights the street in its own colour
    const l = spill.current;
    if (best) {
      l.position.copy(best.centre).addScaledVector(best.normal, 7).setY(best.centre.y - best.height * 0.35);
      l.color.copy(best.tint).multiplyScalar(1 / Math.max(0.05, Math.max(best.tint.r, best.tint.g, best.tint.b)));
      l.intensity = CONFIG.city.billboardLight * bestW * chapterState.env.city;
    } else l.intensity = 0;
  }, -1);

  return (
    <group ref={group}>
      {boards.map((b) => (
        <BoardMesh key={b.id} board={b} />
      ))}
      <pointLight ref={spill} distance={42} decay={2} intensity={0} />
    </group>
  );
}

const tiny = typeof document !== 'undefined' ? document.createElement('canvas') : null;
/** Average colour of a board's art (16 x 9 downsample), for the light it spills. */
function averageColour(b: Board) {
  if (!tiny) return;
  tiny.width = 16;
  tiny.height = 9;
  const c = tiny.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(b.canvas, 0, 0, 16, 9);
  const px = c.getImageData(0, 0, 16, 9).data;
  let r = 0;
  let g = 0;
  let bl = 0;
  for (let i = 0; i < px.length; i += 4) {
    r += px[i];
    g += px[i + 1];
    bl += px[i + 2];
  }
  const n = px.length / 4;
  b.tint.setRGB(r / n / 255, g / n / 255, bl / n / 255).convertSRGBToLinear();
}

function BoardMesh({ board }: { board: Board }) {
  const root = useRef<Group>(null!);
  const screen = useRef<Mesh>(null!);
  useLayoutEffect(() => {
    const g = root.current;
    g.position.copy(board.centre);
    g.lookAt(_o.copy(board.centre).add(board.normal));
    g.updateMatrixWorld(true);
  });
  const { width: w, height: h } = board;
  const lift = specOf(board.id).lift;
  return (
    <group ref={root}>
      {/* the screen faces +z (out of the wall) */}
      <mesh ref={screen} position={[0, 0, 0.32]} material={board.mat}>
        <planeGeometry args={[w, h]} />
      </mesh>
      <mesh>
        <boxGeometry args={[w + 0.7, h + 0.7, 0.6]} />
        <meshStandardMaterial color="#0d0e12" roughness={0.6} metalness={0.5} />
      </mesh>
      {/* a gantry over the deck: two posts down to the road and a beam along the top */}
      {board.mount === 'gantry' && (
        <>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (w / 2 + 1.4), (0.6 - lift) / 2, -0.2]}>
              <boxGeometry args={[0.6, lift + h + 0.6, 0.6]} />
              <meshStandardMaterial color="#2a2c31" roughness={0.5} metalness={0.7} />
            </mesh>
          ))}
          <mesh position={[0, h / 2 + 0.6, -0.2]}>
            <boxGeometry args={[w + 3.4, 0.5, 0.5]} />
            <meshStandardMaterial color="#2a2c31" roughness={0.5} metalness={0.7} />
          </mesh>
        </>
      )}
      {/* standing on its own: two legs down to the pavement */}
      {!board.onWall &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * w * 0.32, -h / 2 - 6, -0.1]}>
            <boxGeometry args={[0.5, 12, 0.5]} />
            <meshStandardMaterial color="#15161a" roughness={0.6} metalness={0.5} />
          </mesh>
        ))}
    </group>
  );
}
