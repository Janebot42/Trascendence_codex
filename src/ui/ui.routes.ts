import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

const publicDir = join(process.cwd(), 'public');

export async function registerUiRoutes(app: FastifyInstance) {
  app.get('/', async (_request, reply) => {
    const html = await readFile(join(publicDir, 'index.html'), 'utf8');
    return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(html);
  });

  app.get('/privacy', async (_request, reply) => {
    const html = await readFile(join(publicDir, 'privacy.html'), 'utf8');
    return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(html);
  });

  app.get('/terms', async (_request, reply) => {
    const html = await readFile(join(publicDir, 'terms.html'), 'utf8');
    return reply.header('cache-control', 'no-store').type('text/html; charset=utf-8').send(html);
  });

  app.get('/ui/app.css', async (_request, reply) => {
    const css = await readFile(join(publicDir, 'app.css'), 'utf8');
    return reply.header('cache-control', 'no-store').type('text/css; charset=utf-8').send(css);
  });

  app.get('/ui/app.js', async (_request, reply) => {
    const js = await readFile(join(publicDir, 'app.js'), 'utf8');
    return reply.header('cache-control', 'no-store').type('application/javascript; charset=utf-8').send(js);
  });

  app.get('/vendor/three.module.js', async (_request, reply) => {
    const js = await readFile(join(process.cwd(), 'node_modules', 'three', 'build', 'three.module.js'), 'utf8');
    return reply.header('cache-control', 'public, max-age=3600').type('application/javascript; charset=utf-8').send(js);
  });

  app.get('/vendor/:file', async (request, reply) => {
    const params = request.params as { file: string };
    const file = basename(params.file);
    if (!file.endsWith('.js')) return reply.status(404).send({ error: 'NOT_FOUND' });

    const js = await readFile(join(process.cwd(), 'node_modules', 'three', 'build', file), 'utf8');
    return reply.header('cache-control', 'public, max-age=3600').type('application/javascript; charset=utf-8').send(js);
  });
}
