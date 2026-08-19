# Kriya

A guided meditation / kriya practice app. Build custom sequences from a
library of recordings, or play one of the full guided kriyas straight
through.

Built with Vite + React. Audio recordings are bundled in `public/audio/`
and served same-origin — no external hosting.

## Development

```bash
npm install
npm run dev
```

## Deployment

Deploys to GitHub Pages automatically on every push to `main` via
`.github/workflows/deploy.yml`. The production build is served from
`/kriya/`, configured in `vite.config.js`.

## Adding or replacing recordings

Files live in `public/audio/`. Filenames may contain spaces — the app
URL-encodes them at request time (see `BASE`/`urlFor` in `src/App.jsx`).
Reference each file's exact name in the `FILES` or `FULL` arrays in
`src/App.jsx`. A recording that shows a dash instead of a duration on
the Recordings screen means its filename doesn't match exactly.
