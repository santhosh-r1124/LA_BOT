# @legal-platform/database

A thin, pooled PostgreSQL client for **Node** code that needs direct database access (scripts,
seeders, a server-side route handler). Built on [`postgres`](https://github.com/porsager/postgres).

**Status:** available, but not used yet. Neither the website nor the advocate portal imports it: both
talk to the API only, and the backend owns all data access. The `Database` type in `src/types.ts` is
an empty placeholder (`[table: string]: Record<string, unknown>`), so queries are untyped until you
generate real types.

## Schema ownership

The database schema is **owned by `apps/api`**: SQLAlchemy 2.0 models plus Alembic migrations. This
package does not define or migrate tables. See
[`docs/adr/0003-schema-and-migrations.md`](../../docs/adr/0003-schema-and-migrations.md). Prefer
calling the API over querying the database from the frontends.

## Usage

```ts
import { createDbClient } from '@legal-platform/database';

const sql = createDbClient(); // reads DATABASE_URL_TS, then DATABASE_URL
const rows = await sql`select 1 as ok`;
await sql.end();
```

The API's `DATABASE_URL` uses a SQLAlchemy scheme (`postgresql+asyncpg://...`); `createDbClient`
strips the `+driver` part automatically. To give Node tools a plain URL instead, set
`DATABASE_URL_TS=postgresql://...`. Options: `connectionString`, `max` (pool size, default 10) and
`statementTimeoutSeconds` (default 30).

For the local Docker database the connection string is
`postgresql://legal:legal_dev_password@localhost:5432/legal_platform` (start it with `pnpm stack:up`
and migrate with `pnpm db:migrate`).

## Generating `src/types.ts`

The file is a placeholder. To replace it with real types, migrate the local database
(`pnpm stack:up` then `pnpm db:migrate`), run a generator of your choice against it (for example
`kysely-codegen`, which is not a dependency of this repo), and commit the result so typechecks stay
deterministic in CI. Keep the exported name `Database`, or update `src/index.ts` to match.

## Checks

```bash
pnpm --filter @legal-platform/database typecheck
pnpm --filter @legal-platform/database lint
```
