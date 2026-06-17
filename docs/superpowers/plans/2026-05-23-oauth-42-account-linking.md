# OAuth 42 Account Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add explicit OAuth 42 link/unlink flows for authenticated users without weakening the hardened OAuth login path.

**Architecture:** Extend the existing `oauth` module with a second purpose besides login: account linking. Persist the purpose and initiating user in `oauth_states`, require recent strong reauthentication before link/unlink, and centralize the “account still has a viable access method” rule inside the OAuth service/repository layer.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/in-memory repositories, existing cookie session auth, existing TOTP/reauth flow, Node test runner.

---

## File Structure

### Files to modify
- `db/migrations/001_auth_base.sql` — add `purpose` and `initiating_user_id` to `oauth_states`.
- `src/db/pgMappers.ts` — map the new `oauth_states` columns.
- `src/modules/oauth/oauth.types.ts` — extend OAuth state types and add small response/result types for link/unlink.
- `src/modules/oauth/oauth.repository.ts` — support creating states with purpose/user, counting linked OAuth accounts for a user, finding by user/provider, and deleting an account link.
- `src/modules/oauth/oauth.pgRepository.ts` — PostgreSQL implementation for those repository methods.
- `src/modules/oauth/oauth.service.ts` — add link-start, link-callback, unlink, reauth checks, and viable-access checks.
- `src/modules/oauth/oauth.routes.ts` — add routes for link start, link callback, and unlink.
- `src/modules/auth/auth.routes.ts` or `src/modules/oauth/oauth.routes.ts` — reuse the current sensitive-action reauth window consistently.
- `README.md` — mention link/unlink behavior.
- `DEV.md` — document link vs login purpose split and unlink rule.

### Files to create
- None required if the existing module stays focused.

### Tests to modify/create
- `tests/integration/oauth-flow.test.mjs` — add coverage for linking, unlinking, reauth requirement, and viability rule.

---

### Task 1: Add failing tests for link start and link callback purpose separation

**Files:**
- Modify: `tests/integration/oauth-flow.test.mjs`
- Test: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Write the failing test**

```javascript
test('starts OAuth link only for a recently reauthenticated session', async () => {
  const app = await buildApp();
  try {
    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'linkowner',
        email: 'linkowner@example.test',
        password: 'correct horse battery staple'
      }
    });
    const sidCookie = sessionCookie(register);

    const withoutReauth = await app.inject({
      method: 'POST',
      url: '/auth/oauth/42/link/start',
      headers: { cookie: sidCookie }
    });
    assert.equal(withoutReauth.statusCode, 403);
    assert.equal(withoutReauth.json().error, 'REAUTHENTICATION_REQUIRED');
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: FAIL with missing route or wrong status because link flow does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```ts
app.post('/auth/oauth/42/link/start', { preHandler: requireAuth(sessionsService) }, async (request) => {
  const reauthenticatedAt = request.currentSession!.reauthenticatedAt;
  if (!reauthenticatedAt || Date.now() - reauthenticatedAt.getTime() > securityConfig.sensitiveActionTtlMs) {
    throw forbidden('Recent reauthentication required', 'REAUTHENTICATION_REQUIRED');
  }
  return { ok: true };
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: PASS for the new reauth gate test only.

- [ ] **Step 5: Commit**

```bash
git add tests/integration/oauth-flow.test.mjs src/modules/oauth/oauth.routes.ts
git commit -m "test: cover oauth link start reauth gate"
```

### Task 2: Add `purpose` and `initiating_user_id` to OAuth state persistence

**Files:**
- Modify: `db/migrations/001_auth_base.sql`
- Modify: `src/db/pgMappers.ts`
- Modify: `src/modules/oauth/oauth.types.ts`
- Modify: `src/modules/oauth/oauth.repository.ts`
- Modify: `src/modules/oauth/oauth.pgRepository.ts`
- Test: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Extend the failing test for linking callback**

```javascript
test('oauth link callback rejects a login state reused against the linking endpoint', async () => {
  const app = await buildApp();
  try {
    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'purposecheck',
        email: 'purposecheck@example.test',
        password: 'correct horse battery staple'
      }
    });
    const sidCookie = sessionCookie(register);

    const startLogin = await app.inject({ method: 'GET', url: '/auth/oauth/42' });
    const state = new URL(startLogin.headers.location).searchParams.get('state');

    const callback = await app.inject({
      method: 'GET',
      url: `/auth/oauth/42/link/callback?code=fake-code&state=${state}`,
      headers: { cookie: sidCookie }
    });
    assert.equal(callback.statusCode, 401);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: FAIL because states have no purpose split yet.

- [ ] **Step 3: Write minimal implementation**

```sql
alter table oauth_states add column if not exists purpose text not null default 'login'
  check (purpose in ('login', 'link'));
alter table oauth_states add column if not exists initiating_user_id text references users(id) on delete cascade;
```

```ts
export type OAuthStatePurpose = 'login' | 'link';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: PASS with callback rejecting wrong-purpose state.

- [ ] **Step 5: Commit**

```bash
git add db/migrations/001_auth_base.sql src/db/pgMappers.ts src/modules/oauth/oauth.types.ts src/modules/oauth/oauth.repository.ts src/modules/oauth/oauth.pgRepository.ts tests/integration/oauth-flow.test.mjs
git commit -m "feat: persist oauth state purpose and initiator"
```

### Task 3: Implement explicit link start and link callback

**Files:**
- Modify: `src/modules/oauth/oauth.service.ts`
- Modify: `src/modules/oauth/oauth.routes.ts`
- Modify: `tests/integration/oauth-flow.test.mjs`
- Test: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Write the failing happy-path linking test**

```javascript
test('links a 42 account to the current user after strong reauthentication', async () => {
  // register local user
  // reauthenticate
  // POST /auth/oauth/42/link/start
  // callback with mocked token/profile
  // verify { ok: true, linked: true }
});
```

Use concrete assertions:
- start route returns a redirect URL or `{ authorizationUrl }`
- callback returns 200
- callback does **not** create a new login session response body
- second callback for the same linked account returns idempotent success

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: FAIL because link callback behavior does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
async startFortyTwoLink(input: { userId: string }) {
  const state = randomToken(24);
  await this.oauthRepository.createState({
    provider: '42',
    purpose: 'link',
    initiatingUserId: input.userId,
    stateTokenHash: hashToken(state),
    redirectTo: null,
    expiresAt: new Date(Date.now() + securityConfig.oauthStateTtlMs)
  });
  return { authorizationUrl, state };
}
```

```ts
async completeFortyTwoLinkCallback(input: { code?: string; state?: string; browserState?: string | null; currentUserId: string }) {
  // validate cookie/state
  // consume state atomically
  // require purpose === 'link'
  // require initiatingUserId === currentUserId
  // exchange token + fetch profile
  // conflict if linked to another user
  // idempotent success if already linked to same user
  // create link otherwise
  return { ok: true, linked: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: PASS for explicit linking path.

- [ ] **Step 5: Commit**

```bash
git add src/modules/oauth/oauth.service.ts src/modules/oauth/oauth.routes.ts tests/integration/oauth-flow.test.mjs
git commit -m "feat: add explicit oauth account linking flow"
```

### Task 4: Implement unlink viability rules

**Files:**
- Modify: `src/modules/oauth/oauth.repository.ts`
- Modify: `src/modules/oauth/oauth.pgRepository.ts`
- Modify: `src/modules/oauth/oauth.service.ts`
- Modify: `src/modules/oauth/oauth.routes.ts`
- Modify: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Write the failing unlink tests**

```javascript
test('rejects unlink when oauth is the last viable access method', async () => {
  // create OAuth-only account path or simulate linked account without password
  // expect DELETE /auth/oauth/42/link -> 409 OAUTH_UNLINK_FORBIDDEN
});

test('allows unlink when the user still has a local password', async () => {
  // local user + linked OAuth
  // reauthenticate strongly
  // expect DELETE /auth/oauth/42/link -> 200 { ok: true, unlinked: true }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: FAIL because unlink route and viability checks do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
async canUserLoseThisOAuthLink(userId: string): Promise<boolean> {
  const hasPassword = await this.authRepository.findPasswordCredential(userId);
  const oauthCount = await this.oauthRepository.countAccountsForUser(userId);
  return Boolean(hasPassword) || oauthCount > 1;
}
```

```ts
async unlinkFortyTwo(input: { userId: string }) {
  const account = await this.oauthRepository.findAccountByUserIdAndProvider(input.userId, '42');
  if (!account) throw conflict('OAuth account is not linked', 'OAUTH_NOT_LINKED');
  if (!(await this.canUserLoseThisOAuthLink(input.userId))) {
    throw conflict('This account would lose all access methods', 'OAUTH_UNLINK_FORBIDDEN');
  }
  await this.oauthRepository.deleteAccount(account.id);
  return { ok: true, unlinked: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: PASS for unlink allowed/forbidden cases.

- [ ] **Step 5: Commit**

```bash
git add src/modules/oauth/oauth.repository.ts src/modules/oauth/oauth.pgRepository.ts src/modules/oauth/oauth.service.ts src/modules/oauth/oauth.routes.ts tests/integration/oauth-flow.test.mjs
git commit -m "feat: add oauth unlink viability checks"
```

### Task 5: Verify conflict handling and docs

**Files:**
- Modify: `README.md`
- Modify: `DEV.md`
- Modify: `tests/integration/oauth-flow.test.mjs`

- [ ] **Step 1: Add a failing conflict test**

```javascript
test('rejects linking when the 42 identity already belongs to another user', async () => {
  // user A links OAuth account
  // user B attempts linking same provider user id
  // expect 409 OAUTH_ALREADY_LINKED_TO_OTHER_USER
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build && node --test tests/integration/oauth-flow.test.mjs`
Expected: FAIL until conflict code/path is explicit.

- [ ] **Step 3: Write minimal implementation**

```ts
if (existingAccount && existingAccount.userId !== currentUserId) {
  throw conflict('This OAuth account already belongs to another user', 'OAUTH_ALREADY_LINKED_TO_OTHER_USER');
}
```

Update docs with:
- link requires strong reauth
- login callback and link callback are separate
- unlink forbidden when it would remove the last viable access method

- [ ] **Step 4: Run full verification**

Run: `npm run build && npm test`
Expected: all integration tests PASS, including login OAuth, link/unlink, auth, and UI tests.

- [ ] **Step 5: Commit**

```bash
git add README.md DEV.md tests/integration/oauth-flow.test.mjs src/modules/oauth/oauth.service.ts
git commit -m "docs: describe oauth link and unlink behavior"
```

## Self-review
- Spec coverage:
  - link start/callback covered in Tasks 1–3
  - `oauth_states.purpose` and `initiating_user_id` covered in Task 2
  - unlink viability rule covered in Task 4
  - conflict/error behavior covered in Task 5
- Placeholder scan: no `TODO`/`TBD`; all steps include files and concrete commands.
- Type consistency: route names, error codes, and state purpose names are consistent with the design doc.
