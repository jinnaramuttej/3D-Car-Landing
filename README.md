# Techfest 2026 (unofficial concept)

Scroll-driven R3F site in one fixed Canvas, told in eleven chapters and a finale: a Porsche 992 GT3 R waits in the rain on a waterfront at midnight, wakes up and drifts through the bends; the camera climbs into the cloud and comes down over a city at night, where the car drives from one LED billboard to the next (one per festival section) and finally out onto a bridge over the sea as dawn breaks. An unofficial concept build for the Build in 3D challenge; every call to action goes to [techfest.org](https://techfest.org).

```powershell
npm install
npm run dev
```

Open http://localhost:3000 to scroll it, or http://localhost:3000/?debug for the leva tuning panel (add `&route` to see the city route).

**Edit the copy in `src/content.ts`** (SITE, ROBOWARS, COMPETITIONS, VOICES, EXPO, HEARTBEAT, TWMUN, plus the chapter lines and UI labels).

## How it fits together

```
scroll (Lenis) -> ScrollTrigger -> one GSAP timeline -> store.progress (zustand, global 0..1)
                                                         |
  Scene  useFrame(-3)  stepChapters(): damped progress -> chapter, beat, stage, environment
                       waterfront (I-IV): stepDrive()     city (V on): stepCityDrive()
                       then fog, env map, sun and sky light from the chapter's environment
  Car    useFrame(-2)  applies it to the model, publishes tyre contacts and the headlight beams
  Smoke / Rain / SkidMarks / city / CameraRig / Sound / Interaction  useFrame(-1)
  city reflection  useFrame(-0.5)  renders the mirrored street once per frame
  Effects  composer, priority 1 (the smoke has its own pass in it)
  Overlay + Stops (DOM)  paused GSAP timelines that follow store.progress
```

## The chapters

`src/lib/chapters.ts` holds the chapters (scroll length in viewport heights, environment at the start and end) and the camera beats of I, II and IV. `src/lib/chapterRuntime.ts` eases every environment value (rain, fog, light colour, exposure, sky, sun, lamps), so nothing jumps between chapters.

| # | Chapter | What happens |
| --- | --- | --- |
| I | Stillness | Midnight on the waterfront, heavy rain, the car parked with the engine off |
| II | Ignition | The engine catches and the lights flicker up; a camera car leads it away into the drift's first frame |
| III | The Turn | The drift scene (shot script below), untouched and at its original pace. It ends in the smoke |
| IV | Clearing | The smoke settles and the title forms; then the camera climbs into the cloud. At the thickest point the stage switches to the city |
| V | Arrival | Down out of the cloud over a city at night in the rain: edition, dates, venue on the first billboard |
| VI | Robowars | Prize pool and weight classes; pick a class and the billboard follows; the stats count up |
| VII | Competitions | The competitions as cards; filter chips re-flow the cards (GSAP Flip) and re-sort the billboard list; each card has a Check status link |
| VIII | Speakers | Past speakers: the categories turn over on the billboard and in the panel until you pick one |
| IX | Expo | Past exhibits; scrolling steps through them, Details opens the panel |
| X | DKMS | The stem cell donor drive: slow, warm, quiet. A soft heartbeat in light and sound, a 3-minute ring timer |
| XI | TWMUN | The MUN; committee cards flip on hover (tap on phones) |
| Fin | Finale | Out of the city on the flyover and across the bridge; dawn breaks over the sea and the one CTA comes up |

The move from the waterfront to the city is not a cut: the two stages are far apart in the world, the fog closes in completely while the camera climbs into the cloud, the stage switches there (`stageSwitchAt()`), and the camera comes down out of the cloud over the city. Only a mini-map jump cross-dissolves (`DissolvePass`).

## The city

- **Model.** "city" by golukumar (CC BY 4.0, credit below and in the footer), rebuilt by `npm run city` (`scripts/optimize-city.mjs`): scaled so a lane is 3.5 m (58.3 m per source unit), joined by material into a 2 x 2 grid of tiles, welded, WebP textures (max 512 px), meshopt geometry. The two oversized pasted textures (a palm atlas and a tree card) are replaced by generated LED textures (LED palm trees and fairy-light trees), and three ad posters with faces and logos by generated shop signs (`scripts/city-textures.mjs`). Each material is tagged with what the scene does with it (`road:`, `window:`, `sign:` ...).

  | | Source (`Untitled.glb`) | `public/models/city.glb` |
  | --- | --- | --- |
  | File size | 21.2 MB | 5.5 MB (2.9 MB gzipped) |
  | Draw calls | 2780 | 272 |
  | Triangles | 207 499 | 207 499 |
  | Textures | 100 PNG, 6.0 MB | 100 WebP, 1.0 MB |

- **Route.** `scripts/build-route.mjs` rasterises the model's road surfaces, runs A* between a few via points along the middle of each carriageway (it cannot fall off a flyover onto the road below), smooths the path and samples the road height under it, and writes `src/lib/cityRoute.data.ts` (848 m, climbing from 8.6 m to 29.8 m onto the flyover). `src/lib/cityRoute.ts` adds the bridge, the stops and the world placement (`CITY_ORIGIN`). **To fix the route**, open `/?debug&route` (or City > showRoute): the yellow line is the curve, the dots are the waypoints (index every 5th), the red posts are the stops and the cyan dots the billboards. Move the `VIA` points in `scripts/build-route.mjs` and run it again, or edit a waypoint in the data file.
- **Stops.** `STOPS` in `cityRoute.ts`. Each sits where `scripts/find-walls.mjs` found a flat, road-facing wall wide enough for a billboard; the billboard finds that wall itself with a raycast (`Billboards.tsx`) and stands on legs if it can't. `src/lib/cityDrive.ts` maps scroll to route metres: the car arrives at each stop early in its chapter, creeps past the billboard while the panel is up, and drives on to the next across the chapter boundary (cubic Hermite, no step in speed). The drift angle is a function of position (curvature times the speed a steady scroll gives), so the slides always happen in the same corners.
- **Night and rain** (`src/scene/city/cityMaterials.ts`). Surfaces darken at night; up-facing ones get wet (darker, smoother) and pool into puddles from world-space noise; roads, pavements and the sea take one shared planar reflection (`cityReflection.ts`) that follows the road under the car and drops to sea level on the bridge (desktop only). Windows light up floor by floor from a world-space grid, signs and the LED trees glow, sodium lamps line the route with a handful of real lights following the camera (`StreetLights.tsx`), and tall towers fade into a cloud layer in the fog (`src/scene/fogLayers.ts`).
- **Billboards** (`Billboards.tsx`, `billboardArt.ts`). Each stop's content is drawn to a canvas (text and shapes only) and turned into LEDs by a shader that blooms; the active one spills its colour on the street. Phones: text only, no LED shimmer.
- **Sea and bridge** (`Sea.tsx`, `Bridge.tsx`). Dark water with a slow swell that bends the reflection; a sea wall under the city's edge; a cable-stayed bridge built from code (deck, two H-pylons, instanced stay cables, blinking aviation lights, lamp rows, piers).
- **Camera director** (`director.ts`). Chase, wheel, hood, side-pan and drone shots, cut on a schedule along the route that never lands on a slide (a cut that would moves to the nearest calm spot or is dropped). Each stop gets a framed shot with the billboard and the car both in view and shallow depth of field. Speed opens the lens a little, acceleration shakes it, every lens stays in 24-40 degrees. **Hold C** (or the navbar camera button) to step through the shots; the schedule takes over again 6 s after the last press.

## Sound

`src/lib/powertrain.ts` is a small model of a six-speed flat-six: the car's motion and the visitor's rev input become a throttle with attack and release, gears with shift points, and revs that drop at each shift (a clutch slip near standstill, a flare on wheelspin). The mixer (`src/lib/engineAudio.ts`) reads only that model, never the scroll or the keys. It crossfades 18 engine loops (9 rpm points x on-throttle / lift-off) with equal-power curves, each kept within 15% of its own pitch, with pops on lifts and upshifts, tyre squeal on the slip angle, wind on speed, a rain bed ducked under the engine, a whoosh past each bridge cable and pylon, a soft heartbeat at the DKMS stop, and a compressor on the master. Sound stays off until the navbar toggle (that click unlocks audio); the samples are built then, in about half a second.

Every sample is generated in code (`src/lib/audio/synth.ts`); no recordings are used, so they are covered by this repository's own licence:

| Sample | What it is |
| --- | --- |
| `engine on 1000 ... 8100 rpm` (9) | Flat-six exhaust on throttle: firing pulses (3 per crank turn) through exhaust resonances, intake roar |
| `engine off 1000 ... 8100 rpm` (9) | The same lifting off: softer pulses, overrun crackle above 2500 rpm |
| `tyre squeal` | Resonant noise with a slow wobble |
| `wind` | Low-passed noise with a rumble under it |
| `rain bed` | Pink-ish noise with drop ticks |
| `starter` | The starter motor against compression (chapter II) |
| `pop` | One overrun / shift crackle |
| `whoosh` | A stay cable or pylon going past |
| heartbeat | Two sine thumps, made live (no buffer) |

## Smoke

Tyre smoke and spray (`src/scene/Smoke.tsx`) follow the slip angle with a floor while the car slides, as big faint puffs that drift on the wind and take the headlights and the nearest street lamps. They render in their own pass against the main render's depth (`postfx/SoftSmokeEffect.ts`), so they melt into the road, the car and walls instead of cutting through them. Puffs near the lens fade by distance (sooner for bigger ones), so nothing close to the camera fills the frame; the full-screen cover only happens at the III to IV handover.

## Interaction

- **Hold the mouse button or Space** to rev (the powertrain, so the sound and the camera follow), and the rain reacts.
- **Move the cursor** over the scene to wipe the wet lens; the drops come back as it keeps raining.
- **Click the car** for the next livery. **H** toggles the headlights, **hold C** steps through camera shots; the navbar has both, and the sound toggle. Mouse parallax on every camera, a chapter mini-map down the right edge.
- At the stops: weight classes, competition filters, speaker categories, exhibit details, the swab timer, committee flip cards.
- Phones get tap-the-car, the mini-map and the stop controls; no hold-to-rev or lens wipe.

## The drift scene: shot script

`src/lib/script.ts` is the film: six shots, each owning a slice of the drift scene's own progress (chapter III maps to its 0-0.78), joined by hard cuts or short blends.

| # | Progress | Shot | On screen |
| --- | --- | --- | --- |
| 1 | 0.00-0.13 | Cold open | The car arrives from chapter II and flicks sideways into the right-hander. Low front 3/4, slow push |
| 2 | 0.13-0.30 | The flank | Cut. Tracking close-up down the right side, nose to tail |
| 3 | 0.30-0.40 | The tail | Swings round the rear; brake lights flare before turn-in, camera pulls back and rises |
| 4 | 0.40-0.48 | The tyre | Cut. Right-rear tyre at hub height as the slide starts |
| 5 | 0.48-0.66 | The drift | Cut. Long-lens swing from the flank to the front 3/4 through the left-hander |
| 6 | 0.66-1.00 | Into the smoke | Pull back and rise over the cloud, push into it, the title emerges |

## The look

- **Lens.** Every camera is held to a vertical FOV of 24-40 degrees (`CONFIG.camera.fovMin/fovMax`); a wider ask pulls the camera back instead.
- **Car.** Clear-coated physical paint over the livery, transmissive glass on the waterfront (tinted glass in the city and on phones), emissive head and tail lights, contact shadows (`CONFIG.car`).
- **Waterfront.** Wet asphalt (`MeshReflectorMaterial`), road markings, a sea wall and the sea, sodium lamps, a lit skyline and a bridge across the bay (`CONFIG.coast`, `CONFIG.look`).
- **Rain.** Slanted streaks around the camera, splashes around the car, haze cones in the headlight beams, drops on the lens (`CONFIG.rain`).
- **Post.** NaN scrub with the chapter's exposure, a cross-dissolve over jumps, the smoke pass, depth of field, camera motion blur, bloom plus anamorphic streaks, lens drops, ACES, a teal/orange LUT, chromatic aberration, grain, vignette (`CONFIG.post`).
- **Mobile.** Phones get 30% of the rain, half the smoke, 2 real street lights instead of 6, no street reflection, no LED shimmer, and skip depth of field, motion blur, anamorphic streaks and lens drops.

## Performance and size

Measured in the dev build on an RTX 3050 laptop GPU at 1897 x 1080 (DPR 1.5), GPU time per frame:

| Where | Median | 90th percentile | Draw calls |
| --- | --- | --- | --- |
| I Stillness | 12.4 ms | 15.8 ms | 857 |
| III The drift | 12.9 ms | 14.3 ms | 882 |
| V Arrival | 14.9 ms | 17.8 ms | 545 |
| VII the long drive | 18.4 ms | 23.1 ms | 739 |
| X DKMS | 16.8 ms | 23.2 ms | 562 |
| Finale, the bridge | 9.8 ms | 12.5 ms | 411 |

The city stage is on its own render layer (`CITY_LAYER`), so the car's contact-shadow pass never draws it and the street reflection draws only the city and the sky.

Download: the car model 36.6 MB (17.3 MB gzipped), the city 5.5 MB (2.9 MB gzipped), the HDRI 1.6 MB, the livery 1.3 MB (436 KB on phones), JavaScript about 2.4 MB, fonts 216 KB: about 48 MB raw, about 25 MB gzipped. The car is the place to save more (see Model notes).

## Files

| File | What it does |
| --- | --- |
| `src/content.ts` | All site copy, the accent colour, the credits |
| `src/lib/chapters.ts` | Chapters, environments, the I/II/IV camera beats, the stage switch |
| `src/lib/chapterRuntime.ts` | Runs the chapters each frame: environment, looks, stage, ignition, the cloud, stop weights |
| `src/lib/cityRoute.ts`, `cityRoute.data.ts` | The route through the city and over the bridge, the stops |
| `src/lib/cityDrive.ts` | Scroll to route metres, the drift profile, the car on the route |
| `src/lib/stops.ts` | UI state shared by the stop panels and the billboards, billboard anchors |
| `src/lib/powertrain.ts`, `engineAudio.ts`, `audio/synth.ts` | The rpm model, the mixer, the generated samples |
| `src/lib/motion.ts` | The waterfront track, the drift curve, `carState`, `stepDrive()` |
| `src/lib/script.ts` | The drift scene's shot script |
| `src/lib/config.ts` | Every other tunable plus slider ranges for leva |
| `src/components/Stops.tsx` | Chapters V-XI and the finale in the DOM |
| `src/components/Overlay.tsx`, `Navbar.tsx`, `MiniMap.tsx` | Chapter cards, hints, title, credits; the navbar; the mini-map |
| `src/scene/Scene.tsx` | Canvas contents, lights, env maps, frame order |
| `src/scene/city/` | The city, its materials and reflection, street lights, billboards, sea, bridge, the camera director, the route debug view |
| `src/scene/Smoke.tsx`, `postfx/SoftSmokeEffect.ts` | Tyre smoke and spray, and the pass that draws them |
| `src/scene/Sound.tsx` | Feeds the powertrain and the mixer every frame |
| `src/scene/Track.tsx`, `Cityscape.tsx` | The waterfront and its sky, skyline and bridge |
| `src/scene/CameraRig.tsx`, `Effects.tsx` | The camera (shot script, beats, the city director) and the post chain |
| `scripts/optimize-city.mjs`, `city-textures.mjs` | Rebuilds the city GLB (`npm run city` also rebuilds the route) |
| `scripts/build-route.mjs`, `find-walls.mjs` | Finds the route; finds walls for billboards |

## Testing without scrolling

1. Open `/?debug`. In the **Scrub** folder, drag **progress** (global, 0-1 over the whole page). The beat and shot buttons jump; **play 0 to 1** runs the whole page in 60 s. The yellow HUD shows the chapter and shot (in the city: route metre, speed and camera shot).
2. Open any folder (**City**, **Camera**, **Smoke**, **Car**, **Rain**, **Post** ...) and tune live; **copy config** copies the values as JSON for `config.ts`.
3. Console (debug mode): `__gt3r.store`, `__gt3r.carState`, `__gt3r.chapterState`, `__gt3r.powertrain`, `__gt3r.schedule()` (the camera cuts with the slide at each), `__gt3r.director`.

Chapter environments, beats, the route and the stops are code, not leva: edit, save, and reload the page (hot reload keeps stale state for the frame loop).

## Model notes

- The car's wheels are separate nodes (`WHEEL_LF/RF/LR/RR`); `Car.tsx` re-pivots each at its hub. Units are metres, +Y up, +Z forward, +X = the car's left.
- The export lost the look; `src/scene/carMaterials.ts` restores it (livery on clear-coated paint from `public/textures/gt3r-livery-4k.jpg`, transmissive glass, rubber, rims, calipers).
- The car GLB is 36.6 MB. For production, compress it without merging the wheel nodes, for example `npx @gltf-transform/cli optimize gt3r.glb gt3r.opt.glb --texture-compress webp --join false --flatten false --instance false`, and check the node log afterwards.

## Credits

- "Porsche 992 GT3 R" by MattDoesBlender on Sketchfab, licensed **CC BY-NC-SA 4.0** (attribution required, non-commercial, share-alike). The credit line is in the page footer.
- "city" by golukumar (mortalityrexotable) on Sketchfab, licensed **CC BY 4.0**: https://sketchfab.com/3d-models/city-2e358ed084524a8f963c146a19637815. Modified: merged by material into tiles, scaled (a lane is 3.5 m), compressed (meshopt geometry, WebP textures), and five textures replaced with generated ones (an LED palm atlas, an LED tree card and three shop-sign panels in place of ad posters). Rebuilt by `scripts/optimize-city.mjs`. The credit line is in the page footer.
- Night HDRI: "Shanghai Bund" from Poly Haven (CC0), used for reflections.
- Sound: every sample is generated in code (`src/lib/audio/synth.ts`), see Sound.
- Display font: Unbounded (SIL Open Font License), self-hosted by `next/font`.
