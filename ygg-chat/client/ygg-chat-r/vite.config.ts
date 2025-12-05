import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const buildTarget = process.env.BUILD_TARGET || 'local'
  const isElectron = buildTarget === 'electron'
  const isWeb = buildTarget === 'web'

  return {
    // Use relative paths for Electron (file:// protocol requires ./ instead of /)
    base: isElectron ? './' : '/',

    plugins: [react(), tailwindcss()],

    // Define compile-time constants for conditional code
    define: {
      __BUILD_TARGET__: JSON.stringify(buildTarget),
      __IS_ELECTRON__: JSON.stringify(isElectron),
      __IS_WEB__: JSON.stringify(isWeb),
      __IS_LOCAL__: JSON.stringify(buildTarget === 'local'),
    },

    // Resolve aliases for cleaner imports
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        '@shared': path.resolve(__dirname, '../../shared'),
      },
    },

    // Build configuration
    build: {
      outDir: isElectron ? 'dist-electron' : 'dist',
      sourcemap: true,

      rollupOptions: {
        output: {
          // Code-split by feature for tree-shaking
          manualChunks: id => {
            // Separate Stripe code (tree-shaken in electron build)
            if (id.includes('@stripe/stripe-js') || id.includes('stripe')) {
              return 'stripe'
            }
            // Don't separate Supabase - it causes circular dependency issues
            // when loaded via file:// protocol in Electron
            // Vendor chunk for common deps (includes Supabase)
            if (id.includes('node_modules')) {
              return 'vendor'
            }
          },
        },
      },
    },

    // Server config
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3001',
          changeOrigin: true,
          secure: false,
        },
      },
    },
  }
})
