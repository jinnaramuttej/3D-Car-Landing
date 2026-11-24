# Techfest 2026 (unofficial concept)

Scroll-driven R3F site in one fixed Canvas, told as one continuous drive through one world in eleven chapters and a finale: a Porsche 992 GT3 R waits in the rain on a city street at midnight, wakes up and drifts down a long left-hander, leaves its smoke hanging in the street, then drives from one LED billboard to the next (one per festival section), up the ramp onto a bridge and out over the sea as dawn breaks. No cuts, no teleports, no dissolves: only the first-load screen fades. An unofficial concept build for the Build in 3D challenge; every call to action goes to [techfest.org](https://techfest.org).

- **Live site:** _(add the deployed link here)_
- **Recording:** _(add the Google Drive link to the screen recording here)_

```powershell
npm install
npm run dev
```

Open http://localhost:3000 to scroll it (or press **Play**), or http://localhost:3000/?debug for the leva tuning panel (add `&route` to see the route, `&dpr=1.5` to pin the resolution for measuring).

## Stack

Next.js 16 (App Router, Turbopack), React 19, three.js 0.187 through React Three Fiber 9 and drei 10, postprocessing 6 (@react-three/postprocessing 3), GSAP with ScrollTrigger, Lenis, zustand, leva for tuning, TypeScript. The asset scripts use glTF Transform 4, meshoptimizer and sharp.

**Edit the copy in `src/content.ts`** (SITE, ROBOWARS, COMPETITIONS, VOICES, EXPO, TECHEXPO, CATALYST, ALSO, CES2027, HEARTBEAT, TWMUN, plus the chapter lines and UI labels).

## How it fits together

```
scroll (Lenis) -> ScrollTrigger -> one GSAP timeline -> store.progress (zustand, global 0..1: the target)
   (the Play button moves the scroll itself at a cinematic pace)
                                                         |
  Scene  useFrame(-3)  the journey driver chases the target (speed and acceleration limited,
                       the car never above 110 m/s) -> chapterState.progress = what is on screen
                       stepChapters(): chapter, environment, ignition    stepCityDrive(): the car
                       then fog, env map, sun and sky light; writes store.view for the DOM
  Car    useFrame(-2)  applies it to the model, publishes tyre contacts and the headlight beams
  Smoke / Rain / SkidMarks / city / CameraRig / Sound / Interaction  useFrame(-1)
                       CameraRig: the director picks and blends rigs, then publishes where the car
                       and the billboard are on screen (src/lib/layout.ts)
  city reflection  useFrame(-0.5)  renders the mirrored street every other frame
  Effects  composer, priority 1 (the smoke has its own pass in it)
  Overlay + Stops + Extras (DOM)  paused GSAP timelines that follow store.view, and a layout
                       loop that keeps titles and panels off the car
```

## The journey

`src/lib/chapters.ts` holds the chapters (scroll length in viewport heights, environment at the start and end); `src/lib/chapterRuntime.ts` eases every environment value (rain, fog, light colour, exposure, sky, sun, lamps) so nothing jumps, and runs the **journey driver**: the scroll sets a target, and what is on screen drives toward it with a top speed and acceleration, so any wheel flick or mini-map click is a fast but continuous drive (with motion blur and, flat out, light-speed streaks), never a jump. `src/lib/cityDrive.ts` maps the journey to metres along the one route.

**Cold open** (`src/lib/coldOpen.ts`, `ColdOpen.tsx`): as the loader fades, three seconds of black; the engine wakes in the dark (tail lights, an exhaust pop, a jolt of the lens, the starter if the sound is on), the headlights flicker on as the black lifts, then the first title and the controls come in, and the lights ease back to the parked car's. Only from the top of the page.

| # | Chapter | Route metres | What happens |
| --- | --- | --- | --- |
| I | Stillness | 112 | Parked on a rainy street, engine off; the Catalyst billboard glows up the street. A slow push in along the flank |
| II | Ignition | 112 to 160 | The engine catches, the headlight flickers up, the car pulls away with a camera car riding ahead |
| III | The Turn | 160 to 372 | The drift: the flick into the plaza, then sideways down the long left-hander in heavier rain, the camera car still ahead |
| IV | Wake | 372 to 452 | The smoke hangs in the street; the camera crane-moves over the car and trails back through the wake; the Techfest title forms in it |
| V | Arrival | 462 | Edition, dates, venue on the first billboard |
| VI | Robowars | 510 | Prize pool and weight classes; pick a class and the billboard follows; the stats count up |
| VII | Competitions | 562 | The competitions as a strip down the side (collapsed while driving, open at the stop); filter chips re-flow it and re-sort the billboard |
| VIII | Speakers | 596 | Past speakers: the categories turn over on the billboard and in the panel until you pick one |
| IX | TechExpo | 638 | The Ignite Pavilion (international and Indian exhibits), and what Techfest has brought to campus before |
| X | DKMS | 678 | The stem cell donor drive: slow, warm, quiet. A soft heartbeat in light and sound, a 3-minute ring timer |
| XI | TWMUN | 746 | The MUN; committee cards flip on hover (tap on phones) |
| Fin | Finale | 849 on | Up the ramp, past the Also at Techfest gantry and the CES 2027 pylon, out over the sea as dawn breaks and the rain stops; the one CTA |

Drive-past billboards (`EXTRAS` in `cityRoute.ts`), each with a small card as the car comes up to it: **Catalyst** (campus modules, the National Leadership Summit & Pitch, the national seed fund) on the wall ahead of the parked car, **Also at Techfest** (keynotes and speaker sessions, workshops linking to techfest.org/workshops, the closing performance at Convocation Hall) on a gantry over the bridge, **CES 2027** (official innovation partner of the Motwani Jadeja India Pavilion) on the first pylon.

## Play and cinematic mode

**Play** in the navbar (or a tap of **Space**) drives the whole journey by itself, about 150 s (`CONFIG.autoplay.seconds`), brisk on the drives and slower at the stops (`src/lib/autoplay.ts`); every title, billboard and panel comes and goes on its own cue because autoplay simply moves the scroll. Tap Space again to pause; any scroll by hand (wheel, touch, keys, the scrollbar, the mini-map) takes the wheel back, smoothed by the journey driver. A progress bar runs along the top. **Cinematic mode** (the film-frame button) brings in 2.39:1 bars (the lens widens over the same 0.9 s, so the strip between them keeps the whole shot) and hides the navbar and the mini-map; a small dock with play/pause and Exit wakes up on mouse movement, and Esc leaves it.

## The city

- **Model.** "city" by golukumar (CC BY 4.0, credit below and in the footer), rebuilt by `npm run city`: `scripts/optimize-city.mjs` scales it so a lane is 3.5 m (58.3 m per source unit), joins it by material into a 2 x 2 grid of tiles, welds it, WebP textures (max 512 px), meshopt geometry, into `assets/city-full.glb`; the route is found on that; then `scripts/trim-city.mjs` keeps every connected piece that comes within 120 m of the route (or the bridge) and swaps the rest for ten tall landmark towers as box proxies, into `public/models/city.glb`. The two oversized pasted textures (a palm atlas and a tree card) are replaced by generated LED textures (LED palm trees and fairy-light trees), and three ad posters with faces and logos by generated shop signs (`scripts/city-textures.mjs`). Each material is tagged with what the scene does with it (`road:`, `window:`, `sign:` ...).

  | | Source (`Untitled.glb`) | Rebuilt (`assets/city-full.glb`) | Trimmed (`public/models/city.glb`) |
  | --- | --- | --- | --- |
  | File size | 21.2 MB | 5.7 MB | 4.3 MB |
  | Draw calls (primitives) | 2780 | 272 | 217 |
  | Triangles | 207 499 | 207 499 | 147 000 |
  | Textures | 100 PNG, 6.0 MB | 100 WebP, 1.0 MB | 93 WebP, 0.9 MB |

- **Route.** `scripts/build-route.mjs` rasterises the model's road surfaces, runs A* between a few via points along the middle of each carriageway (it cannot fall off a flyover onto the road below), smooths the path, raycasts the real road height under each point, finds the holes in the model's road (patched in the scene) and its open road ends, and writes `src/lib/cityRoute.data.ts`. `src/lib/cityRoute.ts` adds the bridge, the stops and the world placement (`CITY_ORIGIN`). The bridge deck (`src/lib/bridgePath.ts`, built by `Bridge.tsx`) starts over the end of the flyover on the same curve, so the ramp runs straight onto it with no step and no kink. **To fix the route**, open `/?debug&route`; move the `VIA` points in `scripts/build-route.mjs` and run it again.
- **Route check.** `npm run check:route` (and automatically before every `npm run build`) walks the route, the ramp and the deck every 25 cm against the real geometry and fails on a gap, a ledge over 8 cm, the route more than 8 cm off the road, or a turn over 3 degrees between samples. Current output: `OK`, with one note (a 6 cm step at s 461-468, the model's painted crossing).
- **Edges.** `EdgeSeal.tsx` closes the map: a fog wall round the land (open to the sea), and concrete barriers with blinking lights and a fog card across every road the model leaves open.
- **Stops.** `STOPS` in `cityRoute.ts`, each where `scripts/find-walls.mjs` found a flat, road-facing wall for a billboard; the billboard finds that wall itself with a raycast (`Billboards.tsx`) and stands on legs if it can't. Competitions is the exception: a canopy runs across its wall at board height, so its board spans the road on a gantry just ahead of the stop (`mount: 'gantry'`, `boardS`), face-on to the car and the camera. At each stop the car arrives early in the chapter, creeps past the billboard while the panel is up, and drives on to the next across the chapter boundary (cubic Hermite, no step in speed).
- **Night and rain** (`src/scene/city/cityMaterials.ts`). Surfaces darken at night; up-facing ones get wet and pool into puddles (bigger in some stretches than others, with damp rims); roads, pavements and the sea take one shared planar reflection (`cityReflection.ts`, desktop only). Windows light up floor by floor, signs glow (one in eight is a failing tube that stutters), the LED trees glow; sodium lamps line the route with a cone of light through the rain under each and three real lights following the camera (`StreetLights.tsx`); steam drifts up from street grates (`Steam.tsx`); distant traffic runs along the roads well away from the car (`Traffic.tsx`); towers fade into a cloud layer and the air at street level is a little hazier than the fog alone (`src/scene/fogLayers.ts`).
- **Billboards** (`Billboards.tsx`, `billboardArt.ts`). Each board's content is drawn to a canvas (text and shapes only) and turned into LEDs by a shader that blooms; it wakes up row by row as the car approaches and sleeps once the car is well past; the active stop's board spills its colour on the street. Phones: text only, no LED shimmer.
- **Sea and bridge** (`Sea.tsx`, `Bridge.tsx`). Dark water with a slow swell that bends the reflection; a cable-stayed bridge built from code (deck with solid parapets and rails, two H-pylons, instanced stay cables, blinking aviation lights, lamp rows, piers).

## The camera

`src/scene/city/director.ts` is the one camera for the whole page: **rigs** (each a pose that follows the car, or a place in the world it looks from) and **blends** between them. When it changes rig, the camera travels from where it is to the new rig over 1.2-2 s (`CONFIG.director`), eased, round the car, or over it like a crane where the street is too narrow, while both rigs keep tracking the car. It never changes rig near the peak of a slide.

- **opening** (I-III): keyed to the scroll while the car is parked (up the street, in along the flank to the headlight as it wakes), then to route metres (a camera car ahead as it pulls away and slides through the plaza and down the long left-hander).
- **wake** (IV): trailing well back on the road, low, through the smoke, closing up as it thins.
- **stop**: the car big in the foreground and its billboard beyond, in the right two-thirds of the frame (the panel takes the left). The car creeps about 18 m through each stop, so each stop's camera is worked out once, behind the loader: the closest place (13-21 m behind the car) and the longest lens that keep the whole car in frame and clear of the panel at both ends of the creep and show the board, with a sight line through the city model to both (`src/lib/sightline.ts`). It dollies a third of the creep, and the look eases off the board once the car has passed it. Where the board stands well back from the road the car comes first and the board's far end shows; on the arrival ramp the camera rises like a crane to see it over the overpass. `__gt3r.director.stops` shows what each stop got.
- **chase, wheel, hood, sidepan, drone**: one per drive between stops, and over the bridge. **Hold C** (or the navbar camera button) to step through them; the director takes over again 6 s after the last press.

Every lens stays within 24-40 degrees (a wider ask moves the camera back), and no camera goes under the road or through a wall: each is checked against the road and the street's walls at its own place along the route.

**Feel** (`src/lib/feel.ts`, the **Feel** folder in leva):

- **Shake by trauma.** Trauma (0-1) builds with hard acceleration and braking, slides, gear changes, bumps and exhaust pops, and decays; the lens shakes by trauma squared through three layers of simplex noise (a small position and roll offset). Stop cameras don't shake.
- **Spring-damped follow.** Car-relative rigs hang off the car on a spring: the camera falls back a little as the car pulls away and swings out in corners. A hood camera is bolted on; cameras standing in the street don't follow.
- **Speed kick.** The lens opens a few degrees with speed and a little more while the car pulls hard.
- **Body on springs.** Pitch (squat under power, dive on the brakes), roll in corners and heave over crests and the road's texture, each a spring-damper driven by the car's acceleration; the slide's own roll on top.
- **Lights and pops.** Brake lights on deceleration; exhaust pops (a flash at the tailpipes and a red glow on the road) on the same powertrain lifts and upshifts the audio pops on; wheel spin from the ground speed.

## Layout

Nothing covers the car. The 3D frame publishes the car's and the billboard's screen rectangles every frame (`src/lib/layout.ts`), and the DOM places things round them (`Overlay.tsx`, `Stops.tsx`, `Extras.tsx`):

- **One title at a time**, small, in whichever slot (top-left, top-right, upper-centre, lower-left) keeps it off the car, the billboard and the stop's panel. It fades at speed, and at a stop it waits until the camera has settled. Its words rise out of masks as it arrives, with a little depth parallax on the pointer.
- **Stop panels** wait for the camera to settle and take the side that keeps the car clear; the competitions strip opens only at the stop. Panels over the canvas are solid and semi-transparent (no backdrop blur, which would re-read and blur the WebGL frame under every panel each frame).
- A thin **route HUD** in the corner (distance along the route, speed, a tick per stop).

## Smoke

The tyre smoke and spray (`src/scene/Smoke.tsx`) follow the slip angle with a floor, so emission never cuts out mid-slide. What the drift lays down stays behind as a **wake** for 6-8 s: it hugs the road first, then warms and rises, sheared by the rain's wind (more the higher it gets), lit by the street lamps and the headlights. It renders in its own pass against the main render's depth (`postfx/SoftSmokeEffect.ts`), so it melts into the road, the car and walls; near the lens every puff fades by its own size, so the camera can drive through the wake without smoke filling the frame.

## Sound

`src/lib/powertrain.ts` is a small model of a six-speed flat-six: the car's motion and the visitor's rev input become a throttle with attack and release, gears with shift points, and revs that drop at each shift (a clutch slip near standstill, a flare on wheelspin). The mixer (`src/lib/engineAudio.ts`) reads only that model, never the scroll or the keys. It crossfades 18 engine loops (9 rpm points x on-throttle / lift-off) with equal-power curves, each kept within 15% of its own pitch, with pops on lifts and upshifts, tyre squeal on the slip angle, wind on speed, a rain bed ducked under the engine, a whoosh past each bridge cable and pylon, a soft heartbeat at the DKMS stop, and a compressor on the master. Sound stays off until the navbar toggle (that click unlocks audio); the samples are built then, in about half a second.

There is no music track: the brief allowed an optional one from a free source, and the engine, the rain and the city carry it instead. Every sample is generated in code (`src/lib/audio/synth.ts`); no recordings are used, so they are covered by this repository's own licence:

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

## Interaction

- **Scroll** to drive, or press **Play** (tap **Space** to play / pause). **Hold the mouse button or Space** to rev (the powertrain, so the sound and the camera follow), and the rain reacts.
- **Move the cursor** over the scene to wipe the wet lens; the drops come back as it keeps raining.
- **Click the car** for the next livery. **H** toggles the headlights, **hold C** steps through camera rigs; the navbar has both, the sound toggle, Play and cinematic mode. Mouse parallax on every camera, a chapter mini-map down the right edge (a click drives there).
- At the stops: weight classes, competition filters, speaker categories, exhibit details, the swab timer, committee flip cards.
- Phones get tap-the-car, the mini-map and the stop controls; no hold-to-rev or lens wipe.

## The look

- **Lens.** Every camera is held to a vertical FOV of 24-40 degrees (`CONFIG.camera.fovMin/fovMax`); shallow depth of field and a street-level camera keep the model's low-poly edges soft.
- **Grade.** One grade for the whole city (the stops change only the weather) and one accent colour, the page's red, on every billboard and panel.
- **Car.** Clear-coated physical paint over the livery, tinted glass, emissive head and tail lights, contact shadows (`CONFIG.car`).
- **Rain.** Slanted streaks around the camera (lighter by default, heavier through the drift, gone by dawn), splashes around the car, haze cones in the headlight beams, drops on the lens (`CONFIG.rain`).
- **Post.** NaN scrub with the chapter's exposure, the smoke pass, depth of field (half resolution), camera motion blur, light-speed streaks when the car is flat out, bloom (half resolution) plus anamorphic streaks, lens drops, ACES, a restrained teal/orange LUT, chromatic aberration, grain, vignette (`CONFIG.post`). The composer merges them into four effect passes (one per effect that samples its neighbours). No ambient occlusion: N8AO did not fit the frame budget.
- **Loader.** The only fade on the site: real download progress, then a warm-up behind it (`src/scene/Warmup.tsx`) that compiles every shader for the composer's render target, uploads every texture and drives once through every chapter, so nothing compiles or uploads mid-scroll.
- **Mobile.** Phones get 30% of the rain, half the smoke, fewer lights, traffic and steam, no street reflection, no LED shimmer, and skip depth of field, motion blur, speed streaks, anamorphic streaks and lens drops.

## Performance

Measured in the dev build on this laptop's GPU at 1897 x 1080 (`/?debug&dpr=1.5`, auto quality off), the middle of each chapter, GPU-synced time per frame (`gl.finish()` after each frame, so a little above what the browser shows). The GPU's own heat moves these by up to 2x between runs, so read them as rough.

| Chapter | Median before | 90th pct before | Median after | 90th pct after | Draw calls after (before) | Triangles after (before) |
| --- | --- | --- | --- | --- | --- | --- |
| I Stillness | 15.1 ms | 17.0 ms | 11.5 ms | 15.2 ms | 416 (555) | 414k (1133k) |
| II Ignition | 18.6 ms | 20.9 ms | 10.9 ms | 14.7 ms | 427 (773) | 404k (1313k) |
| III The Turn | 14.6 ms | 17.4 ms | 11.4 ms | 15.7 ms | 428 (544) | 419k (1113k) |
| IV Wake | 31.5 ms | 48.9 ms | 17.2 ms | 25.6 ms | 604 (751) | 506k (1260k) |
| V Arrival | 29.6 ms | 33.9 ms | 16.9 ms | 26.8 ms | 609 (754) | 518k (1259k) |
| VI Robowars | 28.8 ms | 35.8 ms | 16.5 ms | 22.3 ms | 573 (714) | 502k (1240k) |
| VII Competitions | 35.3 ms | 43.9 ms | 14.9 ms | 22.3 ms | 462 (617) | 452k (1192k) |
| VIII Speakers | 37.0 ms | 45.1 ms | 14.6 ms | 19.6 ms | 489 (616) | 464k (1194k) |
| IX TechExpo | 33.8 ms | 41.8 ms | 15.3 ms | 21.9 ms | 433 (579) | 450k (1178k) |
| X DKMS | 30.1 ms | 38.0 ms | 13.4 ms | 21.3 ms | 418 (553) | 447k (1173k) |
| XI TWMUN | 26.0 ms | 37.8 ms | 10.2 ms | 14.5 ms | 377 (519) | 421k (1158k) |
| Finale | 20.1 ms | 24.0 ms | 5.0 ms | 6.8 ms | 200 (420) | 165k (985k) |

Driving III to V (the drift, the wake, the arrival): median 34.5 ms before, 14.5 ms after; 90th percentile 43.2 ms before, 22.8 ms after; frames over 50 ms: 10 before (all GPU-bound), 1 after. The few slow frames left (35-52 ms) come while parked at the arrival stop, with no shader compiled, no texture uploaded and no geometry created: CPU-side, most likely garbage collection.

| | Before | After |
| --- | --- | --- |
| Car file | 36.6 MB, 489k triangles | 2.8 MB, 130k triangles |
| City file | 5.7 MB, 207k triangles, 272 primitives | 4.3 MB, 147k triangles, 217 primitives |
| Whole download (raw) | about 48 MB | about 12.5 MB (car 2.8, city 4.3, HDRI 1.6, livery 1.3, JS 2.3, fonts 0.2) |
| Real lights | 10 | 6 (two headlights, three street lamps, the billboard spill) |
| Street reflection | half resolution, every frame | half resolution, every other frame |

What keeps it there:

- **Assets.** The car without its hidden interior and simplified (`npm run car`), the city trimmed to what the journey can see (`npm run city`).
- **Six real lights.** A pool of three lamp lights moves to the lamps nearest what the camera looks at; the rest are emissive heads, light shafts and pools on the road. The car's tail glow on the road is an additive pool, not a light. Lights are never added or removed per frame.
- **Reflection.** Half resolution and redrawn every other frame: the texture keeps the matrix of the view it was drawn from, so a frame-old reflection still lands in place.
- **Post.** Bloom and depth of field at half resolution; the chain merged into four effect passes.
- **Auto quality.** Once the loader is gone, drei's `PerformanceMonitor` drops the canvas to as low as 75% resolution if the frame rate sags under about 52 fps, and climbs back when there is room (a few steps at most; each re-sizes the render targets). `?dpr=` turns it off.
- **No allocations in the frame loop** (the lamp sorts and array literals that made objects every frame are gone), no React re-renders from it (the DOM follows the store through subscriptions), `powerPreference: 'high-performance'`.
- **Warm-up** behind the loader: every shader compiled for the composer's render target, every texture uploaded and a drive through every chapter, so nothing compiles or uploads mid-scroll.

The city is on its own render layer (`CITY_LAYER`), so the car's contact-shadow pass never draws it and the street reflection draws only the city and the sky.

## Files

| File | What it does |
| --- | --- |
| `src/content.ts` | All site copy, the accent colour, the credits |
| `src/lib/chapters.ts` | Chapters and their environments |
| `src/lib/chapterRuntime.ts` | The journey driver; runs the chapters each frame: environment, ignition, stop weights |
| `src/lib/cityRoute.ts`, `cityRoute.data.ts` | The route through the city and over the bridge, the stops, the drive-past billboards |
| `src/lib/cityDrive.ts` | Journey to route metres (parked, the drift, the stops), the drift profile, the car on the route |
| `src/lib/bridgePath.ts` | The deck along the route (shared by the scene and the route check) |
| `src/lib/autoplay.ts` | The Play button's pacing |
| `src/lib/layout.ts` | Screen rectangles of the car and the billboard, for the DOM layout |
| `src/lib/stops.ts` | UI state shared by the stop panels and the billboards, billboard anchors |
| `src/lib/powertrain.ts`, `engineAudio.ts`, `audio/synth.ts` | The rpm model, the mixer, the generated samples |
| `src/lib/motion.ts` | `carState` and the heading helpers |
| `src/lib/config.ts` | Every other tunable plus slider ranges for leva |
| `src/lib/feel.ts` | Body springs, the camera's trauma shake and spring follow, the exhaust pops |
| `src/lib/coldOpen.ts`, `src/components/ColdOpen.tsx` | The cold open after the loader |
| `src/components/Overlay.tsx` | Chapter cards (the title layout solver), hints, the title, credits |
| `src/components/Stops.tsx`, `Extras.tsx` | The stop panels; the drive-past cards |
| `src/components/Navbar.tsx`, `PlayControls.tsx`, `MiniMap.tsx`, `RouteHud.tsx`, `Loader.tsx` | The navbar with Play; the progress bar and cinematic dock; the mini-map; the HUD; the first-load screen |
| `src/scene/Scene.tsx`, `Sky.tsx`, `Warmup.tsx` | Canvas contents, lights, env maps, frame order; the sky dome; the warm-up |
| `src/scene/city/` | The city, its materials and reflection, street lights, billboards, traffic, steam, sea, bridge, edge seal, the camera director, the route debug view |
| `src/scene/Smoke.tsx`, `postfx/SoftSmokeEffect.ts` | Tyre smoke, the wake and spray, and the pass that draws them |
| `src/scene/CameraRig.tsx`, `Effects.tsx` | The camera (via the director) and the post chain |
| `src/scene/Sound.tsx` | Feeds the powertrain and the mixer every frame |
| `scripts/check-route.ts` | The route continuity check (runs before every build) |
| `scripts/optimize-city.mjs`, `city-textures.mjs`, `trim-city.mjs` | Rebuild the city GLB and trim it to the journey (`npm run city` also rebuilds the route and checks it) |
| `scripts/optimize-car.mjs` | Builds the car GLB from `assets/gt3r-source.glb` (`npm run car`) |
| `scripts/build-route.mjs`, `find-walls.mjs` | Finds the route; finds walls for billboards |

## Testing without scrolling

1. Open `/?debug`. In the **Scrub** folder, drag **progress** (global, 0-1 over the whole page): the scene drives there. The chapter buttons and the moments of the opening (engine catches, the flick, mid-drift, in the smoke) set the target; **play 0 to 1** runs the whole page in 60 s. The yellow HUD shows the chapter, the camera rig (and the blend into it), route metre, speed, slip, and the scroll target against what is on screen.
2. Open any folder (**Drive**, **Director**, **City**, **Camera**, **Smoke**, **Car**, **Rain**, **Post** ...) and tune live; **copy config** copies the values as JSON for `config.ts`.
3. Console (debug mode): `__gt3r.store`, `__gt3r.carState`, `__gt3r.chapterState`, `__gt3r.director`, `__gt3r.schedule()` (where the director's drive rigs start, with the slide at each), `__gt3r.warmup` (compile time, textures uploaded).

Chapter environments, the drive, the route and the stops are code, not leva: edit, save, and reload the page (hot reload keeps stale state for the frame loop).

## Model notes

- The car's wheels are separate nodes (`WHEEL_LF/RF/LR/RR`); `Car.tsx` re-pivots each at its hub. Units are metres, +Y up, +Z forward, +X = the car's left.
- The export lost the look; `src/scene/carMaterials.ts` restores it (livery on clear-coated paint from `public/textures/gt3r-livery-4k.jpg`, tinted glass, rubber, rims, calipers).
- `npm run car` (`scripts/optimize-car.mjs`) builds `public/models/gt3r.glb` from `assets/gt3r-source.glb`: it drops what the tinted glass hides (the cockpit, seats, belts, dash, electronics, the inner door panels and the rear-view mirror), keeps the body panels, the wheels as separate nodes, the discs and calipers and the lights, simplifies the big meshes with meshoptimizer to about 130k triangles, and compresses it (WebP textures at 1024 px, KTX2 if the Khronos `toktx` tool is installed; meshopt geometry). `Car.tsx` adds one dark shell behind the glass and a flat undertray. Before/after shots of every camera are in `docs/car-before-after-1.jpg` and `-2.jpg`.

## Credits

- "Porsche 992 GT3 R" by MattDoesBlender on Sketchfab, licensed **CC BY-NC-SA 4.0** (attribution required, non-commercial, share-alike). Modified: interior removed, simplified to about 130k triangles, compressed (`scripts/optimize-car.mjs`); the modified model is shared under the same licence. The credit line is in the page footer.
- "city" by golukumar (mortalityrexotable) on Sketchfab, licensed **CC BY 4.0**: https://sketchfab.com/3d-models/city-2e358ed084524a8f963c146a19637815. Modified: merged by material into tiles, scaled (a lane is 3.5 m), trimmed to 120 m around the route with ten landmark towers as box proxies, compressed (meshopt geometry, WebP textures), and five textures replaced with generated ones (an LED palm atlas, an LED tree card and three shop-sign panels in place of ad posters). Rebuilt by `scripts/optimize-city.mjs`. The credit line is in the page footer.
- Night HDRI: "Shanghai Bund" from Poly Haven (CC0), used for reflections.
- Sound: every sample is generated in code (`src/lib/audio/synth.ts`), see Sound.
- Display font: Unbounded (SIL Open Font License), self-hosted by `next/font`.
