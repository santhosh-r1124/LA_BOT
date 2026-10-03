#!/usr/bin/env node
/**
 * One-command local run: `pnpm dev:local`.
 *
 *  1. Picks free ports for the consumer web app (never 3000 — it starts at
 *     3002) and the advocate portal (3001, or the next free one). Override
 *     with WEB_DEV_PORT / PORTAL_DEV_PORT.
 *  2. Starts Postgres, Redis and the API in Docker, telling the API which
 *     origins to allow (CORS_ORIGINS) and where email links point
 *     (FRONTEND_BASE_URL). The API container applies migrations itself.
 *  3. Waits for the API's /health, then runs both Next.js dev servers and
 *     prints the URLs.
 *
 * Flags: --skip-stack  don't touch Docker (API already running elsewhere).
 * Plain Node, no dependencies, works the same in PowerShell, cmd and bash.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const compose = ['compose', '-f', path.join(root, 'infrastructure/docker/docker-compose.yml')];
const apiPort = Number(process.env.API_PORT || 8000);
const skipStack = process.argv.includes('--skip-stack');
const isWindows = process.platform === 'win32';

const log = (msg) => console.log(`\x1b[36m[dev-local]\x1b[0m ${msg}`);
const fail = (msg) => {
  console.error(`\x1b[31m[dev-local] ${msg}\x1b[0m`);
  process.exit(1);
};

/** Free = we can bind it AND nothing answers on it (covers ports Windows reserves). */
async function isFree(port) {
  const canListen = (host) =>
    new Promise((resolve) => {
      const srv = net.createServer();
      srv.once('error', (err) =>
        resolve(err.code === 'EADDRNOTAVAIL' || err.code === 'EAFNOSUPPORT'),
      );
      srv.listen({ port, host, exclusive: true }, () => srv.close(() => resolve(true)));
    });
  const answers = (host) =>
    new Promise((resolve) => {
      const sock = net.connect({ port, host });
      sock.setTimeout(500);
      sock.once('connect', () => (sock.destroy(), resolve(true)));
      sock.once('timeout', () => (sock.destroy(), resolve(false)));
      sock.once('error', () => resolve(false));
    });
  for (const host of ['127.0.0.1', '::1']) if (await answers(host)) return false;
  return (await canListen('0.0.0.0')) && (await canListen('::'));
}

async function pickPort(preferred, taken) {
  for (let port = preferred; port < preferred + 100; port++) {
    if (port === 3000 || taken.includes(port)) continue;
    if (await isFree(port)) return port;
  }
  fail(`No free port found from ${preferred} upwards.`);
}

async function waitForApi(timeoutMs) {
  const url = `http://localhost:${apiPort}/health`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return false;
}

function startNext(name, appDir, port, color) {
  const require = createRequire(path.join(root, appDir, 'package.json'));
  let nextBin;
  try {
    nextBin = require.resolve('next/dist/bin/next');
  } catch {
    fail(`Next.js isn't installed for ${appDir} — run \`pnpm install\` first.`);
  }
  const child = spawn(process.execPath, [nextBin, 'dev', '--turbopack', '--port', String(port)], {
    cwd: path.join(root, appDir),
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_PUBLIC_API_BASE_URL: `http://localhost:${apiPort}`,
      NEXT_TELEMETRY_DISABLED: '1',
    },
  });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  for (const stream of [child.stdout, child.stderr]) {
    let buf = '';
    stream.on('data', (chunk) => {
      buf += chunk;
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) process.stdout.write(prefix + line + '\n');
    });
  }
  child.on('exit', (code) => {
    if (!shuttingDown) log(`${name} stopped (exit code ${code}). Scroll up for its error.`);
  });
  return child;
}

let shuttingDown = false;
const children = [];
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null) continue;
    if (isWindows)
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

const webPort = process.env.WEB_DEV_PORT
  ? Number(process.env.WEB_DEV_PORT)
  : await pickPort(3002, []);
const portalPort = process.env.PORTAL_DEV_PORT
  ? Number(process.env.PORTAL_DEV_PORT)
  : await pickPort(3001, [webPort]);
const webUrl = `http://localhost:${webPort}`;
const portalUrl = `http://localhost:${portalPort}`;
log(`Consumer web → port ${webPort}, advocate portal → port ${portalPort}`);

if (!skipStack) {
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    fail('Docker is not running. Start Docker Desktop, wait until it says "running", then retry.');
  }
  log(
    'Starting Postgres, Redis and the API in Docker (first run builds the image — a few minutes)…',
  );
  const up = spawnSync('docker', [...compose, 'up', '-d'], {
    cwd: root,
    stdio: 'inherit',
    env: {
      ...process.env,
      // Shell env wins over the root .env in compose interpolation.
      CORS_ORIGINS: `${webUrl},${portalUrl},http://127.0.0.1:${webPort},http://127.0.0.1:${portalPort}`,
      FRONTEND_BASE_URL: webUrl,
    },
  });
  if (up.status !== 0) fail('`docker compose up` failed — see the error above.');
}

log(`Waiting for the API on http://localhost:${apiPort} …`);
if (await waitForApi(skipStack ? 15_000 : 300_000)) {
  log('API is up.');
} else {
  log(
    `API didn't answer on /health. Starting the frontends anyway; check it with ` +
      `\`pnpm stack:logs\` (sign-in and chat need it).`,
  );
}

children.push(startNext('web', 'apps/web', webPort, 32));
children.push(startNext('portal', 'apps/advocate-portal', portalPort, 35));

console.log(`
\x1b[1m  Consumer web     ${webUrl}
  Advocate portal  ${portalUrl}
  API docs         http://localhost:${apiPort}/docs\x1b[0m

  First page load compiles for a few seconds. Press Ctrl+C to stop the
  frontends (\`pnpm stack:down\` stops Docker).
`);
