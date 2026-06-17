import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.TOTP_ENCRYPTION_KEY_BASE64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

const { buildApp } = await import('../../dist/app.js');

test('serves the pong application UI and legal pages', async () => {
  const app = await buildApp();

  try {
    const html = await app.inject({ method: 'GET', url: '/' });
    assert.equal(html.statusCode, 200);
    assert.match(html.headers['content-type'], /text\/html/);
    assert.match(html.payload, /Transcendence Pong/);
    assert.match(html.payload, /Privacy Policy/);
    assert.match(html.payload, /Terms of Service/);

    const css = await app.inject({ method: 'GET', url: '/ui/app.css' });
    assert.equal(css.statusCode, 200);
    assert.match(css.headers['content-type'], /text\/css/);

    const js = await app.inject({ method: 'GET', url: '/ui/app.js' });
    assert.equal(js.statusCode, 200);
    assert.match(js.headers['content-type'], /application\/javascript/);
    assert.match(js.payload, /WebSocket/);

    const privacy = await app.inject({ method: 'GET', url: '/privacy' });
    assert.equal(privacy.statusCode, 200);
    assert.match(privacy.payload, /match, friendship and chat data/);

    const terms = await app.inject({ method: 'GET', url: '/terms' });
    assert.equal(terms.statusCode, 200);
    assert.match(terms.payload, /Game results are recorded/);
  } finally {
    await app.close();
  }
});
