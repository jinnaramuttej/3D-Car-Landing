'use client';

import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { chapterState, rainLevel, stopWeight } from '@/lib/chapterRuntime';
import { engine } from '@/lib/engineAudio';
import { interaction } from '@/lib/interaction';
import { carState } from '@/lib/motion';
import { stepPowertrain } from '@/lib/powertrain';
import { stopFx } from '@/lib/stops';
import { bridgeInfo } from './city/Bridge';

/**
 * Drives the sound once per frame, after the car has moved: the powertrain model takes the
 * car's motion and the visitor's rev, and the mixer (src/lib/engineAudio.ts) takes the
 * powertrain plus the rain, the DKMS stop and the bridge cables going past.
 */
export function Sound() {
  const state = useMemo(() => ({ lastS: 0, lastWhoosh: -1e9 }), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20);
    stepPowertrain(
      {
        engineOn: chapterState.engineOn,
        speed: carState.speed,
        accel: carState.accel,
        slip: carState.slip,
        rev: interaction.rev,
      },
      dt,
    );

    // a whoosh for each stay cable the car passes (not too close together), more for a pylon
    let whoosh: 0 | 1 | 2 = 0;
    const s = carState.s;
    if (Math.abs(carState.speed) > 8 && s > state.lastS && s - state.lastS < 30) {
      for (const p of bridgeInfo.pylons) if (p > state.lastS && p <= s) whoosh = 2;
      if (!whoosh)
        for (const a of bridgeInfo.anchors)
          if (a > state.lastS && a <= s && a - state.lastWhoosh > 22) {
            whoosh = 1;
            state.lastWhoosh = a;
            break;
          }
    }
    state.lastS = s;

    engine.update({ rain: rainLevel(), quiet: stopWeight('dkms'), heartbeat: stopFx.heartbeat, whoosh });
  }, -1);

  return null;
}
