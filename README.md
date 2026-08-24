# Breakroom Pool

A procedural, multiplayer browser pool game with open or private 8-ball and 9-ball rooms, authoritative 3D-aware physics, English and elevated-cue techniques, selectable trajectory aids, ranked and casual racks, persistent progression, shot clocks, reconnectable guest seats, and configurable practice modes.

Every visual is generated at runtime from Canvas primitives, CSS color/gradient layers, filters, and inline vector markup. The project contains no raster image or audio assets.

## Run locally

Requirements: Node.js 22.13 or newer and npm.

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:5173`. The game server runs on port `3001` and Vite proxies real-time traffic to it.

Useful commands:

```bash
npm run typecheck
npm run lint
npm test
npm run test:ops
npm run build
npm start
npm run test:e2e
```

The default browser suite covers Chromium, Firefox, and a touch-enabled Chromium phone profile. On a host with Playwright's WebKit system dependencies installed, run `PLAYWRIGHT_WEBKIT=1 npm run test:e2e` to add the Safari-compatible engine.

`npm start` serves the production client and Socket.IO endpoint from the same Node process after `npm run build`.

## Controls

- Move or drag across open cloth to aim.
- Adjust strike velocity with the power rail, or hold the right mouse button and pull back to set power before releasing to strike. Use the English pad for top, draw, and side spin.
- Set English and cue elevation manually for jump, swerve, and massé shots; the instrument panel identifies the closest technique from those settings.
- Drag the cue ball when ball-in-hand is active. Opening-break placement is restricted behind the head string.
- Keyboard: Left/Right (or `A`/`D`) changes aim by 1°, Up/Down (or `W`/`S`) changes velocity by 1%, `Shift` gives 0.1° angle steps, `C` centers English, and `Space` strikes. The angle can also be typed directly in degrees.
- In practice, toggle between rules play and sandbox. Sandbox permissions independently control ball movement, cue-ball movement, free placement, restoring balls, undo, replay, and reracking.
- Trajectory aids are independently selectable from the top navigation. Simple Object Path shows the cue ball and object ball vectors after first contact; advanced paths include rails and jump landing detail.
- Ghost paint trails/contact flashes are optional. Right-click the table for cloth speed, frame, and cloth design controls.
- Practice includes granular sandbox permissions and server-verified skill challenges with personal-best medals and non-repeatable improvement XP.

## Competition and progression

- Casual racks use all room options and award half-rate progression XP. Ranked racks lock standardized cloth speed, a 60-second clock, elevated shots, and full trajectory availability.
- Every authoritative shot is scored from its actual result: legal pockets, distance, cuts, banks, kicks, combinations, verified jump/curve technique, position, safety, streaks, runouts, fouls, and scratches all contribute.
- Guest profiles persist by a bearer session stored in the browser. SQLite stores only a token hash, globally unique 1–20 character names, XP, per-mode Elo ratings, mastery, challenge medals, unlocks, and cosmetic loadouts.
- Overall and per-mode leaderboards include all-time and 30-day views. Repeated opponents receive a declining reward multiplier to discourage farming.

## Rules

The rules are WPA-inspired and tuned for casual browser play.

- 8-ball uses an open table after the break, assigns groups after the first legal single-category pocket, requires legal first contact plus a rail or pocket, gives ball-in-hand on fouls, respots an 8 made on the break, and treats an early 8 as a rack loss.
- 9-ball requires contact with the lowest-numbered ball first, permits combinations, respots the 9 after a foul, and awards a rack for a legally pocketed 9—including on the break.
- A legal break pockets an object ball or drives four object balls to rails.
- Called pockets, push-outs, and the three-foul loss rule are intentionally omitted.

## Architecture

- `packages/game-core` contains canonical table/cushion geometry, deterministic rack generation, fixed-step 3D-aware physics, shot prediction, placement validation, rules, and shared client/server contracts.
- `apps/server` owns public room discovery, privacy redaction, player seats, validation, shot and challenge simulation, session state, playback broadcasts, clocks, reconnect grace, forfeits, scoring, and SQLite progression.
- `apps/client` contains the React UI, procedural Canvas renderer, trajectory Web Worker, synthesized sound, responsive controls, multiplayer flow, and granular practice sandbox.

The server accepts only shot inputs—not ball positions or outcomes. It simulates the complete shot, applies rules, and broadcasts interpolated playback frames plus the final authoritative snapshot. Active rooms remain in memory; profiles, ratings, rewards, loadouts, leaderboards, and challenge progress persist through restarts in SQLite.

## Production configuration

Copy `.env.example` and set values as needed:

- `PORT`: Node server port, default `3001`.
- `CLIENT_ORIGIN`: allowed development origin, default `http://127.0.0.1:5173`.
- `ALLOW_TRYCLOUDFLARE_ORIGIN`: permits only secure, single-label `*.trycloudflare.com` origins when explicitly set to `true`.
- `TRUST_CLOUDFLARE_IP`: trusts `CF-Connecting-IP` for abuse controls; enable only when the origin port is private.
- `RATE_LIMITS_ENABLED`: defaults on in production and off in development; the Oracle stack enables it explicitly.
- `VITE_SERVER_URL`: optional client-side Socket.IO URL; leave blank for same-origin production.
- `DATA_DIR`: directory for `breakroom.sqlite`, default `./data`.
- `DATABASE_PATH`: optional explicit SQLite path; overrides `DATA_DIR`.
- `APP_VERSION`: immutable build identifier returned by `/health`.
- `PASSPORT_MASTER_KEY_FILE`: preferred production path to the root-controlled passport encryption key.

Build and run with npm, or use the included multi-stage Dockerfile:

```bash
docker build -t breakroom-pool .
docker run --rm -p 3001:3001 -v breakroom-data:/app/data breakroom-pool
```

The health endpoint is available at `/health`.

## Oracle Always Free preview

The repository includes a hardened production Compose stack, a GitHub image pipeline, and host tooling for an Oracle Ampere A1 deployment exposed through a temporary Cloudflare Quick Tunnel. The deployment uses immutable image digests, refuses to interrupt active rooms, rolls back failed releases, and backs SQLite up to OCI Object Storage with client-side encryption.

See [the Oracle deployment runbook](ops/oracle/README.md) for provisioning, IAM, secrets, release, monitoring, and restore instructions. Quick Tunnel addresses are temporary and intended for evaluation; a permanent public launch should replace that layer with a named Tunnel and a domain.
