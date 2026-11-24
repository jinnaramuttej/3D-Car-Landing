# Techfest 2026 (unofficial concept)

Scroll-driven R3F site in one fixed Canvas, told as one continuous drive through one world, fast runs and slow stops: a Porsche 992 GT3 R waits in the rain on a city street at midnight under the Techfest title, wakes up and drifts down a long left-hander, then rolls past four LED billboards at walking pace (The Arena, The Pit Lane, The Stage, The Heartbeat) with a launch out of each, up the ramp onto a bridge and out over the sea as dawn breaks. No cuts, no teleports, no dissolves: only the first-load screen fades. An unofficial concept build for the Build in 3D challenge; every call to action goes to [techfest.org](https://techfest.org).

- **Live site:** _(add the deployed link here)_
- **Recording:** _(add the Google Drive link to the screen recording here)_

```powershell
npm install
npm run dev
```

Open http://localhost:3000 to scroll it (or press **Play**), or http://localhost:3000/?debug for the leva tuning panel and the HUD (add `&route` to see the route, `&s=510` to start at a route metre, `&dpr=1.5` to pin the resolution for measuring).

## Stack

Next.js 16 (App Router, Turbopack), React 19, three.js 0.187 through React Three Fiber 9 and drei 10, postprocessing 6 (@react-three/postprocessing 3), GSAP with ScrollTrigger, Lenis, zustand, leva for tuning, TypeScript. The asset scripts use glTF Transform 4, meshoptimizer and sharp.

**Edit the copy in `src/content.ts`** (SITE, ROBOWARS, COMPETITIONS, VOICES, EXPO, TECHEXPO, CATALYST, ALSO, CES2027, HEARTBEAT, TWMUN, plus the chapter lines and UI labels).

## How it fits together

```
scroll (Lenis) -> ScrollTrigger -> one GSAP timeline -> store.progress (zustand, global 0..1: the target)
   (the Play button moves the scroll itself at a cinematic pace)
                                                         |
  Scene  useFrame(-3)  the playhead chases the target in journey seconds (at most 1.5x real time,
                       slower in a stop's phases; a mini-map glide up to 4x) -> chapterState.progress
                       stepChapters(): chapter, environment, ignition    stepCityDrive(): the car
                       then fog, env map, sun and sky light; writes store.view for the DOM
  Car    useFrame(-2)  applies it to the model, publishes tyre contacts and the headlight beams
  Smoke / Rain / SkidMarks / city / CameraRig / Sound / Interaction  useFrame(-1)
                       CameraRig: the director picks and blends rigs, then publishes where the car
                       and the billboard are on screen (src/lib/layout.ts)
  city reflection  useFrame(-0.5)  renders the mirrored street every other frame
  Effects  composer, priority 1 (the smoke has its own pass in it)
  Overlay + Stops (DOM)  paused GSAP timelines that follow store.view, and a layout
                       loop that keeps titles and panels off the car
```

## The journey

The scroll is a time axis. `src/lib/pacing.ts` keys a speed curve v(t) along it (eased between keys with smoothstep, so there is no jolt at a key) and integrates it into metres along the one route, s(t); global progress is t / 179 s. Scrolling at an even pace and the Play button give the same drive, and everything that moves with the car (wheel spin, the rpm and the sound, the rain streaks, the FOV kick, motion blur, the camera shake) reads the car's actual speed, which is that integral. `src/lib/chapterRuntime.ts` eases every environment value (rain, fog, light colour, exposure, sky, sun, lamps) so nothing jumps, and steps the **playhead** (`src/lib/playhead.ts`) on top: the scroll sets a target journey time, and what is on screen chases it at no more than 1.5x real time either way, so a flick of the wheel plays the stops through, a little quicker than their own pace, instead of skipping them. See [The playhead](#the-playhead).

## The playhead

- **The scroll.** The track is 250 px of scroll per second of the journey (`PX_PER_SECOND` in `chapters.ts`), so a wheel notch of about 100 px is 0.4 s of it, whatever the window's height.
- **Chase.** The playhead (journey seconds on screen) chases the scroll's target at up to `CONFIG.playhead.chase` (1.5x) with a limited acceleration, and brakes in time so it never overshoots. A full flick from top to bottom plays the whole 179 s journey in about 128 s.
- **Dwell.** Every cue that must be read has a window and a minimum (`cueWindows()`): each stop's title (1.5 s), details (4 s) and way out (1.2 s) phases, each title card (1.2 s) and the finale's card (1.5 s). Inside a window the playhead runs no faster than that window's length over its minimum (1.2x to 1.47x), braking ahead of it, so at the fastest every cue is still up for its minimum.
- **Glide.** The mini-map and the brand move the scroll in one go and start a glide (`glideTo`): up to 4x with the titles and panels hidden (`html[data-glide]`), down to 1x as it reaches the destination's slow zone, where they come back. Any hand on the scroll mid-glide takes over.
- **Magnet.** When the scroll rests up to 2.5 s short of a stop's title cue, the target eases onto the cue (fully within 1 s of it, fading out by 2.5 s). It only draws from the approach: a scroll resting inside a stop stays where it is. No snapping.
- **Test.** `npm run test:pacing` (and every build) plays the playhead and the car through Node at 60 fps: a flick to the end, a flick back, a steady wheel scroll, a mini-map glide and a scroll resting before each stop. It fails if any cue is up for less than its minimum, a glide shows anything on the way, the rate goes over its limit, or a wheel leaves the road.

**Cold open** (`src/lib/coldOpen.ts`, `ColdOpen.tsx`): as the loader fades, three seconds of black; the engine wakes in the dark (tail lights, an exhaust pop, a jolt of the lens, the starter if the sound is on), the headlights flicker on as the black lifts, then the Techfest title forms and the controls come in, and the lights ease back to the parked car's. Every load starts at the top with it: the browser's scroll restoration is off (`layout.tsx`, `useScrollTimeline.ts`).

| # | Section | Route metres | What happens |
| --- | --- | --- | --- |
| 00 | Techfest 2026 | 40 to 268 | Parked on the north arc under the Techfest title (edition, dates, venue, the CTA); the engine catches and the car pulls away; the first slide, round the north-east corner at 72 km/h, in heavier rain |
| 01 | The Arena | 396 to 426, board 420 | Down the east road. Robowars: prize pool and weight classes (pick a class and the billboard follows), the stats count up, the international zonals |
| 02 | The Pit Lane | 536 to 566, board 560 | Round onto the south ring. The seven competitions as lanes sliding past; filter chips re-flow them and re-sort the billboard |
| 03 | Catalyst | 902 to 928, board 922 | West along the whole south ring and up the west curve. Campus modules (due 30 Nov 2026), the National Leadership Summit & Pitch (16-18 Dec), the ₹1,00,000 seed fund |
| 04 | Workshops & TWMUN | 1314 to 1344, board 1338 | After the U-turn in the cross-street junction (the second slide, from the drone) and back down the elevated carriageway. Hands-on workshops (techfest.org/workshops) and Techfest World MUN's committees |
| 05 | The Stage | 1440 to 1470, board 1468 | Up the slip onto the ramp. Past speakers first (the categories turn over until you pick one), then the TechExpo / Ignite exhibits brought to campus before |
| 06 | The Heartbeat | 1680 to 1706, board 1700 | Where the ramp turns for the bridge. The DKMS stem cell donor drive: the slowest and quietest stop, a soft heartbeat in light and sound, a 3-minute ring timer |
| Fin | Finale | 1706 to 2148 | Over the flyover and the sea at 100 km/h as dawn breaks and the rain stops; the car rolls to a stop under the far pylon: the one CTA (techfest.org) and a compact row (CES 2027, the keynotes, the closing night) |

**Slow zones.** Each stop is a zone of route metres around its billboard: the car brakes in to 15 km/h, rolls past the board at 8-9 km/h, and launches out. The stop's panel follows the zone's progress p (0 as the car rolls in, 1 as it launches): the title at 0.1, the details staggered from 0.3 to 0.7, everything gone by 0.85. The car reaches its board near the end of the zone (about 0.8): the boards hang about 20 m off the road, so while the panel plays out the board is still ahead of the camera, not beside it.

**Lane dashes.** On the runs the road's paint (lane dashes, edge lines, crossings) brightens and shimmers round the car with its speed, and motion blur, a little longer at speed, smears it into streaks; nothing at walking pace (`CONFIG.city.dashGlow`, a few operations in the road shader, no extra texture reads).

**Launch burst.** Braking into a zone: a downshift with a rev-matching blip. Leaving it: full throttle (the gear changes and the exhaust pops follow from the powertrain), a spike of camera trauma, the lens kicking 5 degrees wider and the frame streaking for a moment (`CONFIG.feel.launch*`).

**Distance budget** (`npm run pacing`): runs cruise at 90 km/h (8 m/s2 up, 9 m/s2 braking) and slow for the corners they can't take flat (`CORNERS`: the first slide's corner at 72 km/h, the hard right off the east road at 38, the U-turn at 36, the flyover's bends at 56); the bridge at 100 km/h.

| Leg | Route metres | Metres | Seconds | Top speed |
| --- | --- | --- | --- | --- |
| Parked: title, ignition | 40 | 0 | 7.5 | 0 |
| Run to The Arena (the first slide on the way) | 40-396 | 356 | 17.4 | 90 km/h |
| The Arena | 396-426 | 30 | 10.3 | 15, slowest 9 km/h |
| Run | 426-536 | 110 | 8.2 | 90 km/h |
| The Pit Lane | 536-566 | 30 | 10.3 | 15, slowest 9 km/h |
| Run (the south ring) | 566-902 | 336 | 15.5 | 90 km/h |
| Catalyst | 902-928 | 26 | 9.0 | 15, slowest 9 km/h |
| Run (the U-turn on the way) | 928-1314 | 386 | 23.1 | 90 km/h |
| Workshops & TWMUN | 1314-1344 | 30 | 10.4 | 15, slowest 9 km/h |
| Run | 1344-1440 | 96 | 5.9 | 90 km/h |
| The Stage | 1440-1470 | 30 | 10.8 | 15, slowest 8.5 km/h |
| Run | 1470-1680 | 210 | 10.5 | 90 km/h |
| The Heartbeat | 1680-1706 | 26 | 10.4 | 12, slowest 8 km/h |
| Run over the bridge | 1706-2138 | 432 | 20.4 | 100 km/h |
| Finale: roll to a stop, hold | 2138-2148 | 10 | 9.5 | 12 km/h |
| Total | | 2108 | 179.3 | |

The drive uses 1766 m of the 1806 m city route and 341 m of the 760 m bridge. The usable facades within 15 m of the road come in three clusters (the north arc, the east road and the turn onto the south ring, the slip and the ramp), so two runs are short and the long ones carry the slides.

## Play and cinematic mode

**Play** in the navbar (or a tap of **Space**) drives the whole journey by itself in about 179 s: it runs the journey's time axis at real time, so the car drives exactly the planned speed curve (`src/lib/autoplay.ts`), and every title, billboard and panel comes and goes on its own cue because autoplay simply moves the scroll. An even scroll by hand gives the same pacing. Tap Space again to pause; any scroll by hand (wheel, touch, keys, the scrollbar, the mini-map) takes the wheel back, smoothed by the playhead. A progress bar runs along the top. **Cinematic mode** (the film-frame button) brings in 2.39:1 bars (the lens widens over the same 0.9 s, so the strip between them keeps the whole shot) and hides the navbar and the mini-map; a small dock with play/pause and Exit wakes up on mouse movement, and Esc leaves it.

## The city

- **Model.** "city" by golukumar (CC BY 4.0, credit below and in the footer), rebuilt by `npm run city`: `scripts/optimize-city.mjs` scales it so a lane is 3.5 m (58.3 m per source unit), joins it by material into a 2 x 2 grid of tiles, welds it, WebP textures (max 512 px), meshopt geometry, into `assets/city-full.glb`; the route is found on that; then `scripts/trim-city.mjs` keeps every connected piece that comes within 150 m of the route (or the bridge) and swaps the rest for ten tall landmark towers as box proxies, into `public/models/city.glb`. The two oversized pasted textures (a palm atlas and a tree card) are replaced by generated LED textures (LED palm trees and fairy-light trees), and three ad posters with faces and logos by generated shop signs (`scripts/city-textures.mjs`). Each material is tagged with what the scene does with it (`road:`, `window:`, `sign:` ...).

  | | Source (`Untitled.glb`) | Rebuilt (`assets/city-full.glb`) | Trimmed (`public/models/city.glb`) |
  | --- | --- | --- | --- |
  | File size | 21.2 MB | 5.7 MB | 5.6 MB |
  | Draw calls (primitives) | 2780 | 272 | 273 |
  | Triangles | 207 499 | 207 499 | 206 400 |
  | Textures | 100 PNG, 6.0 MB | 100 WebP, 1.0 MB | 100 WebP, 1.0 MB |

  (At 120 m round the old 850 m route the trim kept 71% of the city and cut the north-east, the east road's north half and the north arc east of the interchange; the longer route needs nearly all of it.) At run time each mesh is one material over a quarter of the city: besides the frustum culling, a mesh wholly past where the fog is all but opaque is hidden (`City.tsx`; 100-180 of the 273 at a time in the city, all of them out over the sea).

- **Route.** `scripts/build-route.mjs` rasterises the model's road surfaces, runs A* between via points along the middle of each carriageway (it cannot fall off a flyover onto the road below), smooths the path, raycasts the real road height under each point, finds the holes in the model's road (patched in the scene) and its open road ends, and writes `src/lib/cityRoute.data.ts`. The drive goes most of the way round the city's loop, 1806 m: east along the north arc from just past the tangled interchange at the top (where the arc drops into an underpass beside a ramp and a plaza: the route stays out of it), round the north-east corner and down the east road, right onto the south ring and all the way west along it, up the west curve's inner carriageway, round a U-turn in the cross-street junction, back down the outer carriageway on its own deck, and up the slip onto the ramp and the flyover. A turn the search can't make is drawn (`DRAWN`): the U-turn is a teardrop (a 6 m swing right, an 8 m loop left, a swing right) between straight run-ins, its curvature blended and sampled every metre, and the search's smoothing narrows toward it so the two meet without a step. `src/lib/cityRoute.ts` adds the bridge, the stops and the world placement (`CITY_ORIGIN`). The bridge deck (`src/lib/bridgePath.ts`, built by `Bridge.tsx`) starts over the end of the flyover on the same curve, so the ramp runs straight onto it with no step and no kink. **To fix the route**, open `/?debug&route`; move the `VIA` points in `scripts/build-route.mjs` and run it again; `node scripts/map-city.mjs map.png` surveys the whole city's roads (centre lines, junctions, flyovers, underpasses) and draws the route over them.
- **Route check.** `npm run check:route` (and automatically before every `npm run build`) walks the route, the ramp and the deck every 25 cm against the real geometry and fails on a gap, a ledge over 8 cm, the route more than 8 cm off the road, or a turn over 3 degrees between samples. Current output: `OK`, with one note (a 6 cm step at s 1417-1424 on the slip up to the ramp).
- **The car's corridor.** `scripts/clear-corridor.ts` (part of `npm run city`, after the trim) sweeps the car's box along the whole drive with three-mesh-bvh: 2.6 m wide, 0.2 to 2.8 m above the road, at every pose the scene drives it through (slides included) and on the route line itself; the backdrop's facade cards get a wider berth (9 m, up to 30 m over the road). A small piece in the way goes whole; a big one is cut back. Where it cut a kerb, it lays a road strip under the cut and a row of concrete barriers just outside the corridor (`CorridorBarriers.tsx`). It also lays strips under any gap in the road a wheel finds (scanned every 5 cm; the wheels bridge hairline cracks between tiles by themselves), measures each strip's height on the road itself, and settles the route line onto the road where it had been measured on a kerb. It writes `src/lib/corridor.data.ts`, and a second run changes nothing. What it takes out on this route: a post on the slip at 1373 m and the nose of a median beside it (a road strip and a barrier go in), the backdrop box standing across the flyover's end at the bridge approach (1794-1800 m: the car drove through its wall) and a card hanging over the bridge entrance (1816-1820 m). It also looks at each stop's board from where the camera faces it (the across shot) and takes out signs and cut-out cards hanging in between: two restaurant signs and a card in front of the Pit Lane's board (a building in the way is only reported). `npm run check:corridor` (and every build) sweeps it again and fails if anything but road is inside.
- **Edges.** `EdgeSeal.tsx` closes the map: a fog wall round the land (open to the sea), and concrete barriers with blinking lights and a fog card across every road the model leaves open.
- **Stops.** `STOPS` in `cityRoute.ts`: six billboards, each on a clear flat, road-facing wall within 15 m of the road's edge that `scripts/find-walls.mjs` finds along the route (420, 560, 922, 1338, 1468 and 1700 m; Catalyst's wall only takes a 12 x 6.75 m board), and the finale's on the far pylon. Each billboard finds its wall with a raycast (`Billboards.tsx`) and stands on legs if it can't. A high board on the car's side of the road has `across: true`: while its panel plays the camera crosses the road and turns to face it, the lens sized so the whole board fits (the Arena, the Pit Lane, Catalyst, the Stage). The Stage's first wall on the ramp had a terrace awning in front of it; it sits on the clean facade before it. The drive-past boards (Also at Techfest over the bridge, CES 2027 on the first pylon) stay as scenery for the finale.
- **Night and rain** (`src/scene/city/cityMaterials.ts`). Surfaces darken at night; up-facing ones get wet and pool into puddles (bigger in some stretches than others, with damp rims); roads, pavements and the sea take one shared planar reflection (`cityReflection.ts`, desktop only). Windows light up floor by floor, signs glow (one in eight is a failing tube that stutters), the LED trees glow; sodium lamps line the route with a cone of light through the rain under each and three real lights following the camera (`StreetLights.tsx`); steam drifts up from street grates (`Steam.tsx`); distant traffic runs along the roads well away from the car (`Traffic.tsx`); towers fade into a cloud layer and the air at street level is a little hazier than the fog alone (`src/scene/fogLayers.ts`).
- **Billboards** (`Billboards.tsx`, `billboardArt.ts`). Each board's content is drawn to a canvas (text and shapes only) and turned into LEDs by a shader that blooms; it wakes up row by row as the car approaches and sleeps once the car is well past; the active stop's board spills its colour on the street. Phones: text only, no LED shimmer.
- **Sea and bridge** (`Sea.tsx`, `Bridge.tsx`). Dark water with a slow swell that bends the reflection; a cable-stayed bridge built from code (deck with solid parapets and rails, two H-pylons, instanced stay cables, blinking aviation lights, lamp rows, piers).

## Ground contact

- **Wheels.** Each frame a ray goes down from each of the four wheels onto the road surfaces only (the model's `road:` and `ground:` materials, the bridge deck and the road strips: never kerbs, barriers or walls), through three-mesh-bvh (`src/lib/ground.ts`). The car's height, pitch and roll are a plane fitted to the four hits; the twist the plane can't follow goes into each wheel's suspension (up to 8 cm).
- **Body.** The body follows that plane on a 1.5 Hz spring, well damped, with small acceleration effects on top: squat (nose up) up to 1.5 degrees, dive (nose down) up to 2, roll up to 3 in a corner (`src/lib/feel.ts`, the Feel folder). Slides are trimmed so the tail stays over the road (`fitToRoad` in `cityDrive.ts`) and damped in journey time, so they take the same shape at any playback rate.
- **Reflection and pools.** The street reflection's mirror is the road under the car, tilted with it (`cityReflection.ts`), and the lamp pools lie on the road's own slope, so neither hovers over the street on a climb.
- **Check.** `npm run check:contact` (and every build) drives the whole journey every 10 cm with the scene's own code and fails if a wheel finds no road or stands more than 5 cm off it past its travel. Current output: `OK`, the largest twist a wheel takes up 1.7 cm.
- **The camera's sphere** (`src/lib/collide.ts`): a 0.35 m sphere swept half a second ahead along the camera's path, tested against the city's solid geometry (not the road, not see-through cards such as foliage and cut-out plants). If it would touch, the camera is drawn toward what it looks at on a spring, never closer than 2.6 m to it.

## The camera

`src/scene/city/director.ts` is the one camera for the whole page: **rigs** (each a pose that follows the car, or a place in the world it looks from) and **blends** between them. When it changes rig, the camera travels from where it is to the new rig over 1.2-2 s (`CONFIG.director`), eased, round the car, or over it like a crane where the street is too narrow, while both rigs keep tracking the car. It never changes rig near the peak of a slide.

- **opening** (the intro): keyed to the scroll while the car is parked (up the street, in along the flank to the headlight as it wakes), then to route metres (a camera car ahead as it pulls away and slides through the plaza and down the long left-hander).
- **wake** (after the drift): trailing well back on the road, low, through the smoke, closing up as it thins.
- **stop**: each slow zone is one rolling shot keyed to the zone's progress p: low (0.7 m) on the far side of the road, trailing the car on a side three-quarter (12 m back, easing out to 15.5 m) so the car stays a steady size as it rolls at walking pace. The camera rides forward with it, a slow push-in toward the billboard: as the details come up the look leans across to the board (as far as keeps the whole car in frame and clear of the panel) while the lens opens from 30 to 37 degrees, and the focus pulls from the car to the board; by 0.85 it is back on the car for the launch. The Stage's facade stands 22 m off the road and there is no closer clear wall, so its shot goes further: from 0.2 the camera cranes forward and across to the far side of the road, rises to 3.5 m and turns to face the board, the lens sized from the board's corners so the whole board sits in the right 60% of the frame (the panel has the left), pushing in a little while it holds; from 0.76 it settles back behind the car for the launch. Its title leaves at 0.26 to make way. The finale has a fixed place down the deck, the car rolling to a stop under its pylon.
- **launch, wheel, chase**: the runs between stops are 4-second bursts, so they get the low ones: the launch chase (0.55 m up, 11 m back, a 26 degree lens, the road rushing under it) and the wheel camera. Over the bridge: the drone, a side pan past the pylon, the wheel, the hood. **Hold C** (or the navbar camera button) to step through them; the director takes over again 6 s after the last press.

Every lens stays within 24-40 degrees (a wider ask moves the camera back), and no camera goes under the road or through a wall: each is checked against the road and the street's walls at its own place along the route.

**Feel** (`src/lib/feel.ts`, the **Feel** folder in leva):

- **Shake by trauma.** Trauma (0-1) builds with hard acceleration and braking, slides, gear changes, bumps and exhaust pops, and decays; the lens shakes by trauma squared through three layers of simplex noise (a small position and roll offset). Stop cameras don't shake.
- **Spring-damped follow.** Car-relative rigs hang off the car on a spring: the camera falls back a little as the car pulls away and swings out in corners. A hood camera is bolted on; cameras standing in the street don't follow.
- **Speed kick.** The lens opens a few degrees with speed and a little more while the car pulls hard.
- **Body on springs.** Pitch (squat under power, dive on the brakes), roll in corners and heave over crests and the road's texture, each a spring-damper driven by the car's acceleration; the slide's own roll on top.
- **Lights and pops.** Brake lights on deceleration; exhaust pops (a flash at the tailpipes and a red glow on the road) on the same powertrain lifts and upshifts the audio pops on; wheel spin from the ground speed.

## Layout

Nothing covers the car. The 3D frame publishes the car's and the billboard's screen rectangles every frame (`src/lib/layout.ts`), and the DOM places things round them (`Overlay.tsx`, `Stops.tsx`):

- **One title at a time**, small, in whichever slot (top-left, top-right, upper-centre, lower-left) keeps it off the car, the billboard and the stop's panel. It fades at speed, and at a stop it waits until the camera has settled. Its words rise out of masks as it arrives, with a little depth parallax on the pointer.
- **Stop panels** follow their slow zone (in at 0.1, the details from 0.3 to 0.7, gone by 0.85) and take the side that keeps the car clear; once the camera has settled on the stop the title keeps off them too, and the competitions strip opens only at the stop. Panels over the canvas are solid and semi-transparent (no backdrop blur, which would re-read and blur the WebGL frame under every panel each frame).
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

**Production build, real time** (2026-11-24, after the fixes below, `next start`, `/?dpr=1.5` at 1897 x 1080, no debug overlay, the Play button driving the journey, every `requestAnimationFrame` callback timed for CPU and wrapped in an `EXT_disjoint_timer_query_webgl2` query for GPU; the display refreshes at 144 Hz, so a frame lands on 6.9, 13.9 or 20.8 ms, most of them on the first): frame interval mean / 95th / 99th percentile, the share of frames over 16.7 ms, then CPU and GPU per frame, mean / 95th percentile.

| Chapter | Frame interval (ms) | Over 16.7 ms | CPU (ms) | GPU (ms) |
| --- | --- | --- | --- | --- |
| 00 Intro (parked, the first slide) | 9.4 / 14.0 / 20.8 | 1.2% | 7.4 / 10.2 | 9.1 / 10.8 |
| 01 The Arena | 10.3 / 14.0 / 20.9 | 1.9% | 8.1 / 12.2 | 9.5 / 13.5 |
| 02 The Pit Lane | 9.7 / 14.0 / 14.1 | 0.6% | 7.4 / 10.7 | 9.3 / 11.3 |
| 03 Catalyst | 9.4 / 14.0 / 14.2 | 0.6% | 7.3 / 10.4 | 9.1 / 10.9 |
| 04 Workshops & TWMUN (the U-turn on the way) | 10.0 / 14.0 / 20.6 | 1.0% | 8.0 / 11.3 | 9.5 / 12.7 |
| 05 The Stage | 11.2 / 14.1 / 20.9 | 4.4% | 9.0 / 13.6 | 10.1 / 14.9 |
| 06 The Heartbeat | 11.0 / 20.9 / 21.0 | 6.6% | 8.7 / 14.1 | 9.5 / 14.4 |
| Fin Finale | 8.0 / 14.0 / 14.1 | 0.2% | 5.8 / 9.2 | 7.5 / 10.1 |
| The whole journey | 9.6 / 14.0 / 20.9 | 1.7% | 7.5 / 11.5 | 9.0 / 12.5 |

(One run, the page focused throughout. The Stage's last seconds and the run up to the Heartbeat took a 3 s burst of 12-13 ms CPU frames that a rerun of that stretch didn't repeat, something else on the machine: rerun, the second half of the Stage is 9.8 / 14.0 / 20.9 ms with 1.9% of frames over 16.7 ms and the Heartbeat 9.6 / 14.0 / 20.9 ms with 1.3%.) After the scripts, the browser's own style, layout and paint take 0.9 ms a frame (95th percentile 1.5 ms).

The Workshops & TWMUN slow zone was the heaviest stretch: frame interval 11.6 / 20.8 / 27.8 ms, 6.2% of frames over 16.7 ms, the CPU's 95th percentile at 14.5 ms. Its stop looks across the open middle of the city, so 180 of the city's 273 meshes are inside the fog's reach there (87 at the Heartbeat): about 1.5 ms more CPU a frame for the extra draw calls, which left it at the edge of a frame. Three things tipped it over, each paid on every chapter: the street reflection saw two fewer lights than the main pass, so three worked out every city material's program again twice a reflection frame (about 1 ms); the Heartbeat's hidden clock rewrote its text every frame, which re-laid out every stop panel (1.7 ms a frame, the whole journey); and custom properties eased on the containers (`--gate` on `.stops`, which did nothing, and `--gate` and the parallax on `.cards`) restyled every panel and card each frame while a stop's title came in (2-3 ms for a second or two). With those fixed the zone is 10.4 / 14.0 / 20.8 ms, 1.2% of frames over 16.7 ms, CPU 8.4 / 11.4 ms. Stepping frames by hand back to back (no display pacing) roughly doubles both timers; with a fence between hand-stepped frames the GPU time matches real time (9.2 ms median over the intro and the Arena).

 `/?debug&dpr=1.5`, 1897 x 1080, the debug overlay on, another session rendering on the same machine): CPU time per frame at rest at each stop, mean / 95th percentile: the Arena 10.7 / 14.3 ms, the Pit Lane 10.5 / 15.5, Catalyst 10.5 / 15.2, Workshops & TWMUN 14.6 / 23.6, the Stage 13.7 / 19.4, the Heartbeat 13.0 / 16.5, the bridge approach 11.6 / 14.8. Driving the whole journey at the playhead's limit, the chapters average 9.7-15.1 ms with 95th percentiles of 15-23 ms. Draw calls per frame (every pass: the scene, the reflection, the post chain) run 250-430 at the stops, with 100-180 of the city's 273 meshes hidden in the fog. `gl.finish()` turned out not to wait for the GPU here, so these and the older numbers below are CPU-side; the GPU's own time wasn't measured.

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

The chapters above are the earlier eleven-chapter layout. The same measurement on the four-stop drive, by zone (median / 90th percentile): parked under the title 9.6 / 13.1 ms, the drift 10.3 / 14.0, the run after it 13.8 / 18.8, The Arena 14.2 / 17.8, a run between stops 13.5 / 16.1, The Pit Lane 12.4 / 16.1, The Stage 10.6 / 14.7, The Heartbeat 11.4 / 14.4, the bridge 7.7 / 10.1, the finale 6.9 / 8.3.

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
- **Six real lights.** A pool of three lamp lights moves to the lamps nearest what the camera looks at; the rest are emissive heads, light shafts and pools on the road. The car's tail glow on the road is an additive pool, not a light. Lights are never added or removed per frame, and every pass that draws the scene sees the same ones (the headlights are on the city's layer too, for the street reflection).
- **Reflection.** Half resolution and redrawn every other frame: the texture keeps the matrix of the view it was drawn from, so a frame-old reflection still lands in place.
- **Post.** Bloom and depth of field at half resolution; the chain merged into four effect passes.
- **Auto quality.** Once the loader is gone, drei's `PerformanceMonitor` drops the canvas to as low as 75% resolution if the frame rate sags under about 52 fps, and climbs back when there is room (a few steps at most; each re-sizes the render targets). `?dpr=` turns it off.
- **The DOM only when something changed.** The per-frame loops (the layout solvers, the HUD, the Heartbeat timer, the play clock) write only what changed, and only while their element is on screen. A value that eases every frame sits on the element that reads it, or is registered as not inherited (`@property`): never on a container, where each change restyles every panel under it.
- **No allocations in the frame loop** (the lamp sorts and array literals that made objects every frame are gone), no React re-renders from it (the DOM follows the store through subscriptions), `powerPreference: 'high-performance'`.
- **Warm-up** behind the loader: every shader compiled for the composer's render target, every texture uploaded and a drive through every chapter, so nothing compiles or uploads mid-scroll.

The city is on its own render layer (`CITY_LAYER`), so the car's contact-shadow pass never draws it and the street reflection draws only the city and the sky.

## Files

| File | What it does |
| --- | --- |
| `src/content.ts` | All site copy, the accent colour, the credits |
| `src/lib/pacing.ts` | The speed curve on the journey's time axis, integrated into route metres; the slow zones; `npm run pacing` prints the budget |
| `src/lib/chapters.ts` | Chapters (spans of the time axis) and their environments |
| `src/lib/chapterRuntime.ts` | Steps the playhead and runs the chapters each frame: environment, ignition, stop weights |
| `src/lib/playhead.ts` | The playhead: the chase, the cues' dwell, the glide, the magnet |
| `src/lib/ground.ts`, `collide.ts` | The wheels' rays onto the road and the plane fitted to them; the camera's collision sphere and the debug box (three-mesh-bvh) |
| `src/lib/corridor.data.ts`, `corridorBlocks.ts` | What the corridor sweep cut, the road strips, the barrier lines (generated); where the barrier blocks stand |
| `src/lib/cityRoute.ts`, `cityRoute.data.ts` | The route through the city and over the bridge, the stops, the drive-past billboards |
| `src/lib/cityDrive.ts` | Journey to route metres (through pacing.ts), the drift profile, the car on the route |
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
| `src/components/Stops.tsx` | The stop panels (each follows its slow zone) and the finale's CTA and More at Techfest row |
| `src/components/Navbar.tsx`, `PlayControls.tsx`, `MiniMap.tsx`, `RouteHud.tsx`, `Loader.tsx` | The navbar with Play; the progress bar and cinematic dock; the mini-map; the HUD; the first-load screen |
| `src/scene/Scene.tsx`, `Sky.tsx`, `Warmup.tsx` | Canvas contents, lights, env maps, frame order; the sky dome; the warm-up |
| `src/scene/city/` | The city, its materials and reflection, street lights, billboards, traffic, steam, sea, bridge, edge seal, the camera director, the route debug view |
| `src/scene/Smoke.tsx`, `postfx/SoftSmokeEffect.ts` | Tyre smoke, the wake and spray, and the pass that draws them |
| `src/scene/CameraRig.tsx`, `Effects.tsx` | The camera (via the director) and the post chain |
| `src/scene/Sound.tsx` | Feeds the powertrain and the mixer every frame |
| `scripts/check-route.ts`, `check-contact.ts`, `check-corridor.ts`, `test-pacing.ts` | The route continuity check, the wheels on the road, the corridor clear, the fast-flick pacing test (all run before every build) |
| `scripts/clear-corridor.ts`, `scripts/lib/` | Clears the car's corridor through the city model (`npm run city`); the shared city loader and corridor sweep |
| `scripts/optimize-city.mjs`, `city-textures.mjs`, `trim-city.mjs` | Rebuild the city GLB and trim it to the journey (`npm run city` also rebuilds the route and checks it) |
| `scripts/optimize-car.mjs` | Builds the car GLB from `assets/gt3r-source.glb` (`npm run car`) |
| `scripts/build-route.mjs`, `find-walls.mjs`, `map-city.mjs` | Finds the route (via points, drawn turns); finds walls for billboards; surveys the city's roads and draws the route over them |

## Testing without scrolling

1. Open `/?debug`. In the **Scrub** folder, drag **progress** (global, 0-1 over the whole page): the scene drives there. The chapter buttons, the moments of the intro (engine catches, the flick, mid-drift, in the smoke) and each zone's billboard set the target; **play 0 to 1** runs the whole page in 60 s. The yellow HUD shows the chapter, the camera rig (and the blend into it), route metre, journey time, the zone and its progress, speed, the wheels' contact and twist, whether anything is inside the car's box, the camera sphere, the scroll target against what is on screen and the playback rate (with GLIDE or magnet when they act). In the scene: the car's box (green, red with the triangles inside it), the four wheel rays and where they hit (magenta for a wheel that found no road). `?s=510` starts at a route metre; `[` and `]` jump 10 m (with Shift, 50 m).
2. Open any folder (**Playhead**, **Director**, **City**, **Camera**, **Smoke**, **Car**, **Rain**, **Post** ...) and tune live; **copy config** copies the values as JSON for `config.ts`.
3. Console (debug mode): `__gt3r.goS(510)` (glide to a route metre), `__gt3r.playhead`, `__gt3r.cameraCollision`, `__gt3r.carContact`, `__gt3r.store`, `__gt3r.carState`, `__gt3r.chapterState`, `__gt3r.director`, `__gt3r.schedule()` (where the director's drive rigs start, with the slide at each), `__gt3r.warmup` (compile time, textures uploaded).

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
