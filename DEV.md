# Developer Guide

## Purpose

This backend is a modular monolith for a Transcendence-style project. It focuses on users, password authentication, OAuth 42 login, server-side sessions, optional TOTP 2FA, recovery codes and simple role-based authorization.

The project intentionally avoids JWT as the main auth mechanism, microservices, CQRS, event sourcing and advanced ACLs. It keeps the auth surface narrow: local password login, OAuth 42, local sessions and local TOTP.

## Stack

- Node.js + TypeScript.
- Fastify for HTTP.
- Prisma ORM for persistence.
- SQLite as the default local database.
- `zod` for request validation.
- Node `scrypt` for password hashing.
- `otplib` for TOTP.
- Server-side sessions with secure cookies.

The project uses in-memory repositories when `NODE_ENV=test`. This keeps tests fast and isolated.

## Module Boundaries

The code is split by backend domain, not by technical layer alone.

```text
src/modules/
  users/
  auth/
  sessions/
  two_factor/
  oauth/
  authorization/
```

### `users`

Owns user identity and profile-like data: username, email, display name, role and status.

### `auth`

Owns registration, login, 2FA login challenges, reauthentication and password changes. It orchestrates `users`, `sessions` and `two_factor`.

### `sessions`

Owns server-side sessions. The browser receives only an opaque cookie. The database stores only a hash of that token.

### `two_factor`

Owns TOTP setup, TOTP verification and recovery codes.

### `oauth`

Owns OAuth 42 login plus explicit link/unlink flows. Login and linking use separate state purposes.

## Persistence

Persistence uses Prisma ORM with SQLite.

Main files:

```text
prisma/schema.prisma
src/db/prisma.ts
src/db/prismaMappers.ts
src/modules/*/*.prismaRepository.ts
```

Manual SQL should not be added to application code. Schema changes should go through `prisma/schema.prisma` and Prisma migrations.

The current Prisma schema covers:

```text
users
password_credentials
sessions
login_challenges
two_factor_totp
recovery_codes
oauth_states
oauth_accounts
matches
match_players
chat_messages
```

Future game-state, tournament and friend/block models should be added to Prisma instead of handwritten SQL. Live game state should stay in memory/WebSocket; SQLite stores durable results, history and chat messages.

## Environment

Create `.env` from `.env.example`.

Required:

```env
DATABASE_URL="file:./dev.db"
TOTP_ENCRYPTION_KEY_BASE64=...
```

Generate the TOTP key with:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

For OAuth 42:

```env
OAUTH_42_CLIENT_ID=...
OAUTH_42_CLIENT_SECRET=...
OAUTH_42_REDIRECT_URI=http://127.0.0.1:3000/auth/oauth/42/callback
OAUTH_42_AUTHORIZE_URL=https://api.intra.42.fr/oauth/authorize
OAUTH_42_TOKEN_URL=https://api.intra.42.fr/oauth/token
OAUTH_42_ME_URL=https://api.intra.42.fr/v2/me
```

## Running Locally

Install dependencies:

```powershell
npm install
```

Generate Prisma Client and apply migrations:

```powershell
npx prisma generate
npx prisma migrate dev
```

Compile:

```powershell
node .\node_modules\typescript\bin\tsc -p tsconfig.json
```

Start:

```powershell
npm start
```

Health check:

```powershell
curl.exe http://127.0.0.1:3000/health
```

Manual UI:

```text
http://127.0.0.1:3000/
```

## Testing

Run:

```powershell
node .\node_modules\typescript\bin\tsc -p tsconfig.json
node --test tests\integration\*.test.mjs
```

The tests run with `NODE_ENV=test`, so they use in-memory repositories and do not require a SQLite file.

Current integration coverage includes:

- register
- login
- authenticated `/me`
- logout
- invalid credentials
- protected route without cookie
- admin route forbidden for normal user
- TOTP setup
- TOTP login
- recovery code login
- recovery code one-use behavior
- OAuth 42 login state validation
- OAuth 42 account creation
- OAuth 42 explicit link/unlink behavior

## Prisma Inspection

Open Prisma Studio:

```powershell
npx prisma studio
```

Reset local development database if needed:

```powershell
npx prisma migrate reset
```

Do not commit generated SQLite database files.

## Adding New Features

Follow these rules:

- Keep profile data in `users`.
- Keep login/password/session orchestration in `auth`.
- Keep cookie and session lifecycle in `sessions`.
- Keep TOTP/recovery internals in `two_factor`.
- Keep route access rules in `authorization`.
- Add persistent models through Prisma.

Do not put password hashes in `users`.
Do not create sessions before 2FA is complete.
Do not return session tokens in JSON.
Do not store recovery codes in plain text.
Do not add JWT unless there is a concrete reason.

## Known Limitations

- No email verification.
- No password reset flow.
- No account lockout policy beyond simple in-memory rate limiting.
- No CSRF token layer yet.
- No admin UI.
- Match history and lobby chat now have Prisma models and repositories. No live game-state, tournament or friend/block models yet.

These are acceptable for the current base. The next most useful backend improvements would be:

1. Add WebSocket game loop with live state in memory.
2. Add WebSocket authentication using the existing session cookie.
3. Add CSRF protection if the frontend is cookie-based and browser-facing.
4. Add password reset.
5. Add email verification.
