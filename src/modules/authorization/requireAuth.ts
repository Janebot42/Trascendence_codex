import type { FastifyReply, FastifyRequest } from 'fastify';
import { securityConfig } from '../../config/security.js';
import { unauthorized } from '../../shared/errors/httpErrors.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import './currentUser.js';

export function requireAuth(sessionsService: SessionsService) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies[securityConfig.cookieName];
    if (!token) throw unauthorized();

    const sessionWithUser = await sessionsService.getSessionFromToken(token);
    if (!sessionWithUser) throw unauthorized();

    request.currentSession = sessionWithUser.session;
    request.currentUser = sessionWithUser.user;
  };
}

