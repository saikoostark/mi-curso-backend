import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/setup/load-env.ts'],
    globalSetup: ['./test/setup/global-setup.ts'],
    // Every spec runs against the same dedicated test database and truncates
    // the tables it touches, so files must never overlap.
    fileParallelism: false,
    // Auth flows run several scrypt hashes and sequential HTTP round-trips;
    // under load a single test can take longer than Vitest's 5s default. A
    // timed-out test keeps running while the next test truncates the shared
    // tables, producing cascading 401/400 failures and FK violations.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
