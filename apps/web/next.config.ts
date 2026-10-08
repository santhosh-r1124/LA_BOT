import path from 'node:path';
import type { NextConfig } from 'next';

// Set at build time for the single-container deployment (repo-root
// Dockerfile): the API runs on this internal address and the web server
// proxies its routes, so the browser only ever talks to one origin.
const apiInternalUrl = process.env.API_INTERNAL_URL;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(apiInternalUrl && {
    async rewrites() {
      return [
        { source: '/api/v1/:path*', destination: `${apiInternalUrl}/api/v1/:path*` },
        { source: '/health', destination: `${apiInternalUrl}/health` },
        { source: '/health/ready', destination: `${apiInternalUrl}/health/ready` },
        // Interactive API docs (served by the API outside APP_ENV=production).
        { source: '/docs', destination: `${apiInternalUrl}/docs` },
        { source: '/redoc', destination: `${apiInternalUrl}/redoc` },
        { source: '/openapi.json', destination: `${apiInternalUrl}/openapi.json` },
      ];
    },
    // AI drafts can take well over the 30s proxy default.
    experimental: { proxyTimeout: 300_000 },
  }),
  // Standalone output for small Docker images. Opt-in via env because the
  // standalone tracer creates symlinks, which need elevated rights on Windows.
  // The Dockerfiles set NEXT_OUTPUT=standalone; local `pnpm build` stays normal.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  // Monorepo: trace workspace deps from the repo root when bundling standalone.
  outputFileTracingRoot: path.join(import.meta.dirname, '../../'),
  // Compile workspace TS packages that ship raw source.
  transpilePackages: ['@legal-platform/shared', '@legal-platform/auth'],
  eslint: {
    // Lint is a separate CI job (`pnpm lint`); don't run it during `next build`.
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
