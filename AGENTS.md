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

- Run it with `npm run dev`. Open `/?debug` for the tuning panel, the chapter/shot jump buttons and the HUD, and `/?debug&route` to see the city route, its waypoints and the stops.
- All the site copy lives in `src/content.ts` (SITE, ROBOWARS, COMPETITIONS, VOICES, EXPO, HEARTBEAT, TWMUN, plus the chapter lines and UI labels). It's an unofficial concept: every call to action goes to SITE.home, the disclaimer stays in the footer, no organiser phone numbers or emails, no external images or logos, and the speakers are always presented as past speakers.
- The page is eleven chapters and a finale. Their scroll lengths, the I/II/IV camera beats and each chapter's light, fog, rain and exposure live in `src/lib/chapters.ts`. Chapters I-IV are on the waterfront; V onwards is the city stage: the route and the stops are in `src/lib/cityRoute.ts`, the drive in `src/lib/cityDrive.ts`, the camera in `src/scene/city/director.ts`. The move between the two stages happens inside the cloud at the end of IV, never as a cut. The drift scene's shots are in `src/lib/script.ts`; everything else tunable is in `src/lib/config.ts`.
- The city is an unnamed night city. Don't call it Mumbai (or any real city) in the scene or the copy.
- The city model comes from `scripts/optimize-city.mjs` (`npm run city` rebuilds it and the route). Change the route by moving the `VIA` points in `scripts/build-route.mjs` and rerunning it; move a stop by changing its `s` in `STOPS` (`scripts/find-walls.mjs` lists the walls a billboard can hang on).
- The sound listens to the powertrain model (`src/lib/powertrain.ts`), never to the scroll or the keys directly. Every sample is generated in code; if you add a recorded one, it must be free to use and listed with its licence in the README.
- Everything on the city stage goes on `CITY_LAYER` (`useCityLayer` in `src/scene/city/City.tsx`). That keeps it out of the car's contact-shadow pass, and it's the only layer the street reflection draws.
- The drift scene (chapter III) is finished. Leave it alone unless someone asks for a change there.
- After editing anything the 3D frame loop reads (`chapters.ts`, `script.ts`, the runtime files), reload the page. Hot reload keeps stale state around and will fool you.
- Keep every camera between 24 and 40 degrees of vertical FOV. If a shot needs more in frame, move the camera back rather than widening the lens.
- Keep the NaN scrub as the first pass in `Effects.tsx`. The wet-road reflector throws the odd NaN pixel, and bloom turns one of those into a black screen.
- Don't hide or add lights per frame. Changing the light count recompiles every material; turn a light's intensity down to 0 instead.
- The car model is CC BY-NC-SA 4.0 and the city model CC BY 4.0, so keep both credit lines in the footer.
