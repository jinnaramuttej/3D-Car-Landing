'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Color, type Group, type PointLight, SRGBColorSpace, Vector3 } from 'three';
import { partners, schedule, theme } from '@/content';
import { BILLBOARDS, getParkedFrame, MARKERS } from '@/lib/chapters';
import { chapterState } from '@/lib/chapterRuntime';
import { forwardOf, leftOf } from '@/lib/motion';

/** Parked-car-local (x left, y up, z forward) to world. */
function parkedToWorld(x: number, y: number, z: number) {
  const f = getParkedFrame();
  const fwd = forwardOf(f.heading, new Vector3());
  const left = leftOf(f.heading, new Vector3());
  return f.origin.clone().addScaledVector(left, x).addScaledVector(fwd, z).setY(y);
}

/** The display font next/font loaded, for canvas text (falls back to a heavy system sans). */
function displayFont() {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim();
  return v ? `${v}, 'Arial Black', sans-serif` : "'Arial Black', sans-serif";
}

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, font: string) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const paint = () => {
    const g = canvas.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    draw(g, displayFont());
    tex.needsUpdate = true;
  };
  paint();
  // redraw once the display font is in
  void document.fonts?.ready.then(paint);
  return tex;
}

/** Indian highway milestone: white stone, orange cap, the date painted on the face. */
function markerFace(day: (typeof schedule.days)[number]) {
  return canvasTexture(256, 384, (g, font) => {
    g.fillStyle = '#f1efe9';
    g.fillRect(0, 0, 256, 384);
    g.fillStyle = '#e8781e';
    g.beginPath();
    g.arc(128, 128, 128, Math.PI, 0);
    g.lineTo(256, 150);
    g.lineTo(0, 150);
    g.closePath();
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `700 34px ${font}`;
    g.textAlign = 'center';
    g.fillText('TECHFEST', 128, 108);
    g.fillStyle = '#16181c';
    g.font = `900 64px ${font}`;
    g.fillText(day.date.split(' ')[1], 128, 236);
    g.font = `700 34px ${font}`;
    g.fillText(day.date.split(' ')[0].toUpperCase(), 128, 284);
    g.font = `500 24px ${font}`;
    g.fillStyle = '#5b5f66';
    g.fillText(day.day.toUpperCase(), 128, 336);
  });
}

function billboardFace(board: (typeof partners.boards)[number], accent: string) {
  return canvasTexture(1024, 512, (g, font) => {
    const grad = g.createLinearGradient(0, 0, 1024, 512);
    grad.addColorStop(0, '#14161b');
    grad.addColorStop(1, '#22252c');
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 512);
    g.fillStyle = accent;
    g.fillRect(64, 92, 120, 12);
    g.fillStyle = '#f4f5f7';
    g.textAlign = 'left';
    // fit the name on one or two lines
    const words = board.name.split(' ');
    let size = 92;
    let lines: string[] = [board.name];
    for (; size > 40; size -= 4) {
      g.font = `900 ${size}px ${font}`;
      if (g.measureText(board.name).width <= 896) {
        lines = [board.name];
        break;
      }
      const cut = Math.ceil(words.length / 2);
      const two = [words.slice(0, cut).join(' '), words.slice(cut).join(' ')];
      if (Math.max(...two.map((l) => g.measureText(l).width)) <= 896) {
        lines = two;
        break;
      }
    }
    g.font = `900 ${size}px ${font}`;
    lines.forEach((l, i) => g.fillText(l, 64, 210 + i * size * 1.08));
    g.font = `500 34px ${font}`;
    g.fillStyle = 'rgba(244,245,247,0.7)';
    g.fillText(board.line, 64, 440);
  });
}

function Marker({ index }: { index: number }) {
  const z = MARKERS.firstZ + index * MARKERS.spacing;
  const base = useMemo(() => parkedToWorld(MARKERS.x, 0, z), [z]);
  const heading = getParkedFrame().heading;
  const face = useMemo(() => markerFace(schedule.days[index]), [index]);
  useEffect(() => () => face.dispose(), [face]);
  // face the oncoming camera, turned a little toward the road
  return (
    <group position={base} rotation-y={heading + Math.PI - 0.6}>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.52, 0.84, 0.22]} />
        <meshStandardMaterial color="#e9e6df" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.84, 0]} rotation-x={-Math.PI / 2}>
        <cylinderGeometry args={[0.26, 0.26, 0.22, 24, 1, false, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#e8781e" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.66, 0.111]}>
        <planeGeometry args={[0.5, 0.75]} />
        <meshStandardMaterial map={face} roughness={0.85} />
      </mesh>
    </group>
  );
}

function Billboard({ index, accent }: { index: number; accent: string }) {
  const z = BILLBOARDS.firstZ + index * BILLBOARDS.spacing;
  const base = useMemo(() => parkedToWorld(BILLBOARDS.x - index * 0.8, 0, z), [z, index]);
  const heading = getParkedFrame().heading;
  const face = useMemo(() => billboardFace(partners.boards[index], accent), [index, accent]);
  useEffect(() => () => face.dispose(), [face]);
  const yaw = heading + Math.PI - (BILLBOARDS.yawDeg * Math.PI) / 180;
  return (
    <group position={base} rotation-y={yaw}>
      {[-2.4, 2.4].map((x) => (
        <mesh key={x} position={[x, 2.4, -0.15]}>
          <boxGeometry args={[0.22, 4.8, 0.22]} />
          <meshStandardMaterial color="#2a2c31" metalness={0.6} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 6.4, -0.12]}>
        <boxGeometry args={[7.6, 3.9, 0.18]} />
        <meshStandardMaterial color="#1a1c21" metalness={0.3} roughness={0.6} />
      </mesh>
      <mesh position={[0, 6.4, -0.02]}>
        <planeGeometry args={[7.2, 3.6]} />
        <meshStandardMaterial map={face} emissiveMap={face} emissive="#ffffff" emissiveIntensity={0.35} roughness={0.55} />
      </mesh>
    </group>
  );
}

/**
 * Things that only exist where the drift leaves the car (chapters IV and V): the mile
 * markers for the schedule, the partner billboards further down the road, and an accent
 * rim light behind the car. Lights stay mounted at 0 (hiding one recompiles everything).
 */
export function ChapterProps() {
  const rimL = useRef<PointLight>(null!);
  const rimR = useRef<PointLight>(null!);
  const props = useRef<Group>(null!);
  const accent = useMemo(() => new Color(theme.accent), []);
  const rimPos = useMemo(() => [parkedToWorld(2.4, 1.5, -3.8), parkedToWorld(-2.4, 1.5, -3.8)] as const, []);

  useFrame(() => {
    const after = !chapterState.drift && chapterState.chapter >= 3;
    props.current.visible = after;
    const rim = after ? chapterState.look.accent * 5 : 0;
    rimL.current.intensity = rimR.current.intensity = rim;
  }, -1);

  return (
    <group>
      <group ref={props} visible={false}>
        {schedule.days.map((_, i) => (
          <Marker key={i} index={i} />
        ))}
        {partners.boards.map((_, i) => (
          <Billboard key={i} index={i} accent={theme.accent} />
        ))}
      </group>
      <pointLight ref={rimL} position={rimPos[0]} color={accent} distance={10} decay={2} intensity={0} />
      <pointLight ref={rimR} position={rimPos[1]} color={accent} distance={10} decay={2} intensity={0} />
    </group>
  );
}
