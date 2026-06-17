# Prisma + SQLite Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current manual PostgreSQL persistence layer with Prisma ORM backed by SQLite, preserving existing auth/OAuth/2FA behavior.

**Architecture:** Keep Fastify routes and service interfaces stable. Replace only the runtime persistence implementation: Prisma Client becomes the production repository backend, while in-memory repositories stay for tests. Existing integration tests are the behavioral safety net.

**Tech Stack:** TypeScript, Fastify, Prisma, SQLite, Node test runner, npm.

---

## File Structure

**Create:**

- `prisma/schema.prisma` — Prisma datasource, generator, enums, and auth-related models.
- `src/db/prisma.ts` — Prisma client factory.
- `src/db/prismaMappers.ts` — conversion from Prisma rows/enums to existing domain types.
- `src/modules/users/users.prismaRepository.ts` — Prisma users repository.
- `src/modules/auth/auth.prismaRepository.ts` — Prisma password/login-challenge repository.
- `src/modules/sessions/sessions.prismaRepository.ts` — Prisma sessions repository.
- `src/modules/two_factor/twoFactor.prismaRepository.ts` — Prisma TOTP/recovery-code repository.
- `src/modules/oauth/oauth.prismaRepository.ts` — Prisma OAuth account/state repository.

**Modify:**

- `package.json` — add Prisma dependencies/scripts and remove `pg` dependencies.
- `.env.example` — switch `DATABASE_URL` to SQLite.
- `src/app.ts` — wire Prisma repositories instead of PostgreSQL repositories.
- `README.md` — update persistence/setup instructions.
- `DEV.md` — remove PostgreSQL/manual-SQL guidance and document Prisma path.

**Remove after migration passes:**

- `src/db/client.ts`
- `src/db/migrate.ts`
- `src/db/pgMappers.ts`
- `src/modules/users/users.pgRepository.ts`
- `src/modules/auth/auth.pgRepository.ts`
- `src/modules/sessions/sessions.pgRepository.ts`
- `src/modules/two_factor/twoFactor.pgRepository.ts`
- `src/modules/oauth/oauth.pgRepository.ts`
- `db/migrations/001_auth_base.sql`

---

## Task 1: Add Prisma dependencies and SQLite schema

**Files:**

- Modify: `package.json`
- Modify: `.env.example`
- Create: `prisma/schema.prisma`

- [ ] **Step 1: Install Prisma packages**

Run:

```bash
npm install @prisma/client
npm install -D prisma
```

Expected: `package.json` and `package-lock.json` include Prisma packages.

- [ ] **Step 2: Remove PostgreSQL packages**

Run:

```bash
npm uninstall pg @types/pg
```

Expected: `pg` and `@types/pg` disappear from `package.json`.

- [ ] **Step 3: Add Prisma npm scripts**

Modify `package.json` scripts to include:

```json
{
  "scripts": {
    "dev": "node ./node_modules/typescript/bin/tsc -w -p tsconfig.json",
    "build": "node ./node_modules/typescript/bin/tsc -p tsconfig.json",
    "start": "node dist/server.js",
    "test": "node --test tests/integration/*.mjs",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:studio": "prisma studio"
  }
}
```

Keep existing package metadata and dependencies not mentioned here.

- [ ] **Step 4: Update `.env.example` for SQLite**

Set the database URL example to:

```env
DATABASE_URL="file:./dev.db"
```

Keep the existing auth/OAuth/2FA variables unchanged.

- [ ] **Step 5: Create Prisma schema**

Create `prisma/schema.prisma`:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

enum UserRole {
  USER
  ADMIN
}

enum UserStatus {
  ACTIVE
  DISABLED
}

enum OAuthProvider {
  FORTY_TWO
}

enum OAuthStatePurpose {
  LOGIN
  LINK
}

model User {
  id                  String               @id
  username            String               @unique
  email               String?              @unique
  displayName         String?              @map("display_name")
  role                UserRole             @default(USER)
  status              UserStatus           @default(ACTIVE)
  createdAt           DateTime             @default(now()) @map("created_at")
  updatedAt           DateTime             @updatedAt @map("updated_at")
  passwordCredential  PasswordCredential?
  sessions            Session[]
  loginChallenges     LoginChallenge[]
  twoFactorTotp       TwoFactorTotp?
  recoveryCodes       RecoveryCode[]
  oauthAccounts       OAuthAccount[]
  oauthStates         OAuthState[]

  @@map("users")
}

model PasswordCredential {
  userId            String   @id @map("user_id")
  passwordHash      String   @map("password_hash")
  passwordUpdatedAt DateTime @map("password_updated_at")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")
  user              User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("password_credentials")
}

model Session {
  id                String    @id
  userId            String    @map("user_id")
  sessionTokenHash  String    @unique @map("session_token_hash")
  createdAt         DateTime  @default(now()) @map("created_at")
  lastSeenAt        DateTime  @default(now()) @map("last_seen_at")
  expiresAt         DateTime  @map("expires_at")
  revokedAt         DateTime? @map("revoked_at")
  ipAddress         String?   @map("ip_address")
  userAgent         String?   @map("user_agent")
  reauthenticatedAt DateTime? @map("reauthenticated_at")
  user              User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("sessions")
}

model LoginChallenge {
  id                 String    @id
  userId             String    @map("user_id")
  challengeTokenHash String    @unique @map("challenge_token_hash")
  createdAt          DateTime  @default(now()) @map("created_at")
  expiresAt          DateTime  @map("expires_at")
  consumedAt         DateTime? @map("consumed_at")
  ipAddress          String?   @map("ip_address")
  userAgent          String?   @map("user_agent")
  user               User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@map("login_challenges")
}

model TwoFactorTotp {
  id              String    @id
  userId          String    @unique @map("user_id")
  secretEncrypted String    @map("secret_encrypted")
  enabledAt       DateTime? @map("enabled_at")
  confirmedAt     DateTime? @map("confirmed_at")
  createdAt       DateTime  @default(now()) @map("created_at")
  updatedAt       DateTime  @updatedAt @map("updated_at")
  user            User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@map("two_factor_totp")
}

model RecoveryCode {
  id         String    @id
  userId     String    @map("user_id")
  codeHash   String    @map("code_hash")
  createdAt  DateTime  @default(now()) @map("created_at")
  usedAt     DateTime? @map("used_at")
  replacedAt DateTime? @map("replaced_at")
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("recovery_codes")
}

model OAuthAccount {
  id             String        @id
  userId         String        @map("user_id")
  provider       OAuthProvider
  providerUserId String        @map("provider_user_id")
  providerLogin  String?       @map("provider_login")
  providerEmail  String?       @map("provider_email")
  createdAt      DateTime      @default(now()) @map("created_at")
  updatedAt      DateTime      @updatedAt @map("updated_at")
  user           User          @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerUserId])
  @@index([userId])
  @@map("oauth_accounts")
}

model OAuthState {
  id               String            @id
  provider         OAuthProvider
  purpose          OAuthStatePurpose @default(LOGIN)
  initiatingUserId String?           @map("initiating_user_id")
  stateTokenHash   String            @unique @map("state_token_hash")
  redirectTo       String?           @map("redirect_to")
  createdAt        DateTime          @default(now()) @map("created_at")
  expiresAt        DateTime          @map("expires_at")
  consumedAt       DateTime?         @map("consumed_at")
  initiatingUser   User?             @relation(fields: [initiatingUserId], references: [id], onDelete: Cascade)

  @@index([expiresAt])
  @@map("oauth_states")
}
```

- [ ] **Step 6: Generate Prisma client**

Run:

```bash
npx prisma generate
```

Expected: command exits successfully and generates Prisma Client.

- [ ] **Step 7: Create initial SQLite migration**

Run:

```bash
npx prisma migrate dev --name init_auth
```

Expected: `prisma/migrations/.../migration.sql` is created and SQLite DB is created locally.

- [ ] **Step 8: Build check**

Run:

```bash
npm run build
```

Expected: may fail because app still imports PostgreSQL files. That is acceptable at this task boundary.

- [ ] **Step 9: Commit dependency/schema work**

```bash
git add package.json package-lock.json .env.example prisma/schema.prisma prisma/migrations
git commit -m "chore: add prisma sqlite schema"
```

---

## Task 2: Add Prisma client and mappers

**Files:**

- Create: `src/db/prisma.ts`
- Create: `src/db/prismaMappers.ts`

- [ ] **Step 1: Create Prisma client factory**

Create `src/db/prisma.ts`:

```ts
import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

export function createPrismaClient(): PrismaClient | null {
  if (!env.DATABASE_URL || env.NODE_ENV === 'test') return null;
  return new PrismaClient();
}
```

- [ ] **Step 2: Create mapper helpers**

Create `src/db/prismaMappers.ts`:

```ts
import type {
  LoginChallenge as PrismaLoginChallenge,
  OAuthAccount as PrismaOAuthAccount,
  OAuthProvider as PrismaOAuthProvider,
  OAuthState as PrismaOAuthState,
  OAuthStatePurpose as PrismaOAuthStatePurpose,
  PasswordCredential as PrismaPasswordCredential,
  RecoveryCode as PrismaRecoveryCode,
  Session as PrismaSession,
  TwoFactorTotp as PrismaTwoFactorTotp,
  User as PrismaUser,
  UserRole as PrismaUserRole,
  UserStatus as PrismaUserStatus
} from '@prisma/client';
import type { LoginChallenge } from '../modules/auth/auth.repository.js';
import type { PasswordCredential } from '../modules/auth/auth.types.js';
import type { OAuthAccountRecord, OAuthStateRecord, OAuthStatePurpose } from '../modules/oauth/oauth.types.js';
import type { Session } from '../modules/sessions/sessions.types.js';
import type { RecoveryCodeRecord, TotpRecord } from '../modules/two_factor/twoFactor.types.js';
import type { User, UserRole, UserStatus } from '../modules/users/users.types.js';

export function mapUser(row: PrismaUser): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    displayName: row.displayName,
    role: mapUserRole(row.role),
    status: mapUserStatus(row.status),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function toPrismaUserRole(role: UserRole): PrismaUserRole {
  return role === 'admin' ? 'ADMIN' : 'USER';
}

export function toPrismaUserStatus(status: UserStatus): PrismaUserStatus {
  return status === 'disabled' ? 'DISABLED' : 'ACTIVE';
}

function mapUserRole(role: PrismaUserRole): UserRole {
  return role === 'ADMIN' ? 'admin' : 'user';
}

function mapUserStatus(status: PrismaUserStatus): UserStatus {
  return status === 'DISABLED' ? 'disabled' : 'active';
}

export function mapPasswordCredential(row: PrismaPasswordCredential): PasswordCredential {
  return {
    userId: row.userId,
    passwordHash: row.passwordHash,
    passwordUpdatedAt: row.passwordUpdatedAt
  };
}

export function mapSession(row: PrismaSession): Session {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.sessionTokenHash,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    reauthenticatedAt: row.reauthenticatedAt
  };
}

export function mapLoginChallenge(row: PrismaLoginChallenge): LoginChallenge {
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.challengeTokenHash,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent
  };
}

export function mapTotpRecord(row: PrismaTwoFactorTotp): TotpRecord {
  return {
    id: row.id,
    userId: row.userId,
    secretEncrypted: row.secretEncrypted,
    enabledAt: row.enabledAt,
    confirmedAt: row.confirmedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapRecoveryCode(row: PrismaRecoveryCode): RecoveryCodeRecord {
  return {
    id: row.id,
    userId: row.userId,
    codeHash: row.codeHash,
    createdAt: row.createdAt,
    usedAt: row.usedAt,
    replacedAt: row.replacedAt
  };
}

export function mapOAuthProvider(provider: PrismaOAuthProvider): '42' {
  if (provider !== 'FORTY_TWO') throw new Error(`Unsupported OAuth provider: ${provider}`);
  return '42';
}

export function toPrismaOAuthProvider(provider: '42'): PrismaOAuthProvider {
  if (provider !== '42') throw new Error(`Unsupported OAuth provider: ${provider}`);
  return 'FORTY_TWO';
}

export function mapOAuthStatePurpose(purpose: PrismaOAuthStatePurpose): OAuthStatePurpose {
  return purpose === 'LINK' ? 'link' : 'login';
}

export function toPrismaOAuthStatePurpose(purpose: OAuthStatePurpose): PrismaOAuthStatePurpose {
  return purpose === 'link' ? 'LINK' : 'LOGIN';
}

export function mapOAuthAccount(row: PrismaOAuthAccount): OAuthAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    provider: mapOAuthProvider(row.provider),
    providerUserId: row.providerUserId,
    providerLogin: row.providerLogin,
    providerEmail: row.providerEmail,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function mapOAuthState(row: PrismaOAuthState): OAuthStateRecord {
  return {
    id: row.id,
    provider: mapOAuthProvider(row.provider),
    purpose: mapOAuthStatePurpose(row.purpose),
    initiatingUserId: row.initiatingUserId,
    tokenHash: row.stateTokenHash,
    redirectTo: row.redirectTo,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt
  };
}
```

- [ ] **Step 3: Typecheck mapper names against existing types**

Run:

```bash
npm run build
```

Expected: may still fail because repositories are not migrated yet. Mapper-specific type errors should be fixed before continuing.

- [ ] **Step 4: Commit client and mapper files**

```bash
git add src/db/prisma.ts src/db/prismaMappers.ts
git commit -m "chore: add prisma client mappers"
```

---

## Task 3: Migrate users repository

**Files:**

- Create: `src/modules/users/users.prismaRepository.ts`

- [ ] **Step 1: Inspect users repository interface**

Run:

```bash
sed -n '1,220p' src/modules/users/users.repository.ts
```

Expected: confirm the required methods: `create`, `findById`, `findByUsername`, `findByEmail`, `list`.

- [ ] **Step 2: Create Prisma users repository**

Create `src/modules/users/users.prismaRepository.ts`:

```ts
import { Prisma, type PrismaClient } from '@prisma/client';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { conflict } from '../../shared/errors/httpErrors.js';
import { mapUser } from '../../db/prismaMappers.js';
import type { CreateUserInput, User } from './users.types.js';
import type { UsersRepository } from './users.repository.js';

export class PrismaUsersRepository implements UsersRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      const user = await this.prisma.user.create({
        data: {
          id: randomToken(16),
          username: input.username.trim().toLowerCase(),
          email: input.email?.trim().toLowerCase() ?? null,
          displayName: input.displayName ?? null
        }
      });
      return mapUser(user);
    } catch (error) {
      if (isUniqueViolation(error)) throw conflict('User already exists');
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    return user ? mapUser(user) : null;
  }

  async findByUsername(username: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() }
    });
    return user ? mapUser(user) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() }
    });
    return user ? mapUser(user) : null;
  }

  async list(): Promise<User[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
    return users.map(mapUser);
  }
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
```

- [ ] **Step 3: Run build**

```bash
npm run build
```

Expected: build may still fail due to app wiring/other missing Prisma repositories, but this file should typecheck.

- [ ] **Step 4: Commit users repository**

```bash
git add src/modules/users/users.prismaRepository.ts
git commit -m "chore: add prisma users repository"
```

---

## Task 4: Migrate auth and sessions repositories

**Files:**

- Create: `src/modules/auth/auth.prismaRepository.ts`
- Create: `src/modules/sessions/sessions.prismaRepository.ts`

- [ ] **Step 1: Inspect auth/session interfaces**

Run:

```bash
sed -n '1,240p' src/modules/auth/auth.repository.ts
sed -n '1,240p' src/modules/sessions/sessions.repository.ts
```

Expected: list required methods before coding.

- [ ] **Step 2: Create Prisma auth repository**

Create `src/modules/auth/auth.prismaRepository.ts` implementing every method from `AuthRepository`, using these mappings:

```ts
import { type PrismaClient } from '@prisma/client';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { mapLoginChallenge, mapPasswordCredential } from '../../db/prismaMappers.js';
import type { PasswordCredential } from './auth.types.js';
import type { AuthRepository, LoginChallenge } from './auth.repository.js';

export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createPasswordCredential(input: PasswordCredential): Promise<void> {
    await this.prisma.passwordCredential.create({
      data: {
        userId: input.userId,
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.passwordUpdatedAt
      }
    });
  }

  async findPasswordCredential(userId: string): Promise<PasswordCredential | null> {
    const credential = await this.prisma.passwordCredential.findUnique({ where: { userId } });
    return credential ? mapPasswordCredential(credential) : null;
  }

  async updatePasswordCredential(input: PasswordCredential): Promise<void> {
    await this.prisma.passwordCredential.update({
      where: { userId: input.userId },
      data: {
        passwordHash: input.passwordHash,
        passwordUpdatedAt: input.passwordUpdatedAt
      }
    });
  }

  async createLoginChallenge(input: Omit<LoginChallenge, 'id' | 'createdAt' | 'consumedAt'>): Promise<LoginChallenge> {
    const challenge = await this.prisma.loginChallenge.create({
      data: {
        id: randomToken(16),
        userId: input.userId,
        challengeTokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent
      }
    });
    return mapLoginChallenge(challenge);
  }

  async findLoginChallengeByTokenHash(tokenHash: string): Promise<LoginChallenge | null> {
    const challenge = await this.prisma.loginChallenge.findUnique({
      where: { challengeTokenHash: tokenHash }
    });
    return challenge ? mapLoginChallenge(challenge) : null;
  }

  async consumeLoginChallenge(id: string): Promise<void> {
    await this.prisma.loginChallenge.update({
      where: { id },
      data: { consumedAt: new Date() }
    });
  }
}
```

If the interface has additional methods, copy their behavior from `auth.pgRepository.ts` and implement them with Prisma.

- [ ] **Step 3: Create Prisma sessions repository**

Create `src/modules/sessions/sessions.prismaRepository.ts` by matching `SessionsRepository`. Use `sessionTokenHash` in Prisma for existing domain `tokenHash`.

For the common methods, use this shape:

```ts
import { type PrismaClient } from '@prisma/client';
import { randomToken } from '../../shared/crypto/randomToken.js';
import { mapSession } from '../../db/prismaMappers.js';
import type { Session } from './sessions.types.js';
import type { CreateSessionInput, SessionsRepository } from './sessions.repository.js';

export class PrismaSessionsRepository implements SessionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateSessionInput): Promise<Session> {
    const session = await this.prisma.session.create({
      data: {
        id: randomToken(16),
        userId: input.userId,
        sessionTokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        reauthenticatedAt: input.reauthenticatedAt ?? null
      }
    });
    return mapSession(session);
  }

  async findByTokenHash(tokenHash: string): Promise<Session | null> {
    const session = await this.prisma.session.findUnique({ where: { sessionTokenHash: tokenHash } });
    return session ? mapSession(session) : null;
  }

  async touch(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { lastSeenAt: at } });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { revokedAt: at } });
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: at }
    });
  }

  async markReauthenticated(id: string, at: Date): Promise<void> {
    await this.prisma.session.update({ where: { id }, data: { reauthenticatedAt: at } });
  }
}
```

If names differ, follow the exact interface in `sessions.repository.ts`.

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: fix method-name/type mismatches in the two new repositories before continuing.

- [ ] **Step 5: Commit auth/session repositories**

```bash
git add src/modules/auth/auth.prismaRepository.ts src/modules/sessions/sessions.prismaRepository.ts
git commit -m "chore: add prisma auth session repositories"
```

---

## Task 5: Migrate 2FA and OAuth repositories

**Files:**

- Create: `src/modules/two_factor/twoFactor.prismaRepository.ts`
- Create: `src/modules/oauth/oauth.prismaRepository.ts`

- [ ] **Step 1: Inspect interfaces**

Run:

```bash
sed -n '1,280p' src/modules/two_factor/twoFactor.repository.ts
sed -n '1,320p' src/modules/oauth/oauth.repository.ts
```

Expected: list every required method.

- [ ] **Step 2: Create Prisma 2FA repository**

Create `src/modules/two_factor/twoFactor.prismaRepository.ts` matching `TwoFactorRepository`. Copy behavior from `twoFactor.pgRepository.ts`, replacing SQL with Prisma methods:

- `twoFactorTotp.create/findUnique/update/delete`
- `recoveryCode.createMany/findMany/update/updateMany/count`

Use `mapTotpRecord` and `mapRecoveryCode` from `src/db/prismaMappers.ts`.

- [ ] **Step 3: Create Prisma OAuth repository**

Create `src/modules/oauth/oauth.prismaRepository.ts` matching `OAuthRepository`. Copy behavior from `oauth.pgRepository.ts`, replacing SQL with Prisma methods:

- `oauthState.create/findUnique/update`
- `oauthAccount.create/findFirst/findUnique/delete/count`

Use:

```ts
import {
  mapOAuthAccount,
  mapOAuthState,
  toPrismaOAuthProvider,
  toPrismaOAuthStatePurpose
} from '../../db/prismaMappers.js';
```

- [ ] **Step 4: Run build**

```bash
npm run build
```

Expected: fix method-name/type mismatches in the two new repositories before continuing.

- [ ] **Step 5: Commit 2FA/OAuth repositories**

```bash
git add src/modules/two_factor/twoFactor.prismaRepository.ts src/modules/oauth/oauth.prismaRepository.ts
git commit -m "chore: add prisma 2fa oauth repositories"
```

---

## Task 6: Wire Prisma repositories into the app

**Files:**

- Modify: `src/app.ts`

- [ ] **Step 1: Replace PostgreSQL imports in `src/app.ts`**

Remove imports:

```ts
import { createPgPool } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { PgUsersRepository } from './modules/users/users.pgRepository.js';
import { PgSessionsRepository } from './modules/sessions/sessions.pgRepository.js';
import { PgAuthRepository } from './modules/auth/auth.pgRepository.js';
import { PgTwoFactorRepository } from './modules/two_factor/twoFactor.pgRepository.js';
import { PgOAuthRepository } from './modules/oauth/oauth.pgRepository.js';
```

Add imports:

```ts
import { createPrismaClient } from './db/prisma.js';
import { PrismaUsersRepository } from './modules/users/users.prismaRepository.js';
import { PrismaSessionsRepository } from './modules/sessions/sessions.prismaRepository.js';
import { PrismaAuthRepository } from './modules/auth/auth.prismaRepository.js';
import { PrismaTwoFactorRepository } from './modules/two_factor/twoFactor.prismaRepository.js';
import { PrismaOAuthRepository } from './modules/oauth/oauth.prismaRepository.js';
```

- [ ] **Step 2: Replace pool setup with Prisma setup**

Replace the existing `pgPool` block with:

```ts
  const prisma = createPrismaClient();
  if (prisma) {
    app.addHook('onClose', async () => {
      await prisma.$disconnect();
    });
  }
```

- [ ] **Step 3: Replace repository construction**

Replace repository wiring with:

```ts
  const usersRepository = prisma ? new PrismaUsersRepository(prisma) : new InMemoryUsersRepository();
  const usersService = new UsersService(usersRepository);
  const sessionsRepository = prisma ? new PrismaSessionsRepository(prisma) : new InMemorySessionsRepository();
  const authRepository = prisma ? new PrismaAuthRepository(prisma) : new InMemoryAuthRepository();
  const twoFactorRepository = prisma ? new PrismaTwoFactorRepository(prisma) : new InMemoryTwoFactorRepository();
  const oauthRepository = prisma ? new PrismaOAuthRepository(prisma) : new InMemoryOAuthRepository();
```

Keep all service and route registration below unchanged.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: PASS. If it fails, fix only import/type/method mismatches introduced by the Prisma migration.

- [ ] **Step 5: Test**

```bash
npm test
```

Expected: PASS. Existing tests still use in-memory repositories.

- [ ] **Step 6: Commit app wiring**

```bash
git add src/app.ts
git commit -m "chore: wire prisma persistence"
```

---

## Task 7: Remove PostgreSQL implementation files

**Files:**

- Remove: `src/db/client.ts`
- Remove: `src/db/migrate.ts`
- Remove: `src/db/pgMappers.ts`
- Remove: `src/modules/users/users.pgRepository.ts`
- Remove: `src/modules/auth/auth.pgRepository.ts`
- Remove: `src/modules/sessions/sessions.pgRepository.ts`
- Remove: `src/modules/two_factor/twoFactor.pgRepository.ts`
- Remove: `src/modules/oauth/oauth.pgRepository.ts`
- Remove: `db/migrations/001_auth_base.sql`

- [ ] **Step 1: Search remaining PostgreSQL imports**

Run:

```bash
grep -R "pgRepository\|createPgPool\|runMigrations\|pgMappers\|from 'pg'\|from \"pg\"" -n src tests README.md DEV.md package.json
```

Expected: only documentation references remain before deletion.

- [ ] **Step 2: Remove old files**

Run:

```bash
rm src/db/client.ts src/db/migrate.ts src/db/pgMappers.ts \
  src/modules/users/users.pgRepository.ts \
  src/modules/auth/auth.pgRepository.ts \
  src/modules/sessions/sessions.pgRepository.ts \
  src/modules/two_factor/twoFactor.pgRepository.ts \
  src/modules/oauth/oauth.pgRepository.ts \
  db/migrations/001_auth_base.sql
```

- [ ] **Step 3: Remove empty migration directory if applicable**

Run:

```bash
rmdir db/migrations db 2>/dev/null || true
```

Expected: removes empty dirs only; ignores non-empty dirs.

- [ ] **Step 4: Build and test**

```bash
npm run build
npm test
```

Expected: both PASS.

- [ ] **Step 5: Commit removal**

```bash
git add -A src db
git commit -m "chore: remove manual postgres persistence"
```

---

## Task 8: Update documentation

**Files:**

- Modify: `README.md`
- Modify: `DEV.md`
- Optionally modify: `docker-compose.yml`

- [ ] **Step 1: Update README persistence section**

Replace PostgreSQL setup text with:

```md
## Database

The backend uses Prisma ORM with SQLite by default.

Create a local `.env` from `.env.example` and keep:

```env
DATABASE_URL="file:./dev.db"
```

Generate the Prisma client and apply migrations:

```bash
npm install
npx prisma generate
npx prisma migrate dev
```

Start the backend:

```bash
npm run build
npm start
```
```

- [ ] **Step 2: Update DEV architecture notes**

Remove claims that the backend intentionally avoids ORMs. Replace with:

```md
## Persistence

The project uses Prisma ORM with SQLite. This keeps persistence simple for the 42 project while still giving typed access to users, sessions, OAuth state, 2FA records, and future game models.

Manual SQL is avoided in application code. Schema changes should go through `prisma/schema.prisma` and Prisma migrations.
```

- [ ] **Step 3: Decide docker-compose treatment**

If `docker-compose.yml` only starts PostgreSQL, remove it:

```bash
git rm docker-compose.yml
```

If it is already used for the full stack, leave it and remove only PostgreSQL service references.

- [ ] **Step 4: Documentation grep**

Run:

```bash
grep -R "PostgreSQL\|pgRepository\|manual SQL\|Cero cajas negras\|ORM" -n README.md DEV.md docs | sed -n '1,160p'
```

Expected: no stale recommendations against ORM remain, except historical design docs under `docs/superpowers` if kept intentionally.

- [ ] **Step 5: Final verification**

```bash
npm run build
npm test
```

Expected: both PASS.

- [ ] **Step 6: Commit docs**

```bash
git add README.md DEV.md docker-compose.yml
git commit -m "docs: document prisma sqlite persistence"
```

---

## Task 9: Final review

**Files:**

- Inspect all changed files.

- [ ] **Step 1: Check working tree**

```bash
git status --short
```

Expected: clean, or only intentionally untracked local SQLite files ignored by `.gitignore`.

- [ ] **Step 2: Check for SQLite DB being tracked**

```bash
git status --short | grep -E "dev.db|\.db" || true
```

Expected: no database file staged/tracked.

- [ ] **Step 3: Add SQLite ignore rules if needed**

If DB files appear, add to `.gitignore`:

```gitignore
prisma/dev.db
prisma/dev.db-journal
*.db
*.db-journal
```

Then unstage DB files:

```bash
git restore --staged prisma/dev.db prisma/dev.db-journal 2>/dev/null || true
```

- [ ] **Step 4: Final build/test**

```bash
npm run build
npm test
```

Expected: both PASS.

- [ ] **Step 5: Summarize result**

Prepare a short summary:

```md
Implemented Prisma + SQLite persistence migration.

Verification:
- npm run build: PASS
- npm test: PASS

Notes:
- Existing auth/OAuth/2FA behavior preserved.
- In-memory test repositories remain unchanged.
- Game models are intentionally left for the next implementation block.
```
