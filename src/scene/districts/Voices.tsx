'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, BackSide, Color, type Group, MathUtils, ShaderMaterial, Vector3 } from 'three';
import { VOICES } from '@/content';
import { districtWeight } from '@/lib/chapterRuntime';
import { CONFIG } from '@/lib/config';
import { isMobile } from '@/lib/device';
import { districtFx, useDistricts, type VoiceCategory } from '@/lib/districtState';
import { DistrictSet, districtLights, glowMaterial } from './shared';

const RADIUS = 1.7;
const CENTRE = new Vector3(0, 3, 0);

districtLights.voices = [
  { pos: [3, 5, 4], color: '#7fa6ff', intensity: 160, distance: 18 },
  { pos: [-4, 2, 2], color: '#4b6cff', intensity: 110, distance: 16 },
  { pos: [0, 0.6, 5], color: '#9cc4ff', intensity: 50, distance: 12 },
];

/**
 * Rough home of each past speaker, only to lay the markers out on the globe (lat, lon).
 * The cards show name and title, never a place.
 */
const PLACES: Record<string, [number, number]> = {
  'Dr. A. P. J. Abdul Kalam': [21, 79],
  'Malcolm Turnbull': [-33.9, 151.2],
  'Tarja Halonen': [60.2, 24.9],
  'Ehud Olmert': [31.8, 35.2],
  'Akash Ambani': [19.1, 72.9],
  'N. R. Narayana Murthy': [12.97, 77.6],
  'Andrew Ng': [37.4, -122.1],
  'Vint Cerf': [38.9, -77],
  'Abhinav Bindra': [30.7, 76.8],
  'Viswanathan Anand': [13.1, 80.3],
  'Zaheer Khan': [19.6, 74.6],
  'Neeraj Chopra': [29.4, 77],
  'The 14th Dalai Lama': [32.2, 76.3],
  'Kurt Wüthrich': [47.4, 8.5],
  'Amartya Sen': [23.7, 87.7],
  'Serge Haroche': [48.9, 2.35],
  'Bill Nelson': [28.5, -80.6],
  'Rakesh Sharma': [11.35, 76.8],
  'Gaganyaan Astronauts': [12.97, 77.6],
  'S. Somnath': [8.5, 76.95],
};

const toXYZ = (lat: number, lon: number, r: number) => {
  const la = MathUtils.degToRad(lat);
  const lo = MathUtils.degToRad(lon);
  return new Vector3(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
};

/** Marker positions for a category, nudged apart so none overlap (most are in India). */
function layout(cat: VoiceCategory) {
  const pts = VOICES.categories[cat].map(([name]) => [...(PLACES[name] ?? [0, 0])] as [number, number]);
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) {
        const dLat = pts[j][0] - pts[i][0];
        const dLon = pts[j][1] - pts[i][1];
        const d = Math.hypot(dLat, dLon);
        if (d < 11) {
          const push = (11 - d) / 2 / Math.max(d, 0.01);
          const ux = d > 0.01 ? dLat : 1;
          const uy = d > 0.01 ? dLon : 0;
          pts[i][0] -= ux * push;
          pts[i][1] -= uy * push;
          pts[j][0] += ux * push;
          pts[j][1] += uy * push;
        }
      }
  }
  return pts;
}

const globeVert = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;
const globeFrag = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uLine;
uniform vec3 uRim;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  float lat = asin(clamp(vObj.y, -1.0, 1.0));
  float lon = atan(vObj.z, vObj.x);
  float step = 0.2617994; // 15 degrees
  float glat = abs(fract(lat / step + 0.5) - 0.5) * step;
  float glon = abs(fract(lon / step + 0.5) - 0.5) * step * cos(lat);
  float w = fwidth(lat) * 1.5 + 0.002;
  float line = 1.0 - smoothstep(0.0, w, min(glat, glon));
  float equator = 1.0 - smoothstep(0.0, w * 1.5, abs(lat));
  // a fine dot field, for texture
  vec2 cell = vec2(lon * 40.0, lat * 40.0);
  float dots = smoothstep(0.32, 0.12, length(fract(cell) - 0.5)) * 0.18;
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 3.0);
  vec3 col = uBase + uLine * (line * 0.55 + equator * 0.6 + dots) + uRim * fres * 1.4;
  gl_FragColor = vec4(col, 1.0);
}
`;

function Globe() {
  const group = useRef<Group>(null!);
  const markerRefs = useRef<(Group | null)[]>([]);
  const category = useDistricts((s) => s.voiceCategory);
  const hover = useDistricts((s) => s.hoverVoice);
  const pinned = useDistricts((s) => s.pinnedVoice);
  const points = useMemo(() => layout(category).map(([la, lo]) => toXYZ(la, lo, RADIUS * 1.01)), [category]);
  const state = useMemo(() => ({ rot: 0, target: 0, hold: 0 }), []);
  const mats = useMemo(
    () => ({
      globe: new ShaderMaterial({
        uniforms: { uBase: { value: new Color('#070c1c') }, uLine: { value: new Color('#3d6bff') }, uRim: { value: new Color('#6fb4ff') } },
        vertexShader: globeVert,
        fragmentShader: globeFrag,
      }),
      atmo: new ShaderMaterial({
        uniforms: { uColor: { value: new Color('#3d7bff') } },
        vertexShader: globeVert,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          varying vec3 vN;
          varying vec3 vV;
          void main() {
            float f = pow(max(0.0, 0.85 - abs(dot(normalize(vN), normalize(vV)))), 2.5);
            gl_FragColor = vec4(uColor * f * 2.0, f);
          }
        `,
        side: BackSide,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      halo: glowMaterial('#ff5a3a', 0.9),
      haloHot: glowMaterial('#ffd2a0', 1),
    }),
    [],
  );

  // swing the new category's markers round to face the camera
  useEffect(() => {
    const ll = layout(category);
    const lon = MathUtils.degToRad(ll.reduce((s, p) => s + p[1], 0) / ll.length);
    let t = -Math.PI / 2 - lon;
    while (t - state.rot > Math.PI) t -= Math.PI * 2;
    while (t - state.rot < -Math.PI) t += Math.PI * 2;
    state.target = t;
    state.hold = 3;
  }, [category, state]);

  const _p = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    const busy = hover !== null || pinned !== null;
    state.hold = Math.max(0, state.hold - dt);
    if (!busy && state.hold <= 0) state.target += CONFIG.districts.globeSpin * dt;
    state.rot += (state.target - state.rot) * (1 - Math.exp(-dt * 3));
    group.current.rotation.y = state.rot;

    // where the active marker is on screen, for the monogram card
    const i = pinned ?? hover;
    const m = i !== null ? markerRefs.current[i] : null;
    if (m && districtWeight('voices') > 0.5) {
      m.getWorldPosition(_p).project(camera);
      districtFx.voiceCard.x = (_p.x * 0.5 + 0.5) * size.width;
      districtFx.voiceCard.y = (-_p.y * 0.5 + 0.5) * size.height;
      districtFx.voiceCard.visible = _p.z < 1;
    } else districtFx.voiceCard.visible = false;

    const t = performance.now() / 1000;
    markerRefs.current.forEach((g, k) => {
      if (!g) return;
      const on = k === hover || k === pinned;
      const s = on ? 1.8 : 1 + 0.15 * Math.sin(t * 3 + k);
      g.scale.setScalar(g.scale.x + (s - g.scale.x) * 0.2);
    });
  });

  const set = useDistricts.getState;
  return (
    <group position={CENTRE}>
      <group ref={group}>
        <mesh material={mats.globe} onPointerOver={(e) => e.stopPropagation()}>
          <sphereGeometry args={[RADIUS, 96, 64]} />
        </mesh>
        {points.map((p, k) => (
          <group
            key={`${category}-${k}`}
            position={p}
            ref={(g) => {
              markerRefs.current[k] = g;
            }}
          >
            <mesh>
              <sphereGeometry args={[0.05, 14, 10]} />
              <meshBasicMaterial color={k === pinned ? '#ffd2a0' : '#ff5a3a'} toneMapped={false} />
            </mesh>
            <mesh material={k === pinned || k === hover ? mats.haloHot : mats.halo} scale={0.42}>
              <planeGeometry args={[1, 1]} />
            </mesh>
            {/* generous invisible hit target */}
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation();
                set().setHoverVoice(k);
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                set().setHoverVoice(null);
                document.body.style.cursor = '';
              }}
              onClick={(e) => {
                e.stopPropagation();
                set().setPinnedVoice(set().pinnedVoice === k ? null : k);
              }}
            >
              <sphereGeometry args={[0.2, 10, 8]} />
              <meshBasicMaterial colorWrite={false} depthWrite={false} />
            </mesh>
          </group>
        ))}
      </group>
      <mesh material={mats.atmo} scale={1.13}>
        <sphereGeometry args={[RADIUS, 64, 48]} />
      </mesh>
      {/* an orbit ring at an angle */}
      <mesh rotation={[1.2, 0.3, 0]}>
        <torusGeometry args={[RADIUS * 1.35, 0.012, 8, 160]} />
        <meshBasicMaterial color="#5b86ff" toneMapped={false} />
      </mesh>
    </group>
  );
}

/**
 * VIII Hall of Voices: past Techfest speakers as markers on a globe in a dark blue hall.
 * Category tabs (DOM) swap the marker set; hover for a monogram card, click to pin it.
 * Phones get a plain list instead of the globe.
 */
export function Voices() {
  const mobile = useMemo(() => isMobile(), []);
  return (
    <DistrictSet id="voices">
      <mesh position={[0, -0.8, 0]}>
        <cylinderGeometry args={[15, 15.5, 1.6, 48]} />
        <meshStandardMaterial color="#0b0e18" roughness={0.6} metalness={0.4} />
      </mesh>
      {/* pillars of light round the back of the hall (none between the camera and the globe) */}
      {Array.from({ length: 9 }, (_, i) => {
        const a = -1.75 + (3.5 * i) / 8;
        return (
          <group key={i} position={[Math.sin(a) * 9, 0, -Math.cos(a) * 9 - 1]} rotation-y={-a}>
            <mesh position={[0, 3.5, 0]}>
              <boxGeometry args={[0.35, 7, 0.35]} />
              <meshStandardMaterial color="#10162a" roughness={0.5} metalness={0.5} />
            </mesh>
            <mesh position={[0, 3.5, 0.18]}>
              <boxGeometry args={[0.04, 6.4, 0.02]} />
              <meshStandardMaterial color="#000" emissive="#3d6bff" emissiveIntensity={3} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.25, 0]}>
        <cylinderGeometry args={[0.9, 1.2, 0.5, 40]} />
        <meshStandardMaterial color="#111727" metalness={0.7} roughness={0.35} />
      </mesh>
      <mesh position={[0, 0.52, 0]} rotation-x={-Math.PI / 2}>
        <ringGeometry args={[0.7, 0.86, 64]} />
        <meshBasicMaterial color="#3d6bff" toneMapped={false} />
      </mesh>
      {!mobile && <Globe />}
    </DistrictSet>
  );
}
