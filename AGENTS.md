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

- Run it with `npm run dev`. Open `/?debug` for the tuning panel, the chapter/shot jump buttons and the HUD.
- All the site copy (chapter lines, facts, events, schedule, partners, the accent colour) lives in `src/content.ts`. It's an unofficial concept: every call to action goes to techfest.org, and the "Unofficial concept build" line stays in the footer.
- The page is five chapters. Their scroll lengths, camera beats and each chapter's light, fog, rain and exposure live in `src/lib/chapters.ts`. The drift scene's shots are in `src/lib/script.ts`; everything else tunable is in `src/lib/config.ts`.
- The drift scene (chapter III) is finished. Leave it alone unless someone asks for a change there.
- After editing anything the 3D frame loop reads (`chapters.ts`, `script.ts`, the runtime files), reload the page. Hot reload keeps stale state around and will fool you.
- Keep every camera between 24 and 40 degrees of vertical FOV. If a shot needs more in frame, move the camera back rather than widening the lens.
- Keep the NaN scrub as the first pass in `Effects.tsx`. The wet-road reflector throws the odd NaN pixel, and bloom turns one of those into a black screen.
- Don't hide or add lights per frame. Changing the light count recompiles every material; turn a light's intensity down to 0 instead.
- The car model is CC BY-NC-SA 4.0, so keep the credit line in the footer.
