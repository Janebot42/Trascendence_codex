# OAuth 42 Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add OAuth 2.0 login with 42 to the existing backend while preserving local cookie sessions and existing TOTP 2FA behavior.

**Architecture:** Introduce a focused `oauth` module responsible for provider state, callback exchange, and local account resolution. Keep session creation and second-factor completion aligned with the existing auth flow so OAuth acts as another first-factor entry point.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/in-memory repositories, Node built-in fetch, existing integration test suite.

---

## File Structure

### New files
- `src/modules/oauth/oauth.types.ts` — types for OAuth provider profile, state records, account records, and callback results.
- `src/modules/oauth/oauth.repository.ts` — in-memory repository + interface for oauth states/accounts.
- `src/modules/oauth/oauth.pgRepository.ts` — PostgreSQL repository for oauth states/accounts.
- `src/modules/oauth/oauth.service.ts` — start login, validate callback, fetch profile, resolve local user, and return session-or-2FA result.
- `src/modules/oauth/oauth.routes.ts` — `/auth/oauth/42` and `/auth/oauth/42/callback` routes.
- `tests/integration/oauth-flow.test.mjs` — integration coverage for OAuth start/callback, state validation, local session creation, and 2FA handoff.

### Modified files
- `db/migrations/001_auth_base.sql` — add `oauth_accounts` and `oauth_states`.
- `.env.example` — add OAuth env vars.
- `src/config/env.ts` — parse OAuth config.
- `src/config/security.ts` — add oauth state TTL if needed.
- `src/app.ts` — wire oauth repository/service/routes.
- `src/modules/auth/auth.service.ts` — expose helper for finalizing login after external identity if needed.
- `src/modules/users/users.service.ts` — helper to create or look up user for OAuth flow if missing.
- `README.md` / `DEV.md` — document OAuth setup and flow.

---

### Task 1: Add failing integration tests for OAuth start and callback

**Files:**
- Create: `tests/integration/oauth-flow.test.mjs`
- Test: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.TOTP_ENCRYPTION_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
process.env.OAUTH_42_CLIENT_ID = 'client-id';
process.env.OAUTH_42_CLIENT_SECRET = 'client-secret';
process.env.OAUTH_42_REDIRECT_URI = 'http://127.0.0.1:3000/auth/oauth/42/callback';
process.env.OAUTH_42_AUTHORIZE_URL = 'https://example.test/oauth/authorize';
process.env.OAUTH_42_TOKEN_URL = 'https://example.test/oauth/token';
process.env.OAUTH_42_ME_URL = 'https://example.test/v2/me';

const { buildApp } = await import('../../dist/app.js');

test('starts OAuth login with redirect and validates callback into local session', async () => {
  const app = await buildApp();
  try {
    const start = await app.inject({ method: 'GET', url: '/auth/oauth/42' });
    assert.equal(start.statusCode, 302);
    assert.match(start.headers.location, /oauth\/authorize/);
    const state = new URL(start.headers.location).searchParams.get('state');
    assert.ok(state);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/oauth-flow.test.mjs`
Expected: FAIL with missing route or missing OAuth wiring.

- [ ] **Step 3: Write minimal implementation**

```ts
// placeholder route shape to satisfy the first redirect test
app.get('/auth/oauth/42', async (_request, reply) => {
  return reply.redirect('https://example.test/oauth/authorize?state=placeholder');
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/integration/oauth-flow.test.mjs`
Expected: PASS for redirect shape.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/oauth-flow.test.mjs src/app.ts
git commit -m "test: add initial oauth redirect coverage"
```

### Task 2: Add OAuth config and persistence with failing tests for state lifecycle

**Files:**
- Modify: `src/config/env.ts`
- Modify: `src/config/security.ts`
- Modify: `db/migrations/001_auth_base.sql`
- Create: `src/modules/oauth/oauth.types.ts`
- Create: `src/modules/oauth/oauth.repository.ts`
- Create: `src/modules/oauth/oauth.pgRepository.ts`
- Test: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Extend the failing test for callback state validation**

```javascript
test('rejects oauth callback with invalid state', async () => {
  const app = await buildApp();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/auth/oauth/42/callback?code=fake-code&state=bad-state'
    });
    assert.equal(response.statusCode, 401);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/integration/oauth-flow.test.mjs`
Expected: FAIL because callback route/state store does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type OAuthStateRecord = {
  id: string;
  provider: '42';
  stateTokenHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
};
```

```sql
create table if not exists oauth_states (
  id text primary key,
  provider text not null check (provider in ('42')),
  state_token_hash text not null unique,
  redirect_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npm test -- tests/integration/oauth-flow.test.mjs`
Expected: PASS for invalid state rejection.

- [ ] **Step 5: Commit**

```bash
git add src/config/env.ts src/config/security.ts db/migrations/001_auth_base.sql src/modules/oauth tests/integration/oauth-flow.test.mjs
git commit -m "feat: add oauth state persistence"
```

### Task 3: Implement provider callback exchange and local account linking through failing tests

**Files:**
- Modify: `tests/integration/oauth-flow.test.mjs`
- Modify: `src/app.ts`
- Create: `src/modules/oauth/oauth.service.ts`
- Create: `src/modules/oauth/oauth.routes.ts`
- Modify: `src/modules/users/users.service.ts`

- [ ] **Step 1: Write the failing callback success test**

```javascript
test('oauth callback creates a local session for a new 42 user', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    if (String(url).includes('/oauth/token')) {
      return new Response(JSON.stringify({ access_token: 'oauth-token', token_type: 'bearer' }), { status: 200 });
    }
    if (String(url).includes('/v2/me')) {
      return new Response(JSON.stringify({ id: 4242, login: 'pablo42', email: 'pablo42@example.test', displayname: 'Pablo 42' }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const app = await buildApp();
  try {
    const start = await app.inject({ method: 'GET', url: '/auth/oauth/42' });
    const state = new URL(start.headers.location).searchParams.get('state');
    const callback = await app.inject({ method: 'GET', url: `/auth/oauth/42/callback?code=ok-code&state=${state}` });
    assert.equal(callback.statusCode, 302);
    assert.ok(callback.headers['set-cookie']);
  } finally {
    global.fetch = originalFetch;
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npm test -- tests/integration/oauth-flow.test.mjs`
Expected: FAIL because token exchange/profile resolution/account linking are missing.

- [ ] **Step 3: Write minimal implementation**

```ts
const tokenResponse = await fetch(env.OAUTH_42_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: env.OAUTH_42_CLIENT_ID,
    client_secret: env.OAUTH_42_CLIENT_SECRET,
    code,
    redirect_uri: env.OAUTH_42_REDIRECT_URI
  })
});
```

```ts
const profileResponse = await fetch(env.OAUTH_42_ME_URL, {
  headers: { Authorization: `Bearer ${accessToken}` }
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npm test -- tests/integration/oauth-flow.test.mjs`
Expected: PASS with a new local session cookie after callback.

- [ ] **Step 5: Commit**

```bash
git add src/app.ts src/modules/oauth src/modules/users/users.service.ts tests/integration/oauth-flow.test.mjs
git commit -m "feat: add oauth callback login flow"
```

### Task 4: Reuse 2FA flow after OAuth via failing tests

**Files:**
- Modify: `tests/integration/oauth-flow.test.mjs`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/oauth/oauth.service.ts`
- Modify: `src/modules/two_factor/twoFactor.service.ts`

- [ ] **Step 1: Write the failing 2FA handoff test**

```javascript
test('oauth callback requires second factor when the local user has TOTP enabled', async () => {
  // register normal user, enable 2FA, link matching oauth account, then callback
  // expect redirect or JSON carrying requires_2fa challenge instead of session cookie
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && npm test -- tests/integration/oauth-flow.test.mjs`
Expected: FAIL because OAuth callback currently creates a final session unconditionally.

- [ ] **Step 3: Write minimal implementation**

```ts
if (await this.twoFactorService.isEnabled(user.id)) {
  const challengeToken = randomToken(32);
  const challenge = await this.authRepository.createLoginChallenge({
    userId: user.id,
    tokenHash: hashToken(challengeToken),
    expiresAt: new Date(Date.now() + securityConfig.loginChallengeTtlMs),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null
  });
  return { status: 'requires_2fa', challengeToken, expiresAt: challenge.expiresAt };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && npm test -- tests/integration/oauth-flow.test.mjs`
Expected: PASS with `requires_2fa` result and no session cookie.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/auth.service.ts src/modules/oauth/oauth.service.ts tests/integration/oauth-flow.test.mjs
git commit -m "feat: require 2fa after oauth login when enabled"
```

### Task 5: Update docs and run full verification

**Files:**
- Modify: `README.md`
- Modify: `DEV.md`
- Test: `tests/integration/auth-flow.test.mjs`
- Test: `tests/integration/oauth-flow.test.mjs`
- Test: `tests/integration/ui.test.mjs`

- [ ] **Step 1: Add failing docs expectation by checking current docs are missing OAuth setup**

```bash
grep -n "OAuth" README.md DEV.md
```

Expected: no complete OAuth setup section yet.

- [ ] **Step 2: Update docs with exact setup and flow**

```md
## OAuth 42

Set these variables in `.env`:
- `OAUTH_42_CLIENT_ID`
- `OAUTH_42_CLIENT_SECRET`
- `OAUTH_42_REDIRECT_URI`
```

- [ ] **Step 3: Run full verification**

Run: `npm run build && npm test`
Expected: all auth, oauth, and UI integration tests PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md DEV.md tests/integration/oauth-flow.test.mjs
git commit -m "docs: document oauth 42 setup and flow"
```
