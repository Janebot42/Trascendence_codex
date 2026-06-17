import type { FastifyReply, FastifyRequest } from 'fastify';
import { forbidden, unauthorized } from '../../shared/errors/httpErrors.js';
import type { UserRole } from '../users/users.types.js';
import './currentUser.js';

export function requireRole(role: UserRole) {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    if (!request.currentUser) throw unauthorized();
    if (request.currentUser.role !== role) throw forbidden();
  };
}

