import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { clearSessionCookie, setSessionCookie } from '../../shared/http/cookies.js';
import { securityConfig } from '../../config/security.js';
import { forbidden } from '../../shared/errors/httpErrors.js';
import type { AuthService } from './auth.service.js';
import type { SessionsService } from '../sessions/sessions.service.js';
import { requireAuth } from '../authorization/requireAuth.js';
import type { LoginResult } from './auth.types.js';

const registerSchema = z.object({
  username: z.string().min(3).max(32),
  email: z.string().email().optional(),
  password: z.string().min(12)
});

const loginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(1)
});

const twoFactorLoginSchema = z.object({
  challengeToken: z.string().min(1),
  code: z.string().min(1),
  method: z.enum(['totp', 'recovery_code'])
});

function getUserAgent(header: string | string[] | undefined): string | null {
  if (!header) return null;
  return Array.isArray(header) ? header.join(', ') : header;
}

function toPublicLoginResult(result: LoginResult) {
  if (result.status === 'requires_2fa') {
    return result;
  }

  return {
    status: result.status,
    user: result.user,
    sessionExpiresAt: result.sessionExpiresAt
  };
}

export async function registerAuthRoutes(
  app: FastifyInstance,
  authService: AuthService,
  sessionsService: SessionsService
) {
  app.post('/auth/register', async (request, reply) => {
    const body = registerSchema.parse(request.body);
    const result = await authService.register({
      ...body,
      ipAddress: request.ip,
      userAgent: getUserAgent(request.headers['user-agent'])
    });

    if (result.status === 'authenticated') {
      setSessionCookie(reply, result.sessionToken, result.sessionExpiresAt);
    }
    return toPublicLoginResult(result);
  });

  app.post('/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body);
    const result = await authService.login({
      ...body,
      ipAddress: request.ip,
      userAgent: getUserAgent(request.headers['user-agent'])
    });

    if (result.status === 'authenticated') {
      setSessionCookie(reply, result.sessionToken, result.sessionExpiresAt);
    }
    return toPublicLoginResult(result);
  });

  app.post('/auth/login/2fa', async (request, reply) => {
    const body = twoFactorLoginSchema.parse(request.body);
    const result = await authService.completeTwoFactorLogin({
      ...body,
      ipAddress: request.ip,
      userAgent: getUserAgent(request.headers['user-agent'])
    });

    if (result.status === 'authenticated') {
      setSessionCookie(reply, result.sessionToken, result.sessionExpiresAt);
    }
    return toPublicLoginResult(result);
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[securityConfig.cookieName];
    if (token) await sessionsService.revokeSession(token);
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.post('/auth/reauthenticate', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const body = z
      .object({
        password: z.string().min(1),
        secondFactorCode: z.string().min(1).optional(),
        secondFactorMethod: z.enum(['totp', 'recovery_code']).optional()
      })
      .parse(request.body);
    await authService.reauthenticate({
      userId: request.currentUser!.id,
      password: body.password,
      sessionId: request.currentSession!.id,
      secondFactorCode: body.secondFactorCode,
      secondFactorMethod: body.secondFactorMethod
    });
    return { ok: true };
  });

  app.post('/auth/password/change', { preHandler: requireAuth(sessionsService) }, async (request) => {
    const body = z.object({ newPassword: z.string().min(12) }).parse(request.body);
    const reauthenticatedAt = request.currentSession!.reauthenticatedAt;
    if (!reauthenticatedAt || Date.now() - reauthenticatedAt.getTime() > securityConfig.sensitiveActionTtlMs) {
      throw forbidden('Recent reauthentication required', 'REAUTHENTICATION_REQUIRED');
    }
    await authService.changePassword(request.currentUser!.id, body.newPassword);
    await sessionsService.revokeOtherUserSessions(request.currentUser!.id, request.currentSession!.id);
    return { ok: true };
  });
}
