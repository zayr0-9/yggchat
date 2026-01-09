import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react-swc';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';
// Custom plugin to serve WASM files with correct MIME type during dev
function serveWasmPlugin() {
    return {
        name: 'serve-wasm',
        configureServer: function (server) {
            server.middlewares.use(function (req, res, next) {
                var _a, _b;
                // Handle requests for ONNX Runtime WASM files
                if (((_a = req.url) === null || _a === void 0 ? void 0 : _a.includes('ort-wasm')) && ((_b = req.url) === null || _b === void 0 ? void 0 : _b.endsWith('.wasm'))) {
                    var wasmPath = path.resolve(__dirname, '../../node_modules/openwakeword-wasm-browser/node_modules/onnxruntime-web/dist', path.basename(req.url.split('?')[0]));
                    if (fs.existsSync(wasmPath)) {
                        res.setHeader('Content-Type', 'application/wasm');
                        fs.createReadStream(wasmPath).pipe(res);
                        return;
                    }
                }
                next();
            });
        },
    };
}
// https://vite.dev/config/
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var buildTarget = process.env.BUILD_TARGET || 'local';
    var isElectron = buildTarget === 'electron';
    var isWeb = buildTarget === 'web';
    return {
        // Use relative paths for Electron (file:// protocol requires ./ instead of /)
        base: isElectron ? './' : '/',
        plugins: [
            react(),
            tailwindcss(),
            // Serve WASM files with correct MIME type during dev
            serveWasmPlugin(),
            // Copy ONNX Runtime WASM files to dist for production builds
            viteStaticCopy({
                targets: [
                    {
                        src: '../../node_modules/openwakeword-wasm-browser/node_modules/onnxruntime-web/dist/ort-wasm*.{wasm,mjs}',
                        dest: 'ort-wasm',
                    },
                ],
            }),
        ],
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
                    manualChunks: function (id) {
                        // Separate Stripe code (tree-shaken in electron build)
                        if (id.includes('@stripe/stripe-js') || id.includes('stripe')) {
                            return 'stripe';
                        }
                        // Don't separate Supabase - it causes circular dependency issues
                        // when loaded via file:// protocol in Electron
                        // Vendor chunk for common deps (includes Supabase)
                        if (id.includes('node_modules')) {
                            return 'vendor';
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
            // Allow serving files from node_modules for ONNX Runtime WASM
            fs: {
                allow: ['..', '../../node_modules'],
            },
        },
        // Optimize dependencies
        optimizeDeps: {
            // Exclude WASM-based packages from pre-bundling as they use dynamic imports
            // onnxruntime-web MUST be excluded to avoid WASM MIME type issues
            exclude: ['@xenova/transformers', 'onnxruntime-web'],
        },
    };
});
