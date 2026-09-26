import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    // 'client' is workspace-linked source (fine, Vite transforms .ts on
    // load), but it imports 'shared', whose compiled CommonJS output would
    // otherwise be served as unconverted ESM via /@fs. Same fix as
    // client/vite.config.ts, needed again here since it's a transitive
    // dependency reached through 'client'.
    include: ['shared', 'client'],
  },
})
