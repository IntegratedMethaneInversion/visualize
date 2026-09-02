import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/IMI-viz-fromscratch/',
  plugins: [react()],
  server: {
    host: '0.0.0.0',   // ← listen on all interfaces
    port: 5173,
  },
  optimizeDeps: {
    include: ['georaster', 'georaster-layer-for-leaflet'],
    // maplibre-gl resolves its tile-parsing worker relative to its own module
    // URL. Pre-bundling rewrites that URL into .vite/deps/, where the worker
    // file does not exist, so the worker 404s and no vector tile ever renders.
    exclude: ['maplibre-gl'],
  },
  // The maplibre worker is spawned with { type: 'module' } and imports a shared
  // chunk, so the emitted worker bundle has to be ESM rather than Vite's
  // default IIFE. See setWorkerUrl in VectorBasemap.jsx.
  worker: {
    format: 'es',
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
})