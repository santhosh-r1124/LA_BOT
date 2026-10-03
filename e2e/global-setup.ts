import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Creates a fresh admin account for this run with the API's own bootstrap
 * script (there is deliberately no HTTP endpoint that can mint an admin).
 * Credentials are handed to the tests via env, which workers inherit.
 */
export default function globalSetup(): void {
  const runId = Date.now().toString(36);
  const email = `e2e-admin-${runId}@example.com`;
  const password = `e2e-admin-password-${runId}`;

  execFileSync(
    'uv',
    ['run', 'python', '-m', 'app.scripts.create_admin', '--email', email, '--password', password],
    { cwd: fileURLToPath(new URL('../apps/api', import.meta.url)), stdio: 'inherit' },
  );

  process.env.E2E_RUN_ID = runId;
  process.env.E2E_ADMIN_EMAIL = email;
  process.env.E2E_ADMIN_PASSWORD = password;
}
