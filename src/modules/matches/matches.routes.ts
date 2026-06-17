import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../authorization/requireAuth.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { MatchesService } from './matches.service.js';

const createFinishedMatchSchema = z.object({
  players: z.array(z.object({ userId: z.string().min(1), score: z.number().int().min(0) })).min(2).max(8)
});

export async function registerMatchRoutes(app: FastifyInstance, sessionsService: SessionsService, matchesService: MatchesService) {
  app.post('/matches', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const body = createFinishedMatchSchema.parse(request.body);
    const match = await matchesService.createFinishedMatch(body);
    return { match };
  });

  app.get('/users/:userId/matches', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const matches = await matchesService.listUserMatches(params.userId, 20);
    return { matches };
  });

  app.get('/users/:userId/stats', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    return { stats: await matchesService.getUserStats(params.userId) };
  });

  app.get('/leaderboard', { preHandler: requireAuth(sessionsService) }, async () => ({
    leaderboard: await matchesService.getLeaderboard(20)
  }));
}
