import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Everything in public/ is copied into the build, and that includes the
// recordings. In the gated build they must not be there: the whole point
// is that audio only ever comes through the Worker, out of a private
// bucket. So the folder is removed again after the copy — a build that
// quietly republished 364MB of gated audio would defeat the exercise.
const keepAudioOut = (outDir) => ({
  name: 'kriya:no-public-audio',
  apply: 'build',
  closeBundle() {
    const dir = resolve(outDir, 'audio')
    if (!existsSync(dir)) return
    rmSync(dir, { recursive: true, force: true })
    this.info(`removed ${dir} — gated builds serve audio through /api/audio`)
  },
})

// Two builds from one source. The default is the open GitHub Pages app
// under /kriya/; `--mode cloudflare` picks up .env.cloudflare and builds
// the gated one for the Worker, served from the root.
// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const gated = env.VITE_GATED === 'true'
  const outDir = 'dist'

  return {
    base: env.VITE_BASE || '/kriya/',
    build: { outDir },
    plugins: [react(), ...(gated ? [keepAudioOut(outDir)] : [])],
    server: {
      // `npm run dev:cf` alongside `npm run dev:worker`: the app stays on
      // Vite with hot reload, and anything under /api goes to the Worker.
      proxy: { '/api': 'http://127.0.0.1:8787' },
    },
  }
})
