import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../authorization/requireAuth.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { ChatService } from './chat.service.js';

const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(1000)
});

export async function registerChatRoutes(app: FastifyInstance, sessionsService: SessionsService, chatService: ChatService) {
  app.post('/chat/messages', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const body = postMessageSchema.parse(request.body);
    const message = await chatService.postLobbyMessage(request.currentUser!.id, body.body);
    return { message };
  });

  app.get('/chat/messages', { preHandler: requireAuth(sessionsService) }, async () => {
    const messages = await chatService.listLobbyMessages(50);
    return { messages };
  });

  app.post('/chat/direct/:userId/messages', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const body = postMessageSchema.parse(request.body);
    const message = await chatService.postDirectMessage(request.currentUser!.id, params.userId, body.body);
    return { message };
  });

  app.get('/chat/direct/:userId/messages', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const params = z.object({ userId: z.string().min(1) }).parse(request.params);
    const messages = await chatService.listDirectMessages(request.currentUser!.id, params.userId, 50);
    return { messages };
  });
}
