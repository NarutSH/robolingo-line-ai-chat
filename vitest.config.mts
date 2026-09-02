import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: [here('./tests/setup.ts')],
    include: ['tests/**/*.test.ts'],
    // One cloud database is shared by every file, so they run one at a time.
    fileParallelism: false,
    // Round trips to a hosted Postgres and back are slower than a local fake.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: [
      // Ambient bits of the Next runtime that a directly driven route handler
      // does not get. See tests/stubs/ for what each one stands in for.
      { find: 'server-only', replacement: here('./tests/stubs/server-only.ts') },
      { find: 'next/headers', replacement: here('./tests/stubs/next-headers.ts') },
      { find: 'next/server', replacement: here('./tests/stubs/next-server.ts') },
      { find: /^@\//, replacement: here('./') },
    ],
  },
})
