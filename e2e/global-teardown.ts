import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** Removes this run's accounts so repeated local runs don't pile up test
 * advocates in the public directory of a shared dev database. */
export default function globalTeardown(): void {
  const runId = process.env.E2E_RUN_ID;
  if (!runId || process.env.E2E_KEEP_DATA) return;
  execFileSync('uv', ['run', 'python', '-m', 'app.scripts.purge_e2e_accounts', '--run-id', runId], {
    cwd: fileURLToPath(new URL('../apps/api', import.meta.url)),
    stdio: 'inherit',
  });
}
