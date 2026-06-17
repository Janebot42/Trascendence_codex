import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { securityConfig } from '../../config/security.js';
import { forbidden } from '../../shared/errors/httpErrors.js';
import { requireAuth } from '../authorization/requireAuth.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import type { TwoFactorService } from './twoFactor.service.js';

function assertRecentReauthentication(reauthenticatedAt: Date | null): void {
  if (!reauthenticatedAt || Date.now() - reauthenticatedAt.getTime() > securityConfig.sensitiveActionTtlMs) {
    throw forbidden('Recent reauthentication required', 'REAUTHENTICATION_REQUIRED');
  }
}

export async function registerTwoFactorRoutes(
  app: FastifyInstance,
  twoFactorService: TwoFactorService,
  sessionsService: SessionsService
) {
  app.post('/2fa/setup', { preHandler: requireAuth(sessionsService) }, async (request) => {
    assertRecentReauthentication(request.currentSession!.reauthenticatedAt);
    return twoFactorService.beginTotpSetup(request.currentUser!.id);
  });

  app.post('/2fa/confirm', { preHandler: requireAuth(sessionsService) }, async (request) => {
    assertRecentReauthentication(request.currentSession!.reauthenticatedAt);
    const body = z.object({ code: z.string().min(6) }).parse(request.body);
    const recoveryCodes = await twoFactorService.confirmTotpSetup(request.currentUser!.id, body.code);
    return { recoveryCodes };
  });

  app.post('/2fa/recovery-codes/regenerate', { preHandler: requireAuth(sessionsService) }, async (request) => {
    assertRecentReauthentication(request.currentSession!.reauthenticatedAt);
    const recoveryCodes = await twoFactorService.regenerateRecoveryCodes(request.currentUser!.id);
    return { recoveryCodes };
  });

  app.delete('/2fa', { preHandler: requireAuth(sessionsService) }, async (request) => {
    assertRecentReauthentication(request.currentSession!.reauthenticatedAt);
    await twoFactorService.disableTwoFactor(request.currentUser!.id);
    await sessionsService.revokeOtherUserSessions(request.currentUser!.id, request.currentSession!.id);
    return { ok: true };
  });
}
