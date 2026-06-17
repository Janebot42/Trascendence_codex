import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.TOTP_ENCRYPTION_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const { buildApp } = await import('../../dist/app.js');

function sessionCookie(response) {
  const raw = response.headers['set-cookie'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  assert.ok(value);
  return value.split(';')[0];
}

async function registerUser(app, username) {
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
  return { cookie: sessionCookie(response), user: response.json().user };
}

test('authenticated users can record finished matches and read their match history', async () => {
  const app = await buildApp();

  try {
    const alice = await registerUser(app, 'alice');
    const bob = await registerUser(app, 'bob');

    const create = await app.inject({
      method: 'POST',
      url: '/matches',
      headers: { cookie: alice.cookie },
      payload: {
        players: [
          { userId: alice.user.id, score: 11 },
          { userId: bob.user.id, score: 7 }
        ]
      }
    });

    assert.equal(create.statusCode, 200);
    assert.equal(create.json().match.status, 'finished');
    assert.equal(create.json().match.players.length, 2);
    assert.equal(create.json().match.winnerUserId, alice.user.id);

    const history = await app.inject({
      method: 'GET',
      url: `/users/${alice.user.id}/matches`,
      headers: { cookie: alice.cookie }
    });

    assert.equal(history.statusCode, 200);
    assert.equal(history.json().matches.length, 1);
    assert.equal(history.json().matches[0].id, create.json().match.id);
  } finally {
    await app.close();
  }
});

test('matches reject unauthenticated and invalid player payloads', async () => {
  const app = await buildApp();

  try {
    const alice = await registerUser(app, 'alice2');

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/matches',
      payload: { players: [{ userId: alice.user.id, score: 1 }] }
    });
    assert.equal(unauthenticated.statusCode, 401);

    const invalidPlayers = await app.inject({
      method: 'POST',
      url: '/matches',
      headers: { cookie: alice.cookie },
      payload: { players: [{ userId: alice.user.id, score: 1 }] }
    });
    assert.equal(invalidPlayers.statusCode, 400);
    assert.equal(invalidPlayers.json().error, 'VALIDATION_ERROR');
  } finally {
    await app.close();
  }
});

test('authenticated users can post and list lobby chat messages', async () => {
  const app = await buildApp();

  try {
    const alice = await registerUser(app, 'chat_alice');
    const bob = await registerUser(app, 'chat_bob');

    const first = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { cookie: alice.cookie },
      payload: { body: 'hola bob' }
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().message.authorUserId, alice.user.id);
    assert.equal(first.json().message.body, 'hola bob');
    assert.equal(first.json().message.scope, 'lobby');

    const second = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { cookie: bob.cookie },
      payload: { body: 'hola alice' }
    });
    assert.equal(second.statusCode, 200);

    const list = await app.inject({
      method: 'GET',
      url: '/chat/messages',
      headers: { cookie: alice.cookie }
    });

    assert.equal(list.statusCode, 200);
    assert.deepEqual(
      list.json().messages.map((message) => message.body),
      ['hola alice', 'hola bob']
    );
  } finally {
    await app.close();
  }
});

test('chat rejects unauthenticated users and empty messages', async () => {
  const app = await buildApp();

  try {
    const alice = await registerUser(app, 'chat_invalid');

    const unauthenticated = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      payload: { body: 'nope' }
    });
    assert.equal(unauthenticated.statusCode, 401);

    const empty = await app.inject({
      method: 'POST',
      url: '/chat/messages',
      headers: { cookie: alice.cookie },
      payload: { body: '   ' }
    });
    assert.equal(empty.statusCode, 400);
    assert.equal(empty.json().error, 'VALIDATION_ERROR');
  } finally {
    await app.close();
  }
});
