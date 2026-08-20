# Kriya

A guided meditation / kriya practice app. Build custom sequences from a
library of recordings, or play one of the full guided kriyas straight
through.

Built with Vite + React.

## Two builds

The same source ships two ways:

- **`npm run build`** — the open build, deployed to GitHub Pages on every
  push to `main` via `.github/workflows/deploy.yml`. Audio is bundled in
  `public/audio/` and served from `/kriya/`. Everything is on show.
- **`npm run build:cf`** — the gated build, served by a Cloudflare Worker
  from `/`. Sign in with Google, and you see only the practices from the
  courses you have actually done. Audio lives in a private R2 bucket and
  is streamed through `/api/audio` after a per-request check.

The gated build is set up separately and does not affect the Pages one —
see [SETUP.md](SETUP.md).

## Development

```bash
npm install
npm run dev            # the open app, http://localhost:5173/kriya/
```

For the gated app, see the local-development section of [SETUP.md](SETUP.md).

## Adding or replacing recordings

The catalog lives in `shared/catalog.js`, imported by both the app and
the Worker. Add the file to `public/audio/`, then add an entry to `FILES`
(a building block) or `FULL` (a complete kriya) with its exact filename
and the `course` that unlocks it.

Filenames may contain spaces; the open build URL-encodes them, and the
R2 key is slugged (`OM - Dinesh.mp3` → `audio/om-dinesh.mp3`). A
recording showing a dash instead of a duration on the Recordings screen
means its filename does not match exactly.

Track ids are derived from filenames, and saved sequences reference those
ids — renaming a file will orphan any sequence that used it.
