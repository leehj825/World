import { defineConfig } from 'vite'

// `shared` is a workspace package resolved through a symlink, so Vite sees its
// real path outside node_modules and would otherwise serve its compiled
// CommonJS output as-is (via /@fs/) instead of pre-bundling it into ESM.
// Forcing it into optimizeDeps makes esbuild convert it like any other
// CJS dependency.
export default defineConfig({
  optimizeDeps: {
    include: ['shared'],
  },
})
