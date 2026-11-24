# AGENTS.md

Notes for anyone working on this repo, people and AI assistants alike.

## How we commit

- **Commit at the end of every response.** If you changed files, they go into a commit before you hand the turn back. Don't leave work sitting around uncommitted.
- **Big change? Break it up.** Commit each logical piece on its own (the 3D scene, the page copy, the styles, the docs) instead of one giant commit. Rule of thumb: if describing it needs "and" twice, it's more than one commit.
- **Small change? One commit is fine.**
- **Write messages the way a person would.** A short first line in plain English that says what changed, like "Add neon posts to the schedule section" or "Stop the camera cutting through the car". Add a line or two underneath only when the reason isn't obvious.
- **Skip the robot voice.** No "This commit implements...", no walls of bullet points, no emoji.
- **Leave things working.** Run `npm run typecheck` before committing code, and `npm run build` after bigger changes.
- **Keep secrets and machine-specific files out.** Never commit `.env*` or `.claude/settings.local.json`.
- **Don't push unless you're asked to.** Pushing is the repo owner's call.

## Good to know before you change things

- Run it with `npm run dev`. Open `/?debug` for the tuning panel, the chapter jump buttons and the HUD, and `/?debug&route` to see the route, its waypoints and the stops.
- All the site copy lives in `src/content.ts` (SITE, ROBOWARS, COMPETITIONS, VOICES, EXPO, TECHEXPO, CATALYST, ALSO, CES2027, HEARTBEAT, TWMUN, plus the chapter lines and UI labels). It's an unofficial concept: every call to action goes to SITE.home, the disclaimer stays in the footer, no organiser phone numbers or emails, no external images or logos, and the speakers are always presented as past speakers.
- The page is an intro, four stops and a finale, and one continuous drive through one world: no cuts, no teleports, no dissolves (only the first-load screen fades). The scroll is a time axis: the speed curve the car drives, the slow zones round each stop and the distance budget live in `src/lib/pacing.ts` (`npm run pacing` prints the budget; rerun it after changing a zone or a stop's metre); each chapter's light, fog, rain and exposure in `src/lib/chapters.ts`; the route, the stops and the drive-past billboards in `src/lib/cityRoute.ts`; route metres from the speed curve and the drift profile in `src/lib/cityDrive.ts`; the camera rigs and their blends in `src/scene/city/director.ts`; everything else tunable in `src/lib/config.ts`.
- The scroll only sets a target: what is on screen drives toward it (`chapterState.progress`, speed and acceleration limited, see `CONFIG.drive`), and the DOM follows `store.view`, not `store.progress`. Never move the car or the camera straight from the scroll, and never snap: a jump has to be a drive.
- The camera never cuts. A new shot is a new rig in `director.ts`; the director blends into it (1.2-2 s) and never changes rig near the peak of a slide.
- Nothing may cover the car. Titles, panels and cards are placed by the layout solver (`src/lib/layout.ts`, `Overlay.tsx`, `Stops.tsx`); only one chapter title is up at a time.
- Anything new that shows up mid-journey has to be warmed up behind the loader (`src/scene/Warmup.tsx`): if it piles up state while the warm-up drives through the chapters, reset it in `onWarmupEnd`.
- The city is an unnamed night city. Don't call it Mumbai (or any real city) in the scene or the copy.
- The city model comes from `npm run city`: `scripts/optimize-city.mjs` builds `assets/city-full.glb`, the route is found on that, and `scripts/trim-city.mjs` trims it to 120 m around the route into `public/models/city.glb`. Change the route by moving the `VIA` points in `scripts/build-route.mjs` and rerunning it; move a stop by changing its `s` in `STOPS` (`scripts/find-walls.mjs` lists the walls a billboard can hang on). If a new shot looks past the trimmed edge, raise `KEEP` in `trim-city.mjs`.
- The car comes from `npm run car` (`scripts/optimize-car.mjs`, from `assets/gt3r-source.glb`). Keep the wheels as separate nodes and keep `TEXCOORD_0` (the livery is applied in code).
- The sound listens to the powertrain model (`src/lib/powertrain.ts`), never to the scroll or the keys directly. Every sample is generated in code; if you add a recorded one, it must be free to use and listed with its licence in the README.
- Everything in the city goes on `CITY_LAYER` (`useCityLayer` in `src/scene/city/City.tsx`). That keeps it out of the car's contact-shadow pass, and it's the only layer the street reflection draws. A raycaster that has to hit the city needs `layers.enableAll()`.
- The route check (`npm run check:route`) runs before every build and fails it on a gap, a ledge or a kink in the road under the route. Keep it green.
- A stop's panel follows its slow zone's progress (title at 0.1, details 0.3-0.7, gone by 0.85); cue new stop content on `progressAtZone`, not on chapter fractions.
- After editing anything the 3D frame loop reads (`pacing.ts`, `chapters.ts`, `cityDrive.ts`, `director.ts`, the runtime files), reload the page. Hot reload keeps stale state around and will fool you.
- Keep every camera between 24 and 40 degrees of vertical FOV. If a shot needs more in frame, move the camera back rather than widening the lens.
- Keep the NaN scrub as the first pass in `Effects.tsx`. The wet-road reflector throws the odd NaN pixel, and bloom turns one of those into a black screen. In custom shaders, don't `pow()` a value that can touch 0 or go negative: on some GPUs that is a NaN that whites out the frame.
- Don't hide or add lights per frame. Changing the light count recompiles every material; turn a light's intensity down to 0 instead. The scene keeps six real lights (two headlights, three street lamps, the billboard spill); fake anything else with emissive or additive pools.
- Camera shake, the follow spring, the speed FOV kick, the body springs and the exhaust pops all live in `src/lib/feel.ts` (the Feel folder in leva). Add new shake sources there as trauma, never as a separate wobble.
- The car model is CC BY-NC-SA 4.0 and the city model CC BY 4.0, so keep both credit lines in the footer.
