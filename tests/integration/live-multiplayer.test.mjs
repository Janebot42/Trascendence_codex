import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WebSocket } from 'ws';

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

class LiveClient {
  constructor(url, cookie) {
    this.messages = [];
    this.waiters = [];
    this.socket = new WebSocket(url, { headers: { cookie } });
    this.socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      const waiterIndex = this.waiters.findIndex((waiter) => waiter.matches(message));
      if (waiterIndex >= 0) {
        const [waiter] = this.waiters.splice(waiterIndex, 1);
        clearTimeout(waiter.timer);
        waiter.resolve(message);
        return;
      }
      this.messages.push(message);
    });
  }

  waitFor(type, predicate = () => true, timeoutMs = 4000) {
    const matches = (message) => message.type === type && predicate(message.payload);
    const queuedIndex = this.messages.findIndex(matches);
    if (queuedIndex >= 0) return Promise.resolve(this.messages.splice(queuedIndex, 1)[0]);

    return new Promise((resolve, reject) => {
      const waiter = { matches, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(new Error(`Timed out waiting for ${type}`));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  send(type, payload = {}) {
    this.socket.send(JSON.stringify({ type, payload }));
  }

  close() {
    this.socket.terminate();
  }
}

test('two users can chat, invite each other and play in the same live match', async () => {
  const app = await buildApp();
  let aliceClient;
  let bobClient;

  try {
    const alice = await registerUser(app, 'live_alice');
    const bob = await registerUser(app, 'live_bob');
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const wsUrl = `${address.replace(/^http/, 'ws')}/ws`;

    aliceClient = new LiveClient(wsUrl, alice.cookie);
    bobClient = new LiveClient(wsUrl, bob.cookie);

    await Promise.all([
      aliceClient.waitFor('session:ready'),
      bobClient.waitFor('session:ready')
    ]);

    const aliceChat = aliceClient.waitFor('chat:message', (payload) => payload.message.body === 'Hello from Alice');
    const bobChat = bobClient.waitFor('chat:message', (payload) => payload.message.body === 'Hello from Alice');
    aliceClient.send('chat:send', { body: 'Hello from Alice' });

    const [aliceChatMessage, bobChatMessage] = await Promise.all([aliceChat, bobChat]);
    assert.equal(aliceChatMessage.payload.message.authorUserId, alice.user.id);
    assert.equal(bobChatMessage.payload.message.authorUserId, alice.user.id);

    const invitation = bobClient.waitFor('chat:invite');
    aliceClient.send('chat:invite', { toUserId: bob.user.id });
    assert.equal((await invitation).payload.fromUserId, alice.user.id);

    const aliceStart = aliceClient.waitFor('game:start');
    const bobStart = bobClient.waitFor('game:start');
    aliceClient.send('queue:join', { botDifficulty: 1 });
    bobClient.send('queue:join', { botDifficulty: 5 });

    const [aliceRoom, bobRoom] = await Promise.all([aliceStart, bobStart]);
    assert.equal(aliceRoom.payload.id, bobRoom.payload.id);
    assert.deepEqual(new Set(aliceRoom.payload.players), new Set([alice.user.id, bob.user.id]));
    assert.equal(aliceRoom.payload.botUserId, null);

    const bothPaddlesMoved = aliceClient.waitFor(
      'game:state',
      (room) => room.paddleY[alice.user.id] > 0 && room.paddleY[bob.user.id] < 0
    );
    aliceClient.send('game:input', { up: true, down: false });
    bobClient.send('game:input', { up: false, down: true });

    const liveState = await bothPaddlesMoved;
    assert.ok(liveState.payload.paddleY[alice.user.id] > 0);
    assert.ok(liveState.payload.paddleY[bob.user.id] < 0);

    const persistedChat = await app.inject({
      method: 'GET',
      url: '/chat/messages',
      headers: { cookie: bob.cookie }
    });
    assert.equal(persistedChat.statusCode, 200);
    assert.ok(persistedChat.json().messages.some((message) => message.body === 'Hello from Alice'));
  } finally {
    aliceClient?.close();
    bobClient?.close();
    await app.close();
  }
});
