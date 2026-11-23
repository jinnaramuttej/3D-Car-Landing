'use client';

import { useEffect, useMemo } from 'react';
import { RepeatWrapping } from 'three';
import { COMPETITIONS, theme } from '@/content';
import { DistrictSet, districtLights, textTexture } from './shared';

const BAY_W = 4.4;
const DEPTH = 6;
const HEIGHT = 4.2;
const FRONT = -3; // garage mouths line up here; the lane runs in front (z > -3)

districtLights.pitlane = [
  { pos: [-8, 3.6, -4], color: '#ffe6c4', intensity: 260, distance: 20 },
  { pos: [8, 3.6, -4], color: '#ffe6c4', intensity: 260, distance: 20 },
  { pos: [0, 5, 4], color: '#cfd8e6', intensity: 220, distance: 22 },
  { pos: [-16, 3, 2], color: '#ffd9b0', intensity: 120, distance: 16 },
];

/**
 * VII Pit Lane: a row of lit garages, one per competition, with the bay numbers over
 * the doors, a white pit-lane line and a hatched fast lane. The bays themselves are the
 * DOM cards; this is the place they stand in.
 */
export function PitLane() {
  const n = COMPETITIONS.length;
  const width = n * BAY_W;
  const x0 = -width / 2 + BAY_W / 2;
  const sign = useMemo(
    () =>
      textTexture(2048, 128, (g, font) => {
        g.fillStyle = '#101216';
        g.fillRect(0, 0, 2048, 128);
        g.fillStyle = theme.accent;
        g.fillRect(0, 118, 2048, 10);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        for (let i = 0; i < n; i++) {
          const cx = ((i + 0.5) / n) * 2048;
          g.fillStyle = '#f2f3f5';
          g.font = `900 64px ${font}`;
          g.fillText(String(i + 1).padStart(2, '0'), cx, 58);
        }
      }),
    [n],
  );
  const hatch = useMemo(() => {
    const t = textTexture(256, 64, (g) => {
        g.fillStyle = '#2f3134';
        g.fillRect(0, 0, 256, 64);
        g.strokeStyle = '#e8c21b';
        g.lineWidth = 10;
        for (let x = -64; x < 320; x += 32) {
          g.beginPath();
          g.moveTo(x, 64);
          g.lineTo(x + 40, 0);
          g.stroke();
        }
      });
    t.wrapS = RepeatWrapping;
    t.repeat.set(width / 2, 1);
    return t;
  }, [width]);
  useEffect(
    () => () => {
      sign.dispose();
      hatch.dispose();
    },
    [sign, hatch],
  );

  return (
    <DistrictSet id="pitlane">
      {/* platform, concrete apron, the lane */}
      <mesh position={[0, -0.8, 0]}>
        <boxGeometry args={[width + 22, 1.6, 30]} />
        <meshStandardMaterial color="#1a1b1e" roughness={0.92} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, 2]}>
        <planeGeometry args={[width + 20, 18]} />
        <meshStandardMaterial color="#3a3c3f" roughness={0.82} metalness={0.05} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 1.2]}>
        <planeGeometry args={[width + 16, 0.16]} />
        <meshStandardMaterial color="#e9e9e6" roughness={0.5} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 6]}>
        <planeGeometry args={[width + 16, 1.2]} />
        <meshStandardMaterial map={hatch} roughness={0.6} />
      </mesh>

      {/* the garage block: back wall, roof, dividers, lit back panels */}
      <mesh position={[0, HEIGHT / 2, FRONT - DEPTH]}>
        <boxGeometry args={[width + 0.4, HEIGHT, 0.3]} />
        <meshStandardMaterial color="#23252a" roughness={0.8} />
      </mesh>
      <mesh position={[0, HEIGHT + 0.25, FRONT - DEPTH / 2]}>
        <boxGeometry args={[width + 1.2, 0.5, DEPTH + 1]} />
        <meshStandardMaterial color="#1c1e22" roughness={0.7} metalness={0.2} />
      </mesh>
      {Array.from({ length: n + 1 }, (_, i) => (
        <mesh key={`d${i}`} position={[x0 - BAY_W / 2 + i * BAY_W, HEIGHT / 2, FRONT - DEPTH / 2]}>
          <boxGeometry args={[0.25, HEIGHT, DEPTH]} />
          <meshStandardMaterial color="#2b2d32" roughness={0.75} />
        </mesh>
      ))}
      {Array.from({ length: n }, (_, i) => (
        <group key={`b${i}`} position={[x0 + i * BAY_W, 0, 0]}>
          <mesh position={[0, HEIGHT / 2, FRONT - DEPTH + 0.17]}>
            <planeGeometry args={[BAY_W - 0.4, HEIGHT - 0.3]} />
            <meshStandardMaterial color="#000" emissive="#ffe9c8" emissiveIntensity={0.35 + (i % 3) * 0.12} />
          </mesh>
          {/* tool chest and a light strip, so each bay has a little life in it */}
          <mesh position={[1.3, 0.55, FRONT - DEPTH + 0.7]}>
            <boxGeometry args={[1.1, 1.1, 0.6]} />
            <meshStandardMaterial color={i % 2 ? '#b8261b' : '#2c3139'} roughness={0.5} metalness={0.4} />
          </mesh>
          <mesh position={[0, HEIGHT - 0.12, FRONT - DEPTH / 2]}>
            <boxGeometry args={[BAY_W - 1, 0.05, 0.12]} />
            <meshStandardMaterial color="#000" emissive="#ffffff" emissiveIntensity={4} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position={[0, 0.011, FRONT - DEPTH / 2]}>
            <planeGeometry args={[BAY_W - 0.4, DEPTH - 0.2]} />
            <meshStandardMaterial color="#4a4d51" roughness={0.35} metalness={0.15} />
          </mesh>
        </group>
      ))}
      {/* bay numbers over the doors */}
      <mesh position={[0, HEIGHT + 0.6, FRONT + 0.52]}>
        <planeGeometry args={[width, width / 16]} />
        <meshStandardMaterial map={sign} emissiveMap={sign} emissive="#ffffff" emissiveIntensity={0.6} roughness={0.6} />
      </mesh>
    </DistrictSet>
  );
}
