# Techfest 2026 (unofficial concept)

Scroll-driven R3F site in one fixed Canvas, told in eleven chapters and a finale: a Porsche 992 GT3 R waits in the rain on a Mumbai seafront at midnight, wakes up, drifts through the bends, the rain clears into a warm morning, and the festival opens up district by district before the car leaves into the sunrise. An unofficial concept build for the Build in 3D challenge; every call to action goes to [techfest.org](https://techfest.org).

```powershell
npm install
npm run dev
```

Open http://localhost:3000 to scroll it, or http://localhost:3000/?debug for the leva tuning panel.

**Edit the copy in `src/content.ts`** (chapter lines, facts, events, schedule, partners, CTAs, accent colour).

## How it fits together

```
scroll (Lenis) -> ScrollTrigger -> one GSAP timeline -> store.progress (zustand, global 0..1)
                                                         |
  Scene  useFrame(-3)  stepChapters(): damped progress -> chapter, beat, environment, car staging
                       stepDrive(): car path, yaw, roll, steer, slip
                       then fog, env map, sun and sky light from the chapter's environment
  Car    useFrame(-2)  applies it to the model, publishes tyre contacts and the headlight beams
  Smoke / Rain / SkidMarks / ChapterProps / districts / CameraRig / Interaction  useFrame(-1)
  Effects  composer, priority 1
  Overlay + Districts (DOM)  paused GSAP timelines that follow store.progress
```

## The chapters

`src/lib/chapters.ts` holds the chapters (scroll length in viewport heights, environment at the start and end), the camera beats inside them (waypoints in a frame, `orbit` or `line` moves, depth of field, headlight/accent/smoke levels) and the staging numbers (ignition, finale, mile markers, billboards). The runtime (`src/lib/chapterRuntime.ts`) eases every environment value, rain, fog, light colour, exposure, sky, sun, lamps, so nothing jumps between chapters.

| # | Chapter | What happens |
| --- | --- | --- |
| I | Stillness | Midnight, heavy rain, the car parked 20 m before the first bend with the engine off. A slow push from the sea side |
| II | Ignition | The engine catches and the lights flicker up; then a camera car leads it away. The launch ends exactly on the drift's first frame, so there is no cut |
| III | The Turn | The drift scene (shot script below), untouched and at its original pace. It ends in the smoke |
| IV | Clearing | Under the smoke the env map switches to daylight; the smoke settles, the rain stops, dawn comes up, the street lamps go off and the Techfest title forms |
| V | Arrival | Warm morning beside the parked car: edition, dates, venue |
| VI | Arena | Robowars: an octagonal steel cage with orange rim light. Pick 8/15/30/60 kg and the robot rescales; click the floor for sparks; the stats count up |
| VII | Pit Lane | The competitions as garage bays; filter chips re-flow the cards (GSAP Flip); every card has a Check status link |
| VIII | Hall of Voices | Past speakers on a globe: category tabs swap the markers, hover for a monogram card, click to pin. Phones get a plain list |
| IX | Expo | Four holographic pedestals; the camera dollies along them; click one for its detail panel |
| X | Heartbeat | The stem cell donor drive: warm light, one slow pulse in light and sound, a 3-minute ring timer |
| XI | Chamber | Techfest World MUN in a purple hall; committee cards flip on hover (tap on phones) |
| Fin | Finale | Back at the car: it leaves into the sunrise; one CTA to techfest.org and the disclaimer |

Camera continuity: beats ease into each other in their own frame (`start`, `follow`, `parked`, or a district's platform). Chapters VI-XI are sets on platforms out over the sea, about 100 m apart; moving between them is a real camera move that lifts out of one hall into morning mist over the water and down into the next (the fog, light and env map cross-fade on the way, `CONFIG.districts`). Only a mini-map jump cross-dissolves (`DissolvePass`).

## Interaction

- **Hold the mouse button or Space** to rev: engine pitch (with sound on), camera shake, body buzz, and the rain reacts (splashes jump, drops shiver, the lens drops rattle).
- **Move the cursor** over the scene to wipe the wet lens; the drops come back as it keeps raining.
- **Click the car** for the next livery (a recolour of the race livery: gold, teal, red, midnight, pearl).
- **H** or the navbar button toggles the headlights. Mouse parallax on every camera, a chapter mini-map down the right edge (click to jump), and a sound toggle.
- In the districts: weight classes and sparks in the arena, filter chips in the pit lane, globe markers and tabs in the Hall of Voices, pedestals in the expo, the timer in Heartbeat, flip cards in the Chamber.
- Tunables in `CONFIG.interaction` and `CONFIG.districts`. Phones get tap-the-car, the mini-map and the district controls; no hold-to-rev or lens wipe, and a list instead of the globe.

## The drift scene: shot script

`src/lib/script.ts` is the film: six shots, each owning a slice of the drift scene's own progress (chapter III maps to its 0–0.78), joined by hard cuts or short blends.

| # | Progress | Shot | On screen |
| --- | --- | --- | --- |
| 1 | 0.00–0.13 | Cold open | The car arrives from chapter II and flicks sideways into the right-hander. Low front 3/4, slow push |
| 2 | 0.13–0.30 | The flank | Cut. Tracking close-up down the right side, nose to tail (screen right to left) |
| 3 | 0.30–0.40 | The tail | Swings round the rear; brake lights flare before turn-in, camera pulls back and rises |
| 4 | 0.40–0.48 | The tyre | Cut. Right-rear tyre at hub height as the slide starts and the smoke erupts |
| 5 | 0.48–0.66 | The drift | Cut. Long-lens swing from the flank to the front 3/4 through the left-hander |
| 6 | 0.66–1.00 | Into the smoke | Pull back and rise over the cloud, push into it, the title emerges |

Each shot gives camera keys in its own frame (`body` = rides on the car, `path` = follows the car facing down the road, `anchor` = fixed on the track), plus depth of field, hand-held float and shake. Edit the numbers there; the car motion that goes with them is `CONFIG.introDrift`, `CONFIG.drift` and `CONFIG.track`. Letterbox bars run through shots 1–5.

## The look

- **Lens.** Every camera, drift shots and chapter beats alike, is held to a vertical FOV of 24–40° (`CONFIG.camera.fovMin/fovMax`). A shot that asks for something wider keeps its framing by pulling the camera back instead (`fitLens` in `CameraRig.tsx`).
- **Scale.** The model is in real metres: 4.77 m long (splitter to wing; the road car body is 4.62 m), 2.05 m wide, 2.52 m wheelbase. It is not rescaled.
- **Car.** Clear-coated physical paint over the livery, transmissive tinted glass (cheap glass on mobile), dark low-specular rubber, emissive head and tail lights, drei `ContactShadows` underneath (`CONFIG.car`).
- **Place.** A seafront road that goes from midnight to morning: wet asphalt (`MeshReflectorMaterial`, blurred reflection, puddle roughness map), Indian road markings, a sea wall with the sea beyond it, sodium lamps, a lit city with neon on the right, a cable-stayed bridge and the far shore across the bay, light fog. The night-street HDRI drives the reflections (`CONFIG.coast`, `CONFIG.look`).
- **Rain.** Slanted streaks around the camera, splashes around the car, haze cones in the headlight beams; the drops inside the beams light up and make the rain curtain (`CONFIG.rain`).
- **Smoke.** Low tyre smoke and wet-road spray, lit by the headlights. Before shot 4 (the tyre, `CONFIG.smoke.fullScreenFrom`) no puff may cover more than `maxCover` of the frame height, so the screen only fills with smoke in the final shot.
- **Post.** NaN scrub with the chapter's exposure, a cross-dissolve over camera jumps, depth of field held on the car, camera motion blur (the car is carried by its own motion, so tracking shots keep it sharp), bloom plus anamorphic streaks, rain drops on the lens that streak when the camera moves, ACES tone mapping, a teal/orange LUT, chromatic aberration, midtone film grain and vignette (`CONFIG.post`).
- **Mobile.** dpr is clamped to 1.5 everywhere. Phones get 30% of the rain, half the smoke, a smaller city and reflection, and skip depth of field, motion blur, anamorphic streaks and lens drops.

## Files

| File | What it does |
| --- | --- |
| `src/content.ts` | All site copy and the accent colour |
| `src/lib/chapters.ts` | The chapters: scroll lengths, environments, camera beats, district positions, finale/ignition numbers |
| `src/lib/districtState.ts` | UI state shared by the district panels and sets (weight class, speaker category, open exhibit) |
| `src/lib/chapterRuntime.ts` | Runs the chapters each frame: damped environment and looks, car staging, ignition, finale, camera targets |
| `src/lib/interaction.ts`, `src/scene/Interaction.tsx` | Hold to rev, lens wipe, click-the-car livery, headlight toggle |
| `src/lib/engineAudio.ts` | Synthesised flat-six: ignition, held-throttle rev, finale rev and launch (Web Audio, no files) |
| `src/components/Overlay.tsx` | Chapter cards, hints, cinema bars, the chapter IV title, livery toast, footer credit |
| `src/components/Districts.tsx` | Chapters V-XI and the finale in the DOM: facts, Robowars console, pit lane bays, speakers, expo details, heartbeat timer, committee cards, the CTA |
| `src/components/Navbar.tsx`, `MiniMap.tsx` | Navbar (headlights, sound, techfest.org) and the chapter mini-map |
| `src/scene/ChapterProps.tsx` | The accent rim light behind the parked car |
| `src/scene/districts/` | The six district sets, the shared light pool, the hologram material |
| `src/scene/livery.ts`, `dayEnvironment.ts` | Livery recolours; the generated daylight env map |
| `src/lib/script.ts` | The drift scene's shot script: timings, framing, cuts, depth of field per shot |
| `src/lib/config.ts` | Every other tunable (drift, car, smoke, rain, coast, post, look) plus slider ranges for leva |
| `src/lib/store.ts` | `progress` (0..1) and `manual` (the debug slider owns progress) |
| `src/lib/useScrollTimeline.ts` | Lenis + ScrollTrigger + the single scrubbed timeline. The only scroll listener |
| `src/lib/motion.ts` | Track curve, drift curve, `carState`, `stepDrive()`, camera shake envelope |
| `src/lib/coast.ts` | The land outline: road side of the sea wall, used for the asphalt and to place buildings |
| `src/scene/Scene.tsx` | Canvas contents, HDRI and lightformers, sun and sky light, env-map switch, frame order |
| `src/scene/Car.tsx` | Loads `/models/gt3r.glb`, logs node names, re-pivots the wheels, lights, contact shadows |
| `src/scene/carMaterials.ts` | Paint, glass and tyre materials, plus fixes for what the export flattened |
| `src/scene/Track.tsx` | Wet asphalt, markings, sea wall, the sea, sodium lamps |
| `src/scene/Cityscape.tsx` | Sky, city blocks with lit windows and shop fronts, neon signs, the bridge, far-shore lights |
| `src/scene/Rain.tsx` | Rain streaks, splashes and headlight haze, all computed on the GPU |
| `src/scene/Smoke.tsx` | Instanced billboard smoke and spray, the shot-4 coverage guard, the full-screen veil |
| `src/scene/SkidMarks.tsx` | Rubber ribbons behind the rear tyres |
| `src/scene/CameraRig.tsx` | Plays the shot script in chapter III and the beats elsewhere: cuts, blends, hand-held, shake, parallax, the long-lens rule; publishes focus |
| `src/scene/Effects.tsx` | The post chain |
| `src/scene/postfx/` | Custom post effects: NaN scrub, cross-dissolve, motion blur, anamorphic streaks, lens drops, grain, the LUT |

## Testing without scrolling

1. Open `/?debug`. In the **Scrub** folder, drag **progress** (global, 0–1 over the whole page). Dragging hands control to the slider ("slider drives" turns on) and the scroll timeline stops writing.
2. Use the beat buttons (**I: still** … **V: finale**) and the **III shot 1–6** buttons to jump, or **play 0 to 1** for a 60 s run. The yellow HUD shows the chapter, beat or shot on screen.
3. Open any folder (**Camera**, **Smoke**, **Car**, **Look**, **Interaction**, **Post**, **Rain**, **Coast**, ...) and tune live. **copy config** puts the current values on the clipboard as JSON to paste back into `config.ts`. Values marked `(mount)` in `config.ts` need a reload.
4. **back to scroll** returns control to the page scroll.

To work on the drift before scroll exists at all, comment out `useScrollTimeline(trackRef)` in `src/components/Experience.tsx`. Nothing else changes: the slider writes the same `progress` value.

From the browser console (debug mode): `__gt3r.store.getState().setProgress(0.5)`, `__gt3r.config.rain.intensity = 0`, `__gt3r.carState`, `__gt3r.chapterState`, `__gt3r.interaction`.

Chapter environments and camera beats live in `chapters.ts` (not leva): edit, save, and reload the page (hot reload keeps stale state for the frame loop).

Note: the smoke is time-based. Jumping straight into a shot shows the car with little smoke; scrub or play into it to build the cloud.

## Model notes

- The model keeps all four wheels as separate nodes (`WHEEL_LF/RF/LR/RR`), with brake discs (`DISC_*`) and calipers (`SUSP_*`) separate too. Their pivots sit at the car origin, so `Car.tsx` measures each tyre and re-parents it under a pivot at the hub: `STEER_xx` (rotation.y) holds `SPIN_xx` (rotation.x). Discs spin; calipers only steer.
- Units are metres, +Y up, +Z forward, +X = the car's left (the Sketchfab wrapper nodes above `RootNode` only apply a 0.01 scale and are skipped). `Car.tsx` logs the measured size as `[gt3r] size (m)`.
- The export lost the look: every material came out as metalness 0 / roughness 0.958, untextured parts as flat grey, and the livery (`textures/decals.png` in the download) is not embedded in the GLB at all. `src/scene/carMaterials.ts` restores it: the livery goes on a clear-coated physical paint (from `public/textures/gt3r-livery-4k.jpg`, 2K on mobile), the windows become transmissive glass, the tyres dark rubber, and a name-based table fixes rims, calipers, carbon, mechanicals and the interior. Rim and caliper colours are in `CONFIG.car`.
- The GLB is 36.6 MB. For production, compress it without merging the wheel nodes, for example `npx @gltf-transform/cli optimize gt3r.glb gt3r.opt.glb --texture-compress webp --join false --flatten false --instance false`, and check the node log afterwards.

## Credits

- "Porsche 992 GT3 R" by MattDoesBlender on Sketchfab, licensed **CC BY-NC-SA 4.0** (attribution required, non-commercial, share-alike). The credit line is in the page footer.
- Night HDRI: "Shanghai Bund" from Poly Haven (CC0), standing in for a Mumbai seafront.
