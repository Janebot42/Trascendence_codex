import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authenticator } from 'otplib';

process.env.NODE_ENV = 'test';
process.env.TOTP_ENCRYPTION_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const { buildApp } = await import('../../dist/app.js');

function sessionCookie(response) {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(value);
  return value.split(';')[0];
}

async function registerUser(app, username = 'alice') {
  const response = await app.inject({
    method: 'POST',
    url: '/auth/register',
    payload: {
      username,
      email: `${username}@example.test`,
      password: 'correct horse battery staple'
    }
  });
  assert.equal(response.statusCode, 200);
  return sessionCookie(response);
}

async function login(app, username = 'alice', password = 'correct horse battery staple') {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    payload: { username, password }
  });
}

async function enableTwoFactor(app, cookie) {
  const reauth = await app.inject({
    method: 'POST',
    url: '/auth/reauthenticate',
    headers: { cookie },
    payload: { password: 'correct horse battery staple' }
  });
  assert.equal(reauth.statusCode, 200);

  const setup = await app.inject({
    method: 'POST',
    url: '/2fa/setup',
    headers: { cookie }
  });
  assert.equal(setup.statusCode, 200);

  const secret = new URL(setup.json().provisioningUri).searchParams.get('secret');
  assert.ok(secret);

  const confirm = await app.inject({
    method: 'POST',
    url: '/2fa/confirm',
    headers: { cookie },
    payload: { code: authenticator.generate(secret) }
  });
  assert.equal(confirm.statusCode, 200);

  return {
    secret,
    recoveryCodes: confirm.json().recoveryCodes
  };
}

test('auth flow supports sessions, TOTP and one-use recovery codes', async () => {
  const app = await buildApp();

  try {
    const register = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: 'alice',
        email: 'alice@example.test',
        password: 'correct horse battery staple'
      }
    });
    assert.equal(register.statusCode, 200);
    const cookie = sessionCookie(register);

    const me = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie }
    });
    assert.equal(me.statusCode, 200);
    assert.equal(me.json().user.username, 'alice');

    const reauth = await app.inject({
      method: 'POST',
      url: '/auth/reauthenticate',
      headers: { cookie },
      payload: { password: 'correct horse battery staple' }
    });
    assert.equal(reauth.statusCode, 200);

    const setup = await app.inject({
      method: 'POST',
      url: '/2fa/setup',
      headers: { cookie }
    });
    assert.equal(setup.statusCode, 200);

    const provisioningUri = setup.json().provisioningUri;
    const secret = new URL(provisioningUri).searchParams.get('secret');
    assert.ok(secret);

    const confirm = await app.inject({
      method: 'POST',
      url: '/2fa/confirm',
      headers: { cookie },
      payload: { code: authenticator.generate(secret) }
    });
    assert.equal(confirm.statusCode, 200);
    const [recoveryCode] = confirm.json().recoveryCodes;
    assert.ok(recoveryCode);

    await app.inject({ method: 'POST', url: '/auth/logout', headers: { cookie } });

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'alice',
        password: 'correct horse battery staple'
      }
    });
    assert.equal(login.statusCode, 200);
    assert.equal(login.json().status, 'requires_2fa');
    assert.equal(login.headers['set-cookie'], undefined);

    const completeTotp = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: {
        challengeToken: login.json().challengeToken,
        method: 'totp',
        code: authenticator.generate(secret)
      }
    });
    assert.equal(completeTotp.statusCode, 200);
    assert.equal(completeTotp.json().status, 'authenticated');
    sessionCookie(completeTotp);

    const recoveryLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'alice',
        password: 'correct horse battery staple'
      }
    });
    assert.equal(recoveryLogin.json().status, 'requires_2fa');

    const completeRecovery = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: {
        challengeToken: recoveryLogin.json().challengeToken,
        method: 'recovery_code',
        code: recoveryCode
      }
    });
    assert.equal(completeRecovery.statusCode, 200);

    const reuseLogin = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: {
        username: 'alice',
        password: 'correct horse battery staple'
      }
    });

    const reuseRecovery = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: {
        challengeToken: reuseLogin.json().challengeToken,
        method: 'recovery_code',
        code: recoveryCode
      }
    });
    assert.equal(reuseRecovery.statusCode, 401);
  } finally {
    await app.close();
  }
});

test('rejects invalid credentials and protected routes without a session', async () => {
  const app = await buildApp();

  try {
    await registerUser(app, 'bob');

    const invalidPassword = await login(app, 'bob', 'wrong password');
    assert.equal(invalidPassword.statusCode, 401);
    assert.equal(invalidPassword.json().error, 'UNAUTHORIZED');
    assert.equal(invalidPassword.headers['set-cookie'], undefined);

    const missingSession = await app.inject({
      method: 'GET',
      url: '/me'
    });
    assert.equal(missingSession.statusCode, 401);
    assert.equal(missingSession.json().error, 'UNAUTHORIZED');
  } finally {
    await app.close();
  }
});

test('logout accepts requests without a JSON body', async () => {
  const app = await buildApp();

  try {
    const cookie = await registerUser(app, 'logoutbody');

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: {
        cookie,
        'content-type': 'application/json'
      }
    });
    assert.equal(logout.statusCode, 200);
    assert.equal(logout.json().ok, true);
  } finally {
    await app.close();
  }
});

test('normal users cannot access admin routes', async () => {
  const app = await buildApp();

  try {
    const cookie = await registerUser(app, 'carol');

    const adminUsers = await app.inject({
      method: 'GET',
      url: '/admin/users',
      headers: { cookie }
    });
    assert.equal(adminUsers.statusCode, 403);
    assert.equal(adminUsers.json().error, 'FORBIDDEN');
  } finally {
    await app.close();
  }
});

test('changing password requires reauthentication and revokes other sessions', async () => {
  const app = await buildApp();

  try {
    const firstCookie = await registerUser(app, 'dave');
    const secondLogin = await login(app, 'dave');
    assert.equal(secondLogin.statusCode, 200);
    const secondCookie = sessionCookie(secondLogin);

    const changeWithoutReauth = await app.inject({
      method: 'POST',
      url: '/auth/password/change',
      headers: { cookie: firstCookie },
      payload: { newPassword: 'new correct horse battery staple' }
    });
    assert.equal(changeWithoutReauth.statusCode, 403);

    const reauth = await app.inject({
      method: 'POST',
      url: '/auth/reauthenticate',
      headers: { cookie: firstCookie },
      payload: { password: 'correct horse battery staple' }
    });
    assert.equal(reauth.statusCode, 200);

    const change = await app.inject({
      method: 'POST',
      url: '/auth/password/change',
      headers: { cookie: firstCookie },
      payload: { newPassword: 'new correct horse battery staple' }
    });
    assert.equal(change.statusCode, 200);

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: secondCookie }
    });
    assert.equal(revokedSession.statusCode, 401);

    const oldPasswordLogin = await login(app, 'dave', 'correct horse battery staple');
    assert.equal(oldPasswordLogin.statusCode, 401);

    const newPasswordLogin = await login(app, 'dave', 'new correct horse battery staple');
    assert.equal(newPasswordLogin.statusCode, 200);
    assert.equal(newPasswordLogin.json().status, 'authenticated');
  } finally {
    await app.close();
  }
});

test('disabling 2FA requires strong reauthentication and revokes other sessions', async () => {
  const app = await buildApp();

  try {
    const firstCookie = await registerUser(app, 'erin');
    const { secret } = await enableTwoFactor(app, firstCookie);

    const pendingLogin = await login(app, 'erin');
    assert.equal(pendingLogin.statusCode, 200);
    assert.equal(pendingLogin.json().status, 'requires_2fa');

    const completeSecondSession = await app.inject({
      method: 'POST',
      url: '/auth/login/2fa',
      payload: {
        challengeToken: pendingLogin.json().challengeToken,
        method: 'totp',
        code: authenticator.generate(secret)
      }
    });
    assert.equal(completeSecondSession.statusCode, 200);
    const secondCookie = sessionCookie(completeSecondSession);

    const weakReauth = await app.inject({
      method: 'POST',
      url: '/auth/reauthenticate',
      headers: { cookie: firstCookie },
      payload: { password: 'correct horse battery staple' }
    });
    assert.equal(weakReauth.statusCode, 401);

    const strongReauth = await app.inject({
      method: 'POST',
      url: '/auth/reauthenticate',
      headers: { cookie: firstCookie },
      payload: {
        password: 'correct horse battery staple',
        secondFactorMethod: 'totp',
        secondFactorCode: authenticator.generate(secret)
      }
    });
    assert.equal(strongReauth.statusCode, 200);

    const disable = await app.inject({
      method: 'DELETE',
      url: '/2fa',
      headers: { cookie: firstCookie }
    });
    assert.equal(disable.statusCode, 200);

    const revokedSession = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: secondCookie }
    });
    assert.equal(revokedSession.statusCode, 401);

    const loginAfterDisable = await login(app, 'erin');
    assert.equal(loginAfterDisable.statusCode, 200);
    assert.equal(loginAfterDisable.json().status, 'authenticated');
    assert.equal(loginAfterDisable.json().challengeToken, undefined);
  } finally {
    await app.close();
  }
});
