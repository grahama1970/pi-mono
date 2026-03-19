/**
 * ROOT POISON PILL — DO NOT REMOVE
 *
 * This config exists to PREVENT vitest from being run at the monorepo root.
 * Without it, vitest discovers all vitest.config.ts files across the tree
 * (including .pi/.worktrees/ and battle dirs), spawning 47+ forks that
 * consume all RAM and crash the workstation.
 *
 * Incident log:
 * - 2026-03-16: maxForks:8 → 94 zombie vitest PIDs, earlyoom killed 120+ processes, KDE crashed
 * - 2026-03-17: Verification hooks ran vitest from root → 260+ cli.js processes at 100% CPU
 *
 * To run tests, cd into the specific package:
 *   cd packages/coding-agent && npx vitest run
 *   cd packages/ai && npx vitest run
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Include nothing — this is a blocker, not a runner
    include: [],
    // Belt and suspenders
    pool: 'forks',
    fileParallelism: false,
    poolOptions: {
      forks: {
        maxForks: 1,
      },
    },
  },
});
