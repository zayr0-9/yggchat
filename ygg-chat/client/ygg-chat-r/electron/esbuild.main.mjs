import * as esbuild from 'esbuild'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Bundle main.ts with all dependencies
await esbuild.build({
  entryPoints: [path.join(__dirname, 'main.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  outfile: path.join(__dirname, 'main.mjs'),
  format: 'esm',
  external: [
    'electron',
    'better-sqlite3',  // Native module - must be external
  ],
  banner: {
    // Required for ESM to use require() for native modules
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);"
  },
  sourcemap: true,
  // Resolve .ts files when importing .js extensions
  resolveExtensions: ['.ts', '.js', '.mjs', '.json'],
})

console.log('✅ main.ts bundled to main.mjs')

// Compile preload.ts (simple, no bundling needed - only uses electron)
await esbuild.build({
  entryPoints: [path.join(__dirname, 'preload.ts')],
  bundle: false,  // Don't bundle, just transpile
  platform: 'node',
  target: 'node20',
  outfile: path.join(__dirname, 'preload.mjs'),
  format: 'esm',
  sourcemap: true,
})

console.log('✅ preload.ts compiled to preload.mjs')
