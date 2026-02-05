import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/tools/**/*.test.ts'],
    exclude: ['dist/**', 'dist-electron/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['electron/tools/editFile.ts'],
    },
  },
})
