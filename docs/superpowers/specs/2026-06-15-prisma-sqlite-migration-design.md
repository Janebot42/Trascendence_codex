# Prisma + SQLite Migration Design

## Goal

Migrate the current Transcendence backend persistence layer from manual PostgreSQL/`pg` repositories to Prisma ORM with SQLite, while preserving the existing Fastify/TypeScript application shape, local auth, cookie sessions, OAuth 42, 2FA, and integration-test behavior.

## Context

The current project has a working auth-oriented backend:

- Fastify + TypeScript.
- Cookie-based server sessions.
- Local username/password auth.
- TOTP 2FA and recovery codes.
- OAuth 42 login/linking.
- Manual PostgreSQL persistence via `pg` repositories.
- In-memory repositories used during tests.

There is not yet meaningful SQL/game-domain work for matches, stats, tournaments, chat, or friends. That makes this the right moment to introduce an ORM without migrating a large game schema.

## Decision

Use **Prisma + SQLite** as the primary persistence layer.

This satisfies the ORM direction for the project and reduces future development cost for game-related models. SQLite is preferred over PostgreSQL for the express/42 path because it removes database-service setup friction and keeps local development simple.

## Chosen Approach

Replace the PostgreSQL-specific repository implementations with Prisma-backed repositories:

- `PgUsersRepository` → `PrismaUsersRepository`
- `PgAuthRepository` → `PrismaAuthRepository`
- `PgSessionsRepository` → `PrismaSessionsRepository`
- `PgTwoFactorRepository` → `PrismaTwoFactorRepository`
- `PgOAuthRepository` → `PrismaOAuthRepository`

Keep service and route APIs stable. The migration should mostly affect wiring and repository internals, not business logic.

## Prisma Schema

Create `prisma/schema.prisma` using SQLite and Prisma Client. Initial models mirror the existing auth migration:

- `User`
- `PasswordCredential`
- `Session`
- `LoginChallenge`
- `TwoFactorTotp`
- `RecoveryCode`
- `OAuthAccount`
- `OAuthState`

Use string IDs to preserve current behavior. Use Prisma enums for constrained fields:

- `UserRole`: `USER`, `ADMIN`
- `UserStatus`: `ACTIVE`, `DISABLED`
- `OAuthProvider`: `FORTY_TWO`
- `OAuthStatePurpose`: `LOGIN`, `LINK`

Expose mapper functions where enum casing differs from the current TypeScript domain types.

## Runtime Wiring

Add a Prisma client factory in `src/db/prisma.ts`.

In `src/app.ts`:

- Keep in-memory repositories when `NODE_ENV === 'test'`.
- Use Prisma repositories otherwise.
- Disconnect Prisma in the Fastify `onClose` hook.

This keeps the existing integration tests fast and limits the first migration risk. A later task can add dedicated Prisma-backed persistence tests if needed.

## Removed PostgreSQL Surface

Remove or stop using:

- `pg`
- `@types/pg`
- `src/db/client.ts`
- `src/db/migrate.ts`
- `src/db/pgMappers.ts`
- `src/modules/**/**.pgRepository.ts`
- `db/migrations/001_auth_base.sql`
- PostgreSQL-first documentation.

`docker-compose.yml` can either be removed or rewritten later when the full stack needs containers. It should not be part of the first persistence migration unless it blocks build/test.

## Data Flow

For normal runtime:

1. Fastify builds the app.
2. `createPrismaClient()` creates a Prisma client using `DATABASE_URL`.
3. Repositories call Prisma Client methods.
4. Services receive the same domain objects they receive today.
5. Routes continue behaving as before.
6. On app close, Prisma disconnects.

For test runtime:

1. `NODE_ENV=test` keeps using in-memory repositories.
2. Existing auth/OAuth integration tests remain isolated from filesystem DB state.

## Error Handling

Repository-level unique constraint failures should continue mapping to existing `conflict('User already exists')` behavior where applicable.

Prisma known request errors should be checked by error code. At minimum:

- `P2002` → unique constraint conflict for user creation.

Unexpected Prisma errors should bubble to the existing Fastify error handler.

## Testing

Minimum verification:

- `npm run build`
- `npm test`

The first migration is considered successful when the current tests still pass without changing route/service behavior.

## Documentation Updates

Update README/DEV docs to say:

- Persistence uses Prisma ORM.
- SQLite is the default database.
- Manual SQL/PostgreSQL is no longer the main path.
- Prisma commands are part of setup.

## Out of Scope

This migration does not add:

- Match/game models.
- Tournament models.
- Friends/blocking models.
- Chat models.
- JWT auth.
- WebSocket auth.

Those should be added after Prisma is in place.
