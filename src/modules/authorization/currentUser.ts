import type { User } from '../users/users.types.js';
import type { Session } from '../sessions/sessions.types.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: User;
    currentSession?: Session;
  }
}

